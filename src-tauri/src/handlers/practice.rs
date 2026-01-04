//! 练习会话命令处理器
//!
//! 包含所有与练习会话相关的 Tauri 命令

use crate::error::AppResult;
use crate::logger::Logger;
use crate::types::study::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn start_practice_session(
    app: AppHandle,
    plan_id: i64,
    schedule_id: i64,
) -> AppResult<PracticeSession> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "start_practice_session",
        Some(&format!(
            "plan_id: {}, schedule_id: {}",
            plan_id, schedule_id
        )),
    );

    let service = crate::services::PracticeService::from_pool_and_logger(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.start_practice_session(plan_id, schedule_id).await {
        Ok(session) => {
            logger.api_response(
                "start_practice_session",
                true,
                Some(&format!("练习会话已创建，会话ID: {}", session.session_id)),
            );
            Ok(session)
        }
        Err(e) => {
            logger.api_response("start_practice_session", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 提交步骤结果
#[tauri::command]
pub async fn submit_step_result(
    app: AppHandle,
    session_id: String,
    word_id: i64,
    plan_word_id: i64,
    step: i32,
    user_input: String,
    is_correct: bool,
    time_spent: i64,
    attempts: i32,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "submit_step_result",
        Some(&format!(
            "session_id: {}, word_id: {}, step: {}, is_correct: {}",
            session_id, word_id, step, is_correct
        )),
    );

    let service = crate::services::PracticeService::from_pool_and_logger(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service
        .submit_step_result(
            &session_id,
            word_id,
            plan_word_id,
            step,
            user_input,
            is_correct,
            time_spent,
            attempts,
        )
        .await
    {
        Ok(_) => {
            logger.api_response("submit_step_result", true, Some("步骤结果已记录"));
            Ok(())
        }
        Err(e) => {
            logger.api_response("submit_step_result", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 暂停练习会话
#[tauri::command]
pub async fn pause_practice_session(app: AppHandle, session_id: String) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "pause_practice_session",
        Some(&format!("session_id: {}", session_id)),
    );

    let service = crate::services::PracticeService::from_pool_and_logger(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.pause_practice_session(&session_id).await {
        Ok(_) => {
            logger.api_response(
                "pause_practice_session",
                true,
                Some(&format!("暂停练习会话: {}", session_id)),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("pause_practice_session", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 恢复练习会话
#[tauri::command]
pub async fn resume_practice_session(app: AppHandle, session_id: String) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "resume_practice_session",
        Some(&format!("session_id: {}", session_id)),
    );

    let service = crate::services::PracticeService::from_pool_and_logger(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.resume_practice_session(&session_id).await {
        Ok(_) => {
            logger.api_response(
                "resume_practice_session",
                true,
                Some(&format!("恢复练习会话: {}", session_id)),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("resume_practice_session", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 完成练习会话
#[tauri::command]
pub async fn complete_practice_session(
    app: AppHandle,
    session_id: String,
    total_time: i64,
    active_time: i64,
) -> AppResult<PracticeResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "complete_practice_session",
        Some(&format!("session_id: {}", session_id)),
    );

    let service = crate::services::PracticeService::from_pool_and_logger(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service
        .complete_practice_session(&session_id, total_time, active_time)
        .await
    {
        Ok(result) => {
            logger.api_response(
                "complete_practice_session",
                true,
                Some(&format!(
                    "练习会话已完成，正确率: {:.1}%",
                    result.word_accuracy * 100.0
                )),
            );
            Ok(result)
        }
        Err(e) => {
            logger.api_response("complete_practice_session", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取未完成的练习会话
#[tauri::command]
pub async fn get_incomplete_practice_sessions(
    app: AppHandle,
) -> AppResult<Vec<PracticeSession>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_incomplete_practice_sessions", None);

    let service = crate::services::PracticeService::from_pool_and_logger(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.get_incomplete_practice_sessions().await {
        Ok(sessions) => {
            logger.api_response(
                "get_incomplete_practice_sessions",
                true,
                Some(&format!("找到 {} 个未完成的练习会话", sessions.len())),
            );
            Ok(sessions)
        }
        Err(e) => {
            logger.api_response("get_incomplete_practice_sessions", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取练习会话详情
#[tauri::command]
pub async fn get_practice_session_detail(
    app: AppHandle,
    session_id: String,
) -> AppResult<PracticeSession> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_practice_session_detail",
        Some(&format!("session_id: {}", session_id)),
    );

    let service = crate::services::PracticeService::from_pool_and_logger(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.get_practice_session_detail(&session_id).await {
        Ok(session) => {
            logger.api_response(
                "get_practice_session_detail",
                true,
                Some(&format!("成功获取练习会话详情: {}", session_id)),
            );
            Ok(session)
        }
        Err(e) => {
            logger.api_response(
                "get_practice_session_detail",
                false,
                Some(&format!("获取练习会话详情失败: {}", e)),
            );
            Err(e)
        }
    }
}

/// 取消练习会话
#[tauri::command]
pub async fn cancel_practice_session(app: AppHandle, session_id: String) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "cancel_practice_session",
        Some(&format!("session_id: {}", session_id)),
    );

    let service = crate::services::PracticeService::from_pool_and_logger(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.cancel_practice_session(&session_id).await {
        Ok(_) => {
            logger.api_response("cancel_practice_session", true, Some("练习会话已取消"));
            Ok(())
        }
        Err(e) => {
            logger.api_response("cancel_practice_session", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取学习计划的练习会话列表
#[tauri::command]
pub async fn get_plan_practice_sessions(
    app: AppHandle,
    plan_id: i64,
) -> AppResult<Vec<PracticeSession>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_plan_practice_sessions",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let service = crate::services::PracticeService::from_pool_and_logger(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.get_plan_practice_sessions(plan_id).await {
        Ok(sessions) => {
            logger.api_response(
                "get_plan_practice_sessions",
                true,
                Some(&format!("找到 {} 个练习会话", sessions.len())),
            );
            Ok(sessions)
        }
        Err(e) => {
            logger.api_response("get_plan_practice_sessions", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取练习统计数据
#[tauri::command]
pub async fn get_practice_statistics(
    app: AppHandle,
    plan_id: i64,
) -> AppResult<PracticeStatistics> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_practice_statistics",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let service = crate::services::PracticeService::from_pool_and_logger(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.get_practice_statistics(plan_id).await {
        Ok(stats) => {
            logger.api_response(
                "get_practice_statistics",
                true,
                Some(&format!(
                    "统计完成: 总会话{}, 完成{}, 准确率{:.1}%",
                    stats.total_sessions, stats.completed_sessions, stats.average_accuracy
                )),
            );
            Ok(stats)
        }
        Err(e) => {
            logger.api_response("get_practice_statistics", false, Some(&e.to_string()));
            Err(e)
        }
    }
}
