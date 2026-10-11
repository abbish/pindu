//! 拼读的 MCP 服务（D55）：给 AI 老师（pi）用的拼读能力——查学习者的词汇本、短文、学习记录，往素材库里收东西。
//!
//! - 只在本机：`127.0.0.1` 随机端口，每次启动生成的令牌（`Authorization: Bearer`），只经环境变量交给 sidecar。
//! - 用 MCP 官方 Rust SDK（rmcp）的 streamable HTTP 服务；pi 经 `pi.registerMcpServer` 连上（sidecar 扩展）。
//! - 第一次打开 AI 老师对话时启动，之后随应用运行。工具在 `tools.rs`。

pub mod reason;
mod tools;

#[cfg(test)]
pub use tools::done as tool_result;

use crate::error::{AppError, AppResult};
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::OnceCell;

/// 服务地址与令牌
#[derive(Debug, Clone)]
pub struct McpEndpoint {
    pub url: String,
    pub token: String,
}

static ENDPOINT: OnceCell<McpEndpoint> = OnceCell::const_new();

/// 服务地址（第一次调用时启动）
pub async fn endpoint(app: &AppHandle) -> AppResult<McpEndpoint> {
    ENDPOINT
        .get_or_try_init(|| start(app.clone()))
        .await
        .cloned()
}

async fn start(app: AppHandle) -> AppResult<McpEndpoint> {
    serve(move || Ok(tools::PinduTools::new(app.clone()))).await
}

/// 在本机随机端口启动一个 MCP 服务（带令牌校验），返回地址与令牌
pub async fn serve<S>(
    factory: impl Fn() -> Result<S, std::io::Error> + Send + Sync + 'static,
) -> AppResult<McpEndpoint>
where
    S: rmcp::ServerHandler + Send + 'static,
{
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let service: StreamableHttpService<S, LocalSessionManager> = StreamableHttpService::new(
        factory,
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    );
    let router = axum::Router::new().nest_service("/mcp", service).layer(
        axum::middleware::from_fn_with_state(Arc::new(format!("Bearer {}", token)), authorize),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::InternalError(format!("无法启动 AI 老师的工具服务：{}", e)))?;
    let addr = listener
        .local_addr()
        .map_err(|e| AppError::InternalError(format!("无法启动 AI 老师的工具服务：{}", e)))?;
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            tracing::error!("AI 老师的工具服务已停止：{}", e);
        }
    });
    tracing::info!("AI 老师的工具服务已启动：127.0.0.1:{}", addr.port());
    Ok(McpEndpoint {
        url: format!("http://127.0.0.1:{}/mcp", addr.port()),
        token,
    })
}

/// 只接受带本次令牌的请求
async fn authorize(State(expected): State<Arc<String>>, request: Request, next: Next) -> Response {
    let ok = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v == expected.as_str());
    if ok {
        next.run(request).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}
