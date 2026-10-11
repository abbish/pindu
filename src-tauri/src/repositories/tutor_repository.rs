//! AI 老师查询学习者资料（只读）：按词查各词汇本里的记录与学习情况、最近容易错的词

use crate::error::AppResult;
use crate::types::common::Id;
use sqlx::{Row, SqlitePool};

/// 词汇本里的一条记录 + 学习情况
#[derive(Debug, Clone, PartialEq)]
pub struct WordLookupRow {
    pub word_id: Id,
    pub word: String,
    pub meaning: String,
    pub ipa: Option<String>,
    pub book_id: Id,
    pub book_title: String,
    /// 各计划里最高的记忆等级（没进过计划为 None）
    pub srs_box: Option<i64>,
    /// 首次作答（learn）答错 / 总次数
    pub wrong: i64,
    pub attempts: i64,
}

/// 最近容易错的词
#[derive(Debug, Clone, PartialEq)]
pub struct TroubleWordRow {
    pub word: String,
    pub meaning: String,
    pub book_title: String,
    pub wrong: i64,
    pub attempts: i64,
}

/// 按词（忽略大小写）查没删除的词汇本里的记录
pub async fn lookup_words(pool: &SqlitePool, words: &[String]) -> AppResult<Vec<WordLookupRow>> {
    let list = serde_json::to_string(words).unwrap_or_else(|_| "[]".to_string());
    let rows = sqlx::query(
        "SELECT w.id, w.word, w.meaning, w.ipa, b.id AS book_id, b.title,
                lv.level, COALESCE(pr.wrong, 0) AS wrong, COALESCE(pr.attempts, 0) AS attempts
         FROM words w
         JOIN word_books b ON b.id = w.word_book_id AND b.deleted_at IS NULL
         LEFT JOIN (SELECT word_id, MAX(srs_box) AS level FROM study_plan_words GROUP BY word_id) lv
                ON lv.word_id = w.id
         LEFT JOIN (SELECT word_id,
                           SUM(CASE WHEN is_correct THEN 0 ELSE 1 END) AS wrong,
                           COUNT(*) AS attempts
                    FROM word_practice_records WHERE kind = 'learn' GROUP BY word_id) pr
                ON pr.word_id = w.id
         WHERE LOWER(w.word) IN (SELECT LOWER(TRIM(value)) FROM json_each(?))
         ORDER BY LOWER(w.word), b.id",
    )
    .bind(list)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| WordLookupRow {
            word_id: r.get("id"),
            word: r.get("word"),
            meaning: r.get("meaning"),
            ipa: r.get("ipa"),
            book_id: r.get("book_id"),
            book_title: r.get("title"),
            srs_box: r.get("level"),
            wrong: r.get("wrong"),
            attempts: r.get("attempts"),
        })
        .collect())
}

/// `since`（UTC 时刻）之后首次作答答错过的词，按答错次数排序
pub async fn trouble_words(
    pool: &SqlitePool,
    since: &str,
    limit: i64,
) -> AppResult<Vec<TroubleWordRow>> {
    let rows = sqlx::query(
        "SELECT w.word, w.meaning, b.title,
                SUM(CASE WHEN r.is_correct THEN 0 ELSE 1 END) AS wrong, COUNT(*) AS attempts
         FROM word_practice_records r
         JOIN words w ON w.id = r.word_id
         JOIN word_books b ON b.id = w.word_book_id AND b.deleted_at IS NULL
         WHERE r.kind = 'learn' AND r.created_at >= ?
         GROUP BY r.word_id
         HAVING wrong > 0
         ORDER BY wrong DESC, MAX(r.created_at) DESC
         LIMIT ?",
    )
    .bind(since)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| TroubleWordRow {
            word: r.get("word"),
            meaning: r.get("meaning"),
            book_title: r.get("title"),
            wrong: r.get("wrong"),
            attempts: r.get("attempts"),
        })
        .collect())
}
