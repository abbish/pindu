//! 短文练习命令：生成短文、列表 / 详情 / 删除、开始与提交作答、开放题重新评分、统计

use super::{agent_paths, finish};
use crate::error::AppResult;
use crate::logger::Logger;
use crate::services::passage::PassageService;
use crate::types::passage::{
    GeneratePassageRequest, GenerateQuestionSetRequest, Passage, PassageAttempt, PassageStatistics,
    PassageSummary, PassageWordCandidate, PassageWordSources, QuestionSet,
    SubmitPassageAttemptRequest,
};
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

fn service(app: &AppHandle) -> PassageService {
    PassageService::new(
        Arc::new(app.state::<SqlitePool>().inner().clone()),
        Arc::new(app.state::<Logger>().inner().clone()),
    )
}

/// 候选词：按来源（单词本、学习计划的难词 / 已学 / 到期复习）合并，标出难词与建议勾选的词
#[tauri::command]
pub async fn get_passage_word_candidates(
    app: AppHandle,
    request: PassageWordSources,
) -> AppResult<Vec<PassageWordCandidate>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passage_word_candidates",
        Some(&format!("{:?}", request)),
    );
    let result = service(&app).candidates(&request).await;
    finish(&logger, "get_passage_word_candidates", result)
}

/// 所选计划里每种取词策略能取到的词数
#[tauri::command]
pub async fn get_plan_scope_counts(
    app: AppHandle,
    plan_ids: Vec<i64>,
) -> AppResult<Vec<crate::types::passage::PlanScopeCount>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_plan_scope_counts",
        Some(&format!("plan_ids: {:?}", plan_ids)),
    );
    let result = service(&app).plan_scope_counts(&plan_ids).await;
    finish(&logger, "get_plan_scope_counts", result)
}

/// 内容规划：AI 提议写几篇、每篇的构思与用词（约 20–40 秒；不保存）。`feedback` 为对上一版规划的调整意见
#[tauri::command]
pub async fn plan_passages(
    app: AppHandle,
    request: GeneratePassageRequest,
    feedback: Option<String>,
) -> AppResult<crate::types::passage::PassagePlan> {
    let logger = app.state::<Logger>();
    logger.api_request("plan_passages", Some(&format!("{:?}", request)));
    let result = async {
        let paths = agent_paths(&app)?;
        service(&app)
            .plan(&request, feedback.as_deref().unwrap_or(""), &paths)
            .await
    }
    .await;
    finish(&logger, "plan_passages", result)
}

/// 生成一篇短文（独立素材；AI 写短文，约 20–60 秒；阅读理解题另外生成）
#[tauri::command]
pub async fn generate_passage(
    app: AppHandle,
    request: GeneratePassageRequest,
) -> AppResult<Passage> {
    let logger = app.state::<Logger>();
    logger.api_request("generate_passage", Some(&format!("{:?}", request)));
    let result = async {
        let paths = agent_paths(&app)?;
        service(&app).generate(&request, &paths).await
    }
    .await;
    finish(&logger, "generate_passage", result)
}

/// 短文列表（可按来源单词本或计划筛选）
#[tauri::command]
pub async fn get_passages(
    app: AppHandle,
    book_id: Option<i64>,
    plan_id: Option<i64>,
    origin: Option<String>,
) -> AppResult<Vec<PassageSummary>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passages",
        Some(&format!(
            "book_id: {:?}, plan_id: {:?}, origin: {:?}",
            book_id, plan_id, origin
        )),
    );
    let result = service(&app)
        .list(book_id, plan_id, origin.as_deref())
        .await;
    finish(&logger, "get_passages", result)
}

#[tauri::command]
pub async fn get_passage(app: AppHandle, passage_id: i64) -> AppResult<Passage> {
    let logger = app.state::<Logger>();
    logger.api_request("get_passage", Some(&format!("passage_id: {}", passage_id)));
    let result = service(&app).get(passage_id).await;
    finish(&logger, "get_passage", result)
}

