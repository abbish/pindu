//! 把 `tracing` 事件、`log` 记录与 panic 接进应用日志（`logger.rs` 的同一个 Sink）。
//!
//! - 本应用的代码（target 以 `redlark_app_lib` 开头）按设置的最低级别记录；
//!   第三方库（sqlx、tauri、reqwest…）只收 WARN 以上，避免逐条 SQL / 网络明细刷屏。
//! - tracing 事件的组件名：有 `component` 字段用它，否则用模块路径（去掉 crate 前缀）；
//!   `details` 字段进 details，`message` 进 message，其余字段进 `fields`。span 只分配编号，不记录（暂不需要）。
//! - panic：同步追加到日志文件（不经后台线程），再交给原来的钩子。
//!
//! 安装一次：`install(&logger)`（`lib.rs` 启动时）。测试里用 `tracing::subscriber::with_default` 局部安装。

use crate::logger::{LogLevel, Logger, Record};
use serde_json::{json, Map, Value};
use std::fmt::Write as _;
use std::io::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record as SpanRecord};
use tracing::subscriber::Interest;
use tracing::{Event, Metadata, Subscriber};

/// 本 crate 的 target 前缀（lib 名）
const OWN_TARGET: &str = "redlark_app_lib";

fn level_of(level: &tracing::Level) -> LogLevel {
    match *level {
        tracing::Level::ERROR => LogLevel::Error,
        tracing::Level::WARN => LogLevel::Warn,
        tracing::Level::INFO => LogLevel::Info,
        _ => LogLevel::Debug,
    }
}

/// 某个 target 的这一级是否记录：本应用按最低级别；第三方至少 WARN
fn accepts(logger: &Logger, level: LogLevel, target: &str) -> bool {
    logger.enabled(level) && (target.starts_with(OWN_TARGET) || level >= LogLevel::Warn)
}

/// 组件名：`redlark_app_lib::services::srs` → `services::srs`；第三方保留原 target
fn component_of(target: &str) -> &str {
    target
        .strip_prefix(OWN_TARGET)
        .map(|rest| rest.trim_start_matches("::"))
        .filter(|rest| !rest.is_empty())
        .unwrap_or(target)
}

/// 收集事件字段
#[derive(Default)]
struct Fields {
    message: String,
    component: Option<String>,
    details: Option<String>,
    rest: Map<String, Value>,
}

impl Fields {
    fn put(&mut self, field: &Field, value: Value, text: String) {
        match field.name() {
            "message" => self.message = text,
            "component" => self.component = Some(text),
            "details" => self.details = Some(text),
            name if name.starts_with("log.") => {} // tracing-log 附带的元数据
            name => {
                self.rest.insert(name.to_string(), value);
            }
        }
    }
}

impl Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.put(field, json!(value), value.to_string());
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.put(field, json!(value), value.to_string());
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.put(field, json!(value), value.to_string());
    }
    fn record_f64(&mut self, field: &Field, value: f64) {
        self.put(field, json!(value), value.to_string());
    }
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.put(field, json!(value), value.to_string());
    }
    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        self.put(field, json!(value.to_string()), value.to_string());
    }
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let text = format!("{:?}", value);
        self.put(field, json!(text), text);
    }
}

/// tracing → 应用日志
pub struct AppSubscriber {
    logger: Logger,
    next_span: AtomicU64,
}

impl AppSubscriber {
    pub fn new(logger: Logger) -> Self {
        Self {
            logger,
            next_span: AtomicU64::new(1),
        }
    }
}

