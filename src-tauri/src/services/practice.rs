//! 练习会话业务逻辑服务
//!
//! 封装练习会话相关的业务逻辑,使用 Repository 模式
//!
//! # 架构
//! - PracticeService 使用 PracticeRepository 和 StudyScheduleRepository
//! - 所有数据访问通过 Repository 层
//! - Service 层只包含业务逻辑

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::{
    practice_repository::PracticeRepository, study_plan_repository::StudyPlanRepository,
    study_schedule_repository::StudyScheduleRepository,
};
use crate::services::srs::{self, Outcome};
use crate::types::study::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use uuid::Uuid;

/// 练习会话服务
///
/// 负责练习会话的业务逻辑处理
pub struct PracticeService {
    /// 与各 repository 共享的连接池，仅用于开启事务
    pool: Arc<SqlitePool>,
    practice_repo: PracticeRepository,
    schedule_repo: StudyScheduleRepository,
    plan_repo: StudyPlanRepository,
}

impl PracticeService {
    /// 创建新的服务实例 (使用 Repository)
    pub fn new(
        practice_repo: PracticeRepository,
        schedule_repo: StudyScheduleRepository,
        plan_repo: StudyPlanRepository,
    ) -> Self {
        Self {
            pool: practice_repo.pool.clone(),
            practice_repo,
            schedule_repo,
            plan_repo,
        }
    }

    /// 从 pool 和 logger 创建 (向后兼容)
    pub fn from_pool_and_logger(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        let practice_repo = PracticeRepository::new(pool.clone(), logger.clone());
        let schedule_repo = StudyScheduleRepository::new(pool.clone(), logger.clone());
        let plan_repo = StudyPlanRepository::new(pool, logger);
        Self::new(practice_repo, schedule_repo, plan_repo)
    }

    /// 开始练习会话
    pub async fn start_practice_session(
        &self,
        plan_id: i64,
        schedule_id: i64,
    ) -> AppResult<PracticeSession> {
        // 1. 验证日程是否存在
        let schedule = self
            .schedule_repo
            .find_by_id(schedule_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("指定的学习日程不存在".to_string()))?;

        // 验证日程所属的计划
        if schedule.plan_id != plan_id {
            return Err(AppError::ValidationError(
                "日程不属于指定的学习计划".to_string(),
            ));
        }
        // 只有待开始 / 进行中的计划能练习（暂停、已结束的不能）
        if !self.practice_repo.plan_accepts_practice(plan_id).await? {
            return Err(AppError::ValidationError(
                "这个学习计划已暂停或已结束，不能练习".to_string(),
            ));
        }

        // 2. 检查是否已有未完成的练习会话
        if let Some(existing_session) = self
            .practice_repo
            .find_incomplete_session(plan_id, schedule_id)
            .await?
        {
            // 如果已有未完成的练习会话，返回该会话
            return self
                .get_practice_session_by_id(&existing_session.session_id)
                .await;
        }

        // 待开始的计划：第一次练习时自动开始（日程整体平移到从今天开始）
        self.auto_start_plan(plan_id).await?;

        // 今天到期的复习放进今天的日程（自适应复习）；过期且没练过的复习日程会被合并掉
        let mut tx = srs::begin_write(&self.pool).await?;
        srs::sync_today(&mut tx, plan_id, crate::time::local_today()).await?;
        tx.commit().await?;
        // 开始与同步可能改了日程日期或合并了日程：重新读取
        let Some(schedule) = self.schedule_repo.find_by_id(schedule_id).await? else {
            return Err(AppError::ValidationError(
                "这一天的复习已合并到今天的任务里，请从今天的任务开始练习".to_string(),
            ));
        };

        // 3. 获取日程单词
        let schedule_words = self.schedule_repo.find_schedule_words(schedule_id).await?;

        if schedule_words.is_empty() {
            return Err(AppError::ValidationError(
                "该日程没有安排单词练习".to_string(),
            ));
        }

        // 4. 创建练习会话
        let session_id = Uuid::new_v4().to_string();
        let now = crate::time::now_utc();

        self.practice_repo
            .create_session(
                &session_id,
                plan_id,
                schedule_id,
                &schedule.schedule_date,
                &now,
            )
            .await?;

        // 5. 转换并创建单词状态
        let word_states = self.convert_schedule_words_to_states(schedule_words, &now)?;

        self.practice_repo
            .create_word_states_batch(&session_id, &word_states)
            .await?;

        // 6. 获取计划名称
        let plan_title = self
            .plan_repo
            .get_plan_name(plan_id)
            .await?
            .unwrap_or_else(|| format!("计划 {}", plan_id));

        // 7. 构建返回对象
        let session = PracticeSession {
            session_id: session_id.clone(),
            plan_id,
            plan_title: Some(plan_title),
            schedule_id,
            schedule_date: schedule.schedule_date,
            start_time: now.clone(),
            end_time: None,
            total_time: 0,
            active_time: 0,
            pause_count: 0,
            word_states,
            completed: false,
            created_at: now.clone(),
            updated_at: now,
        };

        Ok(session)
    }

