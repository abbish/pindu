//! 学习计划生成：校验请求 → 读取单词 → agent 给出学习顺序与难度 / 优先级 → 确定性计算日程（DECISIONS D13）。
//! AI 排序作为前台任务运行（jobs.rs，结果只给新建计划页用）：阶段与模型输出段数经任务进度推送，取消时中止 agent。

use crate::agent::{tasks, AgentPaths};
use crate::error::{AppError, AppResult};
use crate::jobs::JobCtx;
use crate::logger::Logger;
use crate::repositories::word_repository::WordRepository;
use crate::services::study_planning::{
    build_schedule, normalize_order, PlanParams, PlanWord, DAILY_NEW_WORDS_RANGE,
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
        return invalid("请至少选择一个单词本");
    }
    // 日期格式先校验，避免 AI 跑完才报错
    if crate::time::parse_date(&request.start_date).is_none() {
        return invalid("开始日期格式应为 YYYY-MM-DD");
    }
    Ok(())
}

/// 读取所选单词本的单词（去重由排程负责）；没有单词时报校验错误
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
            "所选单词本中没有单词".to_string(),
        ));
    }
    Ok(words)
}

/// 不用 AI 的日程：单词本原顺序、按词长估难度（与 AI 漏排时的补齐规则相同），立即完成
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
            "请至少选择一个单词本".to_string(),
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

    pub async fn generate(
        &self,
        request: &StudyPlanScheduleRequest,
        ctx: &JobCtx,
    ) -> AppResult<StudyPlanAIResult> {
        validate_request(request)?;
        let started = Instant::now();
        ctx.stage("读取单词本…");
        let words = load_plan_words(&self.pool, &self.logger, &request.wordbook_ids).await?;

        let model = crate::services::agent_settings::AgentSettingsService::new(
            self.pool.clone(),
            self.logger.clone(),
        )
        .model_for(
            crate::services::agent_settings::AgentTaskKind::Plan,
            request.model_id,
        )
        .await?;
        ctx.stage(format!(
            "AI 正在评估 {} 个单词的难度并安排学习顺序…",
            words.len()
        ));
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
        .await?;

        ctx.stage("按每天新词数生成每日日程…");
        let ordered = normalize_order(&words, &assessed);
        let filled = ordered.len().saturating_sub(assessed.len());
        let schedule = build_schedule(
            &PlanParams {
                daily_new_words: request.daily_new_words,
                start_date: request.start_date.clone(),
            },
            &ordered,
        )?;
        self.logger.info(
            "STUDY_PLAN",
            &format!(
                "日程已生成：{} 词（模型漏排 {} 个已按原顺序补齐），{} 个学习日，用时 {:.1}s",
                words.len(),
                filled,
                schedule.daily_plans.len(),
                started.elapsed().as_secs_f64()
            ),
        );
        Ok(schedule)
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
