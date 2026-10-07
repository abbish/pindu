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
    pub fn pool(&self) -> Arc<SqlitePool> {
        self.pool.clone()
    }

    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, _logger: Arc<crate::logger::Logger>) -> Self {
        Self { pool }
    }

    /// 把各进行中计划今天到期的复习放进今天的日程（自适应复习，见 services::srs）
    pub async fn sync_today_reviews(&self) -> AppResult<()> {
        crate::services::srs::sync_all_today(&self.pool).await
    }

    // ==================== 今日日程查询 ====================

    /// 今日要练的日程：今天的日程（进行中 / 待开始的计划），加上每个进行中计划最早一个没练的过期日程（待补）。
    /// 暂停的计划不出现（暂停期间不催）。
    pub async fn find_today_schedules(&self) -> AppResult<Vec<TodayScheduleInfo>> {
        let today = crate::time::format_date(crate::time::local_today());

        let query = r#"
            SELECT
                sp.id as plan_id,
                sp.name as plan_name,
                sps.id as schedule_id,
                sps.schedule_date,
                sps.new_words_count,
                sps.review_words_count,
                sps.total_words_count,
                COALESCE(sps.completed_words_count, 0) as completed_words_count,
                sps.status as schedule_status,
                EXISTS (SELECT 1 FROM practice_sessions ps
                        WHERE ps.schedule_id = sps.id AND ps.completed = FALSE) as has_open_session,
                CASE WHEN sps.schedule_date < ?1 THEN
                    (SELECT COUNT(*) FROM study_plan_schedules s2
                     WHERE s2.plan_id = sp.id AND s2.schedule_date < ?1
                       AND COALESCE(s2.status, '') != 'completed' AND s2.total_words_count > 0)
                ELSE 0 END as overdue_count
            FROM study_plans sp
            JOIN study_plan_schedules sps ON sp.id = sps.plan_id
            WHERE sp.deleted_at IS NULL
              AND sp.unified_status IN ('Pending', 'Active')
              AND (
                  sps.schedule_date = ?1
                  OR sps.schedule_date = (
                      SELECT MIN(s3.schedule_date) FROM study_plan_schedules s3
                      WHERE s3.plan_id = sp.id AND s3.schedule_date < ?1
                        AND COALESCE(s3.status, '') != 'completed' AND s3.total_words_count > 0
                  )
              )
            ORDER BY sps.schedule_date ASC, sp.created_at ASC
        "#;

        let rows = sqlx::query(query)
            .bind(&today)
            .fetch_all(self.pool.as_ref())
            .await?;

        let schedules = rows
            .iter()
            .map(|row| TodayScheduleInfo {
                plan_id: row.get("plan_id"),
                plan_name: row.get("plan_name"),
                schedule_id: row.get("schedule_id"),
                schedule_date: row.get("schedule_date"),
                new_words_count: row.get("new_words_count"),
                review_words_count: row.get("review_words_count"),
                total_words_count: row.get("total_words_count"),
                completed_words_count: row.get("completed_words_count"),
                practiced: row.get::<Option<String>, _>("schedule_status").as_deref()
                    == Some("completed"),
                has_open_session: row.get("has_open_session"),
                overdue_count: row.get("overdue_count"),
            })
            .collect();

        Ok(schedules)
    }

    // ==================== 月度日历查询 ====================

    /// 日期范围内的日程（不含草稿与已删除计划）。已完成 / 已终止计划的日程也返回，
    /// 由服务层只保留练过的那些作为历史记录。
    pub async fn find_schedules_in_range(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> AppResult<Vec<CalendarScheduleRow>> {
        let query = r#"
            SELECT
                sps.id as schedule_id,
                sps.schedule_date,
                sp.id as plan_id,
                sp.name as plan_name,
                sp.unified_status,
                sps.total_words_count as total_words,
                COALESCE(sps.completed_words_count, 0) as completed_words,
                sps.status as schedule_status,
                EXISTS (SELECT 1 FROM practice_sessions ps
                        WHERE ps.schedule_id = sps.id AND ps.completed = FALSE) as has_open_session,
                sps.new_words_count as new_words,
                sps.review_words_count as review_words
            FROM study_plan_schedules sps
            JOIN study_plans sp ON sps.plan_id = sp.id
            WHERE sps.schedule_date BETWEEN ? AND ?
                AND sp.deleted_at IS NULL
                AND sp.unified_status IN ('Pending', 'Active', 'Paused', 'Completed', 'Terminated')
            ORDER BY sps.schedule_date, sp.id
        "#;

        let rows = sqlx::query(query)
            .bind(start_date)
            .bind(end_date)
            .fetch_all(self.pool.as_ref())
            .await?;

        Ok(rows
            .into_iter()
            .map(|row| CalendarScheduleRow {
                schedule_id: row.get("schedule_id"),
                schedule_date: row.get("schedule_date"),
                plan_id: row.get("plan_id"),
                plan_name: row.get("plan_name"),
                unified_status: row.get("unified_status"),
                total_words: row.get("total_words"),
                completed_words: row.get("completed_words"),
                practiced: row.get::<Option<String>, _>("schedule_status").as_deref()
                    == Some("completed"),
                has_open_session: row.get("has_open_session"),
                new_words: row.get("new_words"),
                review_words: row.get("review_words"),
            })
            .collect())
    }

    /// 学习日（完成过练习的本地日期），用于连续学习天数
    pub async fn find_study_dates(&self) -> AppResult<Vec<chrono::NaiveDate>> {
        Ok(crate::repositories::practice_metrics::study_dates(self.pool.as_ref()).await?)
    }

    /// 日期范围内按（完成日期, 计划）汇总的学习记录（study_sessions，本地日期；不含已删除计划）。
    /// 只用于时长与学习记录展示；日程是否完成以日程自身的 completed_words_count 为准。
    pub async fn find_session_summaries_in_range(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> AppResult<Vec<CalendarSessionRow>> {
        let query = r#"
            SELECT
                DATE(ss.finished_at, 'localtime') as study_date,
                ss.plan_id,
                sp.name as plan_name,
                SUM(ss.words_studied) as words_studied,
                SUM(CAST(ss.total_time_seconds AS REAL) / 60.0) as study_time_minutes,
                AVG(CAST(ss.correct_answers AS REAL) / NULLIF(ss.words_studied, 0) * 100.0) as accuracy_rate,
                MAX(ss.finished_at) as completed_at
            FROM study_sessions ss
            JOIN study_plans sp ON ss.plan_id = sp.id
            WHERE ss.finished_at IS NOT NULL
              AND sp.deleted_at IS NULL
              AND DATE(ss.finished_at, 'localtime') BETWEEN ? AND ?
            GROUP BY DATE(ss.finished_at, 'localtime'), ss.plan_id, sp.name
            ORDER BY study_date, ss.plan_id
        "#;

        let rows = sqlx::query(query)
            .bind(start_date)
            .bind(end_date)
            .fetch_all(self.pool.as_ref())
            .await?;

        Ok(rows
            .into_iter()
            .map(|row| CalendarSessionRow {
                study_date: row.get("study_date"),
                plan_id: row.get("plan_id"),
                plan_name: row.get("plan_name"),
                words_studied: row.get("words_studied"),
                study_time_minutes: row.get("study_time_minutes"),
                accuracy_rate: row
                    .try_get::<Option<f64>, _>("accuracy_rate")
                    .ok()
                    .flatten(),
                completed_at: row.get("completed_at"),
            })
            .collect())
    }
}

/// 月度日历：某天某计划的日程行
#[derive(Debug, Clone)]
pub struct CalendarScheduleRow {
    pub schedule_id: i64,
    pub schedule_date: String,
    pub plan_id: i64,
    pub plan_name: String,
    pub unified_status: String,
    pub total_words: i32,
    /// 日程已掌握单词数（三步首答全对，见 refresh_completion）
    pub completed_words: i32,
    /// 日程已练完（有已完成的练习会话）
    pub practiced: bool,
    /// 有练了一半的会话
    pub has_open_session: bool,
    pub new_words: i32,
    pub review_words: i32,
}

/// 月度日历：某天某计划的学习记录汇总
#[derive(Debug, Clone)]
pub struct CalendarSessionRow {
    pub study_date: String,
    pub plan_id: i64,
    pub plan_name: String,
    pub words_studied: i64,
    pub study_time_minutes: f64,
    /// 无有效作答时为 None
    pub accuracy_rate: Option<f64>,
    pub completed_at: String,
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
    /// 日程已练完（有已完成的练习会话）
    pub practiced: bool,
    /// 有练了一半的会话
    pub has_open_session: bool,
    /// 过期日程：这个计划没练的过期日程数（含本条）；今天的日程为 0
    pub overdue_count: i32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, seed_schedule, test_logger};

    /// 回归：2026-01 重构后该查询引用了不存在的 `sps.progress_percentage`，今日日程始终加载失败。
    #[tokio::test]
    async fn finds_schedules_dated_today_for_active_plans() {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 2).await;
        let today = crate::time::format_date(crate::time::local_today());
        sqlx::query("UPDATE study_plan_schedules SET schedule_date = ? WHERE id = ?")
            .bind(&today)
            .bind(fx.schedule_id)
            .execute(pool.as_ref())
            .await
            .unwrap();

        let repo = CalendarRepository::new(pool.clone(), test_logger());
        let schedules = repo.find_today_schedules().await.unwrap();

        assert_eq!(schedules.len(), 1);
        assert_eq!(schedules[0].schedule_id, fx.schedule_id);
        assert_eq!(schedules[0].total_words_count, 2);
    }

    /// 今日计划：今天的日程 + 每个进行中计划最早一个没练的过期日程（附待补数）；暂停计划不出现
    #[tokio::test]
    async fn today_includes_earliest_overdue_schedule_and_open_sessions() {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 2).await;
        let today = crate::time::local_today();
        let day = |n: i64| {
            (today - chrono::Duration::days(n))
                .format("%Y-%m-%d")
                .to_string()
        };
        // 计划 1：3 天前、2 天前没练，1 天前练完，今天有日程且练了一半
        sqlx::query("UPDATE study_plan_schedules SET schedule_date = ? WHERE id = ?")
            .bind(day(3))
            .bind(fx.schedule_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        for (n, status) in [(2, "not-started"), (1, "completed"), (0, "not-started")] {
            sqlx::query(
                "INSERT INTO study_plan_schedules (plan_id, day_number, schedule_date, total_words_count, status)
                 VALUES (?, ?, ?, 2, ?)",
            )
            .bind(fx.plan_id)
            .bind(5 - n)
            .bind(day(n))
            .bind(status)
            .execute(pool.as_ref())
            .await
            .unwrap();
        }
        let today_id: i64 = sqlx::query_scalar(
            "SELECT id FROM study_plan_schedules WHERE plan_id = ? AND schedule_date = ?",
        )
        .bind(fx.plan_id)
        .bind(day(0))
        .fetch_one(pool.as_ref())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO practice_sessions (id, plan_id, schedule_id, schedule_date, start_time, completed)
             VALUES ('open', ?, ?, ?, '2026-10-01T00:00:00Z', FALSE)",
        )
        .bind(fx.plan_id)
        .bind(today_id)
        .bind(day(0))
        .execute(pool.as_ref())
        .await
        .unwrap();
        // 暂停的计划：今天的日程不出现
        let paused = sqlx::query(
            "INSERT INTO study_plans (name, status, unified_status) VALUES ('暂停', 'normal', 'Paused')",
        )
        .execute(pool.as_ref())
        .await
        .unwrap()
        .last_insert_rowid();
        sqlx::query(
            "INSERT INTO study_plan_schedules (plan_id, day_number, schedule_date, total_words_count) VALUES (?, 1, ?, 2)",
        )
        .bind(paused)
        .bind(day(0))
        .execute(pool.as_ref())
        .await
        .unwrap();

        let repo = CalendarRepository::new(pool.clone(), test_logger());
        let rows = repo.find_today_schedules().await.unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].schedule_date, day(3));
        assert_eq!(rows[0].overdue_count, 2);
        assert!(!rows[0].has_open_session);
        assert_eq!(rows[1].schedule_id, today_id);
        assert_eq!(rows[1].overdue_count, 0);
        assert!(rows[1].has_open_session);
    }
}