    /// 将 ScheduleWordInfo 转换为 WordPracticeState
    fn convert_schedule_words_to_states(
        &self,
        schedule_words: Vec<crate::repositories::study_schedule_repository::ScheduleWordInfo>,
        now: &str,
    ) -> AppResult<Vec<WordPracticeState>> {
        schedule_words
            .into_iter()
            .map(|word_info| {
                Ok(WordPracticeState {
                    word_id: word_info.word_id,
                    plan_word_id: word_info.plan_word_id,
                    is_review: word_info.is_review,
                    word_info: PracticeWordInfo {
                        word_id: word_info.word_id,
                        word: word_info.word,
                        meaning: word_info.meaning,
                        description: word_info.description,
                        ipa: word_info.ipa,
                        syllables: word_info.syllables,
                        phonics_segments: word_info.phonics_segments,
                        examples: word_info.examples,
                    },
                    current_step: WordPracticeStep::Step1,
                    step_results: vec![false; 3],
                    step_attempts: vec![0; 3],
                    step_time_spent: vec![0; 3],
                    completed: false,
                    passed: false,
                    retry_counts: vec![0; 3],
                    fixed_steps: vec![false; 3],
                    review_correct: None,
                    start_time: now.to_string(),
                    end_time: None,
                })
            })
            .collect()
    }

    /// 提交步骤结果
    pub async fn submit_step_result(&self, record: PracticeStepRecord) -> AppResult<()> {
        let (session_id, step) = (record.session_id.as_str(), record.step);
        // 1. 验证步骤范围
        if !(1..=3).contains(&step) {
            return Err(AppError::ValidationError("步骤必须在1-3之间".to_string()));
        }
        if !crate::types::study::RECORD_KINDS.contains(&record.kind.as_str()) {
            return Err(AppError::ValidationError(format!(
                "作答类型需为 learn / retry / review：{}",
                record.kind
            )));
        }

        // 2. 验证会话是否存在且未完成
        let session = self
            .practice_repo
            .find_session_by_id(session_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("练习会话不存在或已完成".to_string()))?;

        if session.completed {
            return Err(AppError::ValidationError("练习会话已完成".to_string()));
        }
        if !self
            .practice_repo
            .word_belongs_to_session(session_id, record.word_id, record.plan_word_id)
            .await?
        {
            return Err(AppError::ValidationError(
                "作答的单词不属于本次练习的日程".to_string(),
            ));
        }

        // 3. 创建练习记录
        self.practice_repo.create_practice_record(&record).await?;

        Ok(())
    }

