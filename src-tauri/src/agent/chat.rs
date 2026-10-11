//! AI 老师的常驻对话：一个对话一个 pi 进程（RPC 模式 + 持久会话），对话内容由 pi 的会话文件保存。
//!
//! - 发送：空闲时 `prompt`，运行中 `steer`（pi 在当前工具调用结束后插入）；停止用 `abort`。
//! - 事件：pi 的原始事件 JSON 原样交给 `Emit`（前端按 pi 的消息格式重建），
//!   含 `extension_ui_request`（工具向用户提问），回答经 `respond_ui` 写回 `extension_ui_response`。
//! - 进程退出（或被关闭）后从表里移除，并补发一条 `{"type":"redlark_closed"}`。
//! - 闲置的进程在启动新对话时按 `IDLE_LIMIT` 关闭；应用内更新前也会关掉闲置的。

use super::session::{AgentLaunch, AgentProcess};
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// 事件出口：（对话 id，pi 原始事件）
pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// 闲置多久的对话进程会被关闭（再打开时由 pi 从会话文件恢复）
pub const IDLE_LIMIT: Duration = Duration::from_secs(10 * 60);

/// 一个对话的 pi 进程
pub struct ChatSession {
    pub id: String,
    process: tokio::sync::Mutex<Option<AgentProcess>>,
    running: AtomicBool,
    last_used: Mutex<Instant>,
}

impl ChatSession {
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    fn touch(&self) {
        if let Ok(mut t) = self.last_used.lock() {
            *t = Instant::now();
        }
    }

    fn idle_for(&self) -> Duration {
        self.last_used
            .lock()
            .map(|t| t.elapsed())
            .unwrap_or_default()
    }

    /// 发送一条 RPC 命令并等待响应
    pub async fn request(&self, command: &str, fields: Value) -> AppResult<Value> {
        self.touch();
        let mut guard = self.process.lock().await;
        let process = guard
            .as_mut()
            .ok_or_else(|| AppError::ExternalServiceError("对话已结束，请重新打开".to_string()))?;
        process.connection.request(command, fields).await
    }

    /// 用户发一条消息：空闲时开始新一轮，运行中作为插话（steer）
    pub async fn send(&self, message: &str, images: Vec<Value>) -> AppResult<()> {
        let mut fields = json!({ "message": message });
        if !images.is_empty() {
            fields["images"] = Value::Array(images);
        }
        if self.is_running() {
            self.request("steer", fields).await?;
        } else {
            // 先置为运行中：`agent_start` 事件到来前的再次发送按插话处理
            self.running.store(true, Ordering::SeqCst);
            if let Err(e) = self.request("prompt", fields).await {
                self.running.store(false, Ordering::SeqCst);
                return Err(e);
            }
        }
        Ok(())
    }

    /// 清空排队的消息（插话 / 跟进），返回它们的文字（pi `clear_queue`）
    pub async fn clear_queue(&self) -> AppResult<Vec<String>> {
        let data = self.request("clear_queue", Value::Null).await?;
        Ok(["steering", "followUp"]
            .iter()
            .flat_map(|k| {
                data.get(*k)
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
            })
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect())
    }

    /// 改排队的消息：pi 没有单条删改，按 pi 的做法先清空，再按顺序重新排上
    pub async fn replace_queue(&self, messages: &[String]) -> AppResult<()> {
        self.clear_queue().await?;
        for message in messages.iter().map(|m| m.trim()).filter(|m| !m.is_empty()) {
            self.send(message, Vec::new()).await?;
        }
        Ok(())
    }

    /// 停止本轮：先清空排队的消息再 abort（pi 文档的做法），返回被清掉的文字（放回输入框）
    pub async fn abort(&self) -> AppResult<Vec<String>> {
        let queued = self.clear_queue().await.unwrap_or_default();
        self.request("abort", Value::Null).await?;
        Ok(queued)
    }

    /// 回答工具向用户的提问（`extension_ui_request` 的 id）
    pub async fn respond_ui(&self, response: Value) -> AppResult<()> {
        self.touch();
        let mut guard = self.process.lock().await;
        let process = guard
            .as_mut()
            .ok_or_else(|| AppError::ExternalServiceError("对话已结束，请重新打开".to_string()))?;
        process.connection.send_value(response).await
    }

    async fn shutdown(&self) {
        if let Some(process) = self.process.lock().await.take() {
            process.shutdown().await;
        }
    }
}

/// 全部常驻对话（Tauri 状态）
#[derive(Clone, Default)]
pub struct ChatHub {
    sessions: Arc<tokio::sync::Mutex<HashMap<String, Arc<ChatSession>>>>,
}

impl ChatHub {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn get(&self, id: &str) -> Option<Arc<ChatSession>> {
        self.sessions.lock().await.get(id).cloned()
    }

