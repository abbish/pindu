//! 日历视图命令处理器
//!
//! 包含所有与日历视图相关的 Tauri 命令

use crate::error::AppResult;
use crate::logger::Logger;
use crate::repositories::calendar_repository::CalendarRepository;
use crate::services::CalendarService;
use crate::types::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_today_study_schedules(
    app: AppHandle,
) -> AppResult<Vec<TodayStudySchedule>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_today_study_schedules", None);

    // 创建 Repository
    let calendar_repo = CalendarRepository::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    // 创建 Service
    let service = CalendarService::new(calendar_repo);

    match service.get_today_study_schedules().await {
        Ok(schedules) => {
            logger.api_response(
                "get_today_study_schedules",
                true,
                Some(&format!("Found {} today schedules", schedules.len())),
            );
            Ok(schedules)
        }
        Err(e) => {
            logger.api_response("get_today_study_schedules", false, Some(&e.to_string()));
            Err(e)
        }
    }
}
