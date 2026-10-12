//! AI 老师的常驻对话：一个对话一个 pi 进程（RPC 模式 + 持久会话），对话内容由 pi 的会话文件保存。
//!
//! - 发送：空闲时 `prompt`，运行中 `steer`（pi 在当前工具调用结束后插入）；停止用 `abort`。
//! - 事件：pi 的原始事件 JSON 交给 `Emit`（前端按 pi 的消息格式重建；流式增量只留增量，`slim_update`），
//!   含 `extension_ui_request`（工具向用户提问），回答经 `respond_ui` 写回 `extension_ui_response`。
//!   每条事件带一个递增序号（所有对话共用）；会话记着界面要的现状（正在写的回答、排队的消息、重试提示，`Live`），
//!   重新打开对话时连同当时的序号交给界面，界面丢掉序号不大于它的事件、接着补后面的，不重复也不漏。
//! - 在回答 / 等学习者回答变化时补发 `{"type":"redlark_activity","running","asking"}`（侧边栏「AI 老师」的标记）。
//! - 进程退出（或被关闭）后从表里移除，并补发一条 `{"type":"redlark_closed"}`。
//! - 闲置超过 `IDLE_LIMIT` 的进程每分钟回收一次（`start_reaper`）；应用内更新前也会关掉闲置的。

use super::session::{AgentLaunch, AgentProcess};
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// 事件出口：（对话 id，序号，pi 原始事件）
pub type Emit = Arc<dyn Fn(&str, u64, Value) + Send + Sync>;

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
    /// 界面要的现状与最近的序号；推送事件时持锁，保证序号与推送顺序一致
    live: Mutex<Live>,
    /// 新对话的第一句话与发出时刻：pi 写进会话文件之前，对话列表先用它显示这个对话
    first_message: Mutex<Option<(String, String)>>,
    /// 事件序号（ChatHub 的所有对话共用，进程重启后也只增不减）
    seq: Arc<AtomicU64>,
    emit: Emit,
}

/// 打开对话时交给界面的现状
pub struct LiveSnapshot {
    pub seq: u64,
    pub replay: Vec<Value>,
    pub running: bool,
    pub asks: Vec<Value>,
}

/// 界面要的对话现状（pi 只在一条消息写完后才把它放进 `get_messages`）
#[derive(Default)]
struct Live {
    /// 最近一次推送的序号
    seq: u64,
    /// 正在写的 assistant 消息（`message_update` 带的整条消息）
    partial: Option<Value>,
    /// 最近一次 `queue_update`
    queue: Option<Value>,
    /// 正在重试 / 整理之前的对话（`auto_retry_start` / `compaction_start` 原样）
    notice: Option<Value>,
    /// 正在执行的工具（toolCallId → 最近一次 `tool_execution_start` / `_update` 原样，带进度 details）
    tools: std::collections::BTreeMap<String, Value>,
    /// 上次推送的（在回答，等学习者回答）
    activity: (bool, bool),
}

impl Live {
    /// 按事件更新现状；`message_update` 的整条消息挪到这里（之后推给界面的只留增量）
    fn track(&mut self, raw: &mut Value) {
        let assistant = raw
            .pointer("/message/role")
            .and_then(Value::as_str)
            .is_some_and(|r| r == "assistant");
        match raw.get("type").and_then(Value::as_str) {
            Some("message_start") if assistant => self.partial = raw.get("message").cloned(),
            Some("message_update") => {
                if let Some(message) = raw.as_object_mut().and_then(|o| o.remove("message")) {
                    self.partial = Some(message);
                }
            }
            Some("message_end") if assistant => self.partial = None,
            Some("queue_update") => self.queue = Some(raw.clone()),
            Some("auto_retry_start" | "compaction_start") => self.notice = Some(raw.clone()),
            Some("auto_retry_end" | "compaction_end") => self.notice = None,
            Some("tool_execution_start" | "tool_execution_update") => {
                if let Some(id) = raw.get("toolCallId").and_then(Value::as_str) {
                    self.tools.insert(id.to_string(), raw.clone());
                }
            }
            Some("tool_execution_end") => {
                if let Some(id) = raw.get("toolCallId").and_then(Value::as_str) {
                    self.tools.remove(id);
                }
            }
            Some("agent_settled" | "redlark_closed") => {
                self.partial = None;
                self.queue = None;
                self.notice = None;
                self.tools.clear();
            }
            _ => {}
        }
    }