    /// 暂停练习会话：记录暂停开始并累加暂停次数（同一事务）
    pub async fn pause_practice_session(&self, session_id: &str) -> AppResult<()> {
        self.require_active_session(session_id).await?;
        // 已在暂停中（重复点击）：不再新增暂停记录
        if self.practice_repo.has_open_pause(session_id).await? {
            return Ok(());
        }

        let now = crate::time::now_utc();
        let mut tx = self.pool.begin().await?;
        self.practice_repo
            .create_pause_record(&mut tx, session_id, &now)
            .await?;
        self.practice_repo
            .increment_pause_count(&mut tx, session_id, &now)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    /// 保存练习进度时长（暂停、退出、作答时由前端上报；恢复练习时从这里继续累计）
    pub async fn save_practice_progress(
        &self,
        session_id: &str,
        total_time: i64,
        active_time: i64,
    ) -> AppResult<()> {
        if total_time < 0 || active_time < 0 || active_time > total_time {
            return Err(AppError::ValidationError("练习时长不合法".to_string()));
        }
        self.require_active_session(session_id).await?;
        self.practice_repo
            .save_session_progress(session_id, total_time, active_time)
            .await
    }

    /// 恢复练习会话：结束最近一次未结束的暂停
    pub async fn resume_practice_session(&self, session_id: &str) -> AppResult<()> {
        self.require_active_session(session_id).await?;

        let now = crate::time::now_utc();
        let mut conn = self.pool.acquire().await?;
        self.practice_repo
            .close_latest_pause(&mut conn, session_id, &now)
            .await?;
        Ok(())
    }

    /// 完成练习会话
    ///
    /// 事务内依次：标记会话完成 → 写入 `study_sessions`（日历学习记录）→ 重算日程完成数。
    /// 已完成的会话再次调用时直接返回已记录的结果，不重复写入（幂等，与 2026-01 重构前一致）。
    pub async fn complete_practice_session(
        &self,
        session_id: &str,
        total_time: i64,
        active_time: i64,
    ) -> AppResult<PracticeResult> {
        // 读取放在事务之外，事务只包含写入
        let session = self
            .practice_repo
            .find_session_by_id(session_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("练习会话不存在".to_string()))?;
        let word_states = self
            .practice_repo
            .find_word_states_by_session(session_id)
            .await?;

        if session.completed {
            let completed_at = session
                .end_time
                .clone()
                .unwrap_or_else(|| session.updated_at.clone());
            let (total, active) = (session.total_time, session.active_time);
            return Ok(Self::calculate_practice_result(
                &session,
                completed_at,
                total,
                active,
                word_states,
            ));
        }

        let now = crate::time::now_utc();
        // 恢复过的会话：前端从已落库进度继续累计，这里再与已落库进度取较大值兜底
        let total_time = total_time.max(session.total_time);
        let active_time = active_time.max(session.active_time).min(total_time);
        // 自适应复习：新词学过 → 进入 1 级；复习词按第三步首答结果升级或回到 1 级
        let outcomes: Vec<(i64, Outcome)> = word_states
            .iter()
            .filter_map(|w| {
                if w.is_review {
                    (w.step_attempts.get(2).copied().unwrap_or(0) > 0).then(|| {
                        (
                            w.word_id,
                            Outcome::Reviewed {
                                correct: w.step_results.get(2).copied().unwrap_or(false),
                            },
                        )
                    })
                } else {
                    w.step_attempts
                        .iter()
                        .any(|a| *a > 0)
                        .then_some((w.word_id, Outcome::Learned))
                }
            })
            .collect();
        let result = Self::calculate_practice_result(
            &session,
            now.clone(),
            total_time,
            active_time,
            word_states,
        );

        let mut tx = self.pool.begin().await?;
        let marked = self
            .practice_repo
            .mark_session_completed(&mut tx, session_id, &now, total_time, active_time)
            .await?;
        if !marked {
            // 并发的另一次完成请求已经写入：放弃本次写入，返回已记录的结果
            tx.rollback().await?;
            let session = self
                .practice_repo
                .find_session_by_id(session_id)
                .await?
                .ok_or_else(|| AppError::ValidationError("练习会话不存在".to_string()))?;
            let word_states = self
                .practice_repo
                .find_word_states_by_session(session_id)
                .await?;
            let completed_at = session
                .end_time
                .clone()
                .unwrap_or_else(|| session.updated_at.clone());
            let (total, active) = (session.total_time, session.active_time);
            return Ok(Self::calculate_practice_result(
                &session,
                completed_at,
                total,
                active,
                word_states,
            ));
        }
        self.practice_repo
            .close_open_pauses(&mut tx, session_id, &now)
            .await?;
        self.practice_repo
            .insert_study_session(
                &mut tx,
                &NewStudySession {
                    plan_id: session.plan_id,
                    started_at: &session.start_time,
                    finished_at: &now,
                    words_studied: result.total_words,
                    correct_answers: result.passed_words,
                    total_time_seconds: active_time / 1000,
                },
            )
            .await?;
        self.schedule_repo
            .refresh_completion(&mut tx, session.schedule_id)
            .await?;
        // 练过的词汇本刷新“最近使用”
        crate::repositories::wordbook_repository::WordBookRepository::touch_last_used_by_schedule_conn(
            &mut tx,
            session.schedule_id,
        )
        .await?;
        srs::apply_session_results(
            &mut tx,
            session.plan_id,
            &outcomes,
            crate::time::local_today(),
        )
        .await?;
        // 全部新词日都练过、所有词都已掌握（记忆等级 ≥ 4），且计划里的短文都完成了：计划自动完成
        crate::services::plan_passages::try_auto_complete_conn(
            &self.plan_repo,
            &mut tx,
            session.plan_id,
        )
        .await?;
        tx.commit().await?;

        Ok(result)
    }

    /// 待开始的计划在第一次练习时自动转为进行中（写状态历史）
    async fn auto_start_plan(&self, plan_id: i64) -> AppResult<()> {
        let mut tx = crate::services::srs::begin_write(&self.pool).await?;
        crate::services::plan_passages::auto_start_conn(
            &self.plan_repo,
            &mut tx,
            plan_id,
            crate::time::local_today(),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// 获取练习会话详情
    pub async fn get_practice_session_by_id(&self, session_id: &str) -> AppResult<PracticeSession> {
        let (mut session, plan_title) = self
            .practice_repo
            .find_session_with_plan_name(session_id)
            .await?
            .ok_or_else(|| AppError::NotFound("练习会话不存在，可能已被删除".to_string()))?;

        // 设置计划名称
        session.plan_title = plan_title;

        Ok(session)
    }

    /// 获取未完成的练习会话
    pub async fn get_incomplete_practice_sessions(&self) -> AppResult<Vec<PracticeSession>> {
        // 使用 Repository 获取所有未完成的练习会话
        let mut sessions = self.practice_repo.find_all_incomplete_sessions().await?;
        // 前端「继续练习」提示显示单词进度；未完成会话通常只有个位数，逐个补齐即可
        for session in &mut sessions {
            session.word_states = self
                .practice_repo
                .find_word_states_by_session(&session.session_id)
                .await?;
        }

        Ok(sessions)
    }

    /// 获取练习会话详情
    pub async fn get_practice_session_detail(
        &self,
        session_id: &str,
    ) -> AppResult<PracticeSession> {
        self.get_practice_session_by_id(session_id).await
    }

    /// 取消练习会话
    pub async fn cancel_practice_session(&self, session_id: &str) -> AppResult<()> {
        // 验证会话是否存在且未完成
        let session = self
            .practice_repo
            .find_session_by_id(session_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("练习会话不存在或已完成".to_string()))?;

        if session.completed {
            return Err(AppError::ValidationError("练习会话已完成".to_string()));
        }

        // 使用 Repository 删除会话
        self.practice_repo.delete_session(session_id).await?;

        Ok(())
    }

    /// 获取学习计划的所有练习会话
    pub async fn get_plan_practice_sessions(
        &self,
        plan_id: i64,
    ) -> AppResult<Vec<PracticeSession>> {
        // 使用 Repository 获取计划的所有练习会话
        let sessions = self.practice_repo.find_sessions_by_plan(plan_id).await?;

        Ok(sessions)
    }

    // ==================== 辅助方法 ====================

    /// 会话存在且未完成，否则返回校验错误
    async fn require_active_session(&self, session_id: &str) -> AppResult<PracticeSession> {
        let session = self
            .practice_repo
            .find_session_by_id(session_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("练习会话不存在或已完成".to_string()))?;
        if session.completed {
            return Err(AppError::ValidationError("练习会话已完成".to_string()));
        }
        Ok(session)
    }

    /// 由单词练习状态计算练习结果（纯函数）
    fn calculate_practice_result(
        session: &PracticeSession,
        completed_at: String,
        total_time: i64,
        active_time: i64,
        word_states: Vec<WordPracticeState>,
    ) -> PracticeResult {
        let total_words = word_states.len();
        // 完全掌握：三步首次作答都对，且当轮小测没有写错（没做小测的旧会话只看三步）
        let mastered = |w: &WordPracticeState| w.passed && w.review_correct != Some(false);
        let passed_words = word_states.iter().filter(|w| mastered(w)).count();
        let total_steps = total_words * 3;
        let correct_steps = word_states
            .iter()
            .map(|w| w.step_results.iter().filter(|&&r| r).count())
            .sum::<usize>();

        let step_accuracy = if total_steps > 0 {
            (correct_steps as f64 / total_steps as f64) * 100.0
        } else {
            0.0
        };
        let word_accuracy = if total_words > 0 {
            (passed_words as f64 / total_words as f64) * 100.0
        } else {
            0.0
        };
        // 平均每词用时按有效时长（不含暂停）
        let average_time_per_word = if total_words > 0 {
            active_time / total_words as i64
        } else {
            0
        };

        let (passed_words_list, difficult_words): (Vec<_>, Vec<_>) =
            word_states.into_iter().partition(|w| mastered(w));

        PracticeResult {
            session_id: session.session_id.clone(),
            plan_id: session.plan_id,
            schedule_id: session.schedule_id,
            schedule_date: session.schedule_date.clone(),
            total_words: total_words as i32,
            passed_words: passed_words as i32,
            total_steps: total_steps as i32,
            correct_steps: correct_steps as i32,
            step_accuracy,
            word_accuracy,
            total_time,
            active_time,
            pause_count: session.pause_count,
            average_time_per_word,
            difficult_words,
            passed_words_list,
            completed_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 掌握的词数（记忆等级 ≥ 4）
    async fn mastered(pool: &SqlitePool, plan_id: i64) -> i64 {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM study_plan_words WHERE plan_id = ? AND srs_box >= 4",
        )
        .bind(plan_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }
    use crate::test_support::{
        memory_pool, seed_passed_word, seed_schedule, seed_session, seed_step, test_logger,
    };
    use sqlx::Row;

    async fn setup() -> (PracticeService, Arc<SqlitePool>) {
        let pool = memory_pool().await;
        let service = PracticeService::from_pool_and_logger(pool.clone(), test_logger());
        (service, pool)
    }

    async fn schedule_progress(pool: &SqlitePool, schedule_id: i64) -> (i32, String) {
        let row = sqlx::query(
            "SELECT completed_words_count, status FROM study_plan_schedules WHERE id = ?",
        )
        .bind(schedule_id)
        .fetch_one(pool)
        .await
        .unwrap();
        (row.get("completed_words_count"), row.get("status"))
    }

    async fn study_session_count(pool: &SqlitePool, plan_id: i64) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM study_sessions WHERE plan_id = ?")
            .bind(plan_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn completing_session_records_study_session_and_schedule_progress() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 2).await;
        seed_session(&pool, &fx, "s1", false).await;
        // 单词 1：三步首答全对 → 通过
        seed_passed_word(
            &pool,
            "s1",
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            "2026-10-06",
        )
        .await;
        // 单词 2：第 2 步首答错误、重试正确 → 不通过
        let (w2, pw2) = (fx.word_ids[1], fx.schedule_word_ids[1]);
        seed_step(&pool, "s1", w2, pw2, 1, true, "2026-10-06T10:10:00+00:00").await;
        seed_step(&pool, "s1", w2, pw2, 2, false, "2026-10-06T10:11:00+00:00").await;
        seed_step(&pool, "s1", w2, pw2, 2, true, "2026-10-06T10:12:00+00:00").await;
        seed_step(&pool, "s1", w2, pw2, 3, true, "2026-10-06T10:13:00+00:00").await;

        let result = service
            .complete_practice_session("s1", 120_000, 90_000)
            .await
            .unwrap();

        assert_eq!((result.total_words, result.passed_words), (2, 1));
        let session = sqlx::query("SELECT completed, total_time, active_time, end_time FROM practice_sessions WHERE id = 's1'")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert!(session.get::<bool, _>("completed"));
        assert_eq!(session.get::<i64, _>("active_time"), 90_000);
        assert!(session.get::<Option<String>, _>("end_time").is_some());

        let study = sqlx::query("SELECT words_studied, correct_answers, total_time_seconds FROM study_sessions WHERE plan_id = ?")
            .bind(fx.plan_id)
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(study.get::<i64, _>("words_studied"), 2);
        assert_eq!(study.get::<i64, _>("correct_answers"), 1);
        assert_eq!(study.get::<i64, _>("total_time_seconds"), 90);

        assert_eq!(
            schedule_progress(&pool, fx.schedule_id).await,
            (1, "completed".to_string()) // 练完即完成；掌握数只算三步首答全对的词
        );
        crate::time::assert_instants_canonical(&pool).await;
    }

    #[tokio::test]
    async fn completing_twice_is_idempotent() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 1).await;
        seed_session(&pool, &fx, "s1", false).await;
        seed_passed_word(
            &pool,
            "s1",
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            "2026-10-06",
        )
        .await;

        let first = service
            .complete_practice_session("s1", 60_000, 50_000)
            .await
            .unwrap();
        let second = service
            .complete_practice_session("s1", 999, 999)
            .await
            .unwrap();

        assert_eq!(second.passed_words, first.passed_words);
        assert_eq!(
            second.active_time, 50_000,
            "重复调用返回已记录的时间，不被新参数覆盖"
        );
        assert_eq!(study_session_count(&pool, fx.plan_id).await, 1);
    }

    #[tokio::test]
    async fn schedule_completion_counts_distinct_words_across_completed_sessions() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 2).await;

        seed_session(&pool, &fx, "s1", false).await;
        seed_passed_word(
            &pool,
            "s1",
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            "2026-10-06",
        )
        .await;
        service
            .complete_practice_session("s1", 1_000, 1_000)
            .await
            .unwrap();
        assert_eq!(
            schedule_progress(&pool, fx.schedule_id).await,
            (1, "completed".to_string()) // 练完即完成；掌握数只算三步首答全对的词
        );

        // 第二次练习：单词 1 再次通过（去重），单词 2 通过
        seed_session(&pool, &fx, "s2", false).await;
        seed_passed_word(
            &pool,
            "s2",
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            "2026-10-07",
        )
        .await;
        seed_passed_word(
            &pool,
            "s2",
            fx.word_ids[1],
            fx.schedule_word_ids[1],
            "2026-10-07",
        )
        .await;
        service
            .complete_practice_session("s2", 1_000, 1_000)
            .await
            .unwrap();
        assert_eq!(
            schedule_progress(&pool, fx.schedule_id).await,
            (2, "completed".to_string())
        );
    }

