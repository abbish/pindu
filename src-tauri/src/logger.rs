//! 应用日志：`<app_data_dir>/logs/app.log`，每行一条 JSON。规范：`docs/LOGGING.md`。
//!
//! 行格式：`{timestamp, level, component, message, details?, fields?}`。timestamp 为本地时间（带时区偏移）；
//! `fields` 是结构化字段（请求编号、耗时、tracing 事件的键值等），没有时省略。
//!
//! 写入入口（都进同一个 Sink，同一套分级与格式）：
//! - `Logger`：业务代码经 Tauri 状态拿到的句柄（`info` / `warn` / `error` / `debug` / `api_request` / `api_response`）。
//! - `tracing` 宏：拿不到 `Logger` 的代码直接写 `tracing::info!(component = "SRS", plan_id, "…")`；
//!   第三方库（sqlx、tauri、reqwest…）经 `log` / `tracing` 发出的日志也收进来（见 `log_bridge.rs`，只收 WARN 以上）。
//! - panic：崩溃钩子同步写入（不经后台线程），保证闪退前的原因落盘。
//!
//! 机制：
//! - 分级：低于最低级别的不写；「设置 → 通用 → 诊断」可调（`services/log_settings.rs`），未设置时发布版 INFO、开发版 DEBUG。
//! - 写入交给后台线程，通道有上限（`QUEUE_CAPACITY`）：满了丢弃并在下一条前补记“丢弃了 N 条”，不会让内存无限增长、也不阻塞业务。
//!   后台线程不缓冲，每行直接写入文件，进程退出时最多丢失队列里尚未写出的几条。
//! - 按大小轮转：超过 `MAX_FILE_BYTES` 时 app.log → app.1.log → … → app.N.log（`KEEP_ROTATED` 个），总量约 25MB 封顶。
//! - 命令配对：`api_request` 分配请求编号，`api_response` 按命令先进先出配对，记下同一编号与耗时（同名命令并发时耗时可能互换）。
//! - 读取（设置页「系统日志」）只读文件末尾。发布版不输出到控制台；单条 details 超长会截断。

use chrono::Local;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, VecDeque};
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::mpsc::{channel, sync_channel, Sender, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// 单个日志文件上限
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// 保留的旧日志文件数（app.1.log … app.N.log）
const KEEP_ROTATED: usize = 4;
/// 单条 details 的最大字符数
const MAX_DETAILS_CHARS: usize = 4000;
/// 写日志队列上限（条）；满了丢弃
const QUEUE_CAPACITY: usize = 10_000;
/// 每个命令最多记住的未配对请求数（有分支只记 request 不记 response 时防止堆积）
const MAX_PENDING_PER_COMMAND: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

impl LogLevel {
    /// 未设置时的最低级别：开发版 DEBUG，发布版 INFO
    pub const DEFAULT: LogLevel = if cfg!(debug_assertions) {
        LogLevel::Debug
    } else {
        LogLevel::Info
    };

    /// "DEBUG" / "INFO" / "WARN" / "ERROR"（不区分大小写）
    pub fn parse(s: &str) -> Option<LogLevel> {
        match s.trim().to_ascii_uppercase().as_str() {
            "DEBUG" => Some(LogLevel::Debug),
            "INFO" => Some(LogLevel::Info),
            "WARN" => Some(LogLevel::Warn),
            "ERROR" => Some(LogLevel::Error),
            _ => None,
        }
    }

    fn from_u8(n: u8) -> LogLevel {
        match n {
            0 => LogLevel::Debug,
            1 => LogLevel::Info,
            2 => LogLevel::Warn,
            _ => LogLevel::Error,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }
}

/// 日志行的时间：本地时间 + 时区偏移（给人看的诊断输出；时间规范的豁免只在本文件，见 scripts/check-time.py）
pub(crate) fn timestamp() -> String {
    Local::now().to_rfc3339()
}

/// 一条日志（写入前的结构）
pub struct Record<'a> {
    pub level: LogLevel,
    pub component: &'a str,
    pub message: &'a str,
    pub details: Option<&'a str>,
    /// 结构化字段；空时不写
    pub fields: Map<String, Value>,
}

impl Record<'_> {
    fn to_line(&self) -> String {
        let mut entry = json!({
            "timestamp": timestamp(),
            "level": self.level.as_str(),
            "component": self.component,
            "message": self.message,
            "details": self.details.map(truncate_details),
        });
        if !self.fields.is_empty() {
            entry["fields"] = Value::Object(self.fields.clone());
        }
        format!("{}\n", entry)
    }
}