    /// 重建现状的事件：界面用处理 pi 事件的同一套逻辑重放
    fn replay(&self) -> Vec<Value> {
        let mut events = Vec::new();
        if let Some(message) = &self.partial {
            events.push(json!({ "type": "message_start", "message": message }));
        }
        events.extend(self.tools.values().cloned());
        events.extend(self.queue.clone());
        events.extend(self.notice.clone());
        events
    }
}

/// 提问过期后多等一会儿再补推状态（保证 `pending_ui` 已经把它算作过期）
const EXPIRY_MARGIN: Duration = Duration::from_millis(50);

/// pi 扩展 UI 里要等回答的请求（其余 notify / setStatus 等不用回）
pub const DIALOG_METHODS: [&str; 4] = ["select", "confirm", "input", "editor"];

impl ChatSession {
    fn new(id: String, process: Option<AgentProcess>, emit: Emit, seq: Arc<AtomicU64>) -> Self {
        Self {
            id,
            process: tokio::sync::Mutex::new(process),
            running: AtomicBool::new(false),
            last_used: Mutex::new(Instant::now()),
            pending_ui: Mutex::new(Vec::new()),
            live: Mutex::new(Live::default()),
            first_message: Mutex::new(None),
            seq,
            emit,
        }
    }

    /// 推送一条 pi 事件：记下现状、只留增量、编上序号；在回答 / 等回答变了时再补一条 `redlark_activity`
    fn publish(&self, mut raw: Value) {
        let Ok(mut live) = self.live.lock() else {
            return;
        };
        live.track(&mut raw);
        slim_update(&mut raw);
        self.emit_locked(&mut live, raw);
        self.publish_activity_locked(&mut live);
    }

    fn emit_locked(&self, live: &mut Live, event: Value) {
        live.seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        (self.emit)(&self.id, live.seq, event);
    }

    /// （在回答，等学习者回答）
    pub fn activity(&self) -> (bool, bool) {
        (self.is_running(), !self.pending_ui().is_empty())
    }

    fn publish_activity_locked(&self, live: &mut Live) {
        let (running, asking) = self.activity();
        if live.activity == (running, asking) {
            return;
        }
        live.activity = (running, asking);
        self.emit_locked(
            live,
            json!({ "type": "redlark_activity", "running": running, "asking": asking }),
        );
    }

    fn publish_activity(&self) {
        if let Ok(mut live) = self.live.lock() {
            self.publish_activity_locked(&mut live);
        }
    }

    /// 记下新对话的第一句话（只记第一次）
    pub fn note_first_message(&self, text: &str) {
        if let Ok(mut first) = self.first_message.lock() {
            first.get_or_insert_with(|| (text.to_string(), crate::time::now_utc()));
        }
    }

    /// 新对话的第一句话与发出时刻
    pub fn first_message(&self) -> Option<(String, String)> {
        self.first_message.lock().ok().and_then(|f| f.clone())
    }

