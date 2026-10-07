//! 计划就地调整（改节奏 / 追加单词本）的数据访问：只动“还没练过”的新词日，
//! 已练过的日程、复习条目与 `study_plan_words.srs_*` 一律不动（authoring-flows-redesign B5）。

use crate::error::AppResult;
use crate::types::common::Id;
use sqlx::{Row, SqliteConnection};

/// 还没练过的日程里的一个新词条目
#[derive(Debug, Clone)]
pub struct OpenNewWord {
    pub row_id: Id,
    pub schedule_date: String,
    pub word_id: Id,
    pub wordbook_id: Id,
    pub priority: String,
    pub difficulty_level: i32,
}

// “还没练过”的日程 = 没有任何练习会话、也没标记练完：
//   COALESCE(s.status, '') != 'completed' AND NOT EXISTS (练习会话)；下面三处 SQL 写同一条件（静态 SQL 便于 check-sql 检查）

/// 还没练过的日程里的新词，按日期、再按原排入顺序（保持 AI / 默认顺序）
pub async fn open_new_words_conn(
    conn: &mut SqliteConnection,
    plan_id: Id,
) -> AppResult<Vec<OpenNewWord>> {
    let rows = sqlx::query(
        "SELECT sw.id, s.schedule_date, sw.word_id, sw.wordbook_id, sw.priority, sw.difficulty_level
         FROM study_plan_schedule_words sw
         JOIN study_plan_schedules s ON s.id = sw.schedule_id
         WHERE s.plan_id = ? AND sw.is_review = FALSE AND COALESCE(s.status, '') != 'completed' AND NOT EXISTS (SELECT 1 FROM practice_sessions ps WHERE ps.schedule_id = s.id)
         ORDER BY s.schedule_date, sw.id"
    )
    .bind(plan_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| OpenNewWord {
            row_id: r.get(0),
            schedule_date: r.get(1),
            word_id: r.get(2),
            wordbook_id: r.get(3),
            priority: r.get(4),
            difficulty_level: r.get(5),
        })
        .collect())
}