/// 发给写日志线程的消息
enum WriterMsg {
    Line(String),
    /// 写完之前的消息后回复（读取日志前调用，保证读到最新）
    Flush(Sender<()>),
}

/// 所有入口共享的写入端
struct Sink {
    path: PathBuf,
    /// 低于此级别的不写；设置页修改后立即生效
    min_level: AtomicU8,
    writer: SyncSender<WriterMsg>,
    /// 队列满被丢弃的条数（下一条成功写入前补记）
    dropped: AtomicU64,
    next_request: AtomicU64,
    /// 命令 → 未配对的（请求编号, 开始时刻）
    pending: Mutex<HashMap<String, VecDeque<(u64, Instant)>>>,
}

impl Sink {
    fn send(&self, line: String) {
        let dropped = self.dropped.swap(0, Ordering::Relaxed);
        if dropped > 0 {
            let note = Record {
                level: LogLevel::Warn,
                component: "LOGGER",
                message: &format!("日志写入太快，丢弃了 {} 条", dropped),
                details: None,
                fields: Map::new(),
            };
            if self
                .writer
                .try_send(WriterMsg::Line(note.to_line()))
                .is_err()
            {
                self.dropped.fetch_add(dropped, Ordering::Relaxed);
            }
        }
        match self.writer.try_send(WriterMsg::Line(line)) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                self.dropped.fetch_add(1, Ordering::Relaxed);
            }
            Err(TrySendError::Disconnected(_)) => {}
        }
    }
}

/// 日志句柄：克隆很轻（共享同一个 Sink）
#[derive(Clone)]
pub struct Logger {
    sink: Arc<Sink>,
}

impl Logger {
    pub fn new(app_data_dir: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        Self::with_options(app_data_dir, MAX_FILE_BYTES, QUEUE_CAPACITY)
    }

    fn with_options(
        app_data_dir: &Path,
        max_bytes: u64,
        capacity: usize,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let log_dir = app_data_dir.join("logs");
        std::fs::create_dir_all(&log_dir)?;

        let path = log_dir.join("app.log");
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);

        let (writer, rx) = sync_channel::<WriterMsg>(capacity);
        let mut state = WriterState {
            path: path.clone(),
            max_bytes,
            file: Some(file),
            size,
        };
        std::thread::Builder::new()
            .name("redlark-logger".into())
            .spawn(move || {
                // 所有 Logger（含克隆、全局桥接）都释放后通道关闭，线程退出
                for msg in rx {
                    match msg {
                        WriterMsg::Line(line) => state.write(&line),
                        WriterMsg::Flush(done) => {
                            if let Some(f) = state.file.as_mut() {
                                let _ = f.flush();
                            }
                            let _ = done.send(());
                        }
                    }
                }
            })?;

