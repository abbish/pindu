//! 练习会话数据访问层
//!
//! 提供 Repository 模式的数据访问封装



use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::study::*;
use sqlx::{Row, SqlitePool};
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
                id, plan_id, schedule_id, schedule_date,
                start_time, end_time, total_time, active_time,
                pause_count, completed, created_at, updated_at
            FROM practice_sessions
            WHERE id = ?
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
                    plan_title: None, // 需要单独查询获取
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
    pub async fn find_session_with_plan_name(&self, session_id: &str) -> AppResult<Option<(PracticeSession, Option<String>)>> {
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
                self.logger
                    .database_operation("SELECT", "practice_sessions", false, Some(&e.to_string()));
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

    /// 更新练习会话
    pub async fn update_session(&self, session: &PracticeSession) -> AppResult<()> {
        let query = r#"
            UPDATE practice_sessions SET
                end_time = ?,
                total_time = ?,
                active_time = ?,
                pause_count = ?,
                completed = ?,
                updated_at = ?
            WHERE id = ?
        "#;

        sqlx::query(query)
            .bind(&session.end_time)
            .bind(session.total_time)
            .bind(session.active_time)
            .bind(session.pause_count)
            .bind(session.completed)
            .bind(&session.updated_at)
            .bind(&session.session_id)
            .execute(self.pool.as_ref())
            .await?;

        self.logger.database_operation(
            "UPDATE",
            "practice_sessions",
            true,
            Some(&format!("Updated session {}", session.session_id)),
        );

        Ok(())
    }

    /// 查找所有未完成的练习会话
    pub async fn find_all_incomplete_sessions(&self) -> AppResult<Vec<PracticeSession>> {
        let query = r#"
            SELECT
                id, plan_id, schedule_id, schedule_date,
                start_time, end_time, total_time, active_time,
                pause_count, completed, created_at, updated_at
            FROM practice_sessions
            WHERE completed = FALSE
            ORDER BY created_at DESC
        "#;

        let rows = sqlx::query(query).fetch_all(self.pool.as_ref()).await?;

        let sessions = rows
            .iter()
            .map(|row| PracticeSession {
                session_id: row.get("id"),
                plan_id: row.get("plan_id"),
                plan_title: None, // 需要单独查询获取
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
                id, plan_id, schedule_id, schedule_date,
                start_time, end_time, total_time, active_time,
                pause_count, completed, created_at, updated_at
            FROM practice_sessions
            WHERE plan_id = ?
            ORDER BY created_at DESC
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
                plan_title: None, // 需要单独查询获取
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
            return Err(AppError::NotFound(format!(
                "练习会话 {} 不存在",
                session_id
            )));
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
            None => return Err(AppError::NotFound(format!("练习会话 {} 不存在", session_id))),
        };

        // 获取该日程的所有单词（包含完整单词信息）
        let words = sqlx::query(
            r#"
            SELECT spsw.id as plan_word_id, spsw.word_id,
                   w.word, w.meaning, w.description, w.ipa, w.syllables, w.phonics_segments
            FROM study_plan_schedule_words spsw
            JOIN words w ON spsw.word_id = w.id
            WHERE spsw.schedule_id = ?
            ORDER BY spsw.id
            "#
        )
        .bind(schedule_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        // 获取该会话的练习记录
        let records = sqlx::query(
            r#"
            SELECT word_id, plan_word_id, step, is_correct, time_spent, attempts, created_at
            FROM word_practice_records
            WHERE session_id = ?
            ORDER BY word_id, step, created_at
            "#
        )
        .bind(session_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut word_states = Vec::new();
        let now = chrono::Utc::now().to_rfc3339();

        for word_row in words {
            let word_id: i64 = word_row.get("word_id");
            let plan_word_id: i64 = word_row.get("plan_word_id");

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

            // 按步骤分组处理记录
            for step_num in 1..=3 {
                let step_records: Vec<_> = word_records
                    .iter()
                    .filter(|r| r.get::<i32, _>("step") == step_num)
                    .collect();

                if !step_records.is_empty() {
                    let step_index = (step_num - 1) as usize;
                    max_completed_step = step_num;

                    // 只取第一次尝试的结果
                    let first_record = step_records.first().unwrap();
                    let is_correct: bool = first_record.get("is_correct");
                    let time_spent: i64 = first_record.get("time_spent");
                    let attempts: i32 = first_record.get("attempts");

                    step_results[step_index] = is_correct;
                    step_attempts[step_index] = attempts;
                    step_time_spent[step_index] = time_spent;

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

            // 判断是否完成和通过
            if max_completed_step == 3 {
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
            };

            word_states.push(WordPracticeState {
                word_id,
                plan_word_id,
                word_info,
                current_step,
                step_results,
                step_attempts,
                step_time_spent,
                completed,
                passed,
                start_time: now.clone(),
                end_time: if completed { Some(now.clone()) } else { None },
            });
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

    /// 创建暂停记录
    pub async fn create_pause_record(
        &self,
        session_id: &str,
        pause_time: &str,
    ) -> AppResult<i64> {
        let query = r#"
            INSERT INTO practice_pause_records (session_id, paused_at)
            VALUES (?, ?)
        "#;

        let result = sqlx::query(query)
            .bind(session_id)
            .bind(pause_time)
            .execute(self.pool.as_ref())
            .await?;

        let record_id = result.last_insert_rowid();
        self.logger.database_operation(
            "INSERT",
            "practice_pause_records",
            true,
            Some(&format!("Created pause record {} for session {}", record_id, session_id)),
        );

        Ok(record_id)
    }

    /// 更新暂停记录（更新最近的一次暂停记录）
    pub async fn update_pause_record(
        &self,
        session_id: &str,
        resume_time: &str,
    ) -> AppResult<()> {
        let query = r#"
            UPDATE practice_pause_records
            SET resumed_at = ?
            WHERE session_id = ? AND resumed_at IS NULL
            ORDER BY paused_at DESC
            LIMIT 1
        "#;

        sqlx::query(query)
            .bind(resume_time)
            .bind(session_id)
            .execute(self.pool.as_ref())
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
    pub async fn create_practice_record(
        &self,
        session_id: &str,
        word_id: i64,
        plan_word_id: i64,
        step: i32,
        user_input: &str,
        is_correct: bool,
        time_spent: i64,
        attempts: i32,
    ) -> AppResult<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let query = r#"
            INSERT INTO word_practice_records
             (session_id, word_id, plan_word_id, step, user_input, is_correct, time_spent, attempts, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    /// 获取练习统计数据
    pub async fn get_practice_statistics(&self, plan_id: i64) -> AppResult<PracticeStatistics> {
        // 获取会话统计
        let query = r#"
            SELECT
                COUNT(*) as total_sessions,
                COUNT(CASE WHEN completed = TRUE THEN 1 END) as completed_sessions
            FROM practice_sessions
            WHERE plan_id = ?
        "#;

        let row = sqlx::query(query)
            .bind(plan_id)
            .fetch_one(self.pool.as_ref())
            .await?;

        let total_sessions: i32 = row.get("total_sessions");
        let completed_sessions: i32 = row.get("completed_sessions");

        // 计算平均准确率
        let accuracy_query = r#"
            SELECT
                COUNT(*) as total_steps,
                COUNT(CASE WHEN is_correct = TRUE THEN 1 END) as correct_steps
            FROM word_practice_records wpr
            JOIN practice_sessions ps ON wpr.session_id = ps.id
            WHERE ps.plan_id = ? AND ps.completed = TRUE
        "#;

        let accuracy_row = sqlx::query(accuracy_query)
            .bind(plan_id)
            .fetch_optional(self.pool.as_ref())
            .await?;

        let average_accuracy = match accuracy_row {
            Some(row) => {
                let total: i64 = row.get("total_steps");
                let correct: i64 = row.get("correct_steps");
                if total > 0 {
                    (correct as f64 / total as f64) * 100.0
                } else {
                    0.0
                }
            }
            None => 0.0,
        };

        // 获取总练习时间
        let time_query = r#"
            SELECT COALESCE(SUM(total_time), 0) as total_time
            FROM practice_sessions
            WHERE plan_id = ?
        "#;

        let time_row = sqlx::query(time_query)
            .bind(plan_id)
            .fetch_one(self.pool.as_ref())
            .await?;

        let total_practice_time: i64 = time_row.get("total_time");

        // 获取学会的单词数
        let words_query = r#"
            SELECT COUNT(DISTINCT wpr.word_id) as words_learned
            FROM word_practice_records wpr
            JOIN practice_sessions ps ON wpr.session_id = ps.id
            WHERE ps.plan_id = ? AND ps.completed = TRUE
              AND EXISTS (
                  SELECT 1 FROM word_practice_records wpr2
                  WHERE wpr2.session_id = wpr.session_id
                    AND wpr2.word_id = wpr.word_id
                    AND wpr2.is_correct = TRUE
                    AND wpr2.step = 3
              )
        "#;

        let words_row = sqlx::query(words_query)
            .bind(plan_id)
            .fetch_one(self.pool.as_ref())
            .await?;

        let words_learned: i64 = words_row.get("words_learned");

        let stats = PracticeStatistics {
            total_sessions,
            completed_sessions,
            average_accuracy,
            total_practice_time,
            words_learned: words_learned as i32,
        };

        Ok(stats)
    }
}

// ==================== 辅助类型定义 ====================

