//! 学习计划生成：校验请求 → 读取单词 → 按词汇本顺序确定性计算日程（DECISIONS D13）。
//! 从易到难：计划建好后作为后台任务排（jobs.rs，detached）——agent 给出顺序与难度 / 优先级，
//! 再重排还没练过的日程；阶段与模型输出段数经任务进度推送，取消时中止 agent、计划保持原顺序。

use crate::agent::{tasks, AgentPaths};
use crate::error::{AppError, AppResult};
use crate::jobs::JobCtx;
use crate::logger::Logger;
use crate::repositories::word_repository::WordRepository;
use crate::services::plan_pace::{PlanPaceResult, PlanPaceService};
use crate::services::study_planning::{
    build_schedule, normalize_order, PlanParams, PlanWord, WordAssessment, DAILY_NEW_WORDS_RANGE,
};
use crate::types::study::{StudyPlanAIResult, StudyPlanScheduleRequest};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Instant;

pub struct StudyPlanGenerator {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
    paths: AgentPaths,
}

/// 请求校验（规则与前端一致）
pub fn validate_request(request: &StudyPlanScheduleRequest) -> AppResult<()> {
    let invalid = |msg: &str| Err(AppError::ValidationError(msg.to_string()));
    if request.name.trim().is_empty() {
        return invalid("学习计划名称不能为空");
    }
    if !DAILY_NEW_WORDS_RANGE.contains(&request.daily_new_words) {
        return invalid("每天新词数需在 1–50 之间");
    }
    if request.wordbook_ids.is_empty() {
        return invalid("请至少选择一个词汇本");
    }
    // 日期格式先校验，避免 AI 跑完才报错
    if crate::time::parse_date(&request.start_date).is_none() {
        return invalid("开始日期格式应为 YYYY-MM-DD");
    }
    Ok(())
}

/// 读取所选词汇本的单词（去重由排程负责）；没有单词时报校验错误
async fn load_plan_words(
    pool: &Arc<SqlitePool>,
    logger: &Arc<Logger>,
    wordbook_ids: &[i64],
) -> AppResult<Vec<PlanWord>> {
    let words: Vec<PlanWord> = WordRepository::new(pool.clone(), logger.clone())
        .find_words_by_wordbook_ids(wordbook_ids)
        .await?
        .into_iter()
        .map(|(word_id, word, wordbook_id, meaning)| PlanWord {
            word_id,
            word,
            wordbook_id,
            meaning,
        })
        .collect();
    if words.is_empty() {
        return Err(AppError::ValidationError(
            "所选词汇本中没有单词".to_string(),
        ));
    }
    Ok(words)
}

/// 不用 AI 的日程：词汇本原顺序、按词长估难度（与 AI 漏排时的补齐规则相同），立即完成
pub async fn generate_without_ai(
    pool: &Arc<SqlitePool>,
    logger: &Arc<Logger>,
    request: &StudyPlanScheduleRequest,
) -> AppResult<StudyPlanAIResult> {
    validate_request(request)?;
    let words = load_plan_words(pool, logger, &request.wordbook_ids).await?;
    build_schedule(
        &PlanParams {
            daily_new_words: request.daily_new_words,
            start_date: request.start_date.clone(),
        },
        &normalize_order(&words, &[]),
    )
}

/// 创建前的即时预览（确定性，不用 AI）：从今天起按默认顺序排出的日程，用于展示词数、天数与前几天的单词
pub async fn preview(
    pool: &Arc<SqlitePool>,
    logger: &Arc<Logger>,
    wordbook_ids: &[i64],
    daily_new_words: i32,
) -> AppResult<StudyPlanAIResult> {
    if wordbook_ids.is_empty() {
        return Err(AppError::ValidationError(
            "请至少选择一个词汇本".to_string(),
        ));
    }
    if !DAILY_NEW_WORDS_RANGE.contains(&daily_new_words) {
        return Err(AppError::ValidationError(
            "每天新词数需在 1–50 之间".to_string(),
        ));
    }
    let words = load_plan_words(pool, logger, wordbook_ids).await?;
    build_schedule(
        &PlanParams {
            daily_new_words,
            start_date: crate::time::format_date(crate::time::local_today()),
        },
        &normalize_order(&words, &[]),
    )
}

