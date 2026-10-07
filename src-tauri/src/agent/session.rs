//! sidecar 进程与 JSONL 通信。
//!
//! - `AgentConnection`：只依赖一对 AsyncRead / AsyncWrite，测试用内存管道回放录制的输出。
//! - `AgentProcess`：启动 `redlark-agent` 子进程（kill_on_drop），收集 stderr 尾部用于报错，退出时清理本次运行目录。

use super::protocol::{command_line, parse_line, AgentEvent, Incoming, RpcResponse, RunOutcome};
use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<RpcResponse>>>>;

/// sidecar 无法启动时错误信息的前缀（便于在日志里区分启动失败与调用失败）
pub const SPAWN_FAILURE: &str = "无法启动 agent";

/// 用户取消时错误信息的前缀（调用方据此区分“取消”与失败）
pub const CANCELLED: &str = "已取消";

/// 等待事件时检查取消的间隔
const CANCEL_POLL: Duration = Duration::from_millis(300);

/// 命令响应的默认等待时间（不含模型生成；prompt 只等“已接受”）
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);

fn agent_error(message: impl Into<String>) -> AppError {
    AppError::ExternalServiceError(message.into())
}

/// 与 sidecar 的一条 RPC 连接
pub struct AgentConnection {
    writer: Box<dyn AsyncWrite + Unpin + Send>,
    pending: PendingMap,
    events: mpsc::UnboundedReceiver<AgentEvent>,
    next_id: u64,
    reader: JoinHandle<()>,
}

impl AgentConnection {
    pub fn new<R, W>(reader: R, writer: W) -> Self
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let (events_tx, events) = mpsc::unbounded_channel();
        let reader = tokio::spawn(read_loop(reader, pending.clone(), events_tx));
        Self {
            writer: Box::new(writer),
            pending,
            events,
            next_id: 0,
            reader,
        }
    }

    /// 发送命令并等待对应 id 的响应；失败响应转为错误
    pub async fn request(&mut self, command_type: &str, fields: Value) -> AppResult<Value> {
        self.next_id += 1;
        let id = format!("req-{}", self.next_id);
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| agent_error("agent 连接状态异常"))?
            .insert(id.clone(), tx);

        let line = command_line(&id, command_type, fields);
        self.writer
            .write_all(line.as_bytes())
            .await
            .map_err(|e| agent_error(format!("向 agent 发送命令失败：{}", e)))?;
        self.writer
            .flush()
            .await
            .map_err(|e| agent_error(format!("向 agent 发送命令失败：{}", e)))?;

        let response = tokio::time::timeout(RESPONSE_TIMEOUT, rx)
            .await
            .map_err(|_| agent_error(format!("agent 未响应命令 {}", command_type)))?
            .map_err(|_| agent_error("agent 进程已退出"))?;
        if response.success {
            Ok(response.data)
        } else {
            Err(agent_error(format!(
                "agent 拒绝命令 {}：{}",
                command_type,
                response.error.unwrap_or_default()
            )))
        }
    }

    /// 不可取消版本（测试用）
    #[cfg(test)]
    pub async fn prompt(
        &mut self,
        message: &str,
        timeout: Duration,
        on_event: impl FnMut(&AgentEvent),
    ) -> AppResult<RunOutcome> {
        self.prompt_cancellable(message, timeout, || false, on_event)
            .await
    }

    /// 发送一条用户消息并等待本轮结束（`agent_settled`）。`on_event` 收到每个事件（用于进度 / 流式推送）；
    /// 每 300ms 检查 `cancelled()`：为真时发送 `abort` 并返回以 `CANCELLED` 开头的错误；超时同样先 `abort`。
    pub async fn prompt_cancellable(
        &mut self,
        message: &str,
        timeout: Duration,
        cancelled: impl Fn() -> bool,
        mut on_event: impl FnMut(&AgentEvent),
    ) -> AppResult<RunOutcome> {
        // 丢弃上一轮遗留事件
        while self.events.try_recv().is_ok() {}
        self.request("prompt", serde_json::json!({ "message": message }))
            .await?;

        let deadline = tokio::time::Instant::now() + timeout;
        let mut outcome = RunOutcome::default();
        loop {
            if cancelled() {
                self.notify("abort").await;
                return Err(agent_error(format!("{}：用户取消了本次任务", CANCELLED)));
            }
            if tokio::time::Instant::now() >= deadline {
                self.notify("abort").await;
                return Err(agent_error(format!(
                    "agent 超时（{} 秒）未完成",
                    timeout.as_secs()
                )));
            }
            match tokio::time::timeout(CANCEL_POLL, self.events.recv()).await {
                Ok(Some(event)) => {
                    on_event(&event);
                    if outcome.absorb(&event) {
                        return Ok(outcome);
                    }
                }
                Ok(None) => return Err(agent_error("agent 进程在本轮结束前退出")),
                Err(_) => {} // 轮询间隔：回到循环检查取消 / 超时
            }
        }
    }

    /// 发送命令但不等待响应（尽力而为，如超时后的 abort）
    async fn notify(&mut self, command_type: &str) {
        self.next_id += 1;
        let line = command_line(&format!("req-{}", self.next_id), command_type, Value::Null);
        let _ = self.writer.write_all(line.as_bytes()).await;
        let _ = self.writer.flush().await;
    }

    /// 关闭 stdin（pi 收到 EOF 后有序退出）
    pub async fn close(&mut self) {
        let _ = self.writer.shutdown().await;
    }
}

