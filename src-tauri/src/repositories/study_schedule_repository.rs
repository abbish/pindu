//! 学习日程数据访问层
//!
//! 提供 Repository 模式的数据访问封装



use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::{common::Id, study::*};
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

/// 学习日程仓储
///
/// 负责学习日程的数据访问逻辑,封装所有数据库操作
pub struct StudyScheduleRepository {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl StudyScheduleRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    // ==================== 学习日程基本操作 ====================

    /// 查找单个日程
    pub async fn find_by_id(&self, id: Id) -> AppResult<Option<StudyPlanSchedule>> {
        let query = r#"
            SELECT
                id, plan_id, day_number, schedule_date,
                new_words_count, review_words_count, total_words_count,
                completed_words_count, status,
                created_at, updated_at
            FROM study_plan_schedules
            WHERE id = ?
        "#;

        let row = sqlx::query(query)
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await?;

        match row {
            Some(row) => {
                let status_str: Option<String> = row.get("status");

                let schedule = StudyPlanSchedule {
                    id: row.get("id"),
                    plan_id: row.get("plan_id"),
                    day: row.get("day_number"),  // 从 day_number 映射
                    schedule_date: row.get("schedule_date"),
                    new_words_count: row.get("new_words_count"),
                    review_words_count: row.get("review_words_count"),
                    total_words_count: row.get("total_words_count"),
                    completed_words_count: row.get("completed_words_count"),
                    // 不存在的字段使用默认值
                    progress_percentage: None,
                    study_time_minutes: None,
                    status: status_str.and_then(|s| match s.as_str() {
                        "not-started" => Some(ScheduleStatus::NotStarted),
                        "in-progress" => Some(ScheduleStatus::InProgress),
                        "completed" => Some(ScheduleStatus::Completed),
                        "overdue" => Some(ScheduleStatus::Overdue),
                        _ => None,
                    }),
                    completed: false,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                };
                Ok(Some(schedule))
            }
            None => Ok(None),
        }
    }


    // ==================== 学习日程单词关联 ====================

    /// 查找日程的单词
    pub async fn find_schedule_words(&self, schedule_id: Id) -> AppResult<Vec<ScheduleWordInfo>> {
        let query = r#"
            SELECT
                spsw.id as plan_word_id, spsw.word_id,
                w.word, w.meaning, w.description, w.ipa,
                w.syllables, w.phonics_segments
            FROM study_plan_schedule_words spsw
            JOIN words w ON spsw.word_id = w.id
            WHERE spsw.schedule_id = ?
            ORDER BY spsw.id
        "#;

        let rows = sqlx::query(query)
            .bind(schedule_id)
            .fetch_all(self.pool.as_ref())
            .await?;

        let words = rows
            .iter()
            .map(|row| ScheduleWordInfo {
                plan_word_id: row.get("plan_word_id"),
                word_id: row.get("word_id"),
                word: row.get("word"),
                meaning: row.get("meaning"),
                description: row.get("description"),
                ipa: row.get("ipa"),
                syllables: row.get("syllables"),
                phonics_segments: row.get("phonics_segments"),
            })
            .collect();

        Ok(words)
    }

