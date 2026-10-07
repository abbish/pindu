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

    /// 按名称模糊匹配学习计划，汇总状态、AI 数据、已学单词、日程与单词关联数量
    pub async fn diagnose_study_plan_data(&self, plan_name: &str) -> AppResult<serde_json::Value> {
        let mut diagnosis = serde_json::Map::new();

        // 检查学习计划基本信息
        let plan_query = "SELECT id, name, status, unified_status, ai_plan_data, total_words FROM study_plans WHERE name LIKE ?";
        let plan_rows = sqlx::query(plan_query)
            .bind(format!("%{}%", plan_name))
            .fetch_all(self.pool.as_ref())
            .await?;

        let mut plans_info = Vec::new();
        for row in plan_rows {
            let plan_id: i64 = row.get("id");
            let name: String = row.get("name");
            let status: String = row.get("status");
            let unified_status: String = row.get("unified_status");
            let ai_plan_data: Option<String> = row.get("ai_plan_data");
            let total_words: i32 = row.get("total_words");

            // 从实际练习记录计算已学单词数
            let learned_words: i64 = sqlx::query_scalar(
                r#"
                SELECT COUNT(DISTINCT wpr.word_id)
                FROM word_practice_records wpr
                JOIN practice_sessions ps ON wpr.session_id = ps.id
                WHERE ps.plan_id = ? AND ps.completed = TRUE AND wpr.is_correct = TRUE
            "#,
            )
            .bind(plan_id)
            .fetch_one(self.pool.as_ref())
            .await?;

            // 检查日程数据
            let schedule_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM study_plan_schedules WHERE plan_id = ?")
                    .bind(plan_id)
                    .fetch_one(self.pool.as_ref())
                    .await?;

            // 检查单词关联数据
            let word_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM study_plan_words WHERE plan_id = ?")
                    .bind(plan_id)
                    .fetch_one(self.pool.as_ref())
                    .await?;

            plans_info.push(serde_json::json!({
                "id": plan_id,
                "name": name,
                "status": status,
                "unified_status": unified_status,
                "has_ai_data": ai_plan_data.is_some(),
                "ai_data_length": ai_plan_data.as_ref().map(|s| s.len()).unwrap_or(0),
                "total_words": total_words,
                "learned_words": learned_words,
                "schedule_count": schedule_count,
                "word_count": word_count
            }));
        }

        diagnosis.insert("plans".to_string(), serde_json::Value::Array(plans_info));
        Ok(serde_json::Value::Object(diagnosis))
    }

    /// 汇总所有未删除计划的日程数量与全局日程日期范围
    pub async fn diagnose_calendar_data(&self) -> AppResult<serde_json::Value> {
        let mut diagnosis = serde_json::Map::new();

        // 检查学习计划
        let plans_query = "SELECT id, name, ai_plan_data, start_date, end_date, unified_status FROM study_plans WHERE status != 'deleted'";
        let plan_rows = sqlx::query(plans_query)
            .fetch_all(self.pool.as_ref())
            .await?;

        let mut plans_info = Vec::new();
        for row in &plan_rows {
            let id: i64 = row.get("id");
            let name: String = row.get("name");
            let ai_plan_data: Option<String> = row.get("ai_plan_data");
            let start_date: Option<String> = row.get("start_date");
            let end_date: Option<String> = row.get("end_date");
            let unified_status: String = row.get("unified_status");

            let has_ai_data = ai_plan_data.is_some() && !ai_plan_data.as_ref().unwrap().is_empty();

            // 检查是否有日程数据
            let schedule_count_query =
                "SELECT COUNT(*) as count FROM study_plan_schedules WHERE plan_id = ?";
            let schedule_count: i64 = sqlx::query(schedule_count_query)
                .bind(id)
                .fetch_one(self.pool.as_ref())
                .await
                .map(|row| row.get("count"))?;

            plans_info.push(serde_json::json!({
                "id": id,
                "name": name,
                "unified_status": unified_status,
                "start_date": start_date,
                "end_date": end_date,
                "has_ai_data": has_ai_data,
                "schedule_count": schedule_count
            }));
        }

        diagnosis.insert(
            "study_plans".to_string(),
            serde_json::Value::Array(plans_info),
        );

        // 检查总的日程数据
        let total_schedules_query = "SELECT COUNT(*) as count FROM study_plan_schedules";
        let total_schedules: i64 = sqlx::query(total_schedules_query)
            .fetch_one(self.pool.as_ref())
            .await
            .map(|row| row.get("count"))?;

        diagnosis.insert(
            "total_schedules".to_string(),
            serde_json::Value::Number(serde_json::Number::from(total_schedules)),
        );

        // 检查日程日期范围
        if total_schedules > 0 {
            let date_range_query = "SELECT MIN(schedule_date) as min_date, MAX(schedule_date) as max_date FROM study_plan_schedules";
            if let Ok(row) = sqlx::query(date_range_query)
                .fetch_one(self.pool.as_ref())
                .await
            {
                let min_date: Option<String> = row.get("min_date");
                let max_date: Option<String> = row.get("max_date");
                diagnosis.insert(
                    "schedule_date_range".to_string(),
                    serde_json::json!({
                        "min_date": min_date,
                        "max_date": max_date
                    }),
                );
            }
        }
        Ok(serde_json::Value::Object(diagnosis))
    }

    /// 诊断今日学习计划
    pub async fn diagnose_today_schedules(&self) -> AppResult<String> {
        let today = crate::time::local_today();
        let today_str = crate::time::format_date(today);

        let mut diagnosis = Vec::new();
        diagnosis.push(format!("=== 今日学习计划诊断 (日期: {}) ===", today_str));

        // 1. 检查所有学习计划
        let plans_query = "SELECT id, name, status, unified_status, start_date, end_date FROM study_plans WHERE deleted_at IS NULL";
        let plans = sqlx::query(plans_query)
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
                self.logger.database_operation(
                    "SELECT",
                    "study_plan_schedules",
                    false,
                    Some(&e.to_string()),
                );
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
                self.logger.database_operation(
                    "SELECT",
                    "study_plans",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        diagnosis.push("\n3. 学习计划与今日日程匹配情况:".to_string());
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
                self.logger.database_operation(
                    "SELECT",
                    "study_plans",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        if !isaac_plans.is_empty() {
            diagnosis.push(format!(
                "\n4. 包含 'Issac' 的学习计划 ({} 个):",
                isaac_plans.len()
            ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, seed_schedule, test_logger};

    #[tokio::test]
    async fn plan_and_calendar_diagnosis_report_schedule_and_word_counts() {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 2).await;
        sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
            .bind(fx.plan_id)
            .bind(fx.word_ids[0])
            .execute(pool.as_ref())
            .await
            .unwrap();
        let repo = DiagnosticsRepository::new(pool.clone(), test_logger());

        let plans = repo.diagnose_study_plan_data("测试").await.unwrap();
        let plan = &plans["plans"][0];
        assert_eq!(plan["id"], fx.plan_id);
        assert_eq!(plan["schedule_count"], 1);
        assert_eq!(plan["word_count"], 1);
        assert_eq!(plan["learned_words"], 0);

        let calendar = repo.diagnose_calendar_data().await.unwrap();
        assert_eq!(calendar["total_schedules"], 1);
        assert_eq!(calendar["schedule_date_range"]["min_date"], "2026-10-06");
    }
}
