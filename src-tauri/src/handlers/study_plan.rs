//! 学习计划管理命令处理器
//!
//! 包含所有与学习计划相关的 Tauri 命令

use crate::error::AppResult;
use crate::logger::Logger;
use crate::services::study_plan::StudyPlanService;
use crate::types::*;
use sqlx::SqlitePool;
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
        Arc::new(logger.inner().clone()),
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

    logger.api_request("get_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
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

/// 获取学习统计
#[tauri::command]
pub async fn get_study_statistics(app: AppHandle) -> AppResult<StudyStatistics> {
    use crate::services::statistics::StatisticsService;

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_statistics", None);

    let service = StatisticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
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
/// 改每天新词数（就地生效）：只重排还没练过的新词日，已练过的日程与记忆等级不动
#[tauri::command]
pub async fn replan_study_plan_pace(
    app: AppHandle,
    plan_id: Id,
    daily_new_words: i32,
) -> AppResult<crate::services::plan_pace::PlanPaceResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "replan_study_plan_pace",
        Some(&format!(
            "plan_id: {}, daily_new_words: {}",
            plan_id, daily_new_words
        )),
    );
    let result = crate::services::plan_pace::PlanPaceService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    )
    .replan_pace(plan_id, daily_new_words, crate::time::local_today())
    .await;
    logger.api_response(
        "replan_study_plan_pace",
        result.is_ok(),
        Some(&match &result {
            Ok(r) => format!(
                "{} new words over {} days",
                r.remaining_new_words, r.learning_days
            ),
            Err(e) => e.to_string(),
        }),
    );
    result
}

/// 往计划里追加词汇本：新词排在还没学的新词后面
#[tauri::command]
pub async fn add_word_books_to_plan(
    app: AppHandle,
    plan_id: Id,
    wordbook_ids: Vec<Id>,
) -> AppResult<crate::services::plan_pace::PlanPaceResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "add_word_books_to_plan",
        Some(&format!(
            "plan_id: {}, wordbooks: {:?}",
            plan_id, wordbook_ids
        )),
    );
    let result = crate::services::plan_pace::PlanPaceService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    )
    .add_word_books(plan_id, &wordbook_ids, crate::time::local_today())
    .await;
    logger.api_response(
        "add_word_books_to_plan",
        result.is_ok(),
        Some(&match &result {
            Ok(r) => format!("added {} words", r.added_words),
            Err(e) => e.to_string(),
        }),
    );
    result
}

/// 创建计划前的即时预览（确定性，不用 AI）：按默认顺序从今天排出的日程
#[tauri::command]
pub async fn preview_study_plan(
    app: AppHandle,
    wordbook_ids: Vec<Id>,
    daily_new_words: i32,
) -> AppResult<StudyPlanAIResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "preview_study_plan",
        Some(&format!(
            "wordbooks: {:?}, daily_new_words: {}",
            wordbook_ids, daily_new_words
        )),
    );
    let result = crate::services::study_plan_generation::preview(
        &Arc::new(pool.inner().clone()),
        &Arc::new(logger.inner().clone()),
        &wordbook_ids,
        daily_new_words,
    )
    .await;
    logger.api_response(
        "preview_study_plan",
        result.is_ok(),
        Some(&match &result {
            Ok(r) => format!(
                "{} words, {} days",
                r.plan_metadata.total_words,
                r.daily_plans.len()
            ),
            Err(e) => e.to_string(),
        }),
    );
    result
}

/// 按默认顺序生成学习计划日程（不用 AI；AI 排序走 start_study_plan_ordering）
#[tauri::command]
pub async fn generate_study_plan_schedule(
    app: AppHandle,
    request: StudyPlanScheduleRequest,
) -> AppResult<StudyPlanAIResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "generate_study_plan_schedule",
        Some(&format!(
            "name: {}, daily_new_words: {}, wordbooks: {:?}",
            request.name, request.daily_new_words, request.wordbook_ids
        )),
    );
    let result = crate::services::study_plan_generation::generate_without_ai(
        &Arc::new(pool.inner().clone()),
        &Arc::new(logger.inner().clone()),
        &request,
    )
    .await;
    super::finish(&logger, "generate_study_plan_schedule", result)
}

