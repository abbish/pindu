//! 学习计划数据访问层
//!
//! 提供 Repository 模式的数据访问封装
//!
//! 负责学习计划相关的所有数据库操作

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::common::Id;
use crate::types::study::*;
use sqlx::{Row, SqliteConnection, SqlitePool};
use std::sync::Arc;

/// 学习计划仓储
///
/// 负责学习计划的数据访问逻辑,封装所有数据库操作
pub struct StudyPlanRepository {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl StudyPlanRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 获取 pool 引用（用于跨 Repository 操作）
    pub fn get_pool(&self) -> Arc<SqlitePool> {
        self.pool.clone()
    }

    /// 开始写事务（BEGIN IMMEDIATE）
    pub async fn begin_transaction(&self) -> AppResult<sqlx::Transaction<'_, sqlx::Sqlite>> {
        // 计划的写操作几乎都是先读状态再写：直接拿写锁，避免与并发的复习同步撞上 database is locked
        self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| {
            self.logger
                .database_operation("BEGIN", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(format!("无法开始保存：{}", e))
        })
    }

    /// 查询学习计划列表（带进度信息）
    pub async fn find_all_with_progress(
        &self,
        include_deleted: bool,
    ) -> AppResult<Vec<StudyPlanWithProgress>> {
        let mut query = String::from(
            r#"
            SELECT
                sp.id,
                sp.name,
                sp.description,
                sp.status,
                sp.unified_status,
                sp.total_words,
                sp.mastery_level,
                sp.intensity_level,
                sp.study_period_days,
                sp.review_frequency,
                sp.start_date,
                sp.end_date,
                sp.actual_start_date,
                sp.actual_end_date,
                sp.actual_terminated_date,
                sp.ai_plan_data, sp.daily_new_words,
                sp.deleted_at,
                sp.created_at,
                sp.updated_at,
                sp.practice_content, sp.passage_interval_days,
                (SELECT COUNT(*) FROM study_plan_passages pp WHERE pp.plan_id = sp.id) as total_passages,
                (SELECT COUNT(*) FROM study_plan_passages pp
                 WHERE pp.plan_id = sp.id AND pp.completed_at IS NOT NULL) as completed_passages,
                COUNT(DISTINCT ss.id) as total_schedules,
                COUNT(DISTINCT CASE WHEN ss.status = 'completed' THEN ss.id END) as completed_schedules
            FROM study_plans sp
            LEFT JOIN study_plan_schedules ss ON sp.id = ss.plan_id
        "#,
        );

        if !include_deleted {
            query.push_str(" WHERE sp.status != 'deleted'");
        }

        query.push_str(" GROUP BY sp.id ORDER BY sp.created_at DESC");

        let rows = sqlx::query(&query)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "study_plans",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        self.logger.database_operation(
            "SELECT",
            "study_plans",
            true,
            Some(&format!("Found {} study plans with progress", rows.len())),
        );

        let plans = rows
            .into_iter()
            .map(|row| self.row_to_study_plan_with_progress(row))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(plans)
    }

    /// 根据 ID 查询学习计划（带进度信息）
    pub async fn find_by_id_with_progress(
        &self,
        id: Id,
    ) -> AppResult<Option<StudyPlanWithProgress>> {
        let query = r#"
            SELECT
                sp.id, sp.name, sp.description, sp.status, sp.unified_status,
                sp.total_words, sp.mastery_level, sp.intensity_level,
                sp.study_period_days, sp.review_frequency,
                sp.start_date, sp.end_date,
                sp.actual_start_date, sp.actual_end_date, sp.actual_terminated_date,
                sp.ai_plan_data, sp.daily_new_words, sp.deleted_at,
                sp.created_at, sp.updated_at,
                sp.practice_content, sp.passage_interval_days,
                (SELECT COUNT(*) FROM study_plan_passages pp WHERE pp.plan_id = sp.id) as total_passages,
                (SELECT COUNT(*) FROM study_plan_passages pp
                 WHERE pp.plan_id = sp.id AND pp.completed_at IS NOT NULL) as completed_passages,
                COUNT(DISTINCT ss.id) as total_schedules,
                COUNT(DISTINCT CASE WHEN ss.status = 'completed' THEN ss.id END) as completed_schedules
            FROM study_plans sp
            LEFT JOIN study_plan_schedules ss ON sp.id = ss.plan_id
            WHERE sp.id = ?
            GROUP BY sp.id
        "#;

        let row = sqlx::query(query)
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "study_plans",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        match row {
            Some(row) => {
                self.logger.database_operation(
                    "SELECT",
                    "study_plans",
                    true,
                    Some(&format!("Found study plan {}", id)),
                );
                Ok(Some(self.row_to_study_plan_with_progress(row)?))
            }
            None => Ok(None),
        }
    }

    /// 在事务中创建学习计划
    pub async fn create_in_transaction(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        plan: &StudyPlan,
    ) -> AppResult<Id> {
        let query = r#"
            INSERT INTO study_plans (
                name, description, status, unified_status,
                total_words, mastery_level, intensity_level,
                study_period_days, review_frequency,
                start_date, end_date,
                ai_plan_data,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        "#;

        let unified_status_str = plan
            .unified_status
            .as_ref()
            .map(|s| match s {
                UnifiedStudyPlanStatus::Draft => "Draft",
                UnifiedStudyPlanStatus::Pending => "Pending",
                UnifiedStudyPlanStatus::Active => "Active",
                UnifiedStudyPlanStatus::Paused => "Paused",
                UnifiedStudyPlanStatus::Completed => "Completed",
                UnifiedStudyPlanStatus::Terminated => "Terminated",
                UnifiedStudyPlanStatus::Deleted => "Deleted",
            })
            .unwrap_or("Draft");

        let result = sqlx::query(query)
            .bind(&plan.name)
            .bind(&plan.description)
            .bind(&plan.status)
            .bind(unified_status_str)
            .bind(plan.total_words)
            .bind(plan.mastery_level)
            .bind(plan.intensity_level.as_deref())
            .bind(plan.study_period_days)
            .bind(plan.review_frequency)
            .bind(&plan.start_date)
            .bind(&plan.end_date)
            .bind(&plan.ai_plan_data)
            .execute(&mut **tx)
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "INSERT",
                    "study_plans",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        let id = result.last_insert_rowid();
        self.logger.database_operation(
            "INSERT",
            "study_plans",
            true,
            Some(&format!("Created study plan {} in transaction", id)),
        );

        Ok(id)
    }

    /// 查询状态变更历史（测试核对状态流转用）
    #[cfg(test)]
    pub async fn find_status_history(&self, plan_id: Id) -> AppResult<Vec<StudyPlanStatusHistory>> {
        let query = r#"
            SELECT id, plan_id, from_status, to_status, reason, created_at
            FROM study_plan_status_history
            WHERE plan_id = ?
            ORDER BY created_at DESC, id DESC
        "#;

        let rows = sqlx::query(query)
            .bind(plan_id)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "study_plan_status_history",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        let history: Vec<StudyPlanStatusHistory> = rows
            .into_iter()
            .map(|row| StudyPlanStatusHistory {
                id: row.get("id"),
                plan_id: row.get("plan_id"),
                from_status: row.get("from_status"),
                to_status: row.get("to_status"),
                changed_at: row.get("created_at"),
                reason: row.get("reason"),
            })
            .collect();

        self.logger.database_operation(
            "SELECT",
            "study_plan_status_history",
            true,
            Some(&format!(
                "Found {} history records for plan {}",
                history.len(),
                plan_id
            )),
        );

        Ok(history)
    }

    /// 查询学习计划关联的单词本 ID（按单词所属单词本去重）
    pub async fn find_word_book_ids(&self, plan_id: Id) -> AppResult<Vec<Id>> {
        let query = r#"
            SELECT DISTINCT w.word_book_id
            FROM study_plan_words spw
            JOIN words w ON w.id = spw.word_id
            WHERE spw.plan_id = ?
            ORDER BY w.word_book_id
        "#;

        let ids = sqlx::query_scalar::<_, Id>(query)
            .bind(plan_id)
            .fetch_all(self.pool.as_ref())
            .await?;
        Ok(ids)
    }

    /// 在调用方事务内读取未删除计划的 `unified_status`（唯一权威状态）
    pub async fn find_unified_status_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
    ) -> AppResult<Option<String>> {
        let query = "SELECT unified_status FROM study_plans WHERE id = ? AND deleted_at IS NULL";
        let status = sqlx::query_scalar::<_, String>(query)
            .bind(plan_id)
            .fetch_optional(&mut *conn)
            .await?;
        Ok(status)
    }

    /// 更新计划名称与描述（在调用方事务内执行）
    pub async fn update_basic_info_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
        name: &str,
        description: Option<&str>,
    ) -> AppResult<()> {
        sqlx::query(
            r#"
            UPDATE study_plans
            SET
                name = ?,
                description = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id = ?
        "#,
        )
        .bind(name)
        // description 列可空，但读取类型是 String：写入空串而不是 NULL
        .bind(description.unwrap_or(""))
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 物理删除计划（在调用方事务内执行）。日程、单词关联、练习会话与作答记录、状态历史经
    /// `ON DELETE CASCADE` 一并删除，不可恢复。返回是否删除了记录。
    pub async fn delete_plan_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
    ) -> AppResult<bool> {
        let result = sqlx::query("DELETE FROM study_plans WHERE id = ?")
            .bind(plan_id)
            .execute(&mut *conn)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    /// 查询学习计划的单词
    pub async fn find_plan_words(&self, plan_id: Id) -> AppResult<Vec<StudyPlanWord>> {
        let query = r#"
            SELECT DISTINCT
                w.id as word_id,
                w.word,
                w.meaning,
                w.part_of_speech,
                w.ipa,
                w.syllables,
                w.word_book_id as wordbook_id,
                spw.srs_box, spw.srs_due, spw.srs_last, spw.srs_lapses, spw.srs_reviews,
                (SELECT MIN(s.schedule_date) FROM study_plan_schedule_words sw
                 JOIN study_plan_schedules s ON s.id = sw.schedule_id
                 WHERE s.plan_id = spw.plan_id AND sw.word_id = spw.word_id AND sw.is_review = FALSE) AS learn_date
            FROM study_plan_words spw
            JOIN words w ON w.id = spw.word_id
            WHERE spw.plan_id = ?
            ORDER BY w.word
        "#;

        let rows = sqlx::query(query)
            .bind(plan_id)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "study_plan_words",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        let words: Vec<StudyPlanWord> = rows
            .into_iter()
            .map(|row| StudyPlanWord {
                id: row.get("word_id"),
                word: row.get("word"),
                meaning: row.get::<Option<String>, _>("meaning").unwrap_or_default(),
                part_of_speech: row
                    .get::<Option<String>, _>("part_of_speech")
                    .unwrap_or_else(|| "n.".to_string()),
                ipa: row.get::<Option<String>, _>("ipa").unwrap_or_default(),
                syllables: row
                    .get::<Option<String>, _>("syllables")
                    .unwrap_or_default(),
                plan_id,
                schedule_id: 0,
                scheduled_date: String::new(),
                is_review: false,
                review_count: Some(0),
                priority: "1".to_string(),
                difficulty_level: 1,
                completed: false,
                completed_at: None,
                study_time_minutes: 0,
                correct_attempts: 0,
                total_attempts: 0,
                wordbook_id: row.get("wordbook_id"),
                plan_word_id: row.get("word_id"),
                memory_box: row.get("srs_box"),
                next_review_date: row.get("srs_due"),
                last_practiced_date: row.get("srs_last"),
                lapses: row.get("srs_lapses"),
                reviews: row.get("srs_reviews"),
                learn_date: row.get("learn_date"),
            })
            .collect();

        self.logger.database_operation(
            "SELECT",
            "study_plan_words",
            true,
            Some(&format!("Found {} words for plan {}", words.len(), plan_id)),
        );

        Ok(words)
    }

    /// 查询学习计划的日程列表
    pub async fn find_plan_schedules(&self, plan_id: Id) -> AppResult<Vec<PlanScheduleSummary>> {
        // 验证学习计划是否存在
        let plan_exists = sqlx::query("SELECT id FROM study_plans WHERE id = ?")
            .bind(plan_id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "study_plans",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        if plan_exists.is_none() {
            return Err(AppError::NotFound(
                "学习计划不存在，可能已被删除".to_string(),
            ));
        }

        let schedules = sqlx::query(
            // 单词数用子查询（与练习会话 JOIN 会按会话数成倍放大）；completed = 日程已练完
            "SELECT sps.id, sps.schedule_date, sps.day_number,
                    COALESCE(sps.new_words_count, 0) as new_words_count,
                    COALESCE(sps.review_words_count, 0) as review_words_count,
                    COALESCE(sps.completed_words_count, 0) as completed_words_count,
                    (SELECT COUNT(*) FROM study_plan_schedule_words spsw WHERE spsw.schedule_id = sps.id) as word_count,
                    CASE WHEN sps.status = 'completed' THEN 1 ELSE 0 END as completed
             FROM study_plan_schedules sps
             WHERE sps.plan_id = ?
             ORDER BY sps.schedule_date ASC",
        )
        .bind(plan_id)
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(|e| {
            self.logger.database_operation(
                "SELECT",
                "study_plan_schedules",
                false,
                Some(&e.to_string()),
            );
            AppError::DatabaseError(e.to_string())
        })?;

        // 各日程的单词（新学 + 复习），一次查询后按日程分组
        let word_rows = sqlx::query(
            "SELECT sw.schedule_id, sw.word_id, w.word, w.meaning, sw.is_review
             FROM study_plan_schedule_words sw
             JOIN study_plan_schedules s ON s.id = sw.schedule_id
             JOIN words w ON w.id = sw.word_id
             WHERE s.plan_id = ?
             ORDER BY sw.is_review DESC, sw.id",
        )
        .bind(plan_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        let mut words_by_schedule: std::collections::HashMap<i64, Vec<PlanScheduleWord>> =
            std::collections::HashMap::new();
        for r in &word_rows {
            words_by_schedule
                .entry(r.get("schedule_id"))
                .or_default()
                .push(PlanScheduleWord {
                    word_id: r.get("word_id"),
                    word: r.get("word"),
                    meaning: r.get::<Option<String>, _>("meaning").unwrap_or_default(),
                    is_review: r.get("is_review"),
                });
        }

        let result: Vec<PlanScheduleSummary> = schedules
            .into_iter()
            .map(|row| {
                let id: i64 = row.get("id");
                PlanScheduleSummary {
                    words: words_by_schedule.remove(&id).unwrap_or_default(),
                    id,
                    schedule_date: row.get("schedule_date"),
                    day: row.get("day_number"),
                    word_count: row.get("word_count"),
                    new_words_count: row.get("new_words_count"),
                    review_words_count: row.get("review_words_count"),
                    completed_words_count: row.get("completed_words_count"),
                    completed: row.get::<i64, _>("completed") == 1,
                }
            })
            .collect();

        self.logger.database_operation(
            "SELECT",
            "study_plan_schedules",
            true,
            Some(&format!(
                "Found {} schedules for plan {}",
                result.len(),
                plan_id
            )),
        );

        Ok(result)
    }

    /// 查询关联到指定单词本的学习计划
    pub async fn find_linked_plans_by_wordbook(
        &self,
        wordbook_id: Id,
    ) -> AppResult<Vec<StudyPlanWithProgress>> {
        let query = r#"
            SELECT DISTINCT
                sp.id,
                sp.name,
                sp.description,
                sp.status,
                sp.unified_status,
                sp.total_words,
                sp.mastery_level,
                sp.intensity_level,
                sp.study_period_days,
                sp.review_frequency,
                sp.start_date,
                sp.end_date,
                sp.actual_start_date,
                sp.actual_end_date,
                sp.actual_terminated_date,
                sp.ai_plan_data, sp.daily_new_words,
                sp.deleted_at,
                sp.created_at,
                sp.updated_at,
                sp.practice_content, sp.passage_interval_days,
                (SELECT COUNT(*) FROM study_plan_passages pp WHERE pp.plan_id = sp.id) as total_passages,
                (SELECT COUNT(*) FROM study_plan_passages pp
                 WHERE pp.plan_id = sp.id AND pp.completed_at IS NOT NULL) as completed_passages,
                -- 与计划列表同一口径：练完的日程数 / 日程数
                (SELECT COUNT(*) FROM study_plan_schedules ss WHERE ss.plan_id = sp.id) as total_schedules,
                (SELECT COUNT(*) FROM study_plan_schedules ss
                 WHERE ss.plan_id = sp.id AND ss.status = 'completed') as completed_schedules
            FROM study_plans sp
            WHERE sp.id IN (
                SELECT DISTINCT spw.plan_id
                FROM study_plan_words spw
                JOIN words w ON spw.word_id = w.id
                WHERE w.word_book_id = ?
            )
            AND sp.deleted_at IS NULL
            ORDER BY sp.created_at DESC
        "#;

        let rows = sqlx::query(query)
            .bind(wordbook_id)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "study_plans",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        let plans: Vec<StudyPlanWithProgress> = rows
            .into_iter()
            .map(|row| self.row_to_study_plan_with_progress(row))
            .collect::<Result<Vec<_>, _>>()?;

        self.logger.database_operation(
            "SELECT",
            "study_plans",
            true,
            Some(&format!(
                "Found {} linked plans for wordbook {}",
                plans.len(),
                wordbook_id
            )),
        );

        Ok(plans)
    }

    /// 获取学习计划名称
    pub async fn get_plan_name(&self, id: Id) -> AppResult<Option<String>> {
        let query = "SELECT name FROM study_plans WHERE id = ? AND deleted_at IS NULL";

        let row = sqlx::query(query)
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "study_plans",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        match row {
            Some(row) => Ok(Some(row.get("name"))),
            None => Ok(None),
        }
    }

    /// 批量创建学习计划单词关联（在事务中）
    pub async fn create_plan_words_batch(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        plan_id: Id,
        word_ids: &[Id],
    ) -> AppResult<()> {
        if word_ids.is_empty() {
            return Ok(());
        }

        let query = r#"
            INSERT INTO study_plan_words (plan_id, word_id, learned, correct_count, total_attempts, mastery_score)
            VALUES (?, ?, FALSE, 0, 0, 0.0)
        "#;

        for word_id in word_ids {
            sqlx::query(query)
                .bind(plan_id)
                .bind(word_id)
                .execute(&mut **tx)
                .await
                .map_err(|e| {
                    self.logger.database_operation(
                        "INSERT",
                        "study_plan_words",
                        false,
                        Some(&format!("Failed to create plan word association: {}", e)),
                    );
                    AppError::DatabaseError(format!(
                        "Failed to create plan word association: {}",
                        e
                    ))
                })?;
        }

        self.logger.database_operation(
            "INSERT",
            "study_plan_words",
            true,
            Some(&format!(
                "Created {} plan word associations for plan {}",
                word_ids.len(),
                plan_id
            )),
        );

        Ok(())
    }

    // ==================== 辅助方法 ====================

    /// 将数据库行转换为 StudyPlanWithProgress
    fn row_to_study_plan_with_progress(
        &self,
        row: sqlx::sqlite::SqliteRow,
    ) -> AppResult<StudyPlanWithProgress> {
        let _status: String = row.get("status");
        let unified_status: String = row.get("unified_status");

        let total_schedules: i64 = row.get("total_schedules");
        let completed_schedules: i64 = row.get("completed_schedules");

        let total_passages: i64 = row.get("total_passages");
        let completed_passages: i64 = row.get("completed_passages");
        // 练完的日程与完成的短文一起算进度
        let total = total_schedules + total_passages;
        let progress_percentage = if total > 0 {
            (completed_schedules + completed_passages) as f64 / total as f64 * 100.0
        } else {
            0.0
        };

        Ok(StudyPlanWithProgress {
            id: row.get("id"),
            name: row.get("name"),
            description: row.get("description"),
            status: row.get("status"),
            unified_status,
            total_words: row.get("total_words"),
            mastery_level: row.get("mastery_level"),
            intensity_level: row.get("intensity_level"),
            study_period_days: row.get("study_period_days"),
            review_frequency: row.get("review_frequency"),
            start_date: row.get("start_date"),
            end_date: row.get("end_date"),
            actual_start_date: row.get("actual_start_date"),
            actual_end_date: row.get("actual_end_date"),
            actual_terminated_date: row.get("actual_terminated_date"),
            ai_plan_data: row.get("ai_plan_data"),
            daily_new_words: row.get("daily_new_words"),
            deleted_at: row.get("deleted_at"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            progress_percentage,
            practice_content: row.get("practice_content"),
            passage_interval_days: row.get("passage_interval_days"),
            total_passages,
            completed_passages,
        })
    }
}

/// 一次状态转换要顺带写的列
#[derive(Debug, Clone, Copy, Default)]
pub struct StatusChange {
    /// 同步旧的 `status` 列（normal / draft / deleted）
    pub legacy_status: Option<&'static str>,
    pub set_actual_start: bool,
    pub set_actual_end: bool,
    pub set_actual_terminated: bool,
    /// 清空实际开始 / 结束 / 终止日期
    pub clear_actual_dates: bool,
    /// 软删除（写 deleted_at）
    pub soft_delete: bool,
}

/// 计划状态的中文名（错误提示用）
pub fn status_label(unified_status: &str) -> &'static str {
    match unified_status {
        "Draft" => "草稿",
        "Pending" => "待开始",
        "Active" => "进行中",
        "Paused" => "已暂停",
        "Completed" => "已完成",
        "Terminated" => "已终止",
        "Deleted" => "已删除",
        _ => "未知状态",
    }
}

impl StudyPlanRepository {
    /// 在调用方事务内做一次状态转换：读当前状态 → 校验 → 条件更新（防并发重复）→ 写状态历史。
    /// 返回转换前的状态。`action` 用于错误提示，如“开始”“完成”。
    #[allow(clippy::too_many_arguments)]
    pub async fn transition_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
        allowed_from: &[&str],
        to: &str,
        change: StatusChange,
        action: &str,
        reason: &str,
    ) -> AppResult<String> {
        let from: String = sqlx::query_scalar(
            "SELECT unified_status FROM study_plans WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(plan_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| AppError::NotFound("学习计划不存在，可能已被删除".to_string()))?;
        if !allowed_from.contains(&from.as_str()) {
            return Err(AppError::ValidationError(format!(
                "学习计划当前为「{}」，不能{}",
                status_label(&from),
                action
            )));
        }

        let mut sql =
            String::from("UPDATE study_plans SET unified_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        if let Some(legacy) = change.legacy_status {
            sql.push_str(&format!(", status = '{}'", legacy));
        }
        if change.clear_actual_dates {
            sql.push_str(
                ", actual_start_date = NULL, actual_end_date = NULL, actual_terminated_date = NULL",
            );
        }
        if change.set_actual_start {
            sql.push_str(", actual_start_date = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        }
        if change.set_actual_end {
            sql.push_str(", actual_end_date = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        }
        if change.set_actual_terminated {
            sql.push_str(", actual_terminated_date = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        }
        if change.soft_delete {
            sql.push_str(", deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        }
        sql.push_str(" WHERE id = ? AND unified_status = ? AND deleted_at IS NULL");
        let updated = sqlx::query(&sql)
            .bind(to)
            .bind(plan_id)
            .bind(&from)
            .execute(&mut *conn)
            .await?
            .rows_affected();
        if updated == 0 {
            return Err(AppError::ValidationError(
                "学习计划状态刚刚发生了变化，请刷新后重试".to_string(),
            ));
        }

        sqlx::query(
            "INSERT INTO study_plan_status_history (plan_id, from_status, to_status, reason, created_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(plan_id)
        .bind(&from)
        .bind(to)
        .bind(reason)
        .execute(&mut *conn)
        .await?;

        // INFO：自动开始 / 自动完成发生在练习、短文作答的事务里，只有这里能统一记下。
        // 所在事务回滚时状态不会保存，那次命令会以 API ... FAILED 记一条 ERROR。
        self.logger.info(
            "STUDY_PLAN",
            &format!(
                "计划 {} 状态 {} → {}：{}（随本次操作一起保存）",
                plan_id,
                status_label(&from),
                status_label(to),
                reason
            ),
        );
        Ok(from)
    }

    /// 清空计划的练习数据（会话及其作答、学习记录、计时记录），日程回到未开始；保留日程与单词
    pub async fn clear_practice_data_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
    ) -> AppResult<()> {
        for sql in [
            "DELETE FROM practice_sessions WHERE plan_id = ?",
            "DELETE FROM study_sessions WHERE plan_id = ?",
            "DELETE FROM study_timer_records WHERE plan_id = ?",
            "UPDATE study_plan_words SET learned = 0, correct_count = 0, total_attempts = 0, mastery_score = 0.0,
                 srs_box = 0, srs_due = NULL, srs_last = NULL, srs_lapses = 0, srs_reviews = 0 WHERE plan_id = ?",
            // 复习是按记忆等级动态生成的：重新学习时清掉，只留新词日
            "DELETE FROM study_plan_schedule_words WHERE is_review = TRUE AND schedule_id IN (SELECT id FROM study_plan_schedules WHERE plan_id = ?)",
            "DELETE FROM study_plan_schedules WHERE plan_id = ? AND NOT EXISTS (SELECT 1 FROM study_plan_schedule_words sw WHERE sw.schedule_id = study_plan_schedules.id)",
            "UPDATE study_plan_schedules SET
                 new_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words sw WHERE sw.schedule_id = study_plan_schedules.id AND sw.is_review = FALSE),
                 review_words_count = 0,
                 total_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words sw WHERE sw.schedule_id = study_plan_schedules.id)
             WHERE plan_id = ?",
            "UPDATE study_plan_schedules SET status = 'not-started', completed_words_count = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE plan_id = ?",
            // 短文：任务回到未完成；作答记录保留为自由练习（短文统计不受影响）
            "UPDATE study_plan_passages SET completed_at = NULL, attempt_id = NULL WHERE plan_id = ?",
            "UPDATE passage_attempts SET plan_id = NULL WHERE plan_id = ?",
        ] {
            sqlx::query(sql).bind(plan_id).execute(&mut *conn).await?;
        }
        Ok(())
    }

    /// 日程整体平移：第 1 天落在 `start_date`（本地日期 YYYY-MM-DD），同步计划的开始 / 结束日期
    pub async fn shift_schedules_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
        start_date: &str,
    ) -> AppResult<()> {
        // (plan_id, schedule_date) 唯一：逐行更新时新旧日期会撞车，先换成临时值再写真实日期
        sqlx::query(
            "UPDATE study_plan_schedules SET schedule_date = 'tmp-' || id WHERE plan_id = ?",
        )
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "UPDATE study_plan_schedules
             SET schedule_date = DATE(?1, '+' || (day_number - 1) || ' days'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE plan_id = ?2",
        )
        .bind(start_date)
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "UPDATE study_plans
             SET start_date = ?1,
                 end_date = COALESCE((SELECT MAX(schedule_date) FROM study_plan_schedules WHERE plan_id = ?2), end_date),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?2",
        )
        .bind(start_date)
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 计划的 AI 规划（ai_plan_data）里的日期同步平移到从 `start_date` 开始；解析不了时保持原样
    pub async fn shift_ai_plan_dates_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
        start_date: &str,
    ) -> AppResult<()> {
        let raw: Option<String> =
            sqlx::query_scalar("SELECT ai_plan_data FROM study_plans WHERE id = ?")
                .bind(plan_id)
                .fetch_optional(&mut *conn)
                .await?
                .flatten();
        let Some(raw) = raw else { return Ok(()) };
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            return Ok(());
        };
        if !shift_ai_plan_dates(&mut value, start_date) {
            return Ok(());
        }
        sqlx::query("UPDATE study_plans SET ai_plan_data = ? WHERE id = ?")
            .bind(value.to_string())
            .bind(plan_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    /// 从计划中移除单词（调用方事务内）：删除单词关联与日程里的这些词（作答记录随外键一起删除），
    /// 按剩余单词重算各日程的新学 / 复习 / 总数，删掉变空的日程，更新计划总词数。
    /// 返回移除的计划单词数与受影响（仍存在）的日程 id。
    pub async fn remove_words_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
        word_ids: &[Id],
    ) -> AppResult<(usize, Vec<Id>)> {
        let mut removed = 0usize;
        let mut affected: Vec<Id> = Vec::new();
        for word_id in word_ids {
            let schedules: Vec<Id> = sqlx::query_scalar(
                "SELECT DISTINCT sw.schedule_id FROM study_plan_schedule_words sw
                 JOIN study_plan_schedules s ON s.id = sw.schedule_id
                 WHERE s.plan_id = ? AND sw.word_id = ?",
            )
            .bind(plan_id)
            .bind(word_id)
            .fetch_all(&mut *conn)
            .await?;
            affected.extend(schedules);
            sqlx::query(
                "DELETE FROM study_plan_schedule_words
                 WHERE word_id = ? AND schedule_id IN (SELECT id FROM study_plan_schedules WHERE plan_id = ?)",
            )
            .bind(word_id)
            .bind(plan_id)
            .execute(&mut *conn)
            .await?;
            removed += sqlx::query("DELETE FROM study_plan_words WHERE plan_id = ? AND word_id = ?")
                .bind(plan_id)
                .bind(word_id)
                .execute(&mut *conn)
                .await?
                .rows_affected() as usize;
        }
        affected.sort_unstable();
        affected.dedup();

        let mut remaining = Vec::new();
        for schedule_id in affected {
            sqlx::query(
                "UPDATE study_plan_schedules SET
                    new_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words WHERE schedule_id = ?1 AND is_review = FALSE),
                    review_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words WHERE schedule_id = ?1 AND is_review = TRUE),
                    total_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words WHERE schedule_id = ?1),
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id = ?1",
            )
            .bind(schedule_id)
            .execute(&mut *conn)
            .await?;
            let left: i64 = sqlx::query_scalar(
                "SELECT total_words_count FROM study_plan_schedules WHERE id = ?",
            )
            .bind(schedule_id)
            .fetch_one(&mut *conn)
            .await?;
            if left == 0 {
                sqlx::query("DELETE FROM study_plan_schedules WHERE id = ?")
                    .bind(schedule_id)
                    .execute(&mut *conn)
                    .await?;
            } else {
                remaining.push(schedule_id);
            }
        }

        sqlx::query(
            "UPDATE study_plans SET total_words = (SELECT COUNT(*) FROM study_plan_words WHERE plan_id = ?1),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1",
        )
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;
        Ok((removed, remaining))
    }

    /// 还没练完的日程数（有单词、status != 'completed'）
    pub async fn count_unpracticed_schedules_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
    ) -> AppResult<i64> {
        Ok(sqlx::query_scalar(
            "SELECT COUNT(*) FROM study_plan_schedules
             WHERE plan_id = ? AND total_words_count > 0 AND COALESCE(status, '') != 'completed'",
        )
        .bind(plan_id)
        .fetch_one(&mut *conn)
        .await?)
    }

    /// 以规划元数据为准写入计划参数（周期、档位、结束日期、每天新词数），避免前端表单与日程不一致
    pub async fn apply_plan_metadata_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
        meta: &StudyPlanMetadata,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE study_plans
             SET intensity_level = ?, study_period_days = ?, review_frequency = ?,
                 end_date = ?, daily_new_words = ?
             WHERE id = ?",
        )
        .bind(&meta.intensity_level)
        .bind(meta.study_period_days)
        .bind(meta.review_frequency)
        .bind(&meta.end_date)
        .bind(meta.daily_new_words)
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 开始学习：日程（与 AI 规划日期）整体平移到从 `today` 开始。
    /// 提前开始、推迟开始都以实际开始的这一天为第 1 天。
    /// 已经练习过的计划（如编辑后重新发布）不平移：日程日期是练习记录的一部分，平移会打乱历史。
    pub async fn start_now_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
        today: chrono::NaiveDate,
    ) -> AppResult<()> {
        if self.has_practice_conn(conn, plan_id).await? {
            return Ok(());
        }
        let today_str = crate::time::format_date(today);
        let start: Option<String> =
            sqlx::query_scalar("SELECT start_date FROM study_plans WHERE id = ?")
                .bind(plan_id)
                .fetch_one(&mut *conn)
                .await?;
        if start.as_deref() == Some(today_str.as_str()) {
            return Ok(());
        }
        self.shift_schedules_conn(conn, plan_id, &today_str).await?;
        self.shift_ai_plan_dates_conn(conn, plan_id, &today_str)
            .await?;
        Ok(())
    }

    /// 最近一次进入暂停的本地日期（状态历史里最后一条 → Paused）
    pub async fn paused_since_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
    ) -> AppResult<Option<chrono::NaiveDate>> {
        let at: Option<String> = sqlx::query_scalar(
            "SELECT created_at FROM study_plan_status_history
             WHERE plan_id = ? AND to_status = 'Paused' ORDER BY id DESC LIMIT 1",
        )
        .bind(plan_id)
        .fetch_optional(&mut *conn)
        .await?;
        Ok(at.as_deref().and_then(crate::time::local_date_of))
    }

    /// 暂停结束后顺延 `days` 天：暂停开始当天及以后、还没练过的日程整体后移，
    /// 复习到期日在暂停开始当天及以后的也后移，计划结束日同步后移。
    /// 按日期从后往前移，目标日期被占用（如提前练过的日程）时再往后顺延，保证日期唯一。
    pub async fn postpone_after_pause_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
        paused_from: chrono::NaiveDate,
        days: i64,
    ) -> AppResult<()> {
        if days <= 0 {
            return Ok(());
        }
        let from = crate::time::format_date(paused_from);
        let rows: Vec<(i64, String)> = sqlx::query_as(
            "SELECT s.id, s.schedule_date FROM study_plan_schedules s
             WHERE s.plan_id = ?1 AND s.schedule_date >= ?2
               AND COALESCE(s.status, '') != 'completed'
               AND NOT EXISTS (SELECT 1 FROM practice_sessions ps WHERE ps.schedule_id = s.id)
             ORDER BY s.schedule_date DESC",
        )
        .bind(plan_id)
        .bind(&from)
        .fetch_all(&mut *conn)
        .await?;
        for (id, date) in rows {
            let Some(original) = crate::time::parse_date(&date) else {
                continue;
            };
            let mut target = original + chrono::Duration::days(days);
            loop {
                let taken: bool = sqlx::query_scalar(
                    "SELECT EXISTS (SELECT 1 FROM study_plan_schedules WHERE plan_id = ? AND schedule_date = ? AND id != ?)",
                )
                .bind(plan_id)
                .bind(crate::time::format_date(target))
                .bind(id)
                .fetch_one(&mut *conn)
                .await?;
                if !taken {
                    break;
                }
                target += chrono::Duration::days(1);
            }
            sqlx::query("UPDATE study_plan_schedules SET schedule_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
                .bind(crate::time::format_date(target))
                .bind(id)
                .execute(&mut *conn)
                .await?;
        }
        sqlx::query(
            "UPDATE study_plan_words SET srs_due = DATE(srs_due, '+' || ?1 || ' days')
             WHERE plan_id = ?2 AND srs_box >= 1 AND srs_due >= ?3",
        )
        .bind(days)
        .bind(plan_id)
        .bind(&from)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "UPDATE study_plans SET end_date = MAX(
                 COALESCE(DATE(end_date, '+' || ?1 || ' days'), ''),
                 COALESCE((SELECT MAX(schedule_date) FROM study_plan_schedules WHERE plan_id = ?2), '')
             ) WHERE id = ?2",
        )
        .bind(days)
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 用到某个单词的计划 id
    pub async fn plans_containing_word_conn(
        &self,
        conn: &mut SqliteConnection,
        word_id: Id,
    ) -> AppResult<Vec<Id>> {
        Ok(sqlx::query_scalar(
            "SELECT DISTINCT plan_id FROM study_plan_words WHERE word_id = ? ORDER BY plan_id",
        )
        .bind(word_id)
        .fetch_all(&mut *conn)
        .await?)
    }

    /// 计划里的单词数
    pub async fn find_plan_words_count_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
    ) -> AppResult<i64> {
        Ok(
            sqlx::query_scalar("SELECT COUNT(*) FROM study_plan_words WHERE plan_id = ?")
                .bind(plan_id)
                .fetch_one(&mut *conn)
                .await?,
        )
    }

    /// 计划是否有过练习（单词练习会话含未完成的、计划内的短文作答、读完的短文）
    pub async fn has_practice_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
    ) -> AppResult<bool> {
        Ok(
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM practice_sessions WHERE plan_id = ?1)
                     OR EXISTS(SELECT 1 FROM passage_attempts WHERE plan_id = ?1)
                     OR EXISTS(SELECT 1 FROM study_plan_passages WHERE plan_id = ?1 AND completed_at IS NOT NULL)",
            )
            .bind(plan_id)
                .fetch_one(&mut *conn)
                .await?,
        )
    }

    /// 计划的日程数（发布前校验）
    pub async fn count_schedules_conn(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
    ) -> AppResult<i64> {
        Ok(sqlx::query_scalar(
            "SELECT COUNT(*) FROM study_plan_schedules WHERE plan_id = ? AND total_words_count > 0",
        )
        .bind(plan_id)
        .fetch_one(&mut *conn)
        .await?)
    }
}

/// AI 规划 JSON 的日期平移：dailyPlans[i].date = start + (day - 1)，planMetadata 的起止日期同步。
/// 返回是否做了修改。
pub fn shift_ai_plan_dates(value: &mut serde_json::Value, start_date: &str) -> bool {
    let Ok(start) = chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d") else {
        return false;
    };
    let Some(days) = value.get_mut("dailyPlans").and_then(|v| v.as_array_mut()) else {
        return false;
    };
    let mut last = start;
    for (i, plan) in days.iter_mut().enumerate() {
        let day = plan
            .get("day")
            .and_then(|d| d.as_i64())
            .unwrap_or(i as i64 + 1);
        let date = start + chrono::Duration::days(day - 1);
        last = last.max(date);
        plan["date"] = serde_json::Value::String(date.format("%Y-%m-%d").to_string());
    }
    if let Some(meta) = value
        .get_mut("planMetadata")
        .and_then(|m| m.as_object_mut())
    {
        meta.insert("startDate".into(), start_date.into());
        meta.insert("endDate".into(), last.format("%Y-%m-%d").to_string().into());
    }
    true
}
