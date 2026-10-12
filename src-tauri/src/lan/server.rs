//! 本机的互传接口：监听 0.0.0.0（局域网里的设备要能连进来），TLS 握手要求对方出示证书，
//! 每个连接把对方编号与地址交给接口（`Peer`）。业务在 `Shared` 的 `on_*` 方法里。

use super::identity::fingerprint_of;
use super::protocol::*;
use super::Shared;
use axum::extract::{Extension, Json, State};
use axum::http::StatusCode;
use axum::routing::post;
use axum::Router;
use hyper_util::rt::TokioIo;
use hyper_util::service::TowerToHyperService;
use rustls::ServerConfig;
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
        .with_state(shared);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((stream, addr)) = accepted else {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                };
                let acceptor = acceptor.clone();
                let router = router.clone();
                tokio::spawn(async move {
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
                    let _ = hyper::server::conn::http1::Builder::new()
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