impl Drop for AgentConnection {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

/// 读循环：按字节 LF 切分（不用按 Unicode 行分隔），响应按 id 交给等待者，事件进通道
async fn read_loop<R: AsyncRead + Unpin>(
    reader: R,
    pending: PendingMap,
    events: mpsc::UnboundedSender<AgentEvent>,
) {
    let mut reader = BufReader::new(reader);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let line = String::from_utf8_lossy(&buf);
        let line = line.trim_end_matches(['\n', '\r']);
        if line.is_empty() {
            continue;
        }
        match parse_line(line) {
            Ok(Incoming::Response(response)) => {
                let waiter = response
                    .id
                    .as_ref()
                    .and_then(|id| pending.lock().ok()?.remove(id));
                if let Some(waiter) = waiter {
                    let _ = waiter.send(response);
                }
            }
            Ok(Incoming::Event(event)) => {
                if events.send(event).is_err() {
                    break;
                }
            }
            Err(_) => continue, // 非协议输出（不应出现）忽略
        }
    }
    // 退出：清空等待者，使其收到“进程已退出”
    if let Ok(mut map) = pending.lock() {
        map.clear();
    }
}

/// 启动一个 sidecar 所需的全部信息（由 `config` 模块生成）
#[derive(Debug, Clone)]
pub struct AgentLaunch {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// 环境变量（含 API Key，切勿记录日志）
    pub env: Vec<(String, String)>,
    pub cwd: PathBuf,
    /// 本次运行的临时目录（agentDir、配置、系统提示词），进程结束后删除
    pub run_dir: Option<PathBuf>,
}

/// 运行中的 sidecar 进程
pub struct AgentProcess {
    child: Child,
    pub connection: AgentConnection,
    stderr_tail: Arc<Mutex<String>>,
    run_dir: Option<PathBuf>,
}

const STDERR_TAIL_LIMIT: usize = 4000;

