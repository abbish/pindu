//! 本机的互传接口：监听 0.0.0.0（局域网里的设备要能连进来），TLS 握手要求对方出示证书，
//! 每个连接把对方编号与地址交给接口（`Peer`）。业务在 `Shared` 的 `on_*` 方法里。

use super::identity::fingerprint_of;
use super::package::MAX_MANIFEST_BYTES;
use super::protocol::*;
use super::transfer::{
    FinishResponse, OfferRequest, OfferResponse, ReceivedFiles, ResultResponse, OFFSET_HEADER,
    TOKEN_HEADER,
};
use super::Shared;
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Extension, Json, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{post, put};
use axum::Router;
use hyper_util::rt::{TokioIo, TokioTimer};
use hyper_util::service::TowerToHyperService;
use rustls::ServerConfig;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::watch;

#[derive(Clone)]
struct Peer {
    fingerprint: String,
    address: IpAddr,
}

type Reply<T> = Result<Json<T>, (StatusCode, String)>;

const MAX_CONNECTIONS: usize = 64;
const MAX_PER_ADDRESS: usize = 8;
/// 传文件以外的请求体要在这个时间内发完（防止慢速发送占着连接）
const BODY_WAIT: Duration = Duration::from_secs(30);
const MANIFEST_WAIT: Duration = Duration::from_secs(120);
const BODY_LIMIT: usize = 2 * 1024 * 1024;

type PerAddress = Arc<std::sync::Mutex<HashMap<IpAddr, usize>>>;

/// 一个地址占用的连接数，离开作用域时减一
struct AddressSlot {
    map: PerAddress,
    ip: IpAddr,
}

impl AddressSlot {
    fn take(map: &PerAddress, ip: IpAddr) -> Option<Self> {
        let mut m = map.lock().unwrap_or_else(|p| p.into_inner());
        let n = m.entry(ip).or_insert(0);
        if *n >= MAX_PER_ADDRESS {
            return None;
        }
        *n += 1;
        Some(Self {
            map: map.clone(),
            ip,
        })
    }
}

impl Drop for AddressSlot {
    fn drop(&mut self) {
        let mut m = self.map.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(n) = m.get_mut(&self.ip) {
            *n -= 1;
            if *n == 0 {
                m.remove(&self.ip);
            }
        }
    }
}

/// 传文件以外的请求：先在限定时间内把请求体读完（有大小上限），再交给接口
async fn read_body_in_time(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let path = req.uri().path();
    if path.contains("/files/") {
        return next.run(req).await;
    }
    let (limit, wait) = if path.ends_with("/manifest") {
        (MAX_MANIFEST_BYTES, MANIFEST_WAIT)
    } else {
        (BODY_LIMIT, BODY_WAIT)
    };
    let (parts, body) = req.into_parts();
    match tokio::time::timeout(wait, axum::body::to_bytes(body, limit)).await {
        Ok(Ok(bytes)) => {
            next.run(axum::extract::Request::from_parts(parts, Body::from(bytes)))
                .await
        }
        Ok(Err(_)) => (StatusCode::PAYLOAD_TOO_LARGE, "请求太大").into_response(),
        Err(_) => (StatusCode::REQUEST_TIMEOUT, "请求发送太慢").into_response(),
    }
}