    /// 界面现状（同一时刻取的序号、重建事件、在不在回答、没回答的提问）。打开对话时先取它再取消息，之后的事件界面接着补
    pub fn snapshot(&self) -> LiveSnapshot {
        match self.live.lock() {
            Ok(live) => LiveSnapshot {
                seq: live.seq,
                replay: live.replay(),
                running: self.is_running(),
                asks: self.pending_ui(),
            },
            Err(_) => LiveSnapshot {
                seq: 0,
                replay: Vec::new(),
                running: self.is_running(),
                asks: self.pending_ui(),
            },
        }
    }

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
            match self.request("prompt", fields).await {
                // 扩展命令（/pindu-job 等）当场处理完：不会有 agent_start / agent_settled
                Ok(data) if data.get("disposition").and_then(Value::as_str) == Some("handled") => {
                    self.running.store(false, Ordering::SeqCst);
                    self.publish_activity();
                }
                Ok(_) => {}
                Err(e) => {
                    self.running.store(false, Ordering::SeqCst);
                    // 期间可能已经推过「在回答」（如进程启动时的通知事件）
                    self.publish_activity();
                    return Err(e);
                }
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
        self.publish_activity();
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
    /// 事件序号（见模块说明）
    seq: Arc<AtomicU64>,
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

    /// 全部常驻的对话进程
    pub async fn sessions(&self) -> Vec<Arc<ChatSession>> {
        self.sessions.lock().await.values().cloned().collect()
    }

    /// 在回答或在等学习者回答的对话：（id，在回答，等回答）
    pub async fn activity(&self) -> Vec<(String, bool, bool)> {
        self.sessions
            .lock()
            .await
            .values()
            .map(|s| (s.id.clone(), s.activity()))
            .filter(|(_, (running, asking))| *running || *asking)
            .map(|(id, (running, asking))| (id, running, asking))
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
        let session = Arc::new(ChatSession::new(
            id.clone(),
            Some(process),
            emit,
            self.seq.clone(),
        ));
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
                        // 带 timeout 的提问过期后 pi 按默认值收回、不发事件：到点补一次「等回答」的变化
                        if let Some(ms) = raw.get("timeout").and_then(Value::as_u64) {
                            let session = Arc::downgrade(&pump);
                            tokio::spawn(async move {
                                tokio::time::sleep(Duration::from_millis(ms) + EXPIRY_MARGIN).await;
                                if let Some(session) = session.upgrade() {
                                    session.publish_activity();
                                }
                            });
                        }
                    }
                    _ => {}
                }
                pump.touch();
                pump.publish(raw);
            }
            pump.running.store(false, Ordering::SeqCst);
            pump.forget_ui(None);
            hub.remove(&pump.id, &pump).await;
            pump.publish(json!({ "type": "redlark_closed" }));
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
    /// 从哪个会话另开的（pi 会话头的 parentSession）
    #[serde(default)]
    pub parent_path: Option<String>,
    pub first_message: String,
    pub created: String,
    pub modified: String,
    pub message_count: i64,
    /// 对话的文字（学习者与 AI 老师说的话，搜索与预览用；读的过程中回报的那几批没有）
    #[serde(default)]
    pub text: String,
}

/// `--redlark-sessions` 输出的一行：读好一批（不带全文）或全部读完
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum SessionListLine {
    Partial(Vec<SessionSummary>),
    Done(Vec<SessionSummary>),
}

/// 等列表的上限：每读好一批就有一行输出，这么久没有新的一行才算卡住
const SESSION_LIST_STALL: Duration = Duration::from_secs(30);

/// 用 pi 列出会话目录里的对话。pi 每读好一批调用一次 `on_partial`（新的在前，还不完整、没有全文），全部读完返回完整列表
pub async fn list_sessions(
    paths: &super::AgentPaths,
    session_dir: &std::path::Path,
    cwd: &std::path::Path,
    mut on_partial: impl FnMut(Vec<SessionSummary>),
) -> AppResult<Vec<SessionSummary>> {
    use tokio::io::AsyncBufReadExt;
    let mut child = tokio::process::Command::new(&paths.program)
        .arg("--redlark-sessions")
        .arg(session_dir)
        .arg(cwd)
        .env("PI_OFFLINE", "1")
        .env("PI_TELEMETRY", "0")
        .env("PI_CODING_AGENT_DIR", paths.root.join("catalog"))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            AppError::ExternalServiceError(format!(
                "{}（{}）：{}",
                super::session::SPAWN_FAILURE,
                paths.program.display(),
                e
            ))
        })?;
    let stdout = child.stdout.take().expect("stdout piped");
    let mut lines = tokio::io::BufReader::new(stdout).lines();
    loop {
        let line = tokio::time::timeout(SESSION_LIST_STALL, lines.next_line())
            .await
            .map_err(|_| AppError::ExternalServiceError("读取对话列表超时".to_string()))?
            .map_err(|e| AppError::ExternalServiceError(format!("读取对话列表失败：{}", e)))?;
        let Some(line) = line else { break };
        match serde_json::from_str::<SessionListLine>(&line) {
            Ok(SessionListLine::Partial(list)) => on_partial(list),
            Ok(SessionListLine::Done(list)) => return Ok(list),
            Err(e) => {
                return Err(AppError::ExternalServiceError(format!(
                    "无法解析对话列表：{}",
                    e
                )))
            }
        }
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::ExternalServiceError(format!("读取对话列表失败：{}", e)))?;
    Err(AppError::ExternalServiceError(format!(
        "读取对话列表失败：{}",
        String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(300)
            .collect::<String>()
    )))
}

