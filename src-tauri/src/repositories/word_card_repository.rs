//! 单词卡（word_cards）：按小写单词一份

use crate::error::{AppError, AppResult};
use crate::types::material::WordCard;
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;

fn json<T: serde::Serialize>(value: &T) -> AppResult<String> {
    serde_json::to_string(value).map_err(|e| AppError::InternalError(e.to_string()))
}

pub struct WordCardRepository {
    pool: Arc<SqlitePool>,
}

impl WordCardRepository {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    /// 这些单词（忽略大小写）的单词卡：小写单词 → 卡片
    pub async fn find_many(&self, words: &[String]) -> AppResult<HashMap<String, WordCard>> {
        let keys: Vec<String> = words.iter().map(|w| w.trim().to_lowercase()).collect();
        let rows = sqlx::query(
            "SELECT word_key, word, meaning, pos_abbreviation, pos_chinese, ipa, syllables,
                    phonics_rule, analysis_explanation, examples
             FROM word_cards WHERE word_key IN (SELECT value FROM json_each(?))",
        )
        .bind(json(&keys)?)
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let examples: String = r.get("examples");
                (
                    r.get::<String, _>("word_key"),
                    WordCard {
                        word: r.get("word"),
                        meaning: r.get("meaning"),
                        pos_abbreviation: r.get("pos_abbreviation"),
                        pos_chinese: r.get("pos_chinese"),
                        ipa: r.get("ipa"),
                        syllables: r.get("syllables"),
                        phonics_rule: r.get("phonics_rule"),
                        analysis_explanation: r.get("analysis_explanation"),
                        examples: serde_json::from_str(&examples).unwrap_or_default(),
                    },
                )
            })
            .collect())
    }

    /// 写入或覆盖（同一单词重新生成时以新的为准）
    pub async fn upsert(&self, card: &WordCard) -> AppResult<()> {
        let now = crate::time::now_utc();
        sqlx::query(
            "INSERT INTO word_cards (word_key, word, meaning, pos_abbreviation, pos_chinese, ipa, syllables,
                                     phonics_rule, analysis_explanation, examples, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(word_key) DO UPDATE SET
                word = excluded.word, meaning = excluded.meaning, pos_abbreviation = excluded.pos_abbreviation,
                pos_chinese = excluded.pos_chinese, ipa = excluded.ipa, syllables = excluded.syllables,
                phonics_rule = excluded.phonics_rule, analysis_explanation = excluded.analysis_explanation,
                examples = excluded.examples, updated_at = excluded.updated_at",
        )
        .bind(card.word.trim().to_lowercase())
        .bind(card.word.trim())
        .bind(&card.meaning)
        .bind(&card.pos_abbreviation)
        .bind(&card.pos_chinese)
        .bind(&card.ipa)
        .bind(&card.syllables)
        .bind(&card.phonics_rule)
        .bind(&card.analysis_explanation)
        .bind(json(&card.examples)?)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }
}
