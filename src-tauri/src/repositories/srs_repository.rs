//! 自适应复习的数据访问（规则在 `services::srs`）。全部在调用方事务内执行。

use crate::error::AppResult;
use crate::services::srs::MemoryState;
use chrono::NaiveDate;
use sqlx::{Row, SqliteConnection};

/// 需要同步复习的计划
pub struct SyncPlan {
    pub daily_new_words: Option<i32>,
    pub start_date: Option<String>,
}

/// 某天的日程
pub struct DaySchedule {
    pub id: i64,
    pub practiced: bool,
    pub has_open_session: bool,
}

/// 到期的复习词
pub struct DueWord {
    pub word_id: i64,
    pub wordbook_id: i64,
    pub box_level: i32,
    pub difficulty: i32,
}

pub struct SrsRepository;

impl SrsRepository {
    pub async fn current_box_conn(
        conn: &mut SqliteConnection,
        plan_id: i64,
        word_id: i64,
    ) -> AppResult<Option<i32>> {
        Ok(sqlx::query_scalar(
            "SELECT srs_box FROM study_plan_words WHERE plan_id = ? AND word_id = ?",
        )
        .bind(plan_id)
        .bind(word_id)
        .fetch_optional(&mut *conn)
        .await?)
    }

    pub async fn save_state_conn(
        conn: &mut SqliteConnection,
        plan_id: i64,
        word_id: i64,
        state: &MemoryState,
        today: NaiveDate,
        reviewed: bool,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE study_plan_words
             SET srs_box = ?, srs_due = ?, srs_last = ?,
                 srs_lapses = srs_lapses + ?, srs_reviews = srs_reviews + ?
             WHERE plan_id = ? AND word_id = ?",
        )
        .bind(state.box_level)
        .bind(state.due.format("%Y-%m-%d").to_string())
        .bind(today.format("%Y-%m-%d").to_string())
        .bind(i32::from(state.lapsed))
        .bind(i32::from(reviewed))
        .bind(plan_id)
        .bind(word_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 待开始 / 进行中的计划才同步复习
    pub async fn plan_for_sync_conn(
        conn: &mut SqliteConnection,
        plan_id: i64,
    ) -> AppResult<Option<SyncPlan>> {
        let row = sqlx::query(
            "SELECT daily_new_words, start_date FROM study_plans
             WHERE id = ? AND deleted_at IS NULL AND unified_status IN ('Pending', 'Active')",
        )
        .bind(plan_id)
        .fetch_optional(&mut *conn)
        .await?;
        Ok(row.map(|r| SyncPlan {
            daily_new_words: r.get("daily_new_words"),
            start_date: r.get("start_date"),
        }))
    }

    /// 待同步的计划 id（待开始 / 进行中）
    pub async fn syncable_plan_ids(pool: &sqlx::SqlitePool) -> AppResult<Vec<i64>> {
        Ok(sqlx::query_scalar(
            "SELECT id FROM study_plans WHERE deleted_at IS NULL AND unified_status IN ('Pending', 'Active')",
        )
        .fetch_all(pool)
        .await?)
    }

    /// 删除不在今天、还没练过（没有任何练习会话）的日程里的复习条目，再删掉因此变空的日程，重算计数
    pub async fn drop_stale_reviews_conn(
        conn: &mut SqliteConnection,
        plan_id: i64,
        today: &str,
    ) -> AppResult<()> {
        let removed = sqlx::query(
            "DELETE FROM study_plan_schedule_words
             WHERE is_review = TRUE AND schedule_id IN (
                 SELECT s.id FROM study_plan_schedules s
                 WHERE s.plan_id = ?1 AND s.schedule_date != ?2
                   AND COALESCE(s.status, '') != 'completed'
                   AND NOT EXISTS (SELECT 1 FROM practice_sessions ps WHERE ps.schedule_id = s.id)
             )",
        )
        .bind(plan_id)
        .bind(today)
        .execute(&mut *conn)
        .await?
        .rows_affected();
        if removed == 0 {
            return Ok(());
        }
        sqlx::query(
            "DELETE FROM study_plan_schedules
             WHERE plan_id = ?
               AND NOT EXISTS (SELECT 1 FROM study_plan_schedule_words sw WHERE sw.schedule_id = study_plan_schedules.id)
               AND NOT EXISTS (SELECT 1 FROM practice_sessions ps WHERE ps.schedule_id = study_plan_schedules.id)",
        )
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;
        sqlx::query(&format!("{} WHERE plan_id = ?", RECOUNT_SQL))
            .bind(plan_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    pub async fn schedule_on_conn(
        conn: &mut SqliteConnection,
        plan_id: i64,
        date: &str,
    ) -> AppResult<Option<DaySchedule>> {
        let row = sqlx::query(
            "SELECT s.id, COALESCE(s.status, '') = 'completed' AS practiced,
                    EXISTS (SELECT 1 FROM practice_sessions ps
                            WHERE ps.schedule_id = s.id AND ps.completed = FALSE) AS has_open
             FROM study_plan_schedules s WHERE s.plan_id = ? AND s.schedule_date = ?",
        )
        .bind(plan_id)
        .bind(date)
        .fetch_optional(&mut *conn)
        .await?;
        Ok(row.map(|r| DaySchedule {
            id: r.get("id"),
            practiced: r.get("practiced"),
            has_open_session: r.get("has_open"),
        }))
    }

    /// 到期（due ≤ 今天）且不在今天日程里的词：最早到期、等级低的优先
    pub async fn due_words_conn(
        conn: &mut SqliteConnection,
        plan_id: i64,
        today: &str,
        limit: i64,
    ) -> AppResult<Vec<DueWord>> {
        let rows = sqlx::query(
            "SELECT spw.word_id, w.word_book_id, spw.srs_box,
                    COALESCE((SELECT MAX(sw.difficulty_level) FROM study_plan_schedule_words sw
                              JOIN study_plan_schedules s ON s.id = sw.schedule_id
                              WHERE s.plan_id = spw.plan_id AND sw.word_id = spw.word_id), 1) AS difficulty
             FROM study_plan_words spw
             JOIN words w ON w.id = spw.word_id
             WHERE spw.plan_id = ?1 AND spw.srs_box >= 1 AND spw.srs_due IS NOT NULL AND spw.srs_due <= ?2
               AND spw.word_id NOT IN (
                   SELECT sw.word_id FROM study_plan_schedule_words sw
                   JOIN study_plan_schedules s ON s.id = sw.schedule_id
                   WHERE s.plan_id = ?1 AND s.schedule_date = ?2
               )
             ORDER BY spw.srs_due, spw.srs_box, spw.word_id
             LIMIT ?3",
        )
        .bind(plan_id)
        .bind(today)
        .bind(limit)
        .fetch_all(&mut *conn)
        .await?;
        Ok(rows
            .iter()
            .map(|r| DueWord {
                word_id: r.get("word_id"),
                wordbook_id: r.get("word_book_id"),
                box_level: r.get("srs_box"),
                difficulty: r.get("difficulty"),
            })
            .collect())
    }

    /// 新建一天的日程（复习日）；day_number 与已有日程冲突时顺延到最大值之后
    pub async fn create_schedule_conn(
        conn: &mut SqliteConnection,
        plan_id: i64,
        day_number: i64,
        date: &str,
    ) -> AppResult<i64> {
        let taken: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM study_plan_schedules WHERE plan_id = ? AND day_number = ?)",
        )
        .bind(plan_id)
        .bind(day_number)
        .fetch_one(&mut *conn)
        .await?;
        let day_number = if taken {
            sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE(MAX(day_number), 0) + 1 FROM study_plan_schedules WHERE plan_id = ?",
            )
            .bind(plan_id)
            .fetch_one(&mut *conn)
            .await?
        } else {
            day_number
        };
        Ok(sqlx::query(
            "INSERT INTO study_plan_schedules (plan_id, day_number, schedule_date, status, created_at, updated_at)
             VALUES (?, ?, ?, 'not-started', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(plan_id)
        .bind(day_number)
        .bind(date)
        .execute(&mut *conn)
        .await?
        .last_insert_rowid())
    }

    pub async fn add_review_words_conn(
        conn: &mut SqliteConnection,
        schedule_id: i64,
        words: &[DueWord],
    ) -> AppResult<()> {
        for w in words {
            sqlx::query(
                "INSERT INTO study_plan_schedule_words
                 (schedule_id, word_id, wordbook_id, is_review, review_count, priority, difficulty_level, created_at)
                 VALUES (?, ?, ?, TRUE, ?, 'medium', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            )
            .bind(schedule_id)
            .bind(w.word_id)
            .bind(w.wordbook_id)
            .bind(w.box_level)
            .bind(w.difficulty)
            .execute(&mut *conn)
            .await?;
        }
        Ok(())
    }

    pub async fn recount_schedule_conn(
        conn: &mut SqliteConnection,
        schedule_id: i64,
    ) -> AppResult<()> {
        sqlx::query(&format!("{} WHERE id = ?", RECOUNT_SQL))
            .bind(schedule_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    pub async fn plan_exists(pool: &sqlx::SqlitePool, plan_id: i64) -> AppResult<bool> {
        Ok(sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM study_plans WHERE id = ? AND deleted_at IS NULL)",
        )
        .bind(plan_id)
        .fetch_one(pool)
        .await?)
    }

    /// 计划的记忆概况：(等级, 词数) 列表、今天到期数、下一次到期日期
    pub async fn overview(
        pool: &sqlx::SqlitePool,
        plan_id: i64,
        today: &str,
    ) -> AppResult<(Vec<(i32, i64)>, i64, Option<String>)> {
        let boxes = sqlx::query(
            "SELECT srs_box, COUNT(*) AS n FROM study_plan_words WHERE plan_id = ? GROUP BY srs_box",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| (r.get::<i32, _>("srs_box"), r.get::<i64, _>("n")))
        .collect();
        let row = sqlx::query(
            "SELECT
                 COALESCE(SUM(CASE WHEN srs_due <= ?2 THEN 1 ELSE 0 END), 0) AS due,
                 MIN(CASE WHEN srs_due > ?2 THEN srs_due END) AS next_due
             FROM study_plan_words WHERE plan_id = ?1 AND srs_box >= 1 AND srs_due IS NOT NULL",
        )
        .bind(plan_id)
        .bind(today)
        .fetch_one(pool)
        .await?;
        let due: i64 = row.get("due");
        let next_due: Option<String> = row.get("next_due");
        Ok((
            boxes,
            due,
            if due > 0 {
                Some(today.to_string())
            } else {
                next_due
            },
        ))
    }

    pub async fn unmastered_count_conn(
        conn: &mut SqliteConnection,
        plan_id: i64,
    ) -> AppResult<i64> {
        Ok(sqlx::query_scalar(
            "SELECT COUNT(*) FROM study_plan_words WHERE plan_id = ? AND srs_box < ?",
        )
        .bind(plan_id)
        .bind(crate::services::srs::MASTERED_BOX)
        .fetch_one(&mut *conn)
        .await?)
    }
}

/// 按日程里的实际单词重算新学 / 复习 / 总数
const RECOUNT_SQL: &str = "UPDATE study_plan_schedules SET
    new_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words sw WHERE sw.schedule_id = study_plan_schedules.id AND sw.is_review = FALSE),
    review_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words sw WHERE sw.schedule_id = study_plan_schedules.id AND sw.is_review = TRUE),
    total_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words sw WHERE sw.schedule_id = study_plan_schedules.id),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')";
