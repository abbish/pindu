//! 学习计划里的短文任务（study_plan_passages）与计划的练习内容设置的数据访问

use crate::error::AppResult;
use crate::types::common::Id;
use crate::types::passage::{PassageAttemptBrief, PlanPassageInput};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqliteConnection, SqlitePool};
use std::sync::Arc;

/// 计划的练习内容设置与排期所需的状态
#[derive(Debug, Clone)]
pub struct PlanPassageSettings {
    pub practice_content: String,
    pub interval_days: i64,
    pub start_date: Option<String>,
    pub unified_status: String,
}

/// 计划里的一项短文任务（排期与校验用）
#[derive(Debug, Clone, PartialEq)]
pub struct PlanPassageRow {
    pub id: Id,
    pub passage_id: Id,
    pub set_id: Option<Id>,
    pub mode: String,
    pub sort_order: i64,
    pub scheduled_date: String,
    pub completed_at: Option<String>,
}

/// 计划详情里的一项短文任务（含短文、题组与完成作答）
#[derive(Debug, Clone)]
pub struct PlanPassageDetailRow {
    pub item: PlanPassageRow,
    pub plan_id: Id,
    pub title: String,
    pub level: String,
    pub word_count: i64,
    pub set_name: Option<String>,
    pub attempt: Option<PassageAttemptBrief>,
    /// 视频切片（只读任务即「看视频跟读」）
    pub is_video: bool,
}

/// 今天的短文任务
#[derive(Debug, Clone)]
pub struct TodayPassageRow {
    pub item: PlanPassageRow,
    pub plan_id: Id,
    pub plan_name: String,
    pub title: String,
    pub word_count: i64,
    pub set_name: Option<String>,
    /// 视频切片
    pub is_video: bool,
}

/// 日历上的一项短文任务
#[derive(Debug, Clone)]
pub struct CalendarPassageRow {
    pub scheduled_date: String,
    pub completed: bool,
    pub unified_status: String,
    pub plan_id: Id,
    pub plan_name: String,
    pub passage_id: Id,
    pub title: String,
    pub set_id: Option<Id>,
    pub mode: String,
    pub is_video: bool,
}

fn item_from_row(r: &SqliteRow) -> PlanPassageRow {
    PlanPassageRow {
        id: r.get("id"),
        passage_id: r.get("passage_id"),
        set_id: r.get("set_id"),
        mode: r.get("mode"),
        sort_order: r.get("sort_order"),
        scheduled_date: r.get("scheduled_date"),
        completed_at: r.get("completed_at"),
    }
}

pub struct PlanPassageRepository {
    pool: Arc<SqlitePool>,
}

impl PlanPassageRepository {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    // ==================== 计划设置 ====================

    pub async fn settings_conn(
        conn: &mut SqliteConnection,
        plan_id: Id,
    ) -> AppResult<Option<PlanPassageSettings>> {
        let row = sqlx::query(
            "SELECT practice_content, passage_interval_days, start_date, unified_status
             FROM study_plans WHERE id = ?",
        )
        .bind(plan_id)
        .fetch_optional(&mut *conn)
        .await?;
        Ok(row.map(|r| PlanPassageSettings {
            practice_content: r.get("practice_content"),
            interval_days: r.get("passage_interval_days"),
            start_date: r.get("start_date"),
            unified_status: r
                .get::<Option<String>, _>("unified_status")
                .unwrap_or_default(),
        }))
    }