/// 目标词的完整资料（朗读时点词查看）
#[tauri::command]
pub async fn get_passage_words(
    app: AppHandle,
    passage_id: i64,
) -> AppResult<Vec<crate::types::wordbook::Word>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passage_words",
        Some(&format!("passage_id: {}", passage_id)),
    );
    let result = service(&app).target_word_details(passage_id).await;
    finish(&logger, "get_passage_words", result)
}

/// 删除短文（连同题组与作答记录）
#[tauri::command]
pub async fn delete_passage(app: AppHandle, passage_id: i64) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "delete_passage",
        Some(&format!("passage_id: {}", passage_id)),
    );
    let result = service(&app).delete(passage_id).await;
    finish(&logger, "delete_passage", result)
}

/// 为短文生成一套阅读理解题（AI，约 15–40 秒）
#[tauri::command]
pub async fn generate_question_set(
    app: AppHandle,
    request: GenerateQuestionSetRequest,
) -> AppResult<QuestionSet> {
    let logger = app.state::<Logger>();
    logger.api_request("generate_question_set", Some(&format!("{:?}", request)));
    let result = async {
        let paths = agent_paths(&app)?;
        service(&app).generate_question_set(&request, &paths).await
    }
    .await;
    finish(&logger, "generate_question_set", result)
}

/// 题组详情（题目、答案与选词填空词库）
#[tauri::command]
pub async fn get_question_set(app: AppHandle, set_id: i64) -> AppResult<QuestionSet> {
    let logger = app.state::<Logger>();
    logger.api_request("get_question_set", Some(&format!("set_id: {}", set_id)));
    let result = service(&app).get_set(set_id).await;
    finish(&logger, "get_question_set", result)
}

/// 删除题组（连同它的作答记录）
#[tauri::command]
pub async fn delete_question_set(app: AppHandle, set_id: i64) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("delete_question_set", Some(&format!("set_id: {}", set_id)));
    let result = service(&app).delete_set(set_id).await;
    finish(&logger, "delete_question_set", result)
}

/// 开始练习某套题（mode：reading / listening）；有未提交的同模式作答时接着用。
/// `plan_id`：从计划里的短文任务进入（完成后计入计划）
#[tauri::command]
pub async fn start_passage_attempt(
    app: AppHandle,
    set_id: i64,
    mode: String,
    plan_id: Option<i64>,
) -> AppResult<PassageAttempt> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_passage_attempt",
        Some(&format!(
            "set_id: {}, mode: {}, plan_id: {:?}",
            set_id, mode, plan_id
        )),
    );
    let result = service(&app).start_attempt(set_id, &mode, plan_id).await;
    finish(&logger, "start_passage_attempt", result)
}

/// 提交作答：客观题即时判分，开放题 AI 评分（失败时可用 regrade_passage_open 重试）
#[tauri::command]
pub async fn submit_passage_attempt(
    app: AppHandle,
    request: SubmitPassageAttemptRequest,
) -> AppResult<PassageAttempt> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "submit_passage_attempt",
        Some(&format!(
            "attempt_id: {}, answers: {}",
            request.attempt_id,
            request.answers.len()
        )),
    );
    let result = async {
        let paths = agent_paths(&app)?;
        service(&app).submit_attempt(&request, &paths).await
    }
    .await;
    finish(&logger, "submit_passage_attempt", result)
}

/// 开放题重新评分
#[tauri::command]
pub async fn regrade_passage_open(app: AppHandle, attempt_id: i64) -> AppResult<PassageAttempt> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "regrade_passage_open",
        Some(&format!("attempt_id: {}", attempt_id)),
    );
    let result = async {
        let paths = agent_paths(&app)?;
        service(&app).regrade(attempt_id, &paths).await
    }
    .await;
    finish(&logger, "regrade_passage_open", result)
}

/// 短文练习统计（不传 plan_id 为全部）
#[tauri::command]
pub async fn get_passage_statistics(
    app: AppHandle,
    plan_id: Option<i64>,
) -> AppResult<PassageStatistics> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passage_statistics",
        Some(&format!("plan_id: {:?}", plan_id)),
    );
    let result = service(&app).statistics(plan_id).await;
    finish(&logger, "get_passage_statistics", result)
}
