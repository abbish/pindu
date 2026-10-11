//! AI 老师的常驻对话：一个对话一个 pi 进程（RPC 模式 + 持久会话），对话内容由 pi 的会话文件保存。
//!
//! - 发送：空闲时 `prompt`，运行中 `steer`（pi 在当前工具调用结束后插入）；停止用 `abort`。
//! - 事件：pi 的原始事件 JSON 原样交给 `Emit`（前端按 pi 的消息格式重建），
//!   含 `extension_ui_request`（工具向用户提问），回答经 `respond_ui` 写回 `extension_ui_response`。
//! - 进程退出（或被关闭）后从表里移除，并补发一条 `{"type":"redlark_closed"}`。
//! - 闲置超过 `IDLE_LIMIT` 的进程每分钟回收一次（`start_reaper`）；应用内更新前也会关掉闲置的。

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
    /// 还没回答的提问（pi 扩展 UI 的对话类请求，原始 JSON）：重新打开对话时交给界面
    pending_ui: Mutex<Vec<(Instant, Value)>>,
}

/// pi 扩展 UI 里要等回答的请求（其余 notify / setStatus 等不用回）
pub const DIALOG_METHODS: [&str; 4] = ["select", "confirm", "input", "editor"];

impl ChatSession {
    /// 还没回答的提问（带 timeout 的过期后 pi 已按默认值收回，不再返回）
    pub fn pending_ui(&self) -> Vec<Value> {
        let Ok(mut pending) = self.pending_ui.lock() else {
            return Vec::new();
        };
        pending.retain(|(at, raw)| {
            raw.get("timeout")
                .and_then(Value::as_u64)
                .is_none_or(|ms| at.elapsed() < Duration::from_millis(ms))
        });
        pending.iter().map(|(_, raw)| raw.clone()).collect()
    }

    fn forget_ui(&self, id: Option<&str>) {
        if let Ok(mut pending) = self.pending_ui.lock() {
            match id {
                Some(id) => {
                    pending.retain(|(_, r)| r.get("id").and_then(Value::as_str) != Some(id))
                }
                None => pending.clear(),
            }
        }
    }

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
        self.forget_ui(response.get("id").and_then(Value::as_str));
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
    /// 上次用 pi 列出的对话（每次列都要起一个 sidecar）；对话有变化时清掉
    listed: Arc<Mutex<Option<Vec<SessionSummary>>>>,
    /// 闲置回收已经在跑
    reaper: Arc<AtomicBool>,
}

impl ChatHub {
    /// 每分钟关掉闲置超过 IDLE_LIMIT 的对话进程（只启动一次）；再打开时 pi 从会话文件恢复
    fn start_reaper(&self) {
        if self.reaper.swap(true, Ordering::SeqCst) {
            return;
        }
        let hub = self.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(60));
            loop {
                tick.tick().await;
                hub.close_idle(IDLE_LIMIT).await;
            }
        });
    }

    /// 缓存的对话列表
    pub fn cached_list(&self) -> Option<Vec<SessionSummary>> {
        self.listed.lock().ok().and_then(|l| l.clone())
    }

    pub fn cache_list(&self, list: Vec<SessionSummary>) {
        if let Ok(mut l) = self.listed.lock() {
            *l = Some(list);
        }
    }

    /// 对话有变化（新对话、改名、一轮结束、删除）：下次重新列
    pub fn invalidate_list(&self) {
        if let Ok(mut l) = self.listed.lock() {
            *l = None;
        }
    }

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
        self.start_reaper();
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
            pending_ui: Mutex::new(Vec::new()),
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
            while let Some((_, mut raw)) = events.recv().await {
                match raw.get("type").and_then(Value::as_str) {
                    Some("agent_start") => pump.running.store(true, Ordering::SeqCst),
                    Some("session_info_changed") => hub.invalidate_list(),
                    Some("agent_settled") => {
                        hub.invalidate_list();
                        pump.running.store(false, Ordering::SeqCst);
                        // 停止或结束后，没回答的提问已被 pi 收回
                        pump.forget_ui(None);
                    }
                    Some("extension_ui_request")
                        if raw
                            .get("method")
                            .and_then(Value::as_str)
                            .is_some_and(|m| DIALOG_METHODS.contains(&m)) =>
                    {
                        if let Ok(mut pending) = pump.pending_ui.lock() {
                            pending.push((Instant::now(), raw.clone()));
                        }
                    }
                    _ => {}
                }
                pump.touch();
                slim_update(&mut raw);
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

/// 流式增量事件只留增量：pi 的 `message_update` 每个增量都附带到目前为止的整条消息两份（`message` 与
/// `assistantMessageEvent.partial`），界面按增量拼接、用不到它们；原样转发时一段回答要发几百次、越往后越大
pub(crate) fn slim_update(raw: &mut Value) {
    if raw.get("type").and_then(Value::as_str) != Some("message_update") {
        return;
    }
    if let Some(event) = raw.as_object_mut() {
        event.remove("message");
        if let Some(update) = event
            .get_mut("assistantMessageEvent")
            .and_then(Value::as_object_mut)
        {
            update.remove("partial");
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn message_update_keeps_only_the_delta() {
        let mut raw = json!({
            "type": "message_update",
            "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello wor"}]},
            "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": "wor", "partial": {"content": []}}
        });
        slim_update(&mut raw);
        assert_eq!(
            raw,
            json!({"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": "wor"}})
        );
        // 其他事件原样
        let mut end = json!({"type": "message_end", "message": {"role": "assistant"}});
        slim_update(&mut end);
        assert!(end.get("message").is_some());
    }
}