/// 删除日程单词条目
pub async fn delete_schedule_word_rows_conn(
    conn: &mut SqliteConnection,
    row_ids: &[Id],
) -> AppResult<()> {
    for id in row_ids {
        sqlx::query("DELETE FROM study_plan_schedule_words WHERE id = ?")
            .bind(id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// 某天的日程：Some((id, 是否还没练过))
pub async fn schedule_on_date_conn(
    conn: &mut SqliteConnection,
    plan_id: Id,
    date: &str,
) -> AppResult<Option<(Id, bool)>> {
    let row = sqlx::query(
        "SELECT s.id, (COALESCE(s.status, '') != 'completed' AND NOT EXISTS (SELECT 1 FROM practice_sessions ps WHERE ps.schedule_id = s.id)) AS open FROM study_plan_schedules s WHERE s.plan_id = ? AND s.schedule_date = ?"
    )
    .bind(plan_id)
    .bind(date)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.map(|r| (r.get::<Id, _>(0), r.get::<bool, _>(1))))
}

/// 新建一天的日程（day_number 先用不冲突的临时负数，最后由 `renumber_days_conn` 统一编号）
pub async fn create_schedule_conn(
    conn: &mut SqliteConnection,
    plan_id: Id,
    date: &str,
    temp_day_number: i64,
) -> AppResult<Id> {
    Ok(sqlx::query(
        "INSERT INTO study_plan_schedules (plan_id, day_number, schedule_date, status, created_at, updated_at)
         VALUES (?, ?, ?, 'not-started', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(plan_id)
    .bind(temp_day_number)
    .bind(date)
    .execute(&mut *conn)
    .await?
    .last_insert_rowid())
}

/// 往日程里放一个新词
#[allow(clippy::too_many_arguments)]
pub async fn insert_new_word_conn(
    conn: &mut SqliteConnection,
    schedule_id: Id,
    word_id: Id,
    wordbook_id: Id,
    priority: &str,
    difficulty_level: i32,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO study_plan_schedule_words
           (schedule_id, word_id, wordbook_id, is_review, priority, difficulty_level, created_at)
         VALUES (?, ?, ?, FALSE, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(schedule_id)
    .bind(word_id)
    .bind(wordbook_id)
    .bind(priority)
    .bind(difficulty_level)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// 重算计划全部日程的新词 / 复习 / 总数，并删除变空且没练过的日程
pub async fn recount_and_prune_conn(conn: &mut SqliteConnection, plan_id: Id) -> AppResult<()> {
    sqlx::query(
        "UPDATE study_plan_schedules SET
            new_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words sw WHERE sw.schedule_id = study_plan_schedules.id AND sw.is_review = FALSE),
            review_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words sw WHERE sw.schedule_id = study_plan_schedules.id AND sw.is_review = TRUE),
            total_words_count = (SELECT COUNT(*) FROM study_plan_schedule_words sw WHERE sw.schedule_id = study_plan_schedules.id),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE plan_id = ?",
    )
    .bind(plan_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "DELETE FROM study_plan_schedules WHERE id IN (
            SELECT s.id FROM study_plan_schedules s
            WHERE s.plan_id = ? AND s.total_words_count = 0 AND COALESCE(s.status, '') != 'completed' AND NOT EXISTS (SELECT 1 FROM practice_sessions ps WHERE ps.schedule_id = s.id))"
    )
    .bind(plan_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// 先把 day_number 全部改成不冲突的负数（day_number 在计划内唯一）
pub async fn clear_day_numbers_conn(conn: &mut SqliteConnection, plan_id: Id) -> AppResult<()> {
    sqlx::query("UPDATE study_plan_schedules SET day_number = -id WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// 按日期顺序重新编号第几天
pub async fn renumber_days_conn(conn: &mut SqliteConnection, plan_id: Id) -> AppResult<()> {
    clear_day_numbers_conn(conn, plan_id).await?;
    let ids: Vec<Id> = sqlx::query_scalar(
        "SELECT id FROM study_plan_schedules WHERE plan_id = ? ORDER BY schedule_date",
    )
    .bind(plan_id)
    .fetch_all(&mut *conn)
    .await?;
    for (i, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE study_plan_schedules SET day_number = ? WHERE id = ?")
            .bind(i as i64 + 1)
            .bind(id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// 最后一个新词日（没有新词时为 None）
pub async fn last_new_word_date_conn(
    conn: &mut SqliteConnection,
    plan_id: Id,
) -> AppResult<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT MAX(s.schedule_date) FROM study_plan_schedules s
         WHERE s.plan_id = ? AND s.new_words_count > 0",
    )
    .bind(plan_id)
    .fetch_one(&mut *conn)
    .await?)
}

/// 保存节奏与结束日期，并按计划单词重算总词数
pub async fn save_pace_conn(
    conn: &mut SqliteConnection,
    plan_id: Id,
    daily_new_words: i32,
    end_date: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE study_plans SET
            daily_new_words = ?1,
            end_date = COALESCE(?2, end_date),
            total_words = (SELECT COUNT(*) FROM study_plan_words WHERE plan_id = ?3),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?3",
    )
    .bind(daily_new_words)
    .bind(end_date)
    .bind(plan_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// 这些单词本里还不在计划中的词（按 id 与拼写去重，保持单词本内顺序）：(word_id, word, wordbook_id, meaning)
pub async fn words_not_in_plan_conn(
    conn: &mut SqliteConnection,
    plan_id: Id,
    book_ids: &[Id],
) -> AppResult<Vec<(Id, String, Id, Option<String>)>> {
    let mut found = Vec::new();
    for book_id in book_ids {
        let rows: Vec<(Id, String, Id, Option<String>)> = sqlx::query_as(
            "SELECT w.id, w.word, w.word_book_id, w.meaning FROM words w
             WHERE w.word_book_id = ?1
               AND NOT EXISTS (SELECT 1 FROM study_plan_words spw WHERE spw.plan_id = ?2 AND spw.word_id = w.id)
               AND NOT EXISTS (SELECT 1 FROM study_plan_words spw JOIN words pw ON pw.id = spw.word_id
                               WHERE spw.plan_id = ?2 AND LOWER(pw.word) = LOWER(w.word))
             ORDER BY w.id",
        )
        .bind(book_id)
        .bind(plan_id)
        .fetch_all(&mut *conn)
        .await?;
        found.extend(rows);
    }
    Ok(found)
}

/// 计划当前的每天新词数（旧计划没有记录时按 10）
pub async fn daily_new_words_conn(conn: &mut SqliteConnection, plan_id: Id) -> AppResult<i32> {
    Ok(
        sqlx::query_scalar("SELECT COALESCE(daily_new_words, 10) FROM study_plans WHERE id = ?")
            .bind(plan_id)
            .fetch_one(&mut *conn)
            .await?,
    )
}

/// 把单词加入计划（未学：srs_box 等取默认值 0）
pub async fn insert_plan_word_conn(
    conn: &mut SqliteConnection,
    plan_id: Id,
    word_id: Id,
) -> AppResult<()> {
    sqlx::query("INSERT OR IGNORE INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
        .bind(plan_id)
        .bind(word_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}
