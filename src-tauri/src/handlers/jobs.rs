//! 后台任务命令：列表、取消、移除；退出确认（有任务在跑时由前端确认后调用 quit_app）。任务本身由各功能的 start_* 命令提交（见 jobs.rs）。

use crate::error::{AppError, AppResult};
use crate::jobs::{Job, Jobs};
use tauri::{AppHandle, Emitter, Manager};

/// 有任务在跑时请前端确认退出（载荷：任务标题）
pub const QUIT_REQUESTED_EVENT: &str = "quit-requested";

/// 全部任务（最新的在前）；前端启动时取一次，之后只听 `job-updated`
#[tauri::command]
pub async fn list_jobs(app: AppHandle) -> AppResult<Vec<Job>> {
    Ok(app.state::<Jobs>().list())
}

/// 取消任务（排队中的立即结束，运行中的在下一个检查点停下）
#[tauri::command]
pub async fn cancel_job(app: AppHandle, job_id: String) -> AppResult<()> {
    if app.state::<Jobs>().cancel(&job_id) {
        Ok(())
    } else {
        Err(AppError::ValidationError("这个任务已经结束了".to_string()))
    }
}

/// 从列表移除一个已结束的任务
#[tauri::command]
pub async fn remove_job(app: AppHandle, job_id: String) -> AppResult<()> {
    app.state::<Jobs>().remove(&job_id);
    Ok(())
}

/// 清除全部已结束的任务
#[tauri::command]
pub async fn clear_finished_jobs(app: AppHandle) -> AppResult<()> {
    app.state::<Jobs>().clear_finished();
    Ok(())
}

/// 用户确认后退出（不再检查任务）
#[tauri::command]
pub async fn quit_app(app: AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}

/// 关窗 / 退出前调用：有任务在跑时通知前端确认并返回 true（调用方阻止退出）
pub fn intercept_quit(app: &AppHandle) -> bool {
    let Some(jobs) = app.try_state::<Jobs>() else {
        return false;
    };
    let active = jobs.active_titles();
    if active.is_empty() {
        return false;
    }
    let _ = app.emit(QUIT_REQUESTED_EVENT, active);
    true
}