    /// 正在运行的对话 id
    pub async fn running_ids(&self) -> Vec<String> {
        self.sessions
            .lock()
            .await
            .values()
            .filter(|s| s.is_running())
            .map(|s| s.id.clone())
            .collect()
    }

    /// 启动一个对话进程（新对话或按会话 id 恢复），返回 pi 的会话 id
    pub async fn start(&self, launch: AgentLaunch, emit: Emit) -> AppResult<Arc<ChatSession>> {
        self.close_idle(IDLE_LIMIT).await;
        let mut process = AgentProcess::spawn(launch).await?;
        let mut events = process.connection.take_events();
        let state = match process.connection.request("get_state", Value::Null).await {
            Ok(state) => state,
            Err(e) => {
                let stderr = process.stderr_tail();
                process.shutdown().await;
                tracing::warn!("AI 老师对话启动失败：{}；stderr：{}", e, stderr);
                return Err(e);
            }
        };
        let id = state
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if id.is_empty() {
            process.shutdown().await;
            return Err(AppError::ExternalServiceError(
                "没能打开这个对话".to_string(),
            ));
        }
        let session = Arc::new(ChatSession {
            id: id.clone(),
            process: tokio::sync::Mutex::new(Some(process)),
            running: AtomicBool::new(false),
            last_used: Mutex::new(Instant::now()),
        });
        // 同一个会话已有进程（并发打开）：保留先到的
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(existing) = sessions.get(&id) {
                let existing = existing.clone();
                drop(sessions);
                session.shutdown().await;
                return Ok(existing);
            }
            sessions.insert(id.clone(), session.clone());
        }

        let hub = self.clone();
        let pump = session.clone();
        tokio::spawn(async move {
            while let Some((_, raw)) = events.recv().await {
                match raw.get("type").and_then(Value::as_str) {
                    Some("agent_start") => pump.running.store(true, Ordering::SeqCst),
                    Some("agent_settled") => pump.running.store(false, Ordering::SeqCst),
                    _ => {}
                }
                pump.touch();
                emit(&pump.id, raw);
            }
            pump.running.store(false, Ordering::SeqCst);
            hub.remove(&pump.id, &pump).await;
            emit(&pump.id, json!({ "type": "redlark_closed" }));
        });
        Ok(session)
    }

    async fn remove(&self, id: &str, session: &Arc<ChatSession>) {
        let mut sessions = self.sessions.lock().await;
        if sessions.get(id).is_some_and(|s| Arc::ptr_eq(s, session)) {
            sessions.remove(id);
        }
    }

    /// 关闭一个对话的进程（删除对话前）
    pub async fn close(&self, id: &str) {
        let session = self.sessions.lock().await.remove(id);
        if let Some(session) = session {
            session.shutdown().await;
        }
    }

    /// 关闭闲置超过 `limit` 且没在运行的对话进程；返回关闭的数量
    pub async fn close_idle(&self, limit: Duration) -> usize {
        let idle: Vec<Arc<ChatSession>> = {
            let mut sessions = self.sessions.lock().await;
            let ids: Vec<String> = sessions
                .values()
                .filter(|s| !s.is_running() && s.idle_for() >= limit)
                .map(|s| s.id.clone())
                .collect();
            ids.iter().filter_map(|id| sessions.remove(id)).collect()
        };
        for session in &idle {
            session.shutdown().await;
        }
        idle.len()
    }
}

/// pi 会话列表里的一项（`redlark-agent --redlark-sessions` 输出，来自 pi 的 `SessionManager.list`）
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub path: String,
    pub name: Option<String>,
    pub first_message: String,
    pub created: String,
    pub modified: String,
    pub message_count: i64,
}

/// 用 pi 列出会话目录里的对话
pub async fn list_sessions(
    paths: &super::AgentPaths,
    session_dir: &std::path::Path,
    cwd: &std::path::Path,
) -> AppResult<Vec<SessionSummary>> {
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        tokio::process::Command::new(&paths.program)
            .arg("--redlark-sessions")
            .arg(session_dir)
            .arg(cwd)
            .env("PI_OFFLINE", "1")
            .env("PI_TELEMETRY", "0")
            .env("PI_CODING_AGENT_DIR", paths.root.join("catalog"))
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| AppError::ExternalServiceError("读取对话列表超时".to_string()))?
    .map_err(|e| {
        AppError::ExternalServiceError(format!(
            "{}（{}）：{}",
            super::session::SPAWN_FAILURE,
            paths.program.display(),
            e
        ))
    })?;
    if !output.status.success() {
        return Err(AppError::ExternalServiceError(format!(
            "读取对话列表失败：{}",
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(300)
                .collect::<String>()
        )));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::ExternalServiceError(format!("无法解析对话列表：{}", e)))
}
