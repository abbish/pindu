//! 发音评估结果（pronunciation_attempts）：只记学习计划里的跟读

use crate::error::AppResult;
use sqlx::SqlitePool;

/// 一条要保存的评估
pub struct NewAttempt<'a> {
    pub plan_id: i64,
    pub session_id: Option<&'a str>,
    /// word 单词 / sentence 句子
    pub source: &'a str,
    pub word_id: Option<i64>,
    pub passage_id: Option<i64>,
    pub text: &'a str,
    pub score: i64,
    /// 逐词逐音 JSON
    pub detail: &'a str,
}

#[derive(Debug, sqlx::FromRow)]
pub struct AttemptRow {
    pub score: i64,
    pub detail: String,
}

pub struct PronunciationRepository;

impl PronunciationRepository {
    pub async fn insert(pool: &SqlitePool, attempt: &NewAttempt<'_>) -> AppResult<i64> {
        let id = sqlx::query(
            "INSERT INTO pronunciation_attempts
                (plan_id, session_id, source, word_id, passage_id, text, score, detail, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(attempt.plan_id)
        .bind(attempt.session_id)
        .bind(attempt.source)
        .bind(attempt.word_id)
        .bind(attempt.passage_id)
        .bind(attempt.text)
        .bind(attempt.score)
        .bind(attempt.detail)
        .bind(crate::time::now_utc())
        .execute(pool)
        .await?
        .last_insert_rowid();
        Ok(id)
    }

    /// 计划里的评估，新的在前
    pub async fn list_by_plan(pool: &SqlitePool, plan_id: i64) -> AppResult<Vec<AttemptRow>> {
        Ok(sqlx::query_as::<_, AttemptRow>(
            "SELECT score, detail FROM pronunciation_attempts
             WHERE plan_id = ? ORDER BY created_at DESC, id DESC",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }
}