        Ok(Logger {
            sink: Arc::new(Sink {
                path,
                min_level: AtomicU8::new(LogLevel::DEFAULT as u8),
                writer,
                dropped: AtomicU64::new(0),
                next_request: AtomicU64::new(0),
                pending: Mutex::new(HashMap::new()),
            }),
        })
    }

    /// 等写日志线程把已发出的日志都写入文件
    pub fn flush(&self) {
        let (done, wait) = channel();
        if self.sink.writer.send(WriterMsg::Flush(done)).is_ok() {
            let _ = wait.recv_timeout(std::time::Duration::from_secs(2));
        }
    }

    /// 当前日志文件（崩溃钩子同步写入用）
    pub(crate) fn file_path(&self) -> &Path {
        &self.sink.path
    }

    /// 日志目录（「打开日志文件夹」用）
    pub fn log_dir(&self) -> PathBuf {
        self.sink
            .path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default()
    }

    /// 当前最低记录级别
    pub fn min_level(&self) -> LogLevel {
        LogLevel::from_u8(self.sink.min_level.load(Ordering::Relaxed))
    }

    /// 修改最低记录级别（对所有克隆与全局桥接立即生效）
    pub fn set_min_level(&self, level: LogLevel) {
        self.sink.min_level.store(level as u8, Ordering::Relaxed);
        crate::log_bridge::on_level_changed(level);
    }

    /// 该级别是否会被记录（拼装开销大的 DEBUG 明细前先判断）
    pub fn enabled(&self, level: LogLevel) -> bool {
        level >= self.min_level()
    }

    /// 写一条结构化日志（低于最低级别的忽略）
    pub fn write(&self, record: Record<'_>) {
        if !self.enabled(record.level) {
            return;
        }
        let line = record.to_line();
        // 开发时同时输出到控制台
        if cfg!(debug_assertions) {
            print!(
                "[{}] {}: {}",
                record.level.as_str(),
                record.component,
                record.message
            );
            if !record.fields.is_empty() {
                print!(" {}", Value::Object(record.fields.clone()));
            }
            println!();
            if let Some(details) = record.details {
                println!("  Details: {}", truncate_details(details));
            }
        }
        self.sink.send(line);
    }

    pub fn log(&self, level: LogLevel, component: &str, message: &str, details: Option<&str>) {
        self.write(Record {
            level,
            component,
            message,
            details,
            fields: Map::new(),
        });
    }

    /// 最近的 `limit` 条日志（最新在前）。只读当前日志文件末尾，不足时再读上一个轮转文件。
    pub fn recent_lines(&self, limit: usize) -> std::io::Result<Vec<String>> {
        self.flush();
        let mut lines = tail_lines(&self.sink.path, limit)?;
        if lines.len() < limit {
            let previous = self.sink.path.with_file_name("app.1.log");
            if previous.exists() {
                lines.extend(tail_lines(&previous, limit - lines.len())?);
            }
        }
        Ok(lines)
    }

    pub fn debug(&self, component: &str, message: &str, details: Option<&str>) {
        self.log(LogLevel::Debug, component, message, details);
    }

    pub fn info(&self, component: &str, message: &str) {
        self.log(LogLevel::Info, component, message, None);
    }

    pub fn warn(&self, component: &str, message: &str, details: Option<&str>) {
        self.log(LogLevel::Warn, component, message, details);
    }

    pub fn error(&self, component: &str, message: &str, details: Option<&str>) {
        self.log(LogLevel::Error, component, message, details);
    }

    /// 命令进入：分配请求编号（`fields.req`）。只读查询（页面加载、轮询）记 DEBUG，改数据的操作记 INFO
    pub fn api_request(&self, command: &str, args: Option<&str>) {
        let req = self.sink.next_request.fetch_add(1, Ordering::Relaxed) + 1;
        {
            let mut pending = self.sink.pending.lock().unwrap_or_else(|e| e.into_inner());
            let queue = pending.entry(command.to_string()).or_default();
            if queue.len() >= MAX_PENDING_PER_COMMAND {
                queue.pop_front();
            }
            queue.push_back((req, Instant::now()));
        }
        let mut fields = Map::new();
        fields.insert("req".into(), json!(req));
        self.write(Record {
            level: success_level(command),
            component: "API",
            message: &format!("API Request: {}", command),
            details: args,
            fields,
        });
    }

    /// 命令结束：带上同一请求编号与耗时（`fields.req` / `fields.elapsed_ms`）。成功同上分级；失败一律 ERROR
    pub fn api_response(&self, command: &str, success: bool, details: Option<&str>) {
        let started = {
            let mut pending = self.sink.pending.lock().unwrap_or_else(|e| e.into_inner());
            pending.get_mut(command).and_then(VecDeque::pop_front)
        };
        let mut fields = Map::new();
        let mut message = format!(
            "API Response: {} - {}",
            command,
            if success { "SUCCESS" } else { "FAILED" }
        );
        if let Some((req, at)) = started {
            let elapsed = at.elapsed().as_millis() as u64;
            fields.insert("req".into(), json!(req));
            fields.insert("elapsed_ms".into(), json!(elapsed));
            message.push_str(&format!("（{}ms）", elapsed));
        }
        self.write(Record {
            level: if success {
                success_level(command)
            } else {
                LogLevel::Error
            },
            component: "API",
            message: &message,
            details,
            fields,
        });
    }

    pub fn database_operation(
        &self,
        operation: &str,
        table: &str,
        success: bool,
        details: Option<&str>,
    ) {
        let level = if success {
            LogLevel::Debug
        } else {
            LogLevel::Error
        };
        let message = format!("Database {}: {}", operation, table);
        self.log(level, "DATABASE", &message, details);
    }
}

