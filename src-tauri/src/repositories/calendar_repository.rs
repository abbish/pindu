//! 日历数据访问层
//!
//! 提供 Repository 模式的数据访问封装



use crate::error::AppResult;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

/// 日历仓储
///
/// 负责日历相关的数据访问逻辑,封装所有数据库操作
pub struct CalendarRepository {
    pool: Arc<SqlitePool>,
}

impl CalendarRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, _logger: Arc<crate::logger::Logger>) -> Self {
        Self { pool }
    }

    // ==================== 今日日程查询 ====================

    /// 获取今日学习日程
    pub async fn find_today_schedules(&self) -> AppResult<Vec<TodayScheduleInfo>> {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        let query = r#"
            SELECT
                sp.id as plan_id,
                sp.name as plan_name,
                sp.unified_status as plan_status,
                sps.id as schedule_id,
                sps.schedule_date,
                sps.new_words_count,
                sps.review_words_count,
                sps.total_words_count,
                sps.completed_words_count,
                sps.progress_percentage,
                sps.status as schedule_status
            FROM study_plans sp
            JOIN study_plan_schedules sps ON sp.id = sps.plan_id
            WHERE sps.schedule_date = ?
              AND sp.deleted_at IS NULL
              AND sp.unified_status IN ('Pending', 'Active', 'Paused')
            ORDER BY sps.created_at DESC
        "#;

        let rows = sqlx::query(query)
            .bind(&today)
            .fetch_all(self.pool.as_ref())
            .await?;

        let schedules = rows
            .iter()
            .map(|row| {
                TodayScheduleInfo {
                    plan_id: row.get("plan_id"),
                    plan_name: row.get("plan_name"),
                    schedule_id: row.get("schedule_id"),
                    schedule_date: row.get("schedule_date"),
                    new_words_count: row.get("new_words_count"),
                    review_words_count: row.get("review_words_count"),
                    total_words_count: row.get("total_words_count"),
                    completed_words_count: row.get("completed_words_count"),
                }
            })
            .collect();

        Ok(schedules)
    }

}

// ==================== 辅助类型定义 ====================

/// 今日日程信息
#[derive(Debug, Clone)]
pub struct TodayScheduleInfo {
    pub plan_id: i64,
    pub plan_name: String,
    pub schedule_id: i64,
    pub schedule_date: String,
    pub new_words_count: i32,
    pub review_words_count: i32,
    pub total_words_count: i32,
    pub completed_words_count: i32,
}

