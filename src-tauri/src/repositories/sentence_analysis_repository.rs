//! 句子分析（sentence_analyses）：按句子文字一份，各短文共用

use crate::error::{AppError, AppResult};
use crate::types::passage::SentenceAnalysis;
use sqlx::SqlitePool;
use std::sync::Arc;

/// 缓存键：小写、空白归一
pub fn sentence_key(sentence: &str) -> String {
    sentence
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub struct SentenceAnalysisRepository {
    pool: Arc<SqlitePool>,
}

impl SentenceAnalysisRepository {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    /// 这句已有的分析（存的 JSON 读不出来时视为没有）
    pub async fn find(&self, sentence: &str) -> AppResult<Option<SentenceAnalysis>> {
        let raw: Option<String> =
            sqlx::query_scalar("SELECT analysis FROM sentence_analyses WHERE sentence_key = ?")
                .bind(sentence_key(sentence))
                .fetch_optional(self.pool.as_ref())
                .await?;
        Ok(raw.and_then(|r| serde_json::from_str(&r).ok()))
    }

    /// 写入或覆盖（重新分析时以新的为准）
    pub async fn upsert(&self, sentence: &str, analysis: &SentenceAnalysis) -> AppResult<()> {
        let now = crate::time::now_utc();
        let json =
            serde_json::to_string(analysis).map_err(|e| AppError::InternalError(e.to_string()))?;
        sqlx::query(
            "INSERT INTO sentence_analyses (sentence_key, sentence, analysis, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(sentence_key) DO UPDATE SET
                sentence = excluded.sentence, analysis = excluded.analysis, updated_at = excluded.updated_at",
        )
        .bind(sentence_key(sentence))
        .bind(sentence.trim())
        .bind(json)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }
}