impl Subscriber for AppSubscriber {
    // 最低级别运行中可调：每次都问 enabled，不缓存
    fn register_callsite(&self, _: &'static Metadata<'static>) -> Interest {
        Interest::sometimes()
    }

    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.is_span() || accepts(&self.logger, level_of(metadata.level()), metadata.target())
    }

    fn new_span(&self, _: &Attributes<'_>) -> Id {
        Id::from_u64(self.next_span.fetch_add(1, Ordering::Relaxed))
    }

    fn record(&self, _: &Id, _: &SpanRecord<'_>) {}

    fn record_follows_from(&self, _: &Id, _: &Id) {}

    fn event(&self, event: &Event<'_>) {
        let metadata = event.metadata();
        let level = level_of(metadata.level());
        // log 记录经 tracing-log 转来时 target 在 log.target 字段里；这里只处理原生 tracing 事件
        if !accepts(&self.logger, level, metadata.target()) {
            return;
        }
        let mut fields = Fields::default();
        event.record(&mut fields);
        let component = fields
            .component
            .clone()
            .unwrap_or_else(|| component_of(metadata.target()).to_string());
        self.logger.write(Record {
            level,
            component: &component,
            message: &fields.message,
            details: fields.details.as_deref(),
            fields: fields.rest,
        });
    }

    fn enter(&self, _: &Id) {}

    fn exit(&self, _: &Id) {}
}

/// log → 应用日志（sqlx、tauri、reqwest 等用 `log` 门面的库）
struct LogBridge {
    logger: Logger,
}

impl log::Log for LogBridge {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        accepts(
            &self.logger,
            level_of_log(metadata.level()),
            metadata.target(),
        )
    }

    fn log(&self, record: &log::Record<'_>) {
        let level = level_of_log(record.level());
        if !accepts(&self.logger, level, record.target()) {
            return;
        }
        let mut fields = Map::new();
        if let (Some(file), Some(line)) = (record.file(), record.line()) {
            fields.insert("at".into(), json!(format!("{}:{}", file, line)));
        }
        self.logger.write(Record {
            level,
            component: component_of(record.target()),
            message: &record.args().to_string(),
            details: None,
            fields,
        });
    }

    fn flush(&self) {
        self.logger.flush();
    }
}

fn level_of_log(level: log::Level) -> LogLevel {
    match level {
        log::Level::Error => LogLevel::Error,
        log::Level::Warn => LogLevel::Warn,
        log::Level::Info => LogLevel::Info,
        _ => LogLevel::Debug,
    }
}

/// `log` 的全局最高级别：本应用不用 `log` 宏，第三方只收 WARN 以上，所以最多到 WARN
fn log_max_level(level: LogLevel) -> log::LevelFilter {
    if level >= LogLevel::Error {
        log::LevelFilter::Error
    } else {
        log::LevelFilter::Warn
    }
}

/// 最低级别变化时同步 `log` 的全局过滤（`Logger::set_min_level` 调用）
pub fn on_level_changed(level: LogLevel) {
    log::set_max_level(log_max_level(level));
}

/// 安装全局 tracing 订阅者、log 桥接与崩溃钩子（只第一次生效；重复调用无害）
pub fn install(logger: &Logger) {
    if tracing::subscriber::set_global_default(AppSubscriber::new(logger.clone())).is_err() {
        logger.warn("LOGGER", "已有全局 tracing 订阅者，未重复安装", None);
    }
    if log::set_boxed_logger(Box::new(LogBridge {
        logger: logger.clone(),
    }))
    .is_ok()
    {
        log::set_max_level(log_max_level(logger.min_level()));
    }
    install_panic_hook(logger);
}

