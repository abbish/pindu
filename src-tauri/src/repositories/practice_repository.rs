//! 练习会话数据访问层
//!
//! 提供 Repository 模式的数据访问封装

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::study::*;
use sqlx::{Row, SqliteConnection, SqlitePool};
use std::sync::Arc;

/// 练习会话仓储
///
/// 负责练习会话的数据访问逻辑,封装所有数据库操作
pub struct PracticeRepository {
    pub(crate) pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl PracticeRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    // ==================== 练习会话操作 ====================

    /// 查找练习会话
    pub async fn find_session_by_id(&self, session_id: &str) -> AppResult<Option<PracticeSession>> {
        let query = r#"
            SELECT
                ps.id, ps.plan_id, sp.name AS plan_title, ps.schedule_id, ps.schedule_date,
                ps.start_time, ps.end_time, ps.total_time, ps.active_time,
                ps.pause_count, ps.completed, ps.created_at, ps.updated_at
            FROM practice_sessions ps
            LEFT JOIN study_plans sp ON ps.plan_id = sp.id
            WHERE ps.id = ?
        "#;

        let row = sqlx::query(query)
            .bind(session_id)
            .fetch_optional(self.pool.as_ref())
            .await?;

        match row {
            Some(row) => {
                let session = PracticeSession {
                    session_id: row.get("id"),
                    plan_id: row.get("plan_id"),
                    plan_title: row.get::<Option<String>, _>("plan_title"),
                    schedule_id: row.get("schedule_id"),
                    schedule_date: row.get("schedule_date"),
                    start_time: row.get("start_time"),
                    end_time: row.get("end_time"),
                    total_time: row.get("total_time"),
                    active_time: row.get("active_time"),
                    pause_count: row.get("pause_count"),
                    word_states: vec![], // 需要单独查询获取
                    completed: row.get("completed"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                };
                Ok(Some(session))
            }
            None => Ok(None),
        }
    }

    /// 查找练习会话（包含计划名称）
    pub async fn find_session_with_plan_name(
        &self,
        session_id: &str,
    ) -> AppResult<Option<(PracticeSession, Option<String>)>> {
        let query = r#"
            SELECT
                ps.id, ps.plan_id, sp.name as plan_title, ps.schedule_id, ps.schedule_date,
                ps.start_time, ps.end_time, ps.total_time, ps.active_time, ps.pause_count, ps.completed,
                ps.created_at, ps.updated_at
            FROM practice_sessions ps
            LEFT JOIN study_plans sp ON ps.plan_id = sp.id
            WHERE ps.id = ?
        "#;

        let row = sqlx::query(query)
            .bind(session_id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "practice_sessions",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        match row {
            Some(row) => {
                let word_states = self.find_word_states_by_session(session_id).await?;

                let session = PracticeSession {
                    session_id: row.get("id"),
                    plan_id: row.get("plan_id"),
                    plan_title: row.get::<Option<String>, _>("plan_title"),
                    schedule_id: row.get("schedule_id"),
                    schedule_date: row.get("schedule_date"),
                    start_time: row.get("start_time"),
                    end_time: row.get("end_time"),
                    total_time: row.get("total_time"),
                    active_time: row.get("active_time"),
                    pause_count: row.get("pause_count"),
                    word_states,
                    completed: row.get("completed"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                };

                let plan_title = row.get::<Option<String>, _>("plan_title");
                Ok(Some((session, plan_title)))
            }
            None => Ok(None),
        }
    }

    /// 查找未完成的练习会话
    pub async fn find_incomplete_session(
        &self,
        plan_id: i64,
        schedule_id: i64,
    ) -> AppResult<Option<PracticeSession>> {
        let query = r#"
            SELECT id
            FROM practice_sessions
            WHERE plan_id = ? AND schedule_id = ? AND completed = FALSE
        "#;

        let row = sqlx::query(query)
            .bind(plan_id)
            .bind(schedule_id)
            .fetch_optional(self.pool.as_ref())
            .await?;

        match row {
            Some(row) => {
                let session_id: String = row.get("id");
                self.find_session_by_id(&session_id).await
            }
            None => Ok(None),
        }
    }

    /// 创建新的练习会话
    pub async fn create_session(
        &self,
        session_id: &str,
        plan_id: i64,
        schedule_id: i64,
        schedule_date: &str,
        start_time: &str,
    ) -> AppResult<()> {
        let query = r#"
            INSERT INTO practice_sessions (
                id, plan_id, schedule_id, schedule_date,
                start_time, total_time, active_time, pause_count,
                completed, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, FALSE, ?, ?)
        "#;

        sqlx::query(query)
            .bind(session_id)
            .bind(plan_id)
            .bind(schedule_id)
            .bind(schedule_date)
            .bind(start_time)
            .bind(start_time)
            .execute(self.pool.as_ref())
            .await?;

        self.logger.database_operation(
            "INSERT",
            "practice_sessions",
            true,
            Some(&format!("Created session {}", session_id)),
        );

        Ok(())
    }

    /// 将会话标记为已完成（在调用方事务内执行）。
    /// 只更新尚未完成的会话（并发的重复完成请求只有一个生效），返回是否由本次标记完成；
    /// 时长取已落库进度与本次上报的较大值（恢复练习时前端从已落库进度继续累计）。
    pub async fn mark_session_completed(
        &self,
        conn: &mut SqliteConnection,
        session_id: &str,
        end_time: &str,
        total_time: i64,
        active_time: i64,
    ) -> AppResult<bool> {
        let updated = sqlx::query(
            "UPDATE practice_sessions
             SET completed = TRUE, end_time = ?, total_time = MAX(COALESCE(total_time, 0), ?),
                 active_time = MAX(COALESCE(active_time, 0), ?), updated_at = ?
             WHERE id = ? AND completed = FALSE",
        )
        .bind(end_time)
        .bind(total_time)
        .bind(active_time)
        .bind(end_time)
        .bind(session_id)
        .execute(&mut *conn)
        .await?
        .rows_affected()
            > 0;
        if !updated {
            return Ok(false);
        }

        self.logger.database_operation(
            "UPDATE",
            "practice_sessions",
            true,
            Some(&format!("Completed session {}", session_id)),
        );
        Ok(true)
    }

    /// 记录一次学习会话（日历“学习记录”的数据来源，在调用方事务内执行）
    pub async fn insert_study_session(
        &self,
        conn: &mut SqliteConnection,
        session: &NewStudySession<'_>,
    ) -> AppResult<()> {
        let NewStudySession {
            plan_id,
            started_at,
            finished_at,
            words_studied,
            correct_answers,
            total_time_seconds,
        } = *session;
        sqlx::query(
            "INSERT INTO study_sessions (plan_id, started_at, finished_at, words_studied, correct_answers, total_time_seconds) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(plan_id)
        .bind(started_at)
        .bind(finished_at)
        .bind(words_studied)
        .bind(correct_answers)
        .bind(total_time_seconds)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 查找所有未完成的练习会话
    pub async fn find_all_incomplete_sessions(&self) -> AppResult<Vec<PracticeSession>> {
        let query = r#"
            SELECT
                ps.id, ps.plan_id, sp.name AS plan_title, ps.schedule_id, ps.schedule_date,
                ps.start_time, ps.end_time, ps.total_time, ps.active_time,
                ps.pause_count, ps.completed, ps.created_at, ps.updated_at
            FROM practice_sessions ps
            JOIN study_plans sp ON ps.plan_id = sp.id
            WHERE ps.completed = FALSE
              AND sp.deleted_at IS NULL
              AND sp.unified_status IN ('Pending', 'Active')
            ORDER BY ps.updated_at DESC
        "#;

        let rows = sqlx::query(query).fetch_all(self.pool.as_ref()).await?;

        let sessions = rows
            .iter()
            .map(|row| PracticeSession {
                session_id: row.get("id"),
                plan_id: row.get("plan_id"),
                plan_title: row.get::<Option<String>, _>("plan_title"),
                schedule_id: row.get("schedule_id"),
                schedule_date: row.get("schedule_date"),
                start_time: row.get("start_time"),
                end_time: row.get("end_time"),
                total_time: row.get("total_time"),
                active_time: row.get("active_time"),
                pause_count: row.get("pause_count"),
                word_states: vec![], // 需要单独查询获取
                completed: row.get("completed"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        Ok(sessions)
    }

    /// 查找学习计划的所有练习会话
    pub async fn find_sessions_by_plan(&self, plan_id: i64) -> AppResult<Vec<PracticeSession>> {
        let query = r#"
            SELECT
                ps.id, ps.plan_id, sp.name AS plan_title, ps.schedule_id, ps.schedule_date,
                ps.start_time, ps.end_time, ps.total_time, ps.active_time,
                ps.pause_count, ps.completed, ps.created_at, ps.updated_at
            FROM practice_sessions ps
            LEFT JOIN study_plans sp ON ps.plan_id = sp.id
            WHERE ps.plan_id = ?
            ORDER BY ps.created_at DESC
        "#;

        let rows = sqlx::query(query)
            .bind(plan_id)
            .fetch_all(self.pool.as_ref())
            .await?;

        let sessions = rows
            .iter()
            .map(|row| PracticeSession {
                session_id: row.get("id"),
                plan_id: row.get("plan_id"),
                plan_title: row.get::<Option<String>, _>("plan_title"),
                schedule_id: row.get("schedule_id"),
                schedule_date: row.get("schedule_date"),
                start_time: row.get("start_time"),
                end_time: row.get("end_time"),
                total_time: row.get("total_time"),
                active_time: row.get("active_time"),
                pause_count: row.get("pause_count"),
                word_states: vec![], // 需要单独查询获取
                completed: row.get("completed"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        Ok(sessions)
    }

    /// 删除练习会话
    pub async fn delete_session(&self, session_id: &str) -> AppResult<()> {
        let query = "DELETE FROM practice_sessions WHERE id = ?";

        let result = sqlx::query(query)
            .bind(session_id)
            .execute(self.pool.as_ref())
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(
                "练习会话不存在，可能已被删除".to_string(),
            ));
        }

        self.logger.database_operation(
            "DELETE",
            "practice_sessions",
            true,
            Some(&format!("Deleted session {}", session_id)),
        );

        Ok(())
    }

    // ==================== 单词练习状态操作 ====================

    /// 查找会话的所有单词练习状态
    pub async fn find_word_states_by_session(
        &self,
        session_id: &str,
    ) -> AppResult<Vec<WordPracticeState>> {
        // 从 practice_sessions 获取 schedule_id
        let session_row = sqlx::query("SELECT schedule_id FROM practice_sessions WHERE id = ?")
            .bind(session_id)
            .fetch_optional(self.pool.as_ref())
            .await?;

        let schedule_id: i64 = match session_row {
            Some(row) => row.get("schedule_id"),
            None => {
                return Err(AppError::NotFound(
                    "练习会话不存在，可能已被删除".to_string(),
                ))
            }
        };

        // 获取该日程的所有单词（包含完整单词信息）
        let words = sqlx::query(
            r#"
            SELECT spsw.id as plan_word_id, spsw.word_id, spsw.is_review,
                   w.word, w.meaning, w.description, w.ipa, w.syllables, w.phonics_segments
            FROM study_plan_schedule_words spsw
            JOIN words w ON spsw.word_id = w.id
            WHERE spsw.schedule_id = ?
            ORDER BY spsw.is_review DESC, spsw.id
            "#,
        )
        .bind(schedule_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        // 获取该会话的练习记录
        let records = sqlx::query(
            r#"
            SELECT word_id, plan_word_id, step, is_correct, time_spent, attempts, kind, created_at
            FROM word_practice_records
            WHERE session_id = ?
            ORDER BY word_id, step, created_at, id
            "#,
        )
        .bind(session_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut word_states = Vec::new();
        let now = crate::time::now_utc();

        for word_row in words {
            let word_id: i64 = word_row.get("word_id");
            let plan_word_id: i64 = word_row.get("plan_word_id");
            let is_review: bool = word_row.get("is_review");

            // 分析该单词的练习记录
            let word_records: Vec<_> = records
                .iter()
                .filter(|r| r.get::<i64, _>("word_id") == word_id)
                .collect();

            // 确定当前步骤和结果
            let mut current_step = WordPracticeStep::Step1;
            let mut step_results = vec![false, false, false];
            let mut step_attempts = vec![0, 0, 0];
            let mut step_time_spent = vec![0i64, 0i64, 0i64];
            let mut completed = false;
            let mut passed = false;
            let mut max_completed_step = 0;
            let mut retry_counts = vec![0, 0, 0];
            let mut fixed_steps = vec![false, false, false];
            let kind_of = |r: &&sqlx::sqlite::SqliteRow| r.get::<String, _>("kind");
            // 当轮小测：取第一次小测作答
            let review_correct: Option<bool> = word_records
                .iter()
                .find(|r| kind_of(r) == "review")
                .map(|r| r.get("is_correct"));

            // 按步骤分组处理记录（成绩只看首次作答 learn；重考 retry 用于“改正后对”）
            for step_num in 1..=3 {
                let step_index = (step_num - 1) as usize;
                let retries: Vec<_> = word_records
                    .iter()
                    .filter(|r| r.get::<i32, _>("step") == step_num && kind_of(r) == "retry")
                    .collect();
                retry_counts[step_index] = retries.len() as i32;
                let step_records: Vec<_> = word_records
                    .iter()
                    .filter(|r| r.get::<i32, _>("step") == step_num && kind_of(r) == "learn")
                    .collect();

                if !step_records.is_empty() {
                    max_completed_step = step_num;

                    // 只取第一次尝试的结果
                    let first_record = step_records.first().unwrap();
                    let is_correct: bool = first_record.get("is_correct");
                    let time_spent: i64 = first_record.get("time_spent");
                    let attempts: i32 = first_record.get("attempts");

                    step_results[step_index] = is_correct;
                    step_attempts[step_index] = attempts;
                    step_time_spent[step_index] = time_spent;
                    fixed_steps[step_index] =
                        !is_correct && retries.iter().any(|r| r.get::<bool, _>("is_correct"));

                    // 更新当前步骤
                    if is_correct && step_num < 3 {
                        current_step = match step_num {
                            1 => WordPracticeStep::Step2,
                            2 => WordPracticeStep::Step3,
                            _ => current_step,
                        };
                    } else if step_num == 3 {
                        current_step = WordPracticeStep::Step3;
                    }
                }
            }

            // 判断是否完成和通过：复习词只做第三步，第三步首答对即通过
            if is_review {
                if step_attempts[2] > 0 {
                    completed = true;
                    passed = step_results[2];
                }
            } else if max_completed_step == 3 {
                completed = true;
                passed = step_results[0] && step_results[1] && step_results[2];
            }

            let word_info = PracticeWordInfo {
                word_id,
                word: word_row.get("word"),
                meaning: word_row.get("meaning"),
                description: word_row.get("description"),
                ipa: word_row.get("ipa"),
                syllables: word_row.get("syllables"),
                phonics_segments: word_row.get("phonics_segments"),
                examples: Vec::new(),
            };

            word_states.push(WordPracticeState {
                word_id,
                plan_word_id,
                is_review,
                word_info,
                current_step,
                step_results,
                step_attempts,
                step_time_spent,
                completed,
                passed,
                retry_counts,
                fixed_steps,
                review_correct,
                start_time: now.clone(),
                end_time: if completed { Some(now.clone()) } else { None },
            });
        }

        // 例句一次批量读取
        let ids: Vec<i64> = word_states.iter().map(|s| s.word_id).collect();
        let mut examples =
            crate::repositories::word_repository::examples_by_word_ids(self.pool.as_ref(), &ids)
                .await?;
        for state in &mut word_states {
            state.word_info.examples = examples.remove(&state.word_id).unwrap_or_default();
        }
        Ok(word_states)
    }

    /// 创建单词练习状态
    ///
    /// 注意：此函数不执行任何数据库操作，因为 word_practice_records 表
    /// 只用于存储每次练习步骤的记录，而不是存储完整的状态。
    /// 初始状态不需要持久化，只有在用户提交步骤结果时才会插入记录。
    pub async fn create_word_state(
        &self,
        _session_id: &str,
        state: &WordPracticeState,
    ) -> AppResult<()> {
        // 不执行任何数据库操作，因为初始状态不需要持久化
        // 只有在用户提交步骤结果时才会通过 submit_step_result 插入记录
        self.logger.database_operation(
            "SKIP",
            "word_practice_records",
            true,
            Some(&format!("Skipped creating initial state for word {} (will be created when step results are submitted)", state.word_id)),
        );

        Ok(())
    }

    /// 批量创建单词练习状态
    pub async fn create_word_states_batch(
        &self,
        session_id: &str,
        states: &[WordPracticeState],
    ) -> AppResult<()> {
        for state in states {
            self.create_word_state(session_id, state).await?;
        }
        Ok(())
    }

    // ==================== 暂停记录操作 ====================

    /// 记录一次暂停开始（在调用方事务内执行）
    pub async fn create_pause_record(
        &self,
        conn: &mut SqliteConnection,
        session_id: &str,
        pause_start: &str,
    ) -> AppResult<i64> {
        let result = sqlx::query(
            "INSERT INTO practice_pause_records (session_id, pause_start, created_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(session_id)
        .bind(pause_start)
        .execute(&mut *conn)
        .await?;

        let record_id = result.last_insert_rowid();
        self.logger.database_operation(
            "INSERT",
            "practice_pause_records",
            true,
            Some(&format!(
                "Created pause record {} for session {}",
                record_id, session_id
            )),
        );
        Ok(record_id)
    }

    /// 会话暂停次数 +1（在调用方事务内执行）
    pub async fn increment_pause_count(
        &self,
        conn: &mut SqliteConnection,
        session_id: &str,
        updated_at: &str,
    ) -> AppResult<()> {
        sqlx::query("UPDATE practice_sessions SET pause_count = pause_count + 1, updated_at = ? WHERE id = ?")
            .bind(updated_at)
            .bind(session_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    /// 保存练习进度时长（毫秒，只增不减；已完成的会话不再修改）
    pub async fn save_session_progress(
        &self,
        session_id: &str,
        total_time: i64,
        active_time: i64,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE practice_sessions
             SET total_time = MAX(COALESCE(total_time, 0), ?), active_time = MAX(COALESCE(active_time, 0), ?),
                 updated_at = ?
             WHERE id = ? AND completed = FALSE",
        )
        .bind(total_time)
        .bind(active_time)
        .bind(crate::time::now_utc())
        .bind(session_id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    /// 计划是否还能练习（未删除，且处于待开始 / 进行中 / 暂停）
    pub async fn plan_accepts_practice(&self, plan_id: i64) -> AppResult<bool> {
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM study_plans
             WHERE id = ? AND deleted_at IS NULL AND unified_status IN ('Pending', 'Active')",
        )
        .bind(plan_id)
        .fetch_one(self.pool.as_ref())
        .await?;
        Ok(n > 0)
    }

    /// 会话是否有未结束的暂停
    pub async fn has_open_pause(&self, session_id: &str) -> AppResult<bool> {
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM practice_pause_records WHERE session_id = ? AND pause_end IS NULL",
        )
        .bind(session_id)
        .fetch_one(self.pool.as_ref())
        .await?;
        Ok(n > 0)
    }

    /// 结束会话所有未结束的暂停（完成会话时收尾，在调用方事务内执行）
    pub async fn close_open_pauses(
        &self,
        conn: &mut SqliteConnection,
        session_id: &str,
        pause_end: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE practice_pause_records SET pause_end = ? WHERE session_id = ? AND pause_end IS NULL",
        )
        .bind(pause_end)
        .bind(session_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 作答的单词是否属于会话所练的日程（plan_word_id 与 word_id 必须对应）
    pub async fn word_belongs_to_session(
        &self,
        session_id: &str,
        word_id: i64,
        plan_word_id: i64,
    ) -> AppResult<bool> {
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM study_plan_schedule_words spsw
             JOIN practice_sessions ps ON ps.schedule_id = spsw.schedule_id
             WHERE ps.id = ? AND spsw.id = ? AND spsw.word_id = ?",
        )
        .bind(session_id)
        .bind(plan_word_id)
        .bind(word_id)
        .fetch_one(self.pool.as_ref())
        .await?;
        Ok(n > 0)
    }

    /// 结束最近一次未结束的暂停；没有未结束的暂停时不做任何事（与 2026-01 重构前行为一致）
    pub async fn close_latest_pause(
        &self,
        conn: &mut SqliteConnection,
        session_id: &str,
        pause_end: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE practice_pause_records SET pause_end = ? WHERE id = (SELECT id FROM practice_pause_records WHERE session_id = ? AND pause_end IS NULL ORDER BY id DESC LIMIT 1)",
        )
        .bind(pause_end)
        .bind(session_id)
        .execute(&mut *conn)
        .await?;

        self.logger.database_operation(
            "UPDATE",
            "practice_pause_records",
            true,
            Some(&format!("Resumed pause for session {}", session_id)),
        );
        Ok(())
    }

    // ==================== 练习记录操作 ====================

    /// 创建练习记录
    pub async fn create_practice_record(&self, record: &PracticeStepRecord) -> AppResult<()> {
        let PracticeStepRecord {
            session_id,
            word_id,
            plan_word_id,
            step,
            user_input,
            is_correct,
            time_spent,
            attempts,
            kind,
        } = record;
        let now = crate::time::now_utc();
        let query = r#"
            INSERT INTO word_practice_records
             (session_id, word_id, plan_word_id, step, user_input, is_correct, time_spent, attempts, kind, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#;

        sqlx::query(query)
            .bind(session_id)
            .bind(word_id)
            .bind(plan_word_id)
            .bind(step)
            .bind(user_input)
            .bind(is_correct)
            .bind(time_spent)
            .bind(attempts)
            .bind(kind)
            .bind(&now)
            .execute(self.pool.as_ref())
            .await?;

        self.logger.database_operation(
            "INSERT",
            "word_practice_records",
            true,
            Some(&format!(
                "Created practice record: session_id={}, word_id={}, step={}, is_correct={}",
                session_id, word_id, step, is_correct
            )),
        );

        Ok(())
    }

    // ==================== 统计查询 ====================
}

// ==================== 辅助类型定义 ====================