pub(super) async fn serve(
    listener: TcpListener,
    config: Arc<ServerConfig>,
    shared: Arc<Shared>,
    mut shutdown: watch::Receiver<bool>,
) {
    let acceptor = tokio_rustls::TlsAcceptor::from(config);
    let router = Router::new()
        .route(&format!("{API}/register"), post(register))
        .route(&format!("{API}/pair/start"), post(pair_start))
        .route(&format!("{API}/pair/confirm"), post(pair_confirm))
        .route(&format!("{API}/pair/cancel"), post(pair_cancel))
        .route(&format!("{API}/unpair"), post(unpair))
        .route(&format!("{API}/transfer/offer"), post(transfer_offer))
        .route(
            &format!("{API}/transfer/{{id}}/manifest"),
            put(transfer_manifest).layer(DefaultBodyLimit::max(MAX_MANIFEST_BYTES)),
        )
        .route(
            &format!("{API}/transfer/{{id}}/files/{{file}}"),
            put(transfer_file),
        )
        .route(
            &format!("{API}/transfer/{{id}}/finish"),
            post(transfer_finish),
        )
        .route(
            &format!("{API}/transfer/{{id}}/cancel"),
            post(transfer_cancel),
        )
        .route(
            &format!("{API}/transfer/{{id}}/result"),
            post(transfer_result),
        )
        .layer(axum::middleware::from_fn(read_body_in_time))
        .with_state(shared);
    // 同时处理的连接数上限：局域网里有人反复连进来时不会拖垮本机
    let slots = Arc::new(tokio::sync::Semaphore::new(MAX_CONNECTIONS));
    let per_ip: PerAddress = Arc::new(std::sync::Mutex::new(HashMap::new()));
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((stream, addr)) = accepted else {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                };
                let Ok(permit) = slots.clone().try_acquire_owned() else {
                    tracing::warn!(component = "LAN", %addr, "连接太多，拒绝新的连接");
                    continue;
                };
                // 同一个地址最多占 MAX_PER_ADDRESS 个连接，别人还能连进来
                let Some(per_address) = AddressSlot::take(&per_ip, addr.ip()) else {
                    tracing::warn!(component = "LAN", %addr, "这个地址的连接太多，拒绝新的连接");
                    continue;
                };
                let acceptor = acceptor.clone();
                let router = router.clone();
                tokio::spawn(async move {
                    let _permit = permit;
                    let _per_address = per_address;
                    let Ok(Ok(tls)) =
                        tokio::time::timeout(Duration::from_secs(10), acceptor.accept(stream)).await
                    else {
                        return;
                    };
                    let Some(fingerprint) = tls
                        .get_ref()
                        .1
                        .peer_certificates()
                        .and_then(|c| c.first())
                        .map(|c| fingerprint_of(c))
                    else {
                        return;
                    };
                    let peer = Peer { fingerprint, address: addr.ip().to_canonical() };
                    let service = TowerToHyperService::new(router.layer(Extension(peer)));
                    // 请求头 30 秒内要发完（防止慢速占着连接）；请求体（传文件）不限时
                    let _ = hyper::server::conn::http1::Builder::new()
                        .timer(TokioTimer::new())
                        .header_read_timeout(Duration::from_secs(30))
                        .serve_connection(TokioIo::new(tls), service)
                        .await;
                });
            }
            _ = shutdown.changed() => break,
        }
    }
}

async fn register(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Json(info): Json<DeviceInfo>,
) -> Reply<RegisterResponse> {
    s.on_register(&peer.fingerprint, peer.address, info)
        .await
        .map(Json)
}

async fn pair_start(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Json(req): Json<PairStartRequest>,
) -> Reply<PairStartResponse> {
    s.on_pair_start(&peer.fingerprint, peer.address, req)
        .map(Json)
}

async fn pair_confirm(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Json(req): Json<PairConfirmRequest>,
) -> Reply<PairConfirmResponse> {
    s.on_pair_confirm(&peer.fingerprint, req).await.map(Json)
}

async fn pair_cancel(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Json(req): Json<PairCancelRequest>,
) -> Json<serde_json::Value> {
    s.on_pair_cancel(&peer.fingerprint, req);
    Json(serde_json::json!({}))
}

async fn unpair(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
) -> Reply<serde_json::Value> {
    s.on_unpair(&peer.fingerprint)
        .await
        .map(|_| Json(serde_json::json!({})))
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
}

async fn transfer_offer(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Json(req): Json<OfferRequest>,
) -> Reply<OfferResponse> {
    s.on_offer(&peer.fingerprint, req).await.map(Json)
}

async fn transfer_manifest(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Reply<ReceivedFiles> {
    s.on_manifest(&peer.fingerprint, &id, header(&headers, TOKEN_HEADER), body)
        .await
        .map(Json)
}

async fn transfer_file(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Path((id, file)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Reply<ReceivedFiles> {
    let offset = header(&headers, OFFSET_HEADER).parse::<u64>().unwrap_or(0);
    s.on_file(
        &peer.fingerprint,
        &id,
        &file,
        header(&headers, TOKEN_HEADER),
        offset,
        body,
    )
    .await
    .map(Json)
}

async fn transfer_finish(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Reply<FinishResponse> {
    s.on_finish(&peer.fingerprint, &id, header(&headers, TOKEN_HEADER))
        .await
        .map(Json)
}

async fn transfer_cancel(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    s.on_transfer_cancel(&peer.fingerprint, &id);
    Json(serde_json::json!({}))
}

async fn transfer_result(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Path(id): Path<String>,
) -> Reply<ResultResponse> {
    s.on_result(&peer.fingerprint, &id).map(Json)
}