/// 只读查询命令（按命名约定：get_ / list_ / preview_ / find_ / diagnose_ 开头）。
/// 首页、日历、计划卡会反复调用它们，记 INFO 会占满日志（实测约八成），所以成功时记 DEBUG。
fn is_read_only(command: &str) -> bool {
    ["get_", "list_", "preview_", "find_", "diagnose_"]
        .iter()
        .any(|p| command.starts_with(p))
}

/// 高频命令：练习中每一步、每次自动保存、每次朗读都会调用，成功时只记 DEBUG（结果汇总在完成练习那一条）
const HIGH_FREQUENCY: [&str; 3] = [
    "submit_step_result",
    "save_practice_progress",
    "text_to_speech",
];

fn success_level(command: &str) -> LogLevel {
    if is_read_only(command) || HIGH_FREQUENCY.contains(&command) {
        LogLevel::Debug
    } else {
        LogLevel::Info
    }
}

/// 写日志线程的状态：保持文件打开，记录当前大小，超过上限时轮转
struct WriterState {
    path: PathBuf,
    max_bytes: u64,
    file: Option<File>,
    size: u64,
}

impl WriterState {
    fn write(&mut self, line: &str) {
        if self.size >= self.max_bytes {
            self.rotate();
        }
        if self.file.is_none() {
            self.file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .ok();
            self.size = 0;
        }
        if let Some(f) = self.file.as_mut() {
            if f.write_all(line.as_bytes()).is_ok() {
                self.size += line.len() as u64;
            }
        }
    }

    /// app.log → app.1.log → … → app.N.log（N = KEEP_ROTATED，最旧的删除）
    fn rotate(&mut self) {
        self.file = None; // 先关闭当前文件
        let rotated = |n: usize| self.path.with_file_name(format!("app.{}.log", n));
        let _ = std::fs::remove_file(rotated(KEEP_ROTATED));
        for n in (1..KEEP_ROTATED).rev() {
            let _ = std::fs::rename(rotated(n), rotated(n + 1));
        }
        let _ = std::fs::rename(&self.path, rotated(1));
    }
}

/// details 超长时截断（按字符，不切断多字节字符）
fn truncate_details(details: &str) -> String {
    if details.chars().count() <= MAX_DETAILS_CHARS {
        return details.to_string();
    }
    let kept: String = details.chars().take(MAX_DETAILS_CHARS).collect();
    format!("{}…（已截断，原长 {} 字符）", kept, details.chars().count())
}

