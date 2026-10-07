//! 诊断命令处理器（仅开发排查用，前端不调用）

use crate::error::AppResult;
use crate::logger::Logger;
use crate::services::diagnostics::DiagnosticsService;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// 诊断学习计划数据
#[tauri::command]
pub async fn diagnose_study_plan_data(
    app: AppHandle,
    plan_name: String,
) -> AppResult<serde_json::Value> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "diagnose_study_plan_data",
        Some(&format!("plan_name: {}", plan_name)),
    );

    let service = DiagnosticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.diagnose_study_plan_data(&plan_name).await {
        Ok(diagnosis) => {
            logger.api_response("diagnose_study_plan_data", true, Some("诊断完成"));
            Ok(diagnosis)
        }
        Err(e) => {
            logger.api_response("diagnose_study_plan_data", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 诊断日历数据状态
#[tauri::command]
pub async fn diagnose_calendar_data(app: AppHandle) -> AppResult<serde_json::Value> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("diagnose_calendar_data", None);

    let service = DiagnosticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.diagnose_calendar_data().await {
        Ok(diagnosis) => {
            logger.api_response("diagnose_calendar_data", true, Some("Diagnosis completed"));
            Ok(diagnosis)
        }
        Err(e) => {
            logger.api_response("diagnose_calendar_data", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 诊断今天的日程
#[tauri::command]
pub async fn diagnose_today_schedules(app: AppHandle) -> AppResult<String> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("diagnose_today_schedules", None);

    let service = DiagnosticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.diagnose_today_schedules().await {
        Ok(result) => {
            logger.api_response(
                "diagnose_today_schedules",
                true,
                Some("Diagnosis completed successfully"),
            );
            Ok(result)
        }
        Err(e) => {
            logger.api_response("diagnose_today_schedules", false, Some(&e.to_string()));
            Err(e)
        }
    }
}