/// AI 排学习顺序并生成日程（前台任务）：立即返回任务 id，结果（StudyPlanAIResult）在任务完成时随 job-updated 送达；
/// 新建计划页离开时取消任务
#[tauri::command]
pub async fn start_study_plan_ordering(
    app: AppHandle,
    request: StudyPlanScheduleRequest,
) -> AppResult<String> {
    use crate::jobs::{JobSpec, Jobs, Lane};
    use crate::services::study_plan_generation::{validate_request, StudyPlanGenerator};

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_study_plan_ordering",
        Some(&format!(
            "name: {}, daily_new_words: {}, wordbooks: {:?}",
            request.name, request.daily_new_words, request.wordbook_ids
        )),
    );
    let result = async {
        validate_request(&request)?;
        let generator = StudyPlanGenerator::new(
            Arc::new(pool.inner().clone()),
            Arc::new(logger.inner().clone()),
            super::agent_paths(&app)?,
        );
        let spec = JobSpec {
            kind: "plan_ordering",
            title: format!("AI 排学习顺序 · {}", request.name.trim()),
            lane: Lane::Agent,
            detached: false,
            link: None,
        };
        Ok(app.state::<Jobs>().spawn(spec, move |ctx| async move {
            let schedule = generator.generate(&request, &ctx).await?;
            Ok(serde_json::to_value(schedule).unwrap_or_default())
        }))
    }
    .await;
    super::finish(&logger, "start_study_plan_ordering", result)
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
        Arc::new(logger.inner().clone()),
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
            logger.api_response(
                "create_study_plan_with_schedule",
                false,
                Some(&e.to_string()),
            );
            Err(e)
        }
    }
}

/// 获取学习计划的单词列表（显示原始词汇本单词，而不是学习日程单词）
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
        Arc::new(logger.inner().clone()),
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
        Arc::new(logger.inner().clone()),
    );

    match service
        .batch_remove_words_from_plan(plan_id, &word_ids)
        .await
    {
        Ok(_deleted_count) => {
            logger.api_response(
                "batch_remove_words_from_plan",
                true,
                Some(&format!(
                    "Removed {} words from plan {}",
                    word_ids.len(),
                    plan_id
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
        Arc::new(logger.inner().clone()),
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
        Arc::new(logger.inner().clone()),
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
        Arc::new(logger.inner().clone()),
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
        Arc::new(logger.inner().clone()),
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
        Arc::new(logger.inner().clone()),
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

/// 发布学习计划（从草稿转为正常）
#[tauri::command]
pub async fn publish_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("publish_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
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
        Arc::new(logger.inner().clone()),
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
) -> AppResult<Vec<crate::types::study::PlanScheduleSummary>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_study_plan_schedules",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
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
        Arc::new(logger.inner().clone()),
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

/// 获取学习计划关联的词汇本ID列表
#[tauri::command]
pub async fn get_study_plan_word_books(app: AppHandle, plan_id: i64) -> AppResult<Vec<i64>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_study_plan_word_books",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.get_plan_word_book_ids(plan_id).await {
        Ok(ids) => {
            logger.api_response(
                "get_study_plan_word_books",
                true,
                Some(&format!("Found {} word books", ids.len())),
            );
            Ok(ids)
        }
        Err(e) => {
            logger.api_response("get_study_plan_word_books", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 更新学习计划基本信息（名称和描述；任何未删除的计划都可以改，不影响日程与进度）
#[tauri::command]
pub async fn update_study_plan_basic_info(
    app: AppHandle,
    plan_id: i64,
    name: String,
    description: Option<String>,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "update_study_plan_basic_info",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service
        .update_basic_info(plan_id, &name, description.as_deref())
        .await
    {
        Ok(()) => {
            logger.api_response(
                "update_study_plan_basic_info",
                true,
                Some("学习计划基本信息已更新"),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("update_study_plan_basic_info", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 计划的记忆概况：各记忆等级的词数、今天待复习、已掌握（自适应复习，D20）
#[tauri::command]
pub async fn get_plan_memory_overview(
    app: AppHandle,
    plan_id: i64,
) -> AppResult<PlanMemoryOverview> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_plan_memory_overview",
        Some(&format!("plan_id: {}", plan_id)),
    );
    match crate::services::srs::plan_overview(pool.inner(), plan_id).await {
        Ok(overview) => {
            logger.api_response(
                "get_plan_memory_overview",
                true,
                Some(&format!(
                    "total={}, mastered={}, due_today={}",
                    overview.total, overview.mastered, overview.due_today
                )),
            );
            Ok(overview)
        }
        Err(e) => {
            logger.api_response("get_plan_memory_overview", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 暂停学习计划
#[tauri::command]
pub async fn pause_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("pause_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.pause_study_plan(plan_id).await {
        Ok(_) => {
            logger.api_response("pause_study_plan", true, Some("学习计划已暂停"));
            Ok(())
        }
        Err(e) => {
            logger.api_response("pause_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 继续学习计划（结束暂停）
#[tauri::command]
pub async fn resume_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("resume_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.resume_study_plan(plan_id).await {
        Ok(_) => {
            logger.api_response("resume_study_plan", true, Some("学习计划已继续"));
            Ok(())
        }
        Err(e) => {
            logger.api_response("resume_study_plan", false, Some(&e.to_string()));
            Err(e)
        }
    }
}