/// 读取文件末尾的最多 `limit` 行（最新在前）。从末尾按块向前读，读够即停。
fn tail_lines(path: &Path, limit: usize) -> std::io::Result<Vec<String>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    const CHUNK: u64 = 64 * 1024;
    let mut pos = len;
    let mut buf: Vec<u8> = Vec::new();
    loop {
        let newlines = buf.iter().filter(|&&b| b == b'\n').count();
        if pos == 0 || newlines > limit {
            break;
        }
        let start = pos.saturating_sub(CHUNK);
        let mut chunk = vec![0u8; (pos - start) as usize];
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(&mut chunk)?;
        chunk.extend_from_slice(&buf);
        buf = chunk;
        pos = start;
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    // 没读到文件开头时，第一行可能只是半行
    if pos > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    Ok(lines
        .into_iter()
        .rev()
        .take(limit)
        .map(str::to_string)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("redlark-logger-{}-{}", name, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn recent_lines_are_newest_first_and_limited() {
        let logger = Logger::new(&temp_dir("tail")).unwrap();
        for i in 0..50 {
            logger.info("TEST", &format!("line {}", i));
        }
        let lines = logger.recent_lines(10).unwrap();
        assert_eq!(lines.len(), 10);
        assert!(lines[0].contains("line 49"));
        assert!(lines[9].contains("line 40"));
        assert_eq!(logger.recent_lines(500).unwrap().len(), 50);
    }

    #[test]
    fn tail_reads_across_chunk_boundaries() {
        let dir = temp_dir("chunks");
        let path = dir.join("big.log");
        let mut f = File::create(&path).unwrap();
        for i in 0..20_000 {
            writeln!(f, "{{\"n\":{}}}", i).unwrap();
        }
        let lines = tail_lines(&path, 5000).unwrap();
        assert_eq!(lines.len(), 5000);
        assert_eq!(lines[0], "{\"n\":19999}");
        assert_eq!(lines[4999], "{\"n\":15000}");
    }

    #[test]
    fn rotates_when_file_exceeds_limit_and_keeps_bounded_history() {
        let dir = temp_dir("rotate");
        let logger = Logger::with_options(&dir, 1000, QUEUE_CAPACITY).unwrap();
        let log_dir = dir.join("logs");
        for i in 0..100 {
            logger.info("TEST", &format!("line {}", i));
        }
        logger.flush();
        for n in 1..=KEEP_ROTATED {
            assert!(log_dir.join(format!("app.{n}.log")).exists(), "app.{n}.log");
        }
        assert!(!log_dir
            .join(format!("app.{}.log", KEEP_ROTATED + 1))
            .exists());
        let current = std::fs::metadata(log_dir.join("app.log")).unwrap().len();
        assert!(current <= 1200, "{current}");
        // 最新的日志在当前文件里，读取时不足再接上一个轮转文件
        let recent = logger.recent_lines(3).unwrap();
        assert!(recent[0].contains("line 99"));
    }

    #[test]
    fn existing_large_file_is_rotated_on_first_write() {
        let dir = temp_dir("existing");
        let log_dir = dir.join("logs");
        std::fs::create_dir_all(&log_dir).unwrap();
        std::fs::write(log_dir.join("app.log"), vec![b'x'; 2000]).unwrap();
        let logger = Logger::with_options(&dir, 1000, QUEUE_CAPACITY).unwrap();
        logger.info("TEST", "fresh");
        logger.flush();
        assert_eq!(
            std::fs::metadata(log_dir.join("app.1.log")).unwrap().len(),
            2000
        );
        assert!(std::fs::read_to_string(log_dir.join("app.log"))
            .unwrap()
            .contains("fresh"));
    }

    #[test]
    fn lines_below_min_level_are_skipped_for_all_clones() {
        let logger = Logger::new(&temp_dir("level")).unwrap();
        let clone = logger.clone();
        logger.set_min_level(LogLevel::Warn);
        clone.info("TEST", "info hidden");
        clone.debug("TEST", "debug hidden", None);
        clone.warn("TEST", "warn kept", None);
        clone.error("TEST", "error kept", None);
        assert_eq!(clone.min_level(), LogLevel::Warn);
        assert!(!clone.enabled(LogLevel::Info));
        let lines = logger.recent_lines(10).unwrap();
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert!(lines[0].contains("error kept") && lines[1].contains("warn kept"));

        logger.set_min_level(LogLevel::Debug);
        clone.debug("TEST", "debug shown", None);
        assert!(logger.recent_lines(1).unwrap()[0].contains("debug shown"));
    }

    #[test]
    fn read_only_commands_log_at_debug_but_failures_stay_errors() {
        let logger = Logger::new(&temp_dir("api")).unwrap();
        logger.set_min_level(LogLevel::Info);
        logger.api_request("get_study_plans", None);
        logger.api_response("get_study_plans", true, None);
        logger.api_request("start_practice_session", None);
        logger.api_request("submit_step_result", None);
        logger.api_response("get_study_plans", false, Some("boom"));
        let lines = logger.recent_lines(10).unwrap();
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert!(lines[0].contains("FAILED") && lines[0].contains("\"ERROR\""));
        assert!(lines[1].contains("start_practice_session"));
    }

    #[test]
    fn api_request_and_response_share_request_id_and_elapsed() {
        let logger = Logger::new(&temp_dir("pair")).unwrap();
        logger.api_request("start_practice_session", Some("plan_id: 1"));
        logger.api_request("start_practice_session", Some("plan_id: 2"));
        logger.api_response("start_practice_session", true, None);
        logger.api_response("start_practice_session", false, Some("boom"));
        let lines: Vec<Value> = logger
            .recent_lines(10)
            .unwrap()
            .iter()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        // 最新在前：失败的响应配对第二个请求
        assert_eq!(lines[0]["fields"]["req"], lines[2]["fields"]["req"]);
        assert_eq!(lines[1]["fields"]["req"], lines[3]["fields"]["req"]);
        assert!(lines[0]["fields"]["elapsed_ms"].is_u64());
        assert!(lines[0]["message"].as_str().unwrap().contains("ms）"));
        // 没有配对的响应不带编号
        logger.api_response("never_requested", true, None);
        let last: Value = serde_json::from_str(&logger.recent_lines(1).unwrap()[0]).unwrap();
        assert!(last.get("fields").is_none());
    }

    #[test]
    fn full_queue_drops_and_reports_count() {
        // 不启动写线程：队列容量 2，手动消费
        let (writer, rx) = sync_channel::<WriterMsg>(2);
        let sink = Sink {
            path: PathBuf::new(),
            min_level: AtomicU8::new(LogLevel::Debug as u8),
            writer,
            dropped: AtomicU64::new(0),
            next_request: AtomicU64::new(0),
            pending: Mutex::new(HashMap::new()),
        };
        for i in 0..5 {
            sink.send(format!("line {i}\n"));
        }
        assert_eq!(sink.dropped.load(Ordering::Relaxed), 3);
        let drained: Vec<String> = rx
            .try_iter()
            .filter_map(|m| match m {
                WriterMsg::Line(l) => Some(l),
                WriterMsg::Flush(_) => None,
            })
            .collect();
        assert_eq!(drained, vec!["line 0\n", "line 1\n"]);
        sink.send("line 5\n".into());
        let next: Vec<String> = rx
            .try_iter()
            .filter_map(|m| match m {
                WriterMsg::Line(l) => Some(l),
                WriterMsg::Flush(_) => None,
            })
            .collect();
        assert!(next[0].contains("丢弃了 3 条"), "{next:?}");
        assert_eq!(next[1], "line 5\n");
        assert_eq!(sink.dropped.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn parses_level_names() {
        assert_eq!(LogLevel::parse("warn"), Some(LogLevel::Warn));
        assert_eq!(LogLevel::parse(" ERROR "), Some(LogLevel::Error));
        assert_eq!(LogLevel::parse("verbose"), None);
        for level in [
            LogLevel::Debug,
            LogLevel::Info,
            LogLevel::Warn,
            LogLevel::Error,
        ] {
            assert_eq!(LogLevel::parse(level.as_str()), Some(level));
        }
    }

    #[test]
    fn long_details_are_truncated_on_char_boundaries() {
        let long = "拼".repeat(MAX_DETAILS_CHARS + 10);
        let t = truncate_details(&long);
        assert!(t.starts_with(&"拼".repeat(10)));
        assert!(t.contains("已截断"));
        assert_eq!(truncate_details("短"), "短");
    }
}
