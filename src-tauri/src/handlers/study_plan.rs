//! 学习计划管理命令处理器
//!
//! 包含所有与学习计划相关的 Tauri 命令

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::services::study_plan::StudyPlanService;
use crate::types::*;
use chrono::Datelike;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

// 导入跨模块辅助函数

#[tauri::command]
pub async fn get_study_plans(app: AppHandle) -> AppResult<Vec<StudyPlanWithProgress>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_plans", None);

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_study_plans_with_progress(false).await {
        Ok(plans) => {
            logger.api_response(
                "get_study_plans",
                true,
                Some(&format!("Returned {} study plans", plans.len())),
            );
            Ok(plans)
        }
        Err(e) => {
            logger.api_response("get_study_plans", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取单个学习计划详情
#[tauri::command]
pub async fn get_study_plan(app: AppHandle, plan_id: i64) -> AppResult<StudyPlanWithProgress> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.info(
        "PARAM_DEBUG",
        &format!("get_study_plan received plan_id: {}", plan_id),
    );
    logger.api_request("get_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_study_plan(plan_id).await {
        Ok(plan) => {
            logger.api_response(
                "get_study_plan",
                true,
                Some(&format!("Returned plan: {}", plan.name)),
            );
            Ok(plan)
        }
        Err(e) => {
            logger.api_response("get_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 更新学习计划
#[tauri::command]
pub async fn update_study_plan(
    app: AppHandle,
    plan_id: i64,
    updates: serde_json::Value,
) -> AppResult<bool> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "update_study_plan",
        Some(&format!("plan_id: {}, updates: {}", plan_id, updates)),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.partial_update(plan_id, &updates).await {
        Ok(_) => {
            logger.api_response("update_study_plan", true, Some("学习计划已更新"));
            Ok(true)
        }
        Err(e) => {
            logger.api_response("update_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 创建学习计划
#[tauri::command]
pub async fn create_study_plan(app: AppHandle, request: CreateStudyPlanRequest) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "create_study_plan",
        Some(&format!(
            "name: {}, words: {}",
            request.name,
            request.word_ids.len()
        )),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.create_study_plan(
        request.name,
        request.description,
        request.word_ids,
        request.mastery_level,
    ).await {
        Ok(plan_id) => {
            logger.api_response(
                "create_study_plan",
                true,
                Some(&format!("Created study plan with ID: {}", plan_id)),
            );
            Ok(plan_id)
        }
        Err(e) => {
            logger.api_response("create_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取学习统计
#[tauri::command]
pub async fn get_study_statistics(app: AppHandle) -> AppResult<StudyStatistics> {
    use crate::services::statistics::StatisticsService;
    
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_statistics", None);

    let service = StatisticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_study_statistics().await {
        Ok(result) => {
            logger.api_response(
                "get_study_statistics",
                true,
                Some("Statistics retrieved successfully"),
            );
            Ok(result)
        }
        Err(e) => {
            logger.api_response("get_study_statistics", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取系统日志
/// 生成学习计划AI规划
#[tauri::command]
pub async fn generate_study_plan_schedule(
    app: AppHandle,
    request: StudyPlanScheduleRequest,
) -> AppResult<StudyPlanAIResult> {
    use crate::ai_service::AIService;
    use crate::types::study::{StudyPlanAIParams, StudyWordInfo};

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "generate_study_plan_schedule",
        Some(&format!(
            "name: {}, intensity: {}, period: {} days, wordbooks: {:?}",
            request.name, request.intensity_level, request.study_period_days, request.wordbook_ids
        )),
    );

    // 验证输入参数
    if request.name.trim().is_empty() {
        let error_msg = "Study plan name cannot be empty";
        logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if !["easy", "normal", "intensive"].contains(&request.intensity_level.as_str()) {
        let error_msg = "Invalid intensity level";
        logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if ![1, 3, 7, 14, 28].contains(&request.study_period_days) {
        let error_msg = "Invalid study period days, must be 1, 3, 7, 14, or 28";
        logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if request.wordbook_ids.is_empty() {
        let error_msg = "At least one wordbook must be selected";
        logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 获取选中单词本的所有单词
    use crate::repositories::word_repository::WordRepository;
    let word_repo = WordRepository::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    let word_rows = word_repo.find_words_by_wordbook_ids(&request.wordbook_ids).await?;

    let all_words: Vec<StudyWordInfo> = word_rows
        .into_iter()
        .map(|(id, word, wordbook_id)| StudyWordInfo {
            word,
            word_id: id.to_string(),
            wordbook_id: wordbook_id.to_string(),
        })
        .collect();

    if all_words.is_empty() {
        let error_msg = "No words found in selected wordbooks";
        logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    logger.info(
        "STUDY_PLAN_SCHEDULE",
        &format!(
            "Collected {} words from {} wordbooks",
            all_words.len(),
            request.wordbook_ids.len()
        ),
    );

    // 准备AI规划参数
    let ai_params = StudyPlanAIParams {
        intensity_level: request.intensity_level.clone(),
        total_words: all_words.len() as i32,
        period_days: request.study_period_days,
        review_frequency: request.review_frequency,
        start_date: request.start_date.clone(),
        word_list: all_words,
    };

    // 获取AI模型配置
    use crate::services::ai_model::AIModelService;
    let ai_model_service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );
    let model_config = ai_model_service.get_model_config(request.model_id).await?;

    // 创建AI服务并调用学习计划规划
    let ai_service = match AIService::from_model_config(&model_config) {
        Ok(service) => service,
        Err(e) => {
            let error_msg = format!("Failed to create AI service: {}", e);
            logger.api_response("generate_study_plan_schedule", false, Some(&error_msg));
            return Err(AppError::InternalError(error_msg));
        }
    };

    // 调用AI服务生成学习计划
    match ai_service
        .generate_study_plan_schedule(ai_params, &model_config, &logger)
        .await
    {
        Ok(result) => {
            logger.api_response(
                "generate_study_plan_schedule",
                true,
                Some(&format!(
                    "Generated schedule with {} daily plans",
                    result.daily_plans.len()
                )),
            );
            Ok(result)
        }
        Err(e) => {
            let error_msg = format!("Failed to generate study plan schedule: {}", e);
            logger.api_response("generate_study_plan_schedule", false, Some(&error_msg));
            Err(AppError::InternalError(error_msg))
        }
    }
}

/// 创建带AI规划的学习计划
#[tauri::command]
pub async fn create_study_plan_with_schedule(
    app: AppHandle,
    request: CreateStudyPlanWithScheduleRequest,
) -> AppResult<Id> {
    use crate::services::study_plan::StudyPlanService;

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "create_study_plan_with_schedule",
        Some(&format!(
            "name: {}, status: {:?}, period: {} days",
            request.name, request.status, request.study_period_days
        )),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.create_study_plan_with_schedule(request).await {
        Ok(plan_id) => {
            logger.api_response(
                "create_study_plan_with_schedule",
                true,
                Some(&format!("Created study plan with ID: {}", plan_id)),
            );
            Ok(plan_id)
        }
        Err(e) => {
            logger.api_response("create_study_plan_with_schedule", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取学习计划的单词列表（显示原始单词本单词，而不是学习日程单词）
#[tauri::command]
pub async fn get_study_plan_words(app: AppHandle, plan_id: i64) -> AppResult<Vec<StudyPlanWord>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_study_plan_words",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_plan_words(plan_id).await {
        Ok(words) => {
            logger.api_response(
                "get_study_plan_words",
                true,
                Some(&format!("Returned {} words", words.len())),
            );
            Ok(words)
        }
        Err(e) => {
            logger.api_response("get_study_plan_words", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 从学习计划中移除单词（删除该单词的所有学习日程）
#[tauri::command]
pub async fn remove_word_from_plan(app: AppHandle, plan_id: i64, word_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "remove_word_from_plan",
        Some(&format!("plan_id: {}, word_id: {}", plan_id, word_id)),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.remove_word_from_plan(plan_id, word_id).await {
        Ok(()) => {
            logger.api_response(
                "remove_word_from_plan",
                true,
                Some(&format!("Removed word {} from plan {}", word_id, plan_id)),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("remove_word_from_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 批量从学习计划中移除单词（删除这些单词的所有学习日程）
#[tauri::command]
pub async fn batch_remove_words_from_plan(
    app: AppHandle,
    plan_id: i64,
    word_ids: Vec<i64>,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "batch_remove_words_from_plan",
        Some(&format!(
            "plan_id: {}, word_count: {}",
            plan_id,
            word_ids.len()
        )),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.batch_remove_words_from_plan(plan_id, &word_ids).await {
        Ok(_deleted_count) => {
            logger.api_response(
                "batch_remove_words_from_plan",
                true,
                Some(&format!(
                    "Removed {} words from plan {}",
                    word_ids.len(), plan_id
                )),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("batch_remove_words_from_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取学习计划统计数据
#[tauri::command]
pub async fn get_study_plan_statistics(
    app: AppHandle,
    plan_id: i64,
) -> AppResult<StudyPlanStatistics> {
    use crate::services::statistics::StatisticsService;

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_study_plan_statistics",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let service = StatisticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_study_plan_statistics(plan_id).await {
        Ok(statistics) => {
            logger.api_response(
                "get_study_plan_statistics",
                true,
                Some("Statistics calculated successfully"),
            );
            Ok(statistics)
        }
        Err(e) => {
            logger.api_response("get_study_plan_statistics", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

// ==================== 学习计划状态管理相关命令 ====================

/// 开始学习计划
#[tauri::command]
pub async fn start_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("start_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.start_study_plan(plan_id).await {
        Ok(_) => {
            logger.api_response("start_study_plan", true, Some("学习计划已开始"));
            Ok(())
        }
        Err(e) => {
            logger.api_response("start_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 完成学习计划
#[tauri::command]
pub async fn complete_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "complete_study_plan",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.complete_study_plan(plan_id).await {
        Ok(_) => {
            logger.api_response("complete_study_plan", true, Some("学习计划已完成"));
            Ok(())
        }
        Err(e) => {
            logger.api_response("complete_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 终止学习计划
#[tauri::command]
pub async fn terminate_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "terminate_study_plan",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.terminate_study_plan(plan_id).await {
        Ok(_) => {
            logger.api_response("terminate_study_plan", true, Some("学习计划已终止"));
            Ok(())
        }
        Err(e) => {
            logger.api_response("terminate_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 重新学习计划（从已完成或已终止状态重新开始）
#[tauri::command]
pub async fn restart_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("restart_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.restart_study_plan(plan_id).await {
        Ok(_) => {
            logger.api_response(
                "restart_study_plan",
                true,
                Some("学习计划已重置，需要重新生成日程"),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("restart_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 编辑学习计划（转为草稿状态）
#[tauri::command]
pub async fn edit_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("edit_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.edit_study_plan(plan_id).await {
        Ok(_) => {
            logger.api_response(
                "edit_study_plan",
                true,
                Some("学习计划已转为草稿状态，学习进度已重置"),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("edit_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 发布学习计划（从草稿转为正常）
#[tauri::command]
pub async fn publish_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("publish_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.publish_study_plan(plan_id).await {
        Ok(_) => {
            logger.api_response("publish_study_plan", true, Some("学习计划已发布"));
            Ok(())
        }
        Err(e) => {
            logger.api_response("publish_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 软删除学习计划
#[tauri::command]
pub async fn delete_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("delete_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.delete_study_plan(plan_id).await {
        Ok(_) => {
            logger.api_response("delete_study_plan", true, Some("学习计划已删除"));
            Ok(())
        }
        Err(e) => {
            logger.api_response("delete_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

// ==================== 学习计划日历数据相关命令 ====================
#[tauri::command]
pub async fn get_study_plan_schedules(
    app: AppHandle,
    plan_id: i64,
) -> AppResult<Vec<serde_json::Value>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_study_plan_schedules",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_plan_schedules(plan_id).await {
        Ok(schedules) => {
            logger.api_response(
                "get_study_plan_schedules",
                true,
                Some(&format!("找到 {} 个日程", schedules.len())),
            );
            Ok(schedules)
        }
        Err(e) => {
            logger.api_response("get_study_plan_schedules", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取学习计划的日历数据（用于StudyCalendar组件）
#[tauri::command]
pub async fn get_study_plan_calendar_data(
    app: AppHandle,
    plan_id: i64,
    year: i32,
    month: i32,
) -> AppResult<Vec<crate::types::study::CalendarDayData>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_study_plan_calendar_data",
        Some(&format!(
            "plan_id: {}, year: {}, month: {}",
            plan_id, year, month
        )),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_plan_calendar_data(plan_id, year, month).await {
        Ok(calendar_data) => {
            logger.api_response(
                "get_study_plan_calendar_data",
                true,
                Some(&format!("Generated {} calendar days", calendar_data.len())),
            );
            Ok(calendar_data)
        }
        Err(e) => {
            logger.api_response("get_study_plan_calendar_data", false, Some(&e.to_string()));
            Err(e)
        }
    }
}
