//! 系统命令：日志查看与级别、日志 / 数据文件夹、启动状态

use crate::error::{AppError, AppResult};
use crate::logger::{LogLevel, Logger};
use crate::services::log_settings::LogSettingsService;
use crate::types::common::StartupStatus;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// 默认返回的日志条数与上限
const DEFAULT_LOG_LINES: usize = 300;
const MAX_LOG_LINES: usize = 2000;

/// 最近的系统日志（每行一条 JSON，最新在前）。只读日志末尾；读取本身不写日志，避免刷屏。
#[tauri::command]
pub async fn get_system_logs(app: AppHandle, limit: Option<i64>) -> AppResult<Vec<String>> {
    let logger = app.state::<Logger>().inner().clone();
    let limit = limit
        .map(|n| n.clamp(1, MAX_LOG_LINES as i64) as usize)
        .unwrap_or(DEFAULT_LOG_LINES);
    tauri::async_runtime::spawn_blocking(move || logger.recent_lines(limit))
        .await
        .map_err(|e| AppError::InternalError(format!("读取日志失败：{}", e)))?
        .map_err(|e| AppError::InternalError(format!("读取日志失败：{}", e)))
}

/// 当前的最低日志级别（DEBUG / INFO / WARN / ERROR）
#[tauri::command]
pub async fn get_log_level(app: AppHandle) -> AppResult<String> {
    Ok(app.state::<Logger>().min_level().as_str().to_string())
}

/// 修改最低日志级别：保存并立即生效，返回生效后的级别
#[tauri::command]
pub async fn set_log_level(app: AppHandle, level: String) -> AppResult<String> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request("set_log_level", Some(&level));
    let result = LogSettingsService::set_level(&pool, &logger, &level).await;
    match &result {
        Ok(v) => logger.api_response("set_log_level", true, Some(v)),
        Err(e) => logger.api_response("set_log_level", false, Some(&e.to_string())),
    }
    result
}

/// 前端写一条日志（界面崩溃、未处理的异常、IPC 层错误），组件名统一加 `UI:` 前缀。
/// 级别无法识别时按 ERROR；本命令自身不记 api_request，避免刷屏。
#[tauri::command]
pub async fn write_client_log(
    app: AppHandle,
    level: String,
    component: String,
    message: String,
    details: Option<String>,
) -> AppResult<()> {
    let level = LogLevel::parse(&level).unwrap_or(LogLevel::Error);
    let component = format!("UI:{}", component.trim());
    app.state::<Logger>()
        .log(level, &component, &message, details.as_deref());
    Ok(())
}

/// 在访达 / 资源管理器中打开日志文件夹（反馈问题时附上日志）
#[tauri::command]
pub async fn open_log_folder(app: AppHandle) -> AppResult<()> {
    let logger = app.state::<Logger>();
    let log_file = logger.log_dir().join("app.log");
    app.opener()
        .reveal_item_in_dir(&log_file)
        .map_err(|e| AppError::InternalError(format!("无法打开日志文件夹：{}", e)))
}

/// 启动状态：数据库打开并升级成功为 ok；否则带原因（前端显示错误页，见 `startup.rs`）
#[tauri::command]
pub async fn get_startup_status(app: AppHandle) -> AppResult<StartupStatus> {
    Ok(app.state::<crate::startup::StartupState>().snapshot())
}

/// 在访达 / 资源管理器中打开数据目录（数据库、升级备份、日志都在这里）
#[tauri::command]
pub async fn open_data_folder(app: AppHandle) -> AppResult<()> {
    let dirs = crate::app_paths::dirs(&app);
    let db = dirs.db_path();
    let result = if db.exists() {
        app.opener().reveal_item_in_dir(&db)
    } else {
        app.opener()
            .open_path(dirs.data.to_string_lossy(), None::<&str>)
    };
    result.map_err(|e| AppError::InternalError(format!("无法打开数据文件夹：{}", e)))
}
