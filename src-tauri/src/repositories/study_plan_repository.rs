//! 学习计划数据访问层
//!
//! 提供 Repository 模式的数据访问封装
//!
//! 负责学习计划相关的所有数据库操作

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::common::Id;
use crate::types::study::*;
use sqlx::{Row, SqlitePool};
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

    /// 开始数据库事务
    pub async fn begin_transaction(
        &self,
    ) -> AppResult<sqlx::Transaction<'_, sqlx::Sqlite>> {
        self.pool
            .begin()
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("BEGIN", "transaction", false, Some(&e.to_string()));
                AppError::DatabaseError(format!("Failed to start transaction: {}", e))
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
                sp.ai_plan_data,
                sp.deleted_at,
                sp.created_at,
                sp.updated_at,
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
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
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
                sp.ai_plan_data, sp.deleted_at,
                sp.created_at, sp.updated_at,
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
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
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

    /// 查询学习计划基本信息（不带进度）
    pub async fn find_by_id(&self, id: Id) -> AppResult<Option<StudyPlan>> {
        let query = r#"
            SELECT
                id, name, description, status, unified_status,
                total_words, mastery_level, intensity_level,
                study_period_days, review_frequency,
                start_date, end_date,
                actual_start_date, actual_end_date, actual_terminated_date,
                ai_plan_data, deleted_at,
                created_at, updated_at
            FROM study_plans
            WHERE id = ? AND deleted_at IS NULL
        "#;

        let row = sqlx::query(query)
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
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
                Ok(Some(self.row_to_study_plan(row)?))
            }
            None => Ok(None),
        }
    }

    /// 查询学习计划状态
    pub async fn find_status(&self, id: Id) -> AppResult<Option<(String, String)>> {
        let query = r#"
            SELECT status, unified_status
            FROM study_plans
            WHERE id = ? AND deleted_at IS NULL
        "#;

        let row = sqlx::query(query)
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        match row {
            Some(row) => {
                let status: String = row.get("status");
                let unified_status: String = row.get("unified_status");
                Ok(Some((status, unified_status)))
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
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
            .bind(plan.intensity_level.as_ref().map(|s| s.as_str()))
            .bind(plan.study_period_days)
            .bind(plan.review_frequency)
            .bind(&plan.start_date)
            .bind(&plan.end_date)
            .bind(&plan.ai_plan_data)
            .execute(&mut **tx)
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("INSERT", "study_plans", false, Some(&e.to_string()));
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

    /// 创建学习计划
    pub async fn create(&self, plan: &StudyPlan) -> AppResult<Id> {
        let query = r#"
            INSERT INTO study_plans (
                name, description, status, unified_status,
                total_words, mastery_level, intensity_level,
                study_period_days, review_frequency,
                start_date, end_date,
                ai_plan_data,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
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
            .bind(plan.intensity_level.as_ref().map(|s| s.as_str()))
            .bind(plan.study_period_days)
            .bind(plan.review_frequency)
            .bind(&plan.start_date)
            .bind(&plan.end_date)
            .bind(&plan.ai_plan_data)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("INSERT", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let id = result.last_insert_rowid();
        self.logger.database_operation(
            "INSERT",
            "study_plans",
            true,
            Some(&format!("Created study plan {}", id)),
        );

        Ok(id)
    }

    /// 更新学习计划
    pub async fn update(&self, id: Id, plan: &StudyPlan) -> AppResult<()> {
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

        let query = r#"
            UPDATE study_plans SET
                name = ?,
                description = ?,
                status = ?,
                unified_status = ?,
                total_words = ?,
                mastery_level = ?,
                intensity_level = ?,
                study_period_days = ?,
                review_frequency = ?,
                start_date = ?,
                end_date = ?,
                actual_start_date = ?,
                actual_end_date = ?,
                actual_terminated_date = ?,
                ai_plan_data = ?,
                updated_at = datetime('now')
            WHERE id = ?
        "#;

        let result = sqlx::query(query)
            .bind(&plan.name)
            .bind(&plan.description)
            .bind(&plan.status)
            .bind(unified_status_str)
            .bind(plan.total_words)
            .bind(plan.mastery_level)
            .bind(plan.intensity_level.as_ref().map(|s| s.as_str()))
            .bind(plan.study_period_days)
            .bind(plan.review_frequency)
            .bind(&plan.start_date)
            .bind(&plan.end_date)
            .bind(&plan.actual_start_date)
            .bind(&plan.actual_end_date)
            .bind(&plan.actual_terminated_date)
            .bind(&plan.ai_plan_data)
            .bind(id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("学习计划 {} 不存在", id)));
        }

        self.logger.database_operation(
            "UPDATE",
            "study_plans",
            true,
            Some(&format!("Updated study plan {}", id)),
        );

        Ok(())
    }

    /// 更新学习计划状态
    pub async fn update_status(
        &self,
        id: Id,
        unified_status: &str,
        set_actual_start_date: bool,
        set_actual_end_date: bool,
        set_actual_terminated_date: bool,
    ) -> AppResult<()> {
        let mut query = String::from(
            "UPDATE study_plans SET unified_status = ?, updated_at = datetime('now')",
        );

        if set_actual_start_date {
            query.push_str(", actual_start_date = datetime('now')");
        }
        if set_actual_end_date {
            query.push_str(", actual_end_date = datetime('now')");
        }
        if set_actual_terminated_date {
            query.push_str(", actual_terminated_date = datetime('now')");
        }

        query.push_str(" WHERE id = ?");

        let result = sqlx::query(&query)
            .bind(unified_status)
            .bind(id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("学习计划 {} 不存在", id)));
        }

        self.logger.database_operation(
            "UPDATE",
            "study_plans",
            true,
            Some(&format!("Updated study plan {} status to {}", id, unified_status)),
        );

        Ok(())
    }

    /// 软删除学习计划
    pub async fn delete(&self, id: Id) -> AppResult<()> {
        let query = r#"
            UPDATE study_plans
            SET status = 'deleted',
                unified_status = 'Deleted',
                deleted_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
        "#;

        let result = sqlx::query(query)
            .bind(id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("学习计划 {} 不存在", id)));
        }

        self.logger.database_operation(
            "UPDATE",
            "study_plans",
            true,
            Some(&format!("Deleted study plan {}", id)),
        );

        Ok(())
    }

    /// 添加状态变更历史
    pub async fn add_status_history(
        &self,
        plan_id: Id,
        from_status: &str,
        to_status: &str,
        reason: &str,
    ) -> AppResult<()> {
        let query = r#"
            INSERT INTO study_plan_status_history
            (plan_id, from_status, to_status, reason)
            VALUES (?, ?, ?, ?)
        "#;

        sqlx::query(query)
            .bind(plan_id)
            .bind(from_status)
            .bind(to_status)
            .bind(reason)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "INSERT",
                    "study_plan_status_history",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        self.logger.database_operation(
            "INSERT",
            "study_plan_status_history",
            true,
            Some(&format!(
                "Added status history for plan {}: {} -> {}",
                plan_id, from_status, to_status
            )),
        );

        Ok(())
    }

    /// 查询状态变更历史
    pub async fn find_status_history(&self, plan_id: Id) -> AppResult<Vec<StudyPlanStatusHistory>> {
        let query = r#"
            SELECT id, plan_id, from_status, to_status, reason, created_at
            FROM study_plan_status_history
            WHERE plan_id = ?
            ORDER BY created_at DESC
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
                #[allow(deprecated)]
                from_lifecycle_status: None,
                #[allow(deprecated)]
                to_lifecycle_status: String::new(),
                changed_at: row.get("created_at"),
                reason: row.get("reason"),
            })
            .collect();

        self.logger.database_operation(
            "SELECT",
            "study_plan_status_history",
            true,
            Some(&format!("Found {} history records for plan {}", history.len(), plan_id)),
        );

        Ok(history)
    }

    /// 重置学习计划（清空所有相关数据）
    pub async fn reset_plan_data(&self, plan_id: Id) -> AppResult<()> {
        // 使用事务
        let mut tx = self.pool.begin().await.map_err(|e| {
            self.logger
                .database_operation("BEGIN", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        })?;

        // 清空学习日程
        sqlx::query("DELETE FROM study_plan_schedules WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;

        // 清空学习记录
        sqlx::query("DELETE FROM study_sessions WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;

        // 清空练习会话记录
        sqlx::query("DELETE FROM practice_sessions WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;

        // 清空学习计时器记录
        sqlx::query("DELETE FROM study_timer_records WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;

        // 重置学习进度
        sqlx::query("UPDATE study_plan_words SET learned = 0 WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await.map_err(|e| {
            self.logger
                .database_operation("COMMIT", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        })?;

        self.logger.database_operation(
            "DELETE/UPDATE",
            "plan_data",
            true,
            Some(&format!("Reset all data for plan {}", plan_id)),
        );

        Ok(())
    }

    /// 重置学习计划进度（保留单词关联）
    pub async fn reset_plan_progress(&self, plan_id: Id) -> AppResult<()> {
        // 使用事务
        let mut tx = self.pool.begin().await.map_err(|e| {
            self.logger
                .database_operation("BEGIN", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        })?;

        // 清空学习日程
        sqlx::query("DELETE FROM study_plan_schedules WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;

        // 清空学习记录
        sqlx::query("DELETE FROM study_sessions WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;

        // 清空练习会话记录
        sqlx::query("DELETE FROM practice_sessions WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;

        // 清空学习计时器记录
        sqlx::query("DELETE FROM study_timer_records WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;

        // 重置学习进度字段（保留单词关联）
        sqlx::query("UPDATE study_plan_words SET learned = 0, correct_count = 0, total_attempts = 0, mastery_score = 0.0 WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await.map_err(|e| {
            self.logger
                .database_operation("COMMIT", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        })?;

        self.logger.database_operation(
            "UPDATE",
            "plan_progress",
            true,
            Some(&format!("Reset progress for plan {}", plan_id)),
        );

        Ok(())
    }

    /// 更新状态并清空实际日期
    pub async fn update_status_and_clear_dates(
        &self,
        id: Id,
        unified_status: &str,
    ) -> AppResult<()> {
        let query = r#"
            UPDATE study_plans
            SET unified_status = ?,
                actual_start_date = NULL,
                actual_end_date = NULL,
                actual_terminated_date = NULL,
                updated_at = datetime('now')
            WHERE id = ?
        "#;

        let result = sqlx::query(query)
            .bind(unified_status)
            .bind(id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("学习计划 {} 不存在", id)));
        }

        self.logger.database_operation(
            "UPDATE",
            "study_plans",
            true,
            Some(&format!("Updated study plan {} status to {} and cleared dates", id, unified_status)),
        );

        Ok(())
    }

    /// 更新状态（发布）
    pub async fn update_status_for_publish(&self, id: Id) -> AppResult<()> {
        let query = r#"
            UPDATE study_plans
            SET status = 'normal',
                unified_status = 'Pending',
                updated_at = datetime('now')
            WHERE id = ?
        "#;

        let result = sqlx::query(query)
            .bind(id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("学习计划 {} 不存在", id)));
        }

        self.logger.database_operation(
            "UPDATE",
            "study_plans",
            true,
            Some(&format!("Published study plan {}", id)),
        );

        Ok(())
    }

    /// 部分更新学习计划（动态字段）
    pub async fn partial_update(
        &self,
        id: Id,
        name: Option<&str>,
        description: Option<&str>,
        status: Option<&str>,
        unified_status: Option<&str>,
        intensity_level: Option<&str>,
        review_frequency: Option<i32>,
    ) -> AppResult<()> {
        // 如果只更新状态，使用简化方法
        if status.is_some() && name.is_none() && description.is_none() && intensity_level.is_none() && review_frequency.is_none() {
            let unified_status_str = unified_status.unwrap_or_else(|| {
                match status.unwrap() {
                    "draft" => "Draft",
                    "normal" => "Pending",
                    _ => "Draft",
                }
            });
            
            let query = "UPDATE study_plans SET status = ?, unified_status = ?, updated_at = datetime('now') WHERE id = ?";
            let result = sqlx::query(query)
                .bind(status.unwrap())
                .bind(unified_status_str)
                .bind(id)
                .execute(self.pool.as_ref())
                .await
                .map_err(|e| {
                    self.logger.database_operation("UPDATE", "study_plans", false, Some(&e.to_string()));
                    AppError::DatabaseError(e.to_string())
                })?;

            if result.rows_affected() == 0 {
                return Err(AppError::NotFound(format!("学习计划 {} 不存在", id)));
            }

            self.logger.database_operation(
                "UPDATE",
                "study_plans",
                true,
                Some(&format!("Updated study plan {} status", id)),
            );

            return Ok(());
        }

        // 对于其他字段，需要先获取现有数据，然后更新
        let existing = self.find_by_id(id).await?
            .ok_or_else(|| AppError::NotFound(format!("学习计划 {} 不存在", id)))?;

        let mut updated = existing.clone();
        if let Some(name) = name {
            updated.name = name.to_string();
        }
        if let Some(description) = description {
            updated.description = description.to_string();
        }
        if let Some(status) = status {
            updated.status = status.to_string();
        }
        if let Some(unified_status) = unified_status {
            updated.unified_status = match unified_status {
                "Draft" => Some(UnifiedStudyPlanStatus::Draft),
                "Pending" => Some(UnifiedStudyPlanStatus::Pending),
                "Active" => Some(UnifiedStudyPlanStatus::Active),
                "Paused" => Some(UnifiedStudyPlanStatus::Paused),
                "Completed" => Some(UnifiedStudyPlanStatus::Completed),
                "Terminated" => Some(UnifiedStudyPlanStatus::Terminated),
                "Deleted" => Some(UnifiedStudyPlanStatus::Deleted),
                _ => None,
            };
        }
        if let Some(intensity_level) = intensity_level {
            updated.intensity_level = Some(intensity_level.to_string());
        }
        if let Some(review_frequency) = review_frequency {
            updated.review_frequency = Some(review_frequency);
        }

        self.update(id, &updated).await
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
                w.word_book_id as wordbook_id
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
                self.logger
                    .database_operation("SELECT", "study_plan_words", false, Some(&e.to_string()));
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
    pub async fn find_plan_schedules(&self, plan_id: Id) -> AppResult<Vec<serde_json::Value>> {
        // 验证学习计划是否存在
        let plan_exists = sqlx::query("SELECT id FROM study_plans WHERE id = ?")
            .bind(plan_id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if plan_exists.is_none() {
            return Err(AppError::ValidationError("学习计划不存在".to_string()));
        }

        let schedules = sqlx::query(
            "SELECT sps.id, sps.schedule_date,
                    COUNT(spsw.id) as word_count,
                    CASE WHEN COUNT(ps.id) > 0 AND ps.completed = 1 THEN 1 ELSE 0 END as completed
             FROM study_plan_schedules sps
             LEFT JOIN study_plan_schedule_words spsw ON sps.id = spsw.schedule_id
             LEFT JOIN practice_sessions ps ON sps.id = ps.schedule_id AND ps.completed = 1
             WHERE sps.plan_id = ?
             GROUP BY sps.id, sps.schedule_date
             ORDER BY sps.schedule_date ASC",
        )
        .bind(plan_id)
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(|e| {
            self.logger
                .database_operation("SELECT", "study_plan_schedules", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        })?;

        let result: Vec<serde_json::Value> = schedules
            .into_iter()
            .map(|row| {
                serde_json::json!({
                    "id": row.get::<i64, _>("id"),
                    "schedule_date": row.get::<String, _>("schedule_date"),
                    "word_count": row.get::<i64, _>("word_count"),
                    "completed": row.get::<i64, _>("completed") == 1
                })
            })
            .collect();

        self.logger.database_operation(
            "SELECT",
            "study_plan_schedules",
            true,
            Some(&format!("Found {} schedules for plan {}", result.len(), plan_id)),
        );

        Ok(result)
    }

    /// 查询关联到指定单词本的学习计划
    pub async fn find_linked_plans_by_wordbook(&self, wordbook_id: Id) -> AppResult<Vec<StudyPlanWithProgress>> {
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
                sp.ai_plan_data,
                sp.deleted_at,
                sp.created_at,
                sp.updated_at,
                CASE
                    WHEN sp.total_words > 0 THEN
                        COALESCE(
                            (SELECT COUNT(*) * 100.0 / sp.total_words
                             FROM study_plan_words spw2
                             WHERE spw2.plan_id = sp.id AND spw2.learned = 1),
                            0.0
                        )
                    ELSE 0.0
                END as progress_percentage
            FROM study_plans sp
            WHERE sp.id IN (
                SELECT DISTINCT spw.plan_id
                FROM study_plan_words spw
                JOIN words w ON spw.word_id = w.id
                WHERE w.word_book_id = ?
            )
            AND sp.deleted_at IS NULL
            AND sp.status = 'normal'
            ORDER BY sp.created_at DESC
        "#;

        let rows = sqlx::query(query)
            .bind(wordbook_id)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
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
            Some(&format!("Found {} linked plans for wordbook {}", plans.len(), wordbook_id)),
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
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
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

    /// 删除学习计划中的单词
    pub async fn remove_word_from_plan(&self, plan_id: Id, word_id: Id) -> AppResult<()> {
        let query = r#"
            DELETE FROM study_plan_words
            WHERE plan_id = ? AND word_id = ?
        "#;

        let result = sqlx::query(query)
            .bind(plan_id)
            .bind(word_id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("DELETE", "study_plan_words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!(
                "Word {} not found in plan {}",
                word_id, plan_id
            )));
        }

        self.logger.database_operation(
            "DELETE",
            "study_plan_words",
            true,
            Some(&format!("Removed word {} from plan {}", word_id, plan_id)),
        );

        Ok(())
    }

    /// 批量删除学习计划中的单词
    pub async fn batch_remove_words_from_plan(
        &self,
        plan_id: Id,
        word_ids: &[Id],
    ) -> AppResult<usize> {
        if word_ids.is_empty() {
            return Ok(0);
        }

        let placeholders: Vec<String> = (0..word_ids.len()).map(|_| "?".to_string()).collect();
        let query = format!(
            "DELETE FROM study_plan_words WHERE plan_id = ? AND word_id IN ({})",
            placeholders.join(",")
        );

        let mut query_builder = sqlx::query(&query).bind(plan_id);
        for word_id in word_ids {
            query_builder = query_builder.bind(word_id);
        }

        let result = query_builder
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("DELETE", "study_plan_words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let deleted_count = result.rows_affected() as usize;
        self.logger.database_operation(
            "DELETE",
            "study_plan_words",
            true,
            Some(&format!(
                "Removed {} words from plan {}",
                deleted_count, plan_id
            )),
        );

        Ok(deleted_count)
    }

    /// 创建学习计划单词关联
    pub async fn create_plan_words(&self, plan_id: Id, word_ids: &[Id]) -> AppResult<()> {
        if word_ids.is_empty() {
            return Ok(());
        }

        let query = r#"
            INSERT INTO study_plan_words (
                word_id,
                plan_id,
                learned,
                correct_count,
                total_attempts,
                mastery_score,
                last_studied,
                next_review
            ) VALUES (?, ?, false, 0, 0, 0.0, NULL, NULL)
        "#;

        for word_id in word_ids {
            sqlx::query(query)
                .bind(word_id)
                .bind(plan_id)
                .execute(self.pool.as_ref())
                .await
                .map_err(|e| {
                    self.logger.database_operation(
                        "INSERT",
                        "study_plan_words",
                        false,
                        Some(&format!("Failed to create plan word: {}", e)),
                    );
                    AppError::DatabaseError(format!(
                        "Failed to create progress record for word {}: {}",
                        word_id, e
                    ))
                })?;
        }

        self.logger.database_operation(
            "INSERT",
            "study_plan_words",
            true,
            Some(&format!(
                "Created {} progress records for plan {}",
                word_ids.len(),
                plan_id
            )),
        );

        Ok(())
    }

    // ==================== 辅助方法 ====================

    /// 将数据库行转换为 StudyPlanWithProgress
    fn row_to_study_plan_with_progress(&self, row: sqlx::sqlite::SqliteRow) -> AppResult<StudyPlanWithProgress> {
        let _status: String = row.get("status");
        let unified_status: String = row.get("unified_status");

        let total_schedules: i64 = row.get("total_schedules");
        let completed_schedules: i64 = row.get("completed_schedules");

        let progress_percentage = if total_schedules > 0 {
            completed_schedules as f64 / total_schedules as f64 * 100.0
        } else {
            0.0
        };

        #[allow(deprecated)]
        Ok(StudyPlanWithProgress {
            id: row.get("id"),
            name: row.get("name"),
            description: row.get("description"),
            status: row.get("status"),
            lifecycle_status: String::new(), // 已废弃字段，保留用于兼容
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
            deleted_at: row.get("deleted_at"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            progress_percentage,
        })
    }

    /// 将数据库行转换为 StudyPlan
    fn row_to_study_plan(&self, row: sqlx::sqlite::SqliteRow) -> AppResult<StudyPlan> {
        let unified_status: Option<String> = row.get("unified_status");
        let unified_status_enum = unified_status.and_then(|s| {
            match s.as_str() {
                "Draft" => Some(UnifiedStudyPlanStatus::Draft),
                "Pending" => Some(UnifiedStudyPlanStatus::Pending),
                "Active" => Some(UnifiedStudyPlanStatus::Active),
                "Paused" => Some(UnifiedStudyPlanStatus::Paused),
                "Completed" => Some(UnifiedStudyPlanStatus::Completed),
                "Terminated" => Some(UnifiedStudyPlanStatus::Terminated),
                "Deleted" => Some(UnifiedStudyPlanStatus::Deleted),
                _ => None,
            }
        });

        Ok(StudyPlan {
            id: row.get("id"),
            name: row.get("name"),
            description: row.get("description"),
            status: row.get("status"),
            unified_status: unified_status_enum,
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
            deleted_at: row.get("deleted_at"),
            total_schedules: None,
            completed_schedules: None,
            overdue_schedules: None,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }
}