impl StudyPlanGenerator {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>, paths: AgentPaths) -> Self {
        Self {
            pool,
            logger,
            paths,
        }
    }

    /// 给已建好的计划排学习顺序（从易到难）：agent 评估还没学的新词 → 按顺序重排还没练过的日程。
    /// 计划先按词汇本顺序建好、可以马上用；排不好时保持原顺序（plan-ux B5）
    pub async fn order_plan(&self, plan_id: i64, ctx: &JobCtx) -> AppResult<PlanPaceResult> {
        let started = Instant::now();
        let pace = PlanPaceService::new(self.pool.clone(), self.logger.clone());
        let words = pace.open_words(plan_id).await?;
        if words.is_empty() {
            return Err(AppError::ValidationError(
                "计划里没有还没学的新词".to_string(),
            ));
        }
        let model = crate::services::agent_settings::AgentSettingsService::new(
            self.pool.clone(),
            self.logger.clone(),
        )
        .model_for(crate::services::agent_settings::AgentTaskKind::Plan, None)
        .await?;
        ctx.stage(format!("正在评估 {} 个单词的难易", words.len()));
        let profile =
            crate::services::prompt_profile::PromptProfileService::load(&self.pool).await?;
        // 输出长度不可预知：进度只报收到的输出段数（total = 0）
        let assessed = tasks::plan_word_order(
            &self.paths,
            &model,
            &profile,
            &words,
            &self.logger,
            || ctx.is_cancelled(),
            |events| ctx.progress(u64::from(events), 0),
        )
        .await
        .map_err(|e| {
            self.logger.warn(
                "STUDY_PLAN",
                &format!("计划 {plan_id} 排学习顺序没有完成，保持词汇本顺序"),
                Some(&e.to_string()),
            );
            AppError::ExternalServiceError(
                "没能排好学习顺序，计划先按词汇本里的顺序安排".to_string(),
            )
        })?;
        // 停止了：计划保持原顺序（任务状态由 jobs 记为已停止）
        if ctx.is_cancelled() {
            return Err(AppError::ValidationError("已停止".to_string()));
        }
        ctx.stage("正在重新安排日程");
        let ordered: Vec<WordAssessment> = normalize_order(&words, &assessed)
            .into_iter()
            .map(|(_, a)| a)
            .collect();
        let result = pace
            .reorder_open(plan_id, &ordered, crate::time::local_today())
            .await?;
        self.logger.info(
            "STUDY_PLAN",
            &format!(
                "计划 {plan_id} 已按从易到难重排 {} 个新词（模型漏排 {} 个按原顺序补齐），用时 {:.1}s",
                words.len(),
                words.len().saturating_sub(assessed.len()),
                started.elapsed().as_secs_f64()
            ),
        );
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> StudyPlanScheduleRequest {
        StudyPlanScheduleRequest {
            name: "动物".to_string(),
            description: String::new(),
            daily_new_words: 10,
            intensity_level: String::new(),
            study_period_days: 0,
            review_frequency: 0,
            start_date: "2026-10-07".to_string(),
            wordbook_ids: vec![1],
            model_id: None,
            use_ai: None,
        }
    }

    #[test]
    fn request_validation_matches_frontend_rules() {
        assert!(validate_request(&request()).is_ok());
        for bad in [
            StudyPlanScheduleRequest {
                name: " ".into(),
                ..request()
            },
            StudyPlanScheduleRequest {
                daily_new_words: 0,
                ..request()
            },
            StudyPlanScheduleRequest {
                daily_new_words: 51,
                ..request()
            },
            StudyPlanScheduleRequest {
                wordbook_ids: vec![],
                ..request()
            },
        ] {
            assert!(matches!(
                validate_request(&bad),
                Err(AppError::ValidationError(_))
            ));
        }
    }

    #[tokio::test]
    async fn preview_and_non_ai_generation_are_deterministic_and_validated() {
        let pool = crate::test_support::memory_pool().await;
        let logger = crate::test_support::test_logger();
        let fx = crate::test_support::seed_schedule(&pool, 12).await;
        let book: i64 = sqlx::query_scalar("SELECT word_book_id FROM words WHERE id = ?")
            .bind(fx.word_ids[0])
            .fetch_one(pool.as_ref())
            .await
            .unwrap();

        // 12 词、每天 5 个：3 天学完新词 + 11 天巩固
        let previewed = preview(&pool, &logger, &[book], 5).await.unwrap();
        assert_eq!(previewed.plan_metadata.total_words, 12);
        assert_eq!(previewed.daily_plans.len(), 3);
        assert_eq!(previewed.plan_metadata.study_period_days, 14);
        assert!(preview(&pool, &logger, &[], 5).await.is_err());
        assert!(preview(&pool, &logger, &[book], 0).await.is_err());

        let request = StudyPlanScheduleRequest {
            wordbook_ids: vec![book],
            daily_new_words: 5,
            use_ai: Some(false),
            ..request()
        };
        let generated = generate_without_ai(&pool, &logger, &request).await.unwrap();
        assert_eq!(generated.daily_plans.len(), 3);
        assert_eq!(generated.plan_metadata.start_date, "2026-10-07");
        let bad_date = StudyPlanScheduleRequest {
            start_date: "10/07".into(),
            ..request
        };
        assert!(matches!(
            generate_without_ai(&pool, &logger, &bad_date).await,
            Err(AppError::ValidationError(_))
        ));
    }
}