/// 用 pi 把来源会话里某条学习者消息之前的对话复制成新会话（记着来源），返回新会话 id；
/// 这条消息之前还没有回答时返回 None（直接开新对话）
pub async fn fork_session(
    paths: &super::AgentPaths,
    session_dir: &std::path::Path,
    source_path: &str,
    timestamp: i64,
    name: &str,
) -> AppResult<Option<String>> {
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        tokio::process::Command::new(&paths.program)
            .arg("--redlark-fork")
            .arg(session_dir)
            .arg(source_path)
            .arg(timestamp.to_string())
            .arg(name)
            .env("PI_OFFLINE", "1")
            .env("PI_TELEMETRY", "0")
            .env("PI_CODING_AGENT_DIR", paths.root.join("catalog"))
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| AppError::ExternalServiceError("另开对话超时".to_string()))?
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
            "另开对话失败：{}",
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(300)
                .collect::<String>()
        )));
    }
    #[derive(serde::Deserialize)]
    struct Forked {
        id: Option<String>,
    }
    serde_json::from_slice::<Forked>(&output.stdout)
        .map(|f| f.id)
        .map_err(|e| AppError::ExternalServiceError(format!("另开对话失败：{}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn session_list_lines_are_partial_batches_then_done() {
        let item = json!({"id": "a", "path": "/s/a.jsonl", "name": null, "firstMessage": "hi",
            "created": "2026-10-12T00:00:00.000Z", "modified": "2026-10-12T00:00:01.000Z", "messageCount": 2});
        let partial: SessionListLine =
            serde_json::from_value(json!({ "partial": [item.clone()] })).unwrap();
        assert!(
            matches!(partial, SessionListLine::Partial(ref l) if l.len() == 1 && l[0].text.is_empty() && l[0].parent_path.is_none())
        );
        let mut done_item = item;
        done_item["text"] = json!("hi there");
        done_item["parentPath"] = json!("/s/p.jsonl");
        let done: SessionListLine = serde_json::from_value(json!({ "done": [done_item] })).unwrap();
        let SessionListLine::Done(list) = done else {
            panic!("应是 done")
        };
        assert_eq!(
            (list[0].text.as_str(), list[0].parent_path.as_deref()),
            ("hi there", Some("/s/p.jsonl"))
        );
    }

    type Seen = Arc<Mutex<Vec<(u64, Value)>>>;

    fn recording() -> (ChatSession, Seen) {
        let seen: Seen = Arc::default();
        let sink = seen.clone();
        let emit: Emit = Arc::new(move |_, seq, e| sink.lock().unwrap().push((seq, e)));
        let session = ChatSession::new("c1".into(), None, emit, Arc::default());
        (session, seen)
    }

    fn update(text: &str, delta: &str) -> Value {
        json!({
            "type": "message_update",
            "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
            "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": delta, "partial": {}}
        })
    }

    #[test]
    fn snapshot_rebuilds_the_answer_being_written() {
        let (session, seen) = recording();
        session.publish(
            json!({"type": "message_start", "message": {"role": "assistant", "content": []}}),
        );
        session.publish(update("Hello", "Hello"));
        session.publish(update("Hello wor", " wor"));
        session
            .publish(json!({"type": "queue_update", "steering": ["再举个例子"], "followUp": []}));
        session.publish(json!({"type": "auto_retry_start", "attempt": 1}));

        let LiveSnapshot { seq, replay, .. } = session.snapshot();
        // 序号就是最后一条推送的
        assert_eq!(seq, seen.lock().unwrap().last().unwrap().0);
        assert_eq!(
            replay,
            vec![
                json!({"type": "message_start", "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello wor"}]}}),
                json!({"type": "queue_update", "steering": ["再举个例子"], "followUp": []}),
                json!({"type": "auto_retry_start", "attempt": 1}),
            ]
        );
        // 推给界面的增量不带整条消息
        let (_, last_update) = seen.lock().unwrap()[2].clone();
        assert!(last_update.get("message").is_none());

        session.publish(json!({"type": "auto_retry_end"}));
        session.publish(
            json!({"type": "message_end", "message": {"role": "assistant", "content": []}}),
        );
        assert_eq!(
            session.snapshot().replay,
            vec![json!({"type": "queue_update", "steering": ["再举个例子"], "followUp": []})]
        );
        session.publish(json!({"type": "agent_settled"}));
        assert!(session.snapshot().replay.is_empty());
    }

    #[test]
    fn snapshot_keeps_tools_still_running() {
        let (session, _) = recording();
        session.publish(
            json!({"type": "tool_execution_start", "toolCallId": "t1", "toolName": "save_passage"}),
        );
        session.publish(json!({"type": "tool_execution_update", "toolCallId": "t1", "partialResult": {"details": {"p": 1}}}));
        session.publish(
            json!({"type": "tool_execution_start", "toolCallId": "t2", "toolName": "get_plan"}),
        );
        session
            .publish(json!({"type": "tool_execution_end", "toolCallId": "t2", "isError": false}));
        assert_eq!(
            session.snapshot().replay,
            vec![
                json!({"type": "tool_execution_update", "toolCallId": "t1", "partialResult": {"details": {"p": 1}}})
            ]
        );
        session.publish(json!({"type": "agent_settled"}));
        assert!(session.snapshot().replay.is_empty());
    }

    #[test]
    fn user_messages_do_not_become_the_partial_answer() {
        let (session, _) = recording();
        session
            .publish(json!({"type": "message_start", "message": {"role": "user", "content": []}}));
        session.publish(json!({"type": "message_end", "message": {"role": "user", "content": []}}));
        assert!(session.snapshot().replay.is_empty());
    }

    #[test]
    fn sequence_is_shared_and_increasing_across_sessions() {
        let seq: Arc<AtomicU64> = Arc::default();
        let seen: Arc<Mutex<Vec<u64>>> = Arc::default();
        let sink = seen.clone();
        let emit: Emit = Arc::new(move |_, n, _| sink.lock().unwrap().push(n));
        let a = ChatSession::new("a".into(), None, emit.clone(), seq.clone());
        let b = ChatSession::new("b".into(), None, emit, seq);
        a.publish(json!({"type": "turn_start"}));
        b.publish(json!({"type": "turn_start"}));
        a.publish(json!({"type": "turn_start"}));
        assert_eq!(*seen.lock().unwrap(), vec![1, 2, 3]);
        assert_eq!(b.snapshot().seq, 2);
    }

    #[tokio::test]
    async fn activity_is_published_only_when_it_changes() {
        let (session, seen) = recording();
        let activities = || {
            seen.lock()
                .unwrap()
                .iter()
                .filter(|(_, e)| e["type"] == "redlark_activity")
                .map(|(_, e)| {
                    (
                        e["running"].as_bool().unwrap(),
                        e["asking"].as_bool().unwrap(),
                    )
                })
                .collect::<Vec<_>>()
        };
        session.running.store(true, Ordering::SeqCst);
        session.publish(json!({"type": "agent_start"}));
        session.publish(json!({"type": "turn_start"}));
        assert_eq!(activities(), vec![(true, false)]);

        // 工具问学习者：等回答
        session
            .pending_ui
            .lock()
            .unwrap()
            .push((Instant::now(), json!({"id": "q1", "method": "confirm"})));
        session.publish(json!({"type": "extension_ui_request", "id": "q1", "method": "confirm"}));
        assert_eq!(activities(), vec![(true, false), (true, true)]);

        // 回答了（进程不在，写回失败，但提问已收回）
        let _ = session
            .respond_ui(json!({"type": "extension_ui_response", "id": "q1", "confirmed": true}))
            .await;
        assert_eq!(
            activities(),
            vec![(true, false), (true, true), (true, false)]
        );

        session.running.store(false, Ordering::SeqCst);
        session.publish(json!({"type": "agent_settled"}));
        assert_eq!(activities().last(), Some(&(false, false)));
    }

    #[tokio::test]
    async fn expired_ask_clears_asking_when_republished() {
        let (session, seen) = recording();
        session.running.store(true, Ordering::SeqCst);
        let ask =
            json!({"type": "extension_ui_request", "id": "q1", "method": "confirm", "timeout": 10});
        session
            .pending_ui
            .lock()
            .unwrap()
            .push((Instant::now(), ask.clone()));
        session.publish(ask);
        tokio::time::sleep(Duration::from_millis(10) + EXPIRY_MARGIN).await;
        // 到点补推：过期的提问不再算「等回答」
        session.publish_activity();
        let last = seen
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(_, e)| e["type"] == "redlark_activity")
            .map(|(_, e)| (e["running"] == true, e["asking"] == true));
        assert_eq!(last, Some((true, false)));
    }

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
