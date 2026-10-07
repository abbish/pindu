//! 单词讲解缓存（word_explanations，一个单词一份）

use crate::error::AppResult;
use crate::types::common::Id;
use crate::types::wordbook::WordExplanation;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

pub struct WordExplanationRepository {
    pool: Arc<SqlitePool>,
}

impl WordExplanationRepository {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    /// 读取缓存的讲解：只认 `min_prompt_version` 及以上版本生成的。
    /// `fingerprint` 为 Some 时还要求提示词指纹一致（`accept_unmarked` 为真时也接受未记录指纹的旧记录）；None 不比对指纹。
    pub async fn find(
        &self,
        word_id: Id,
        min_prompt_version: i64,
        fingerprint: Option<&str>,
        accept_unmarked: bool,
    ) -> AppResult<Option<WordExplanation>> {
        let row = sqlx::query(
            "SELECT word_id, content, model_name, updated_at FROM word_explanations
             WHERE word_id = ?1 AND prompt_version >= ?2
               AND (?3 IS NULL OR prompt_fingerprint = ?3 OR (prompt_fingerprint IS NULL AND ?4))",
        )
        .bind(word_id)
        .bind(min_prompt_version)
        .bind(fingerprint)
        .bind(accept_unmarked)
        .fetch_optional(self.pool.as_ref())
        .await?;
        Ok(row.map(|row| WordExplanation {
            word_id: row.get("word_id"),
            content: row.get("content"),
            model_name: row.get("model_name"),
            updated_at: row.get("updated_at"),
        }))
    }

    /// 写入（覆盖）讲解，返回保存后的记录
    pub async fn upsert(
        &self,
        word_id: Id,
        content: &str,
        model_name: Option<&str>,
        prompt_version: i64,
        fingerprint: &str,
    ) -> AppResult<WordExplanation> {
        sqlx::query(
            "INSERT INTO word_explanations (word_id, content, model_name, prompt_version, prompt_fingerprint, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(word_id) DO UPDATE SET
                 content = excluded.content,
                 model_name = excluded.model_name,
                 prompt_version = excluded.prompt_version,
                 prompt_fingerprint = excluded.prompt_fingerprint,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        )
        .bind(word_id)
        .bind(content)
        .bind(model_name)
        .bind(prompt_version)
        .bind(fingerprint)
        .execute(self.pool.as_ref())
        .await?;
        self.find(word_id, prompt_version, Some(fingerprint), false)
            .await?
            .ok_or_else(|| crate::error::AppError::InternalError("讲解保存后未找到".to_string()))
    }
}