/// 崩溃钩子：同步追加一条 ERROR（位置、原因、调用栈）到日志文件，再交给原来的钩子
fn install_panic_hook(logger: &Logger) {
    let path = logger.file_path().to_path_buf();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let reason = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "（无法读取 panic 信息）".to_string());
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_default();
        let thread = std::thread::current();
        let mut details = String::new();
        let _ = write!(
            details,
            "线程 {}\n{}",
            thread.name().unwrap_or("未命名"),
            std::backtrace::Backtrace::force_capture()
        );
        let line = json!({
            "timestamp": chrono::Local::now().to_rfc3339(),
            "level": "ERROR",
            "component": "PANIC",
            "message": format!("程序崩溃：{}（{}）", reason, location),
            "details": details.chars().take(8000).collect::<String>(),
            "fields": { "at": location },
        });
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = writeln!(file, "{}", line);
            let _ = file.flush();
        }
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logger() -> Logger {
        let dir = std::env::temp_dir().join(format!("redlark-bridge-{}", uuid::Uuid::new_v4()));
        Logger::new(&dir).unwrap()
    }

    #[test]
    fn tracing_events_get_component_details_and_fields() {
        let logger = logger();
        logger.set_min_level(LogLevel::Info);
        tracing::subscriber::with_default(AppSubscriber::new(logger.clone()), || {
            tracing::info!(
                component = "SRS",
                plan_id = 3,
                count = 12u64,
                "今日复习已同步"
            );
            tracing::warn!(details = "原始错误", "降级");
            tracing::debug!("被最低级别过滤");
        });
        let lines = logger.recent_lines(10).unwrap();
        assert_eq!(lines.len(), 2, "{lines:?}");
        let warn: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(warn["level"], "WARN");
        assert_eq!(warn["details"], "原始错误");
        assert_eq!(warn["component"], "log_bridge::tests");
        let info: Value = serde_json::from_str(&lines[1]).unwrap();
        assert_eq!(info["component"], "SRS");
        assert_eq!(info["message"], "今日复习已同步");
        assert_eq!(info["fields"]["plan_id"], 3);
        assert_eq!(info["fields"]["count"], 12);
    }

    #[test]
    fn third_party_targets_need_warn() {
        let logger = logger();
        logger.set_min_level(LogLevel::Debug);
        assert!(accepts(
            &logger,
            LogLevel::Debug,
            "redlark_app_lib::services"
        ));
        assert!(!accepts(&logger, LogLevel::Info, "sqlx::query"));
        assert!(accepts(&logger, LogLevel::Warn, "sqlx::query"));
        logger.set_min_level(LogLevel::Error);
        assert!(!accepts(&logger, LogLevel::Warn, "sqlx::query"));
    }

    #[test]
    fn log_records_are_bridged_with_source_location() {
        use log::Log;
        let logger = logger();
        let bridge = LogBridge {
            logger: logger.clone(),
        };
        bridge.log(
            &log::Record::builder()
                .level(log::Level::Warn)
                .target("sqlx::pool")
                .file(Some("pool.rs"))
                .line(Some(42))
                .args(format_args!("连接获取较慢"))
                .build(),
        );
        bridge.log(
            &log::Record::builder()
                .level(log::Level::Info)
                .target("sqlx::query")
                .args(format_args!("SELECT 1"))
                .build(),
        );
        let lines = logger.recent_lines(10).unwrap();
        assert_eq!(lines.len(), 1, "{lines:?}");
        let v: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(v["component"], "sqlx::pool");
        assert_eq!(v["fields"]["at"], "pool.rs:42");
    }

    #[test]
    fn panic_is_written_synchronously() {
        let logger = logger();
        install_panic_hook(&logger);
        let result = std::panic::catch_unwind(|| panic!("测试崩溃"));
        // 换回默认钩子，不影响其他测试
        let _ = std::panic::take_hook();
        assert!(result.is_err());
        let text = std::fs::read_to_string(logger.file_path()).unwrap();
        let v: Value = serde_json::from_str(text.lines().last().unwrap()).unwrap();
        assert_eq!(v["component"], "PANIC");
        assert!(v["message"].as_str().unwrap().contains("测试崩溃"));
        assert!(v["fields"]["at"]
            .as_str()
            .unwrap()
            .contains("log_bridge.rs"));
    }

    #[test]
    fn component_strips_own_crate_prefix() {
        assert_eq!(
            component_of("redlark_app_lib::services::srs"),
            "services::srs"
        );
        assert_eq!(component_of("redlark_app_lib"), "redlark_app_lib");
        assert_eq!(component_of("tauri::app"), "tauri::app");
    }
}
