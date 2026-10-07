//! 应用日志：`<app_data_dir>/logs/app.log`，每行一条 JSON（timestamp / level / component / message / details）。
//!
//! - 按大小轮转：超过 `MAX_FILE_BYTES` 时 app.log → app.1.log → app.2.log，最多保留 `KEEP_ROTATED` 个旧文件。
//! - 发布版不写 DEBUG（数据库操作明细），也不输出到控制台；单条 details 超长会截断。
//! - 写入交给后台线程：调用方只发一条消息（不阻塞、不做文件 IO），后台线程保持文件打开、按序写入并负责轮转。
//! - 读取（设置页「系统日志」）只读文件末尾，不把整个文件读进内存。

use chrono::Local;
use serde_json::json;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};

/// 单个日志文件上限
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// 保留的旧日志文件数（app.1.log … app.N.log）
const KEEP_ROTATED: usize = 2;
/// 单条 details 的最大字符数
const MAX_DETAILS_CHARS: usize = 4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }
}

/// 发给写日志线程的消息
enum WriterMsg {
    Line(String),
    /// 写完之前的消息后回复（读取日志前调用，保证读到最新）
    Flush(Sender<()>),
}

#[derive(Clone)]
pub struct Logger {
    log_file_path: PathBuf,
    /// 低于此级别的不写（发布版跳过 DEBUG）
    min_level: LogLevel,
    writer: Sender<WriterMsg>,
}

impl Logger {
    pub fn new(app_data_dir: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        Self::with_max_bytes(app_data_dir, MAX_FILE_BYTES)
    }

    fn with_max_bytes(
        app_data_dir: &Path,
        max_bytes: u64,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let log_dir = app_data_dir.join("logs");
        std::fs::create_dir_all(&log_dir)?;

        let log_file_path = log_dir.join("app.log");
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file_path)?;
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);

        let (writer, rx) = channel::<WriterMsg>();
        let mut state = WriterState {
            path: log_file_path.clone(),
            max_bytes,
            file: Some(file),
            size,
        };
        std::thread::Builder::new()
            .name("redlark-logger".into())
            .spawn(move || {
                // 所有 Logger（含克隆）都释放后通道关闭，线程退出
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
            log_file_path,
            min_level: if cfg!(debug_assertions) {
                LogLevel::Debug
            } else {
                LogLevel::Info
            },
            writer,
        })
    }

    /// 等写日志线程把已发出的日志都写入文件
    fn flush(&self) {
        let (done, wait) = channel();
        if self.writer.send(WriterMsg::Flush(done)).is_ok() {
            let _ = wait.recv_timeout(std::time::Duration::from_secs(2));
        }
    }

    /// 日志目录（「打开日志文件夹」用）
    pub fn log_dir(&self) -> PathBuf {
        self.log_file_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default()
    }

    pub fn log(&self, level: LogLevel, component: &str, message: &str, details: Option<&str>) {
        if level < self.min_level {
            return;
        }
        let timestamp = Local::now();
        let details = details.map(truncate_details);
        let log_entry = json!({
            "timestamp": timestamp.to_rfc3339(),
            "level": level.as_str(),
            "component": component,
            "message": message,
            "details": details
        });
        let log_line = format!("{}\n", log_entry);

        let _ = self.writer.send(WriterMsg::Line(log_line));

        // 开发时同时输出到控制台
        if cfg!(debug_assertions) {
            println!(
                "[{}] [{}] {}: {}",
                timestamp.format("%Y-%m-%d %H:%M:%S"),
                level.as_str(),
                component,
                message
            );
            if let Some(details) = &details {
                println!("  Details: {}", details);
            }
        }
    }

    /// 最近的 `limit` 条日志（最新在前）。只读当前日志文件末尾，不足时再读上一个轮转文件。
    pub fn recent_lines(&self, limit: usize) -> std::io::Result<Vec<String>> {
        self.flush();
        let mut lines = tail_lines(&self.log_file_path, limit)?;
        if lines.len() < limit {
            let previous = self.log_file_path.with_file_name("app.1.log");
            if previous.exists() {
                lines.extend(tail_lines(&previous, limit - lines.len())?);
            }
        }
        Ok(lines)
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

    pub fn api_request(&self, command: &str, args: Option<&str>) {
        let message = format!("API Request: {}", command);
        self.log(LogLevel::Info, "API", &message, args);
    }

    pub fn api_response(&self, command: &str, success: bool, details: Option<&str>) {
        let level = if success {
            LogLevel::Info
        } else {
            LogLevel::Error
        };
        let message = format!(
            "API Response: {} - {}",
            command,
            if success { "SUCCESS" } else { "FAILED" }
        );
        self.log(level, "API", &message, details);
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
        let logger = Logger::with_max_bytes(&dir, 1000).unwrap();
        let log_dir = dir.join("logs");
        for i in 0..100 {
            logger.info("TEST", &format!("line {}", i));
        }
        logger.flush();
        assert!(log_dir.join("app.1.log").exists());
        assert!(log_dir.join("app.2.log").exists());
        assert!(!log_dir.join("app.3.log").exists());
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
        let logger = Logger::with_max_bytes(&dir, 1000).unwrap();
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
    fn long_details_are_truncated_on_char_boundaries() {
        let long = "拼".repeat(MAX_DETAILS_CHARS + 10);
        let t = truncate_details(&long);
        assert!(t.starts_with(&"拼".repeat(10)));
        assert!(t.contains("已截断"));
        assert_eq!(truncate_details("短"), "短");
    }
}