impl AgentProcess {
    pub async fn spawn(launch: AgentLaunch) -> AppResult<Self> {
        let mut command = Command::new(&launch.program);
        command
            .args(&launch.args)
            .current_dir(&launch.cwd)
            .envs(launch.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|e| {
            agent_error(format!(
                "{}（{}）：{}",
                SPAWN_FAILURE,
                launch.program.display(),
                e
            ))
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| agent_error("agent stdin 不可用"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| agent_error("agent stdout 不可用"))?;
        let stderr_tail = Arc::new(Mutex::new(String::new()));
        if let Some(mut stderr) = child.stderr.take() {
            let tail = stderr_tail.clone();
            tokio::spawn(async move {
                let mut chunk = [0u8; 2048];
                while let Ok(n) = stderr.read(&mut chunk).await {
                    if n == 0 {
                        break;
                    }
                    if let Ok(mut t) = tail.lock() {
                        t.push_str(&String::from_utf8_lossy(&chunk[..n]));
                        if t.len() > STDERR_TAIL_LIMIT {
                            let cut = t.len() - STDERR_TAIL_LIMIT;
                            let cut = (cut..t.len()).find(|i| t.is_char_boundary(*i)).unwrap_or(0);
                            t.drain(..cut);
                        }
                    }
                }
            });
        }

        Ok(Self {
            child,
            connection: AgentConnection::new(stdout, stdin),
            stderr_tail,
            run_dir: launch.run_dir,
        })
    }

    /// stderr 尾部（诊断用；调用方负责脱敏后再记录）
    pub fn stderr_tail(&self) -> String {
        self.stderr_tail
            .lock()
            .map(|t| t.clone())
            .unwrap_or_default()
    }

    /// 有序关闭：关闭 stdin → 最多等 3 秒 → 强制结束；删除本次运行目录
    pub async fn shutdown(mut self) {
        self.connection.close().await;
        if tokio::time::timeout(Duration::from_secs(3), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.kill().await;
        }
        if let Some(dir) = self.run_dir.take() {
            let _ = tokio::fs::remove_dir_all(dir).await;
        }
    }
}

impl Drop for AgentProcess {
    fn drop(&mut self) {
        // 未调用 shutdown 时兜底清理（kill_on_drop 负责结束进程）
        if let Some(dir) = self.run_dir.take() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, AsyncBufReadExt, AsyncWriteExt, BufReader};

    const EXTRACT_RUN: &str = include_str!("fixtures/extract_words_run.jsonl");

    /// 假 sidecar：读一条命令，回放录制输出（录制时第一条命令的 id 恰为 req-1）
    fn fake_agent(script: &'static str, close_after: Option<usize>) -> AgentConnection {
        let (client_stdin, agent_stdin) = duplex(1 << 16);
        let (mut agent_stdout, client_stdout) = duplex(1 << 20);
        tokio::spawn(async move {
            let mut commands = BufReader::new(agent_stdin).lines();
            let _first = commands.next_line().await;
            for (i, line) in script.lines().enumerate() {
                if close_after == Some(i) {
                    return; // 模拟进程中途退出
                }
                if agent_stdout
                    .write_all(format!("{line}\n").as_bytes())
                    .await
                    .is_err()
                {
                    return;
                }
            }
            // 保持连接直到客户端关闭
            while let Ok(Some(_)) = commands.next_line().await {}
        });
        AgentConnection::new(client_stdout, client_stdin)
    }

    #[tokio::test]
    async fn prompt_returns_structured_outcome_from_recorded_run() {
        let mut conn = fake_agent(EXTRACT_RUN, None);
        let mut seen = 0;
        let outcome = conn
            .prompt("text", Duration::from_secs(5), |_| seen += 1)
            .await
            .unwrap();
        assert!(seen > 10);
        let submit = outcome.last_successful_call("submit_words").unwrap();
        assert!(submit.details["words"].as_array().unwrap().len() >= 5);
        assert_eq!(outcome.error, None);
    }

    #[tokio::test]
    async fn process_exit_before_settled_is_an_error() {
        let mut conn = fake_agent(EXTRACT_RUN, Some(20));
        let err = conn
            .prompt("text", Duration::from_secs(5), |_| {})
            .await
            .unwrap_err();
        assert!(err.to_string().contains("退出"), "{err}");
    }

    #[tokio::test]
    async fn silent_agent_times_out() {
        // 只返回 prompt 的响应，之后再无事件
        let mut conn = fake_agent(
            r#"{"id":"req-1","type":"response","command":"prompt","success":true,"data":{"disposition":"started"}}"#,
            None,
        );
        let err = conn
            .prompt("text", Duration::from_millis(200), |_| {})
            .await
            .unwrap_err();
        assert!(err.to_string().contains("超时"), "{err}");
    }

    #[tokio::test]
    async fn cancellation_aborts_the_run() {
        let mut conn = fake_agent(
            r#"{"id":"req-1","type":"response","command":"prompt","success":true,"data":{"disposition":"started"}}"#,
            None,
        );
        let started = std::time::Instant::now();
        let flag = std::sync::atomic::AtomicBool::new(false);
        let err = conn
            .prompt_cancellable(
                "text",
                Duration::from_secs(30),
                || {
                    // 第一次检查后置位，模拟用户点击取消
                    flag.swap(true, std::sync::atomic::Ordering::SeqCst)
                },
                |_| {},
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains(CANCELLED), "{err}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[tokio::test]
    async fn rejected_command_becomes_error() {
        let mut conn = fake_agent(
            r#"{"id":"req-1","type":"response","command":"set_model","success":false,"error":"Model not found"}"#,
            None,
        );
        let err = conn
            .request(
                "set_model",
                serde_json::json!({ "provider": "x", "modelId": "y" }),
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("Model not found"));
    }
}
