//! 学习计划里的短文：计划的短文任务、修改练习内容与短文、今日短文任务、可选短文、只朗读任务的完成

use super::finish;
use crate::error::AppResult;
use crate::logger::Logger;
use crate::services::plan_passages::PlanPassageService;
use crate::types::passage::{
    PlanPassage, PlanPassageCandidate, PlanPassageCandidatesRequest, SetPlanPassagesRequest,
    TodayPassageTask,
};
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

fn service(app: &AppHandle) -> PlanPassageService {
    PlanPassageService::new(
        Arc::new(app.state::<SqlitePool>().inner().clone()),
        Arc::new(app.state::<Logger>().inner().clone()),
    )
}

/// 计划里的短文任务（按顺序，含状态与完成作答）
#[tauri::command]
pub async fn get_plan_passages(app: AppHandle, plan_id: i64) -> AppResult<Vec<PlanPassage>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_plan_passages", Some(&format!("plan_id: {}", plan_id)));
    let result = service(&app).get_plan_passages(plan_id).await;
    finish(&logger, "get_plan_passages", result)
}

/// 修改计划的练习内容、短文（完整顺序）与间隔天数
#[tauri::command]
pub async fn set_plan_passages(app: AppHandle, request: SetPlanPassagesRequest) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("set_plan_passages", Some(&format!("{:?}", request)));
    let result = service(&app).set_plan_passages(&request).await;
    finish(&logger, "set_plan_passages", result)
}

/// 今天的短文任务（到期没完成的 + 今天完成的）
#[tauri::command]
pub async fn get_today_passage_tasks(app: AppHandle) -> AppResult<Vec<TodayPassageTask>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_today_passage_tasks", None);
    let result = service(&app).today_tasks().await;
    finish(&logger, "get_today_passage_tasks", result)
}

/// 可加进计划的短文（按与计划单词 / 所选词汇本的相关度排序，含题组）
#[tauri::command]
pub async fn get_plan_passage_candidates(
    app: AppHandle,
    request: PlanPassageCandidatesRequest,
) -> AppResult<Vec<PlanPassageCandidate>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_plan_passage_candidates",
        Some(&format!("{:?}", request)),
    );
    let result = service(&app).candidates(&request).await;
    finish(&logger, "get_plan_passage_candidates", result)
}

/// 只朗读的短文任务（没有题组）：读完了
#[tauri::command]
pub async fn complete_plan_passage_reading(
    app: AppHandle,
    plan_id: i64,
    passage_id: i64,
) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "complete_plan_passage_reading",
        Some(&format!("plan_id: {}, passage_id: {}", plan_id, passage_id)),
    );
    let result = service(&app).complete_reading(plan_id, passage_id).await;
    finish(&logger, "complete_plan_passage_reading", result)
}