    #[tokio::test]
    async fn incomplete_sessions_carry_plan_title_and_word_states() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 2).await;
        seed_session(&pool, &fx, "open", false).await;
        seed_session(&pool, &fx, "done", true).await;

        let sessions = service.get_incomplete_practice_sessions().await.unwrap();

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "open");
        assert_eq!(sessions[0].plan_title.as_deref(), Some("测试计划"));
        assert_eq!(sessions[0].word_states.len(), 2);
    }

    #[tokio::test]
    async fn retries_and_review_are_reported_without_changing_first_attempt_results() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 1).await;
        seed_session(&pool, &fx, "open", false).await;
        let record = |step: i32, is_correct: bool, kind: &str| PracticeStepRecord {
            session_id: "open".to_string(),
            word_id: fx.word_ids[0],
            plan_word_id: fx.schedule_word_ids[0],
            step,
            user_input: "x".to_string(),
            is_correct,
            time_spent: 1000,
            attempts: 1,
            kind: kind.to_string(),
        };
        // 第一步首答错 → 重考对；第二、三步首答对；小测错
        for r in [
            record(1, false, "learn"),
            record(1, true, "retry"),
            record(2, true, "learn"),
            record(3, true, "learn"),
            record(3, false, "review"),
        ] {
            service.submit_step_result(r).await.unwrap();
        }
        assert!(matches!(
            service.submit_step_result(record(1, true, "again")).await,
            Err(AppError::ValidationError(_))
        ));

        let sessions = service.get_incomplete_practice_sessions().await.unwrap();
        let state = &sessions[0].word_states[0];
        assert_eq!(
            state.step_results,
            vec![false, true, true],
            "成绩只看首次作答"
        );
        assert_eq!(state.retry_counts, vec![1, 0, 0]);
        assert_eq!(state.fixed_steps, vec![true, false, false]);
        assert_eq!(state.review_correct, Some(false));
        assert!(state.completed && !state.passed);
        crate::time::assert_instants_canonical(&pool).await;
    }

    #[tokio::test]
    async fn review_miss_moves_word_to_difficult_but_schedule_still_counts_it() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 1).await;
        seed_session(&pool, &fx, "s1", false).await;
        for (step, is_correct, kind) in [
            (1, true, "learn"),
            (2, true, "learn"),
            (3, true, "learn"),
            (3, false, "review"),
        ] {
            service
                .submit_step_result(PracticeStepRecord {
                    session_id: "s1".to_string(),
                    word_id: fx.word_ids[0],
                    plan_word_id: fx.schedule_word_ids[0],
                    step,
                    user_input: "x".to_string(),
                    is_correct,
                    time_spent: 1000,
                    attempts: 1,
                    kind: kind.to_string(),
                })
                .await
                .unwrap();
        }
        let result = service
            .complete_practice_session("s1", 1_000, 1_000)
            .await
            .unwrap();
        assert_eq!(result.passed_words, 0, "小测写错不算完全掌握");
        assert_eq!(result.difficult_words.len(), 1);
        // 日程完成数只看三步首次作答，小测不影响
        assert_eq!(schedule_progress(&pool, fx.schedule_id).await.0, 1);
    }

    fn rec(
        fx: &crate::test_support::ScheduleFixture,
        i: usize,
        session: &str,
        step: i32,
        ok: bool,
        kind: &str,
    ) -> PracticeStepRecord {
        PracticeStepRecord {
            session_id: session.to_string(),
            word_id: fx.word_ids[i],
            plan_word_id: fx.schedule_word_ids[i],
            step,
            user_input: "x".to_string(),
            is_correct: ok,
            time_spent: 1000,
            attempts: 1,
            kind: kind.to_string(),
        }
    }

    #[tokio::test]
    async fn statistics_use_first_learn_attempts_and_mastery() {
        use crate::repositories::statistics_repository::StatisticsRepository;
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 2).await;
        for w in &fx.word_ids {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
                .bind(fx.plan_id)
                .bind(w)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }
        seed_session(&pool, &fx, "s1", false).await;
        // 词 0：第一步首答错 → 重考对；第二、三步对；小测对 → 首答 2/3，当次未通过
        // 词 1：三步首答全对 → 当次通过（日程完成数），但还没有长期掌握
        for r in [
            rec(&fx, 0, "s1", 1, false, "learn"),
            rec(&fx, 0, "s1", 1, true, "retry"),
            rec(&fx, 0, "s1", 2, true, "learn"),
            rec(&fx, 0, "s1", 3, true, "learn"),
            rec(&fx, 0, "s1", 3, true, "review"),
            rec(&fx, 1, "s1", 1, true, "learn"),
            rec(&fx, 1, "s1", 2, true, "learn"),
            rec(&fx, 1, "s1", 3, true, "learn"),
        ] {
            service.submit_step_result(r).await.unwrap();
        }
        // 进度落库后恢复：完成时上报的时长比已落库的小，取较大值
        service
            .save_practice_progress("s1", 600_000, 300_000)
            .await
            .unwrap();
        let result = service
            .complete_practice_session("s1", 1_000, 1_000)
            .await
            .unwrap();
        assert_eq!(
            (result.active_time, result.average_time_per_word),
            (300_000, 150_000)
        );

        // 正确率只看首次 learn 作答（统一口径 practice_metrics::FIRST_LEARN_CTE）
        let accuracy: f64 = sqlx::query_scalar(&format!(
            "WITH {} SELECT AVG(is_correct) * 100.0 FROM first_learn WHERE plan_id = ?1",
            crate::repositories::practice_metrics::FIRST_LEARN_CTE
        ))
        .bind(fx.plan_id)
        .fetch_one(pool.as_ref())
        .await
        .unwrap();
        assert!(
            (accuracy - 500.0 / 6.0).abs() < 1e-6,
            "首答 5/6，不含重考与小测：{}",
            accuracy
        );
        // 刚学完：两个词都进入记忆等级 1，明天复习；“掌握”要等级 ≥ 4
        assert_eq!(mastered(&pool, fx.plan_id).await, 0);
        let boxes: Vec<(i32, Option<String>)> = sqlx::query_as(
            "SELECT srs_box, srs_due FROM study_plan_words WHERE plan_id = ? ORDER BY word_id",
        )
        .bind(fx.plan_id)
        .fetch_all(pool.as_ref())
        .await
        .unwrap();
        let tomorrow = (crate::time::local_today() + chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();
        assert!(boxes
            .iter()
            .all(|(b, due)| *b == 1 && due.as_deref() == Some(tomorrow.as_str())));
        let (_, schedule_status) = schedule_progress(&pool, fx.schedule_id).await;
        assert_eq!(schedule_status, "completed");

        // 一个词升到等级 4 → 掌握
        sqlx::query("UPDATE study_plan_words SET srs_box = 4 WHERE plan_id = ? AND word_id = ?")
            .bind(fx.plan_id)
            .bind(fx.word_ids[1])
            .execute(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(mastered(&pool, fx.plan_id).await, 1);
        let repo = StatisticsRepository::new(pool.clone(), test_logger());
        let global = repo.get_study_statistics().await.unwrap();
        // 总学习单词 = 已学（练过的两个词都进了等级 ≥ 1），不是掌握数
        assert_eq!(global.total_words_learned, 2);
        assert!((global.average_accuracy - 500.0 / 6.0).abs() < 1e-6);
        let plan = repo.get_study_plan_statistics(fx.plan_id).await.unwrap();
        assert_eq!((plan.completed_words, plan.learned_words), (1, 2));
        assert_eq!((plan.total_study_minutes, plan.completed_days), (5, 1));
    }

    #[tokio::test]
    async fn completion_and_pauses_are_guarded() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 1).await;
        seed_session(&pool, &fx, "s1", false).await;

        // 其他日程的单词不能写进本会话
        let other = seed_schedule(&pool, 1).await;
        let mut wrong = rec(&fx, 0, "s1", 1, true, "learn");
        wrong.word_id = other.word_ids[0];
        wrong.plan_word_id = other.schedule_word_ids[0];
        assert!(matches!(
            service.submit_step_result(wrong).await,
            Err(AppError::ValidationError(_))
        ));

        // 重复暂停只记一次；完成时收尾
        service.pause_practice_session("s1").await.unwrap();
        service.pause_practice_session("s1").await.unwrap();
        let open: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM practice_pause_records WHERE session_id = 's1' AND pause_end IS NULL")
            .fetch_one(pool.as_ref()).await.unwrap();
        assert_eq!(open, 1);

        // 两次完成只写一条学习记录
        service
            .complete_practice_session("s1", 1_000, 1_000)
            .await
            .unwrap();
        service
            .complete_practice_session("s1", 1_000, 1_000)
            .await
            .unwrap();
        let studies: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM study_sessions WHERE plan_id = ?")
                .bind(fx.plan_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(studies, 1);
        let open: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM practice_pause_records WHERE session_id = 's1' AND pause_end IS NULL")
            .fetch_one(pool.as_ref()).await.unwrap();
        assert_eq!(open, 0);
    }

    #[tokio::test]
    async fn deleted_plans_cannot_be_practiced() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 1).await;
        seed_session(&pool, &fx, "open", false).await;
        assert_eq!(
            service
                .get_incomplete_practice_sessions()
                .await
                .unwrap()
                .len(),
            1
        );
        sqlx::query("UPDATE study_plans SET deleted_at = '2026-10-07', unified_status = 'Deleted' WHERE id = ?")
            .bind(fx.plan_id).execute(pool.as_ref()).await.unwrap();
        assert!(service
            .get_incomplete_practice_sessions()
            .await
            .unwrap()
            .is_empty());
        assert!(matches!(
            service
                .start_practice_session(fx.plan_id, fx.schedule_id)
                .await,
            Err(AppError::ValidationError(_))
        ));
    }

    #[tokio::test]
    async fn session_word_states_carry_examples_in_order() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 2).await;
        sqlx::query(
            "INSERT INTO word_examples (word_id, sentence, translation, sort_order)
             VALUES (?1, 'Second.', '二', 1), (?1, 'First.', '一', 0)",
        )
        .bind(fx.word_ids[0])
        .execute(pool.as_ref())
        .await
        .unwrap();
        seed_session(&pool, &fx, "open", false).await;

        // 恢复会话走 find_word_states_by_session
        let sessions = service.get_incomplete_practice_sessions().await.unwrap();
        let states = &sessions[0].word_states;
        let first = states.iter().find(|s| s.word_id == fx.word_ids[0]).unwrap();
        let sentences: Vec<&str> = first
            .word_info
            .examples
            .iter()
            .map(|e| e.sentence.as_str())
            .collect();
        assert_eq!(sentences, vec!["First.", "Second."]);
        let other = states.iter().find(|s| s.word_id == fx.word_ids[1]).unwrap();
        assert!(other.word_info.examples.is_empty());
        // 前端读取的键名
        let json = serde_json::to_value(&first.word_info).unwrap();
        assert_eq!(json["examples"][0]["translation"], "一");
    }

    #[tokio::test]
    async fn unfinished_sessions_do_not_count_towards_schedule_completion() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 2).await;
        seed_session(&pool, &fx, "open", false).await;
        seed_passed_word(
            &pool,
            "open",
            fx.word_ids[1],
            fx.schedule_word_ids[1],
            "2026-10-06",
        )
        .await;
        seed_session(&pool, &fx, "s1", false).await;
        seed_passed_word(
            &pool,
            "s1",
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            "2026-10-06",
        )
        .await;

        service
            .complete_practice_session("s1", 1_000, 1_000)
            .await
            .unwrap();

        assert_eq!(schedule_progress(&pool, fx.schedule_id).await.0, 1);
    }

    #[tokio::test]
    async fn completion_is_atomic_when_a_later_write_fails() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 1).await;
        seed_session(&pool, &fx, "s1", false).await;
        seed_passed_word(
            &pool,
            "s1",
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            "2026-10-06",
        )
        .await;
        // 让事务中的第二步写入失败
        sqlx::query("DROP TABLE study_sessions")
            .execute(pool.as_ref())
            .await
            .unwrap();

        assert!(service
            .complete_practice_session("s1", 1_000, 1_000)
            .await
            .is_err());

        let completed: bool =
            sqlx::query_scalar("SELECT completed FROM practice_sessions WHERE id = 's1'")
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert!(!completed, "第一步写入必须随事务回滚");
        assert_eq!(schedule_progress(&pool, fx.schedule_id).await.0, 0);
    }

    #[tokio::test]
    async fn completing_unknown_session_is_a_validation_error() {
        let (service, _pool) = setup().await;
        let err = service
            .complete_practice_session("missing", 0, 0)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "VALIDATION_ERROR");
    }

    #[tokio::test]
    async fn pause_and_resume_record_the_pause_interval() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 1).await;
        seed_session(&pool, &fx, "s1", false).await;

        service.pause_practice_session("s1").await.unwrap();
        let pause_count: i64 =
            sqlx::query_scalar("SELECT pause_count FROM practice_sessions WHERE id = 's1'")
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(pause_count, 1);

        service.resume_practice_session("s1").await.unwrap();
        let open_pauses: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM practice_pause_records WHERE session_id = 's1' AND pause_end IS NULL")
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(open_pauses, 0);

        // 没有未结束的暂停时恢复是空操作
        service.resume_practice_session("s1").await.unwrap();
        crate::time::assert_instants_canonical(&pool).await;
    }

    /// 待开始的计划第一次练习时自动开始；最后一个日程练完时自动完成（都写状态历史）
    #[tokio::test]
    async fn practice_moves_plan_from_pending_to_active_to_completed() {
        let (service, pool) = setup().await;
        let fx = seed_schedule(&pool, 1).await;
        sqlx::query("UPDATE study_plans SET unified_status = 'Pending' WHERE id = ?")
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        let status = |pool: Arc<SqlitePool>| async move {
            sqlx::query_scalar::<_, String>("SELECT unified_status FROM study_plans WHERE id = ?")
                .bind(fx.plan_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap()
        };

        let session = service
            .start_practice_session(fx.plan_id, fx.schedule_id)
            .await
            .unwrap();
        assert_eq!(status(pool.clone()).await, "Active");

        seed_passed_word(
            &pool,
            &session.session_id,
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            "2026-10-06",
        )
        .await;
        service
            .complete_practice_session(&session.session_id, 60_000, 60_000)
            .await
            .unwrap();
        assert_eq!(status(pool.clone()).await, "Completed");
        let history: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM study_plan_status_history WHERE plan_id = ?")
                .bind(fx.plan_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(history, 2);
        crate::time::assert_instants_canonical(&pool).await;
    }
}