    pub async fn update_settings_conn(
        conn: &mut SqliteConnection,
        plan_id: Id,
        practice_content: &str,
        interval_days: i64,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE study_plans SET practice_content = ?, passage_interval_days = ?,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?",
        )
        .bind(practice_content)
        .bind(interval_days)
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 计划结束日（计划里有短文时）：单词结束日 = 最后一个新词日 + 巩固期，与最后一篇短文日期取较晚的；
    /// 只练短文 = 最后一篇短文的日期。没有短文的计划不改（保持单词排程算出的结束日）。
    pub async fn refresh_end_date_conn(conn: &mut SqliteConnection, plan_id: Id) -> AppResult<()> {
        sqlx::query(
            "UPDATE study_plans SET end_date = COALESCE(NULLIF(MAX(
                 COALESCE((SELECT DATE(MAX(s.schedule_date), '+' || ?2 || ' days') FROM study_plan_schedules s
                           WHERE s.plan_id = ?1 AND s.new_words_count > 0), ''),
                 COALESCE((SELECT MAX(scheduled_date) FROM study_plan_passages WHERE plan_id = ?1), '')
             ), ''), end_date)
             WHERE id = ?1 AND EXISTS (SELECT 1 FROM study_plan_passages WHERE plan_id = ?1)",
        )
        .bind(plan_id)
        .bind(crate::services::study_planning::CONSOLIDATION_DAYS as i64)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 作答不再计入计划（计划已暂停 / 结束，或计划里这篇的题组 / 方式已经变了）：转为自由练习
    pub async fn detach_attempt_conn(conn: &mut SqliteConnection, attempt_id: Id) -> AppResult<()> {
        sqlx::query("UPDATE passage_attempts SET plan_id = NULL WHERE id = ?")
            .bind(attempt_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    // ==================== 任务 ====================

    /// 计划的全部短文任务（按顺序）
    pub async fn items_conn(
        conn: &mut SqliteConnection,
        plan_id: Id,
    ) -> AppResult<Vec<PlanPassageRow>> {
        let rows = sqlx::query(
            "SELECT id, passage_id, set_id, mode, sort_order, scheduled_date, completed_at
             FROM study_plan_passages WHERE plan_id = ? ORDER BY sort_order, id",
        )
        .bind(plan_id)
        .fetch_all(&mut *conn)
        .await?;
        Ok(rows.iter().map(item_from_row).collect())
    }

    pub async fn insert_item_conn(
        conn: &mut SqliteConnection,
        plan_id: Id,
        input: &PlanPassageInput,
        sort_order: i64,
        scheduled_date: &str,
    ) -> AppResult<Id> {
        Ok(sqlx::query(
            "INSERT INTO study_plan_passages (plan_id, passage_id, set_id, mode, sort_order, scheduled_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(plan_id)
        .bind(input.passage_id)
        .bind(input.set_id)
        .bind(&input.mode)
        .bind(sort_order)
        .bind(scheduled_date)
        .bind(crate::time::now_utc())
        .execute(&mut *conn)
        .await?
        .last_insert_rowid())
    }

    /// 改未完成任务的题组、练习方式与顺序
    pub async fn update_item_conn(
        conn: &mut SqliteConnection,
        id: Id,
        set_id: Option<Id>,
        mode: &str,
        sort_order: i64,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE study_plan_passages SET set_id = ?, mode = ?, sort_order = ? WHERE id = ?",
        )
        .bind(set_id)
        .bind(mode)
        .bind(sort_order)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 只改顺序（已完成的任务）
    pub async fn update_sort_order_conn(
        conn: &mut SqliteConnection,
        id: Id,
        sort_order: i64,
    ) -> AppResult<()> {
        sqlx::query("UPDATE study_plan_passages SET sort_order = ? WHERE id = ?")
            .bind(sort_order)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    pub async fn update_date_conn(
        conn: &mut SqliteConnection,
        id: Id,
        scheduled_date: &str,
    ) -> AppResult<()> {
        sqlx::query("UPDATE study_plan_passages SET scheduled_date = ? WHERE id = ?")
            .bind(scheduled_date)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    /// 删除未完成的任务
    pub async fn delete_item_conn(conn: &mut SqliteConnection, id: Id) -> AppResult<()> {
        sqlx::query("DELETE FROM study_plan_passages WHERE id = ? AND completed_at IS NULL")
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    /// 计划里某篇短文的任务
    pub async fn find_item_conn(
        conn: &mut SqliteConnection,
        plan_id: Id,
        passage_id: Id,
    ) -> AppResult<Option<PlanPassageRow>> {
        let row = sqlx::query(
            "SELECT id, passage_id, set_id, mode, sort_order, scheduled_date, completed_at
             FROM study_plan_passages WHERE plan_id = ? AND passage_id = ?",
        )
        .bind(plan_id)
        .bind(passage_id)
        .fetch_optional(&mut *conn)
        .await?;
        Ok(row.as_ref().map(item_from_row))
    }

    /// 标记完成（只更新未完成的任务；返回是否更新）
    pub async fn mark_completed_conn(
        conn: &mut SqliteConnection,
        id: Id,
        attempt_id: Option<Id>,
    ) -> AppResult<bool> {
        Ok(sqlx::query(
            "UPDATE study_plan_passages SET completed_at = ?, attempt_id = ?
             WHERE id = ? AND completed_at IS NULL",
        )
        .bind(crate::time::now_utc())
        .bind(attempt_id)
        .bind(id)
        .execute(&mut *conn)
        .await?
        .rows_affected()
            > 0)
    }

    /// 还没完成的短文任务数
    pub async fn pending_count_conn(conn: &mut SqliteConnection, plan_id: Id) -> AppResult<i64> {
        Ok(sqlx::query_scalar(
            "SELECT COUNT(*) FROM study_plan_passages WHERE plan_id = ? AND completed_at IS NULL",
        )
        .bind(plan_id)
        .fetch_one(&mut *conn)
        .await?)
    }

    /// 短文存在
    pub async fn passage_exists_conn(
        conn: &mut SqliteConnection,
        passage_id: Id,
    ) -> AppResult<bool> {
        Ok(
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM passages WHERE id = ?)")
                .bind(passage_id)
                .fetch_one(&mut *conn)
                .await?,
        )
    }

    /// 题组所属的短文
    pub async fn set_passage_conn(
        conn: &mut SqliteConnection,
        set_id: Id,
    ) -> AppResult<Option<Id>> {
        Ok(
            sqlx::query_scalar("SELECT passage_id FROM passage_question_sets WHERE id = ?")
                .bind(set_id)
                .fetch_optional(&mut *conn)
                .await?,
        )
    }

    // ==================== 列表 ====================

    /// 计划详情的短文任务（含短文标题、题组名、完成作答）
    pub async fn details(&self, plan_id: Id) -> AppResult<Vec<PlanPassageDetailRow>> {
        let rows = sqlx::query(
            "SELECT pp.id, pp.plan_id, pp.passage_id, pp.set_id, pp.mode, pp.sort_order, pp.scheduled_date,
                    pp.completed_at, p.title, p.level, p.word_count, qs.name AS set_name, EXISTS (SELECT 1 FROM video_clips vc WHERE vc.passage_id = pp.passage_id) AS is_video,
                    a.id AS la_id, a.mode AS la_mode, a.objective_correct AS la_correct,
                    a.objective_total AS la_total, a.open_score AS la_open, a.open_total AS la_open_total,
                    a.completed_at AS la_completed_at
             FROM study_plan_passages pp
             JOIN passages p ON p.id = pp.passage_id
             LEFT JOIN passage_question_sets qs ON qs.id = pp.set_id
             LEFT JOIN passage_attempts a ON a.id = pp.attempt_id
             WHERE pp.plan_id = ?
             ORDER BY pp.sort_order, pp.id",
        )
        .bind(plan_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let attempt_id: Option<Id> = r.get("la_id");
                PlanPassageDetailRow {
                    item: item_from_row(r),
                    plan_id: r.get("plan_id"),
                    title: r.get("title"),
                    level: r.get("level"),
                    word_count: r.get("word_count"),
                    set_name: r.get("set_name"),
                    is_video: r.get("is_video"),
                    attempt: attempt_id.map(|id| PassageAttemptBrief {
                        id,
                        mode: r.get("la_mode"),
                        objective_correct: r.get("la_correct"),
                        objective_total: r.get("la_total"),
                        open_score: r.get("la_open"),
                        open_total: r.get("la_open_total"),
                        completed_at: r.get("la_completed_at"),
                    }),
                }
            })
            .collect())
    }

    /// 今天的短文任务：待开始 / 进行中计划里到期没完成的，加上今天（本地日期）完成的
    pub async fn today(&self, today: &str) -> AppResult<Vec<TodayPassageRow>> {
        let rows = sqlx::query(
            "SELECT pp.id, pp.plan_id, pp.passage_id, pp.set_id, pp.mode, pp.sort_order, pp.scheduled_date,
                    pp.completed_at, sp.name AS plan_name, p.title, p.word_count, qs.name AS set_name,
                    EXISTS (SELECT 1 FROM video_clips vc WHERE vc.passage_id = pp.passage_id) AS is_video
             FROM study_plan_passages pp
             JOIN study_plans sp ON sp.id = pp.plan_id
             JOIN passages p ON p.id = pp.passage_id
             LEFT JOIN passage_question_sets qs ON qs.id = pp.set_id
             WHERE sp.deleted_at IS NULL AND sp.unified_status IN ('Pending', 'Active')
               AND ((pp.completed_at IS NULL AND pp.scheduled_date <= ?1)
                    OR DATE(pp.completed_at, 'localtime') = ?1)
             ORDER BY pp.scheduled_date, sp.id, pp.sort_order",
        )
        .bind(today)
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows
            .iter()
            .map(|r| TodayPassageRow {
                item: item_from_row(r),
                plan_id: r.get("plan_id"),
                plan_name: r.get("plan_name"),
                title: r.get("title"),
                word_count: r.get("word_count"),
                set_name: r.get("set_name"),
                is_video: r.get("is_video"),
            })
            .collect())
    }

    /// 日期范围内的短文任务（日历；可只看一个计划）
    pub async fn in_range(
        &self,
        start: &str,
        end: &str,
        plan_id: Option<Id>,
    ) -> AppResult<Vec<CalendarPassageRow>> {
        let rows = sqlx::query(
            "SELECT pp.scheduled_date, pp.completed_at IS NOT NULL AS completed, sp.unified_status,
                    pp.plan_id, sp.name AS plan_name, pp.passage_id, p.title, pp.set_id, pp.mode,
                    EXISTS (SELECT 1 FROM video_clips vc WHERE vc.passage_id = pp.passage_id) AS is_video
             FROM study_plan_passages pp
             JOIN study_plans sp ON sp.id = pp.plan_id
             JOIN passages p ON p.id = pp.passage_id
             WHERE sp.deleted_at IS NULL AND pp.scheduled_date BETWEEN ?1 AND ?2
               AND (?3 IS NULL OR pp.plan_id = ?3)
             ORDER BY pp.scheduled_date, pp.plan_id, pp.sort_order",
        )
        .bind(start)
        .bind(end)
        .bind(plan_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows
            .iter()
            .map(|r| CalendarPassageRow {
                scheduled_date: r.get("scheduled_date"),
                completed: r.get("completed"),
                unified_status: r
                    .get::<Option<String>, _>("unified_status")
                    .unwrap_or_default(),
                plan_id: r.get("plan_id"),
                plan_name: r.get("plan_name"),
                passage_id: r.get("passage_id"),
                title: r.get("title"),
                set_id: r.get("set_id"),
                mode: r.get("mode"),
                is_video: r.get("is_video"),
            })
            .collect())
    }

    // ==================== 删除保护 ====================

    /// 用到这篇短文、还没结束的计划名
    pub async fn unfinished_plans_using_passage(&self, passage_id: Id) -> AppResult<Vec<String>> {
        Ok(sqlx::query_scalar(
            "SELECT DISTINCT sp.name FROM study_plan_passages pp
             JOIN study_plans sp ON sp.id = pp.plan_id
             WHERE pp.passage_id = ? AND sp.unified_status IN ('Draft', 'Pending', 'Active', 'Paused')
             ORDER BY sp.name",
        )
        .bind(passage_id)
        .fetch_all(self.pool.as_ref())
        .await?)
    }

    /// 还没结束的计划里、用这套题且没完成的任务所在计划名
    pub async fn unfinished_plans_using_set(&self, set_id: Id) -> AppResult<Vec<String>> {
        Ok(sqlx::query_scalar(
            "SELECT DISTINCT sp.name FROM study_plan_passages pp
             JOIN study_plans sp ON sp.id = pp.plan_id
             WHERE pp.set_id = ? AND pp.completed_at IS NULL
               AND sp.unified_status IN ('Draft', 'Pending', 'Active', 'Paused')
             ORDER BY sp.name",
        )
        .bind(set_id)
        .fetch_all(self.pool.as_ref())
        .await?)
    }

    // ==================== 候选 ====================

    /// 计划里的单词 id
    pub async fn plan_word_ids(&self, plan_id: Id) -> AppResult<Vec<Id>> {
        Ok(
            sqlx::query_scalar("SELECT word_id FROM study_plan_words WHERE plan_id = ?")
                .bind(plan_id)
                .fetch_all(self.pool.as_ref())
                .await?,
        )
    }

    /// 单词本里的单词 id（多本）
    pub async fn book_word_ids(&self, book_ids: &[Id]) -> AppResult<Vec<Id>> {
        let ids = serde_json::to_string(book_ids).unwrap_or_else(|_| "[]".into());
        Ok(sqlx::query_scalar(
            "SELECT w.id FROM words w WHERE w.word_book_id IN (SELECT value FROM json_each(?))",
        )
        .bind(ids)
        .fetch_all(self.pool.as_ref())
        .await?)
    }
}
