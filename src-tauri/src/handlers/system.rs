//! 系统命令：日志查看、日志 / 数据文件夹、启动状态

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::common::StartupStatus;
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
    Ok(app.state::<StartupStatus>().inner().clone())
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
