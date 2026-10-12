//! 调用别的设备的接口：TLS（按编号核对对方）+ HTTP/1.1 + JSON。

use super::identity::Identity;
use super::protocol::API;
use super::tls;
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::{Request, StatusCode};
use hyper_util::rt::TokioIo;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// 要连接的设备
#[derive(Debug, Clone)]
pub struct Target {
    pub address: IpAddr,
    pub port: u16,
    /// 已知编号时核对对方身份；None 表示第一次认识（按地址添加）
    pub fingerprint: Option<String>,
}

#[derive(Debug)]
pub enum ClientError {
    /// 连不上（不在线、地址不对、被防火墙拦住）
    Unreachable(String),
    /// 对方身份和记下的不一致
    IdentityMismatch,
    /// 超时
    Timeout,
    /// 对方返回了错误状态
    Status(StatusCode, String),
    /// 其他（响应格式不对等）
    Other(String),
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreachable(e) => write!(f, "连不上：{e}"),
            Self::IdentityMismatch => write!(f, "对方身份和配对时记下的不一致"),
            Self::Timeout => write!(f, "等待对方超时"),
            Self::Status(s, body) => write!(f, "对方返回 {s}：{body}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}

/// POST JSON，返回（对方实际的编号，响应）
pub async fn post_json<Req: Serialize, Resp: DeserializeOwned>(
    id: &Identity,
    target: &Target,
    path: &str,
    body: &Req,
    wait: Duration,
) -> Result<(String, Resp), ClientError> {
    let (config, seen) = tls::client_config(id, target.fingerprint.clone())
        .map_err(|e| ClientError::Other(e.to_string()))?;
    let addr = SocketAddr::new(target.address, target.port);
    let tcp = timeout(CONNECT_TIMEOUT, TcpStream::connect(addr))
        .await
        .map_err(|_| ClientError::Unreachable("连接超时".into()))?
        .map_err(|e| ClientError::Unreachable(e.to_string()))?;
    let tls = timeout(
        CONNECT_TIMEOUT,
        tokio_rustls::TlsConnector::from(config).connect(tls::server_name(), tcp),
    )
    .await
    .map_err(|_| ClientError::Unreachable("加密握手超时".into()))?;
    let peer_fingerprint = seen.lock().ok().and_then(|s| s.clone());
    let tls = match tls {
        Ok(tls) => tls,
        Err(e) => {
            let mismatch = matches!(
                (&target.fingerprint, &peer_fingerprint),
                (Some(expected), Some(actual)) if expected != actual
            );
            return Err(if mismatch {
                ClientError::IdentityMismatch
            } else {
                ClientError::Unreachable(e.to_string())
            });
        }
    };
    let peer_fingerprint =
        peer_fingerprint.ok_or_else(|| ClientError::Other("没有拿到对方证书".into()))?;

    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(tls))
        .await
        .map_err(|e| ClientError::Unreachable(e.to_string()))?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let payload = serde_json::to_vec(body).map_err(|e| ClientError::Other(e.to_string()))?;
    let request = Request::post(format!("{API}{path}"))
        .header(hyper::header::HOST, addr.to_string())
        .header(hyper::header::CONTENT_TYPE, "application/json")
        .body(Full::new(Bytes::from(payload)))
        .map_err(|e| ClientError::Other(e.to_string()))?;

    let response = timeout(wait, async {
        let response = sender
            .send_request(request)
            .await
            .map_err(|e| ClientError::Unreachable(e.to_string()))?;
        let status = response.status();
        let bytes = response
            .into_body()
            .collect()
            .await
            .map_err(|e| ClientError::Unreachable(e.to_string()))?
            .to_bytes();
        Ok::<_, ClientError>((status, bytes))
    })
    .await
    .map_err(|_| ClientError::Timeout)??;

    let (status, bytes) = response;
    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes).chars().take(300).collect();
        return Err(ClientError::Status(status, text));
    }
    let parsed = serde_json::from_slice(&bytes)
        .map_err(|e| ClientError::Other(format!("对方的回应格式不对：{e}")))?;
    Ok((peer_fingerprint, parsed))
}