    /// 删除学习计划中单词的所有日程安排
    pub async fn delete_schedule_words_by_word_and_plan(
        &self,
        word_id: Id,
        plan_id: Id,
    ) -> AppResult<usize> {
        let query = r#"
            DELETE FROM study_plan_schedule_words
            WHERE word_id = ?
            AND schedule_id IN (
                SELECT id FROM study_plan_schedules WHERE plan_id = ?
            )
        "#;

        let result = sqlx::query(query)
            .bind(word_id)
            .bind(plan_id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "DELETE",
                    "study_plan_schedule_words",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        let deleted_count = result.rows_affected() as usize;
        self.logger.database_operation(
            "DELETE",
            "study_plan_schedule_words",
            true,
            Some(&format!(
                "Deleted {} schedule words for word {} in plan {}",
                deleted_count, word_id, plan_id
            )),
        );

        Ok(deleted_count)
    }

    /// 查询学习计划在日期范围内的日程数据
    pub async fn find_schedules_by_date_range(
        &self,
        plan_id: Id,
        start_date: &str,
        end_date: &str,
    ) -> AppResult<Vec<(String, i32, i32, i32, i32)>> {
        let query = r#"
            SELECT
                sps.schedule_date,
                sps.total_words_count as total_words,
                sps.new_words_count as new_words,
                sps.review_words_count as review_words,
                sps.completed_words_count as completed_words
            FROM study_plan_schedules sps
            WHERE sps.plan_id = ?
                AND sps.schedule_date BETWEEN ? AND ?
            ORDER BY sps.schedule_date
        "#;

        let rows = sqlx::query(query)
            .bind(plan_id)
            .bind(start_date)
            .bind(end_date)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "study_plan_schedules", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let schedules: Vec<(String, i32, i32, i32, i32)> = rows
            .into_iter()
            .map(|row| {
                (
                    row.get("schedule_date"),
                    row.get("total_words"),
                    row.get("new_words"),
                    row.get("review_words"),
                    row.get("completed_words"),
                )
            })
            .collect();

        self.logger.database_operation(
            "SELECT",
            "study_plan_schedules",
            true,
            Some(&format!("Found {} schedules for plan {}", schedules.len(), plan_id)),
        );

        Ok(schedules)
    }

    /// 批量创建学习计划日程
    pub async fn create_schedule_batch(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        plan_id: Id,
        daily_plans: &[crate::types::study::DailyStudyPlan],
    ) -> AppResult<Vec<Id>> {
        let mut schedule_ids = Vec::new();

        for daily_plan in daily_plans {
            let new_words_count = daily_plan.words.iter().filter(|w| !w.is_review).count() as i32;
            let review_words_count = daily_plan.words.iter().filter(|w| w.is_review).count() as i32;
            let total_words_count = daily_plan.words.len() as i32;

            let query = r#"
                INSERT INTO study_plan_schedules (
                    plan_id, day_number, schedule_date,
                    new_words_count, review_words_count, total_words_count, completed_words_count, status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, 'not-started', datetime('now'), datetime('now'))
            "#;

            let result = sqlx::query(query)
                .bind(plan_id)
                .bind(daily_plan.day)
                .bind(&daily_plan.date)
                .bind(new_words_count)
                .bind(review_words_count)
                .bind(total_words_count)
                .execute(&mut **tx)
                .await
                .map_err(|e| {
                    self.logger.database_operation(
                        "INSERT",
                        "study_plan_schedules",
                        false,
                        Some(&format!("Failed to create schedule for day {}: {}", daily_plan.day, e)),
                    );
                    AppError::DatabaseError(format!(
                        "Failed to create schedule for day {}: {}",
                        daily_plan.day, e
                    ))
                })?;

            schedule_ids.push(result.last_insert_rowid());
        }

        self.logger.database_operation(
            "INSERT",
            "study_plan_schedules",
            true,
            Some(&format!("Created {} schedules", schedule_ids.len())),
        );

        Ok(schedule_ids)
    }

    /// 批量创建日程单词
    pub async fn create_schedule_words_batch(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        schedule_id: Id,
        words: &[crate::types::study::DailyStudyWord],
    ) -> AppResult<()> {
        let query = r#"
            INSERT INTO study_plan_schedule_words (
                schedule_id, word_id, wordbook_id, is_review, review_count,
                priority, difficulty_level, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        "#;

        for word in words {
            let word_id: i64 = word.word_id.parse().map_err(|e| {
                AppError::ValidationError(format!("Invalid word_id format: {}", e))
            })?;

            let wordbook_id: i64 = word.wordbook_id.parse().map_err(|e| {
                AppError::ValidationError(format!("Invalid wordbook_id format: {}", e))
            })?;

            sqlx::query(query)
                .bind(schedule_id)
                .bind(word_id)
                .bind(wordbook_id)
                .bind(word.is_review)
                .bind(word.review_count)
                .bind(&word.priority)
                .bind(word.difficulty_level)
                .execute(&mut **tx)
                .await
                .map_err(|e| {
                    self.logger.database_operation(
                        "INSERT",
                        "study_plan_schedule_words",
                        false,
                        Some(&format!(
                            "Failed to create schedule word: schedule_id={}, word_id={}, error={}",
                            schedule_id, word_id, e
                        )),
                    );
                    AppError::DatabaseError(format!(
                        "Failed to create schedule word: {}. Details: schedule_id={}, word_id={}, wordbook_id={}, word={}, is_review={}, review_count={:?}, priority={}, difficulty_level={}",
                        e, schedule_id, word_id, wordbook_id, word.word, word.is_review, word.review_count, word.priority, word.difficulty_level
                    ))
                })?;
        }

        self.logger.database_operation(
            "INSERT",
            "study_plan_schedule_words",
            true,
            Some(&format!("Created {} schedule words for schedule {}", words.len(), schedule_id)),
        );

        Ok(())
    }

}

// ==================== 辅助类型定义 ====================

/// 日程单词信息
#[derive(Debug, Clone)]
pub struct ScheduleWordInfo {
    pub plan_word_id: i64,
    pub word_id: i64,
    pub word: String,
    pub meaning: String,
    pub description: Option<String>,
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    pub phonics_segments: Option<String>,
}

