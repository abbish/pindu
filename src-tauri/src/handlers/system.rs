//! 系统命令：日志查看与日志文件夹

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
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
