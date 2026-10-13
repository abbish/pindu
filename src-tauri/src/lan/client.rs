//! 调用别的设备的接口：TLS（按编号核对对方）+ HTTP/1.1。JSON 请求用 [`post_json`]，
//! 传文件等需要自定义方法、头与流式请求体的用 [`send`]。

use super::identity::Identity;
use super::protocol::API;
use super::tls;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::{Method, Request, StatusCode};
use hyper_util::rt::TokioIo;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

/// 请求体（流式文件或一段字节）
pub type Body = BoxBody<Bytes, std::io::Error>;

pub fn bytes_body(data: impl Into<Bytes>) -> Body {
    Full::new(data.into())
        .map_err(|never| match never {})
        .boxed()
}

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
    let payload = serde_json::to_vec(body).map_err(|e| ClientError::Other(e.to_string()))?;
    let (fingerprint, bytes) = send(
        id,
        target,
        Method::POST,
        path,
        &[("content-type", "application/json".into())],
        bytes_body(payload),
        wait,
    )
    .await?;
    let parsed = serde_json::from_slice(&bytes)
        .map_err(|e| ClientError::Other(format!("对方的回应格式不对：{e}")))?;
    Ok((fingerprint, parsed))
}

/// 发一个请求，成功（2xx）返回（对方实际的编号，响应体）；`wait` 是发出请求到收完响应的上限
pub async fn send(
    id: &Identity,
    target: &Target,
    method: Method,
    path: &str,
    headers: &[(&str, String)],
    body: Body,
    wait: Duration,
) -> Result<(String, Bytes), ClientError> {
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
    let mut request = Request::builder()
        .method(method)
        .uri(format!("{API}{path}"))
        .header(hyper::header::HOST, addr.to_string());
    for (k, v) in headers {
        request = request.header(*k, v);
    }
    let request = request
        .body(body)
        .map_err(|e| ClientError::Other(e.to_string()))?;

    let (status, bytes) = timeout(wait, async {
        let response = sender
            .send_request(request)
            .await
            .map_err(|e| ClientError::Unreachable(e.to_string()))?;
        let status = response.status();
        // 回应都很小：设个上限，连到不认识的地址（按地址添加）时对方也撑不爆内存
        let bytes = http_body_util::Limited::new(response.into_body(), MAX_RESPONSE_BYTES)
            .collect()
            .await
            .map_err(|e| ClientError::Unreachable(e.to_string()))?
            .to_bytes();
        Ok::<_, ClientError>((status, bytes))
    })
    .await
    .map_err(|_| ClientError::Timeout)??;

    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes).chars().take(300).collect();
        return Err(ClientError::Status(status, text));
    }
    Ok((peer_fingerprint, bytes))
}
