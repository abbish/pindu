//! 诊断数据访问层
//!
//! 提供诊断相关的数据访问封装

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

/// 诊断仓储
///
/// 负责诊断相关的数据访问逻辑
pub struct DiagnosticsRepository {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl DiagnosticsRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 诊断今日学习计划
    pub async fn diagnose_today_schedules(&self) -> AppResult<String> {
        let today = chrono::Local::now().date_naive();
        let today_str = today.format("%Y-%m-%d").to_string();

        let mut diagnosis = Vec::new();
        diagnosis.push(format!("=== 今日学习计划诊断 (日期: {}) ===", today_str));

        // 1. 检查所有学习计划
        let plans_query = "SELECT id, name, status, unified_status, start_date, end_date FROM study_plans WHERE deleted_at IS NULL";
        let plans = sqlx::query(plans_query)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        diagnosis.push(format!("\n1. 所有学习计划 ({} 个):", plans.len()));
        for plan in &plans {
            let id: i64 = plan.get("id");
            let name: String = plan.get("name");
            let status: String = plan.get("status");
            let unified_status: String = plan.get("unified_status");
            let start_date: Option<String> = plan.get("start_date");
            let end_date: Option<String> = plan.get("end_date");

            diagnosis.push(format!(
                "  - 计划 {} ({}): status={}, unified_status={}, start_date={:?}, end_date={:?}",
                id, name, status, unified_status, start_date, end_date
            ));
        }

        // 2. 检查今日的日程记录
        let schedules_query = "SELECT sps.id, sps.plan_id, sps.schedule_date, sp.name, sp.unified_status FROM study_plan_schedules sps JOIN study_plans sp ON sps.plan_id = sp.id WHERE sps.schedule_date = ?";
        let schedules = sqlx::query(schedules_query)
            .bind(&today_str)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "study_plan_schedules", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        diagnosis.push(format!("\n2. 今日日程记录 ({} 个):", schedules.len()));
        for schedule in &schedules {
            let schedule_id: i64 = schedule.get("id");
            let plan_id: i64 = schedule.get("plan_id");
            let plan_name: String = schedule.get("name");
            let unified_status: String = schedule.get("unified_status");

            diagnosis.push(format!(
                "  - 日程 {} (计划 {} - {}): unified_status={}",
                schedule_id, plan_id, plan_name, unified_status
            ));
        }

        // 3. 检查符合条件的学习计划
        let filtered_query = r#"
            SELECT sp.id, sp.name, sp.unified_status, COUNT(sps.id) as schedule_count
            FROM study_plans sp
            LEFT JOIN study_plan_schedules sps ON sp.id = sps.plan_id AND sps.schedule_date = ?
            WHERE sp.deleted_at IS NULL
            GROUP BY sp.id, sp.name, sp.unified_status
        "#;
        let filtered = sqlx::query(filtered_query)
            .bind(&today_str)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        diagnosis.push(format!("\n3. 学习计划与今日日程匹配情况:"));
        for row in &filtered {
            let id: i64 = row.get("id");
            let name: String = row.get("name");
            let unified_status: String = row.get("unified_status");
            let schedule_count: i64 = row.get("schedule_count");

            let status_match = matches!(unified_status.as_str(), "Pending" | "Active" | "Paused");

            diagnosis.push(format!(
                "  - 计划 {} ({}): unified_status={}, 今日日程数={}, 状态匹配={}",
                id, name, unified_status, schedule_count, status_match
            ));
        }

        // 4. 检查包含特定关键词的学习计划详细信息
        let isaac_query = r#"
            SELECT sp.*,
                   COUNT(sps.id) as total_schedules,
                   COUNT(CASE WHEN sps.schedule_date = ? THEN 1 END) as today_schedules
            FROM study_plans sp
            LEFT JOIN study_plan_schedules sps ON sp.id = sps.plan_id
            WHERE sp.name LIKE '%Issac%' AND sp.deleted_at IS NULL
            GROUP BY sp.id
        "#;
        let isaac_plans = sqlx::query(isaac_query)
            .bind(&today_str)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if !isaac_plans.is_empty() {
            diagnosis.push(format!("\n4. 包含 'Issac' 的学习计划 ({} 个):", isaac_plans.len()));
            for plan in &isaac_plans {
                let id: i64 = plan.get("id");
                let name: String = plan.get("name");
                let unified_status: String = plan.get("unified_status");
                let total_schedules: i64 = plan.get("total_schedules");
                let today_schedules: i64 = plan.get("today_schedules");

                diagnosis.push(format!(
                    "  - 计划 {} ({}): unified_status={}, 总日程数={}, 今日日程数={}",
                    id, name, unified_status, total_schedules, today_schedules
                ));
            }
        }

        self.logger.database_operation(
            "SELECT",
            "diagnostics",
            true,
            Some("Diagnosed today schedules"),
        );

        Ok(diagnosis.join("\n"))
    }
}
