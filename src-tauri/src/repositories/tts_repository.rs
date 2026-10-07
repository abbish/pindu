//! TTS 数据访问层：`volcengine_tts_config`（单行，id = 1）与 `tts_cache`

use crate::error::AppResult;
use crate::types::tts::{TTSCacheEntry, UpdateTtsConfigRequest, VolcengineTtsConfig};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::sync::Arc;

/// TTS 仓储
pub struct TtsRepository {
    pool: Arc<SqlitePool>,
}

impl TtsRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    // ==================== 火山引擎语音合成配置 ====================

    /// 读取豆包语音合成配置（含密钥明文，仅后端使用）
    pub async fn find_volcengine_config(&self) -> AppResult<Option<VolcengineTtsConfig>> {
        let row = sqlx::query(
            "SELECT api_key, app_id, access_key, resource_id, default_voice_id, speech_rate, sample_rate
             FROM volcengine_tts_config WHERE id = 1",
        )
        .fetch_optional(self.pool.as_ref())
        .await?;

        Ok(row.map(|row| VolcengineTtsConfig {
            api_key: row.get("api_key"),
            app_id: row.get("app_id"),
            access_key: row.get("access_key"),
            resource_id: row.get("resource_id"),
            default_voice_id: row.get("default_voice_id"),
            speech_rate: row.get("speech_rate"),
            sample_rate: row.get("sample_rate"),
        }))
    }

    /// 部分更新配置，返回受影响行数；调用方保证至少有一个字段
    pub async fn update_volcengine_config(
        &self,
        update: &UpdateTtsConfigRequest,
    ) -> AppResult<u64> {
        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("UPDATE volcengine_tts_config SET ");
        let mut set = qb.separated(", ");
        let text_fields = [
            ("api_key = ", &update.api_key),
            ("app_id = ", &update.app_id),
            ("access_key = ", &update.access_key),
            ("resource_id = ", &update.resource_id),
            ("default_voice_id = ", &update.default_voice_id),
        ];
        for (column, value) in text_fields {
            if let Some(v) = value {
                set.push(column).push_bind_unseparated(v.trim().to_string());
            }
        }
        if let Some(v) = update.speech_rate {
            set.push("speech_rate = ").push_bind_unseparated(v);
        }
        set.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        qb.push(" WHERE id = 1");

        let result = qb.build().execute(self.pool.as_ref()).await?;
        Ok(result.rows_affected())
    }

    // ==================== 音频缓存 ====================

    /// 按文本哈希查找缓存记录
    pub async fn find_cache_entry(&self, text_hash: &str) -> AppResult<Option<TTSCacheEntry>> {
        let row = sqlx::query(
            "SELECT id, text_hash, original_text, voice_id, model_id, file_path, file_size,
                    duration_ms, created_at, last_used, use_count
             FROM tts_cache WHERE text_hash = ?",
        )
        .bind(text_hash)
        .fetch_optional(self.pool.as_ref())
        .await?;

        Ok(row.map(|row| TTSCacheEntry {
            id: row.get("id"),
            text_hash: row.get("text_hash"),
            original_text: row.get("original_text"),
            voice_id: row.get("voice_id"),
            model_id: row.get("model_id"),
            file_path: row.get("file_path"),
            file_size: row.get("file_size"),
            duration_ms: row.get("duration_ms"),
            created_at: row.get("created_at"),
            last_used: row.get("last_used"),
            use_count: row.get("use_count"),
        }))
    }

    /// 记录一次缓存命中
    pub async fn touch_cache_entry(&self, text_hash: &str) -> AppResult<()> {
        sqlx::query(
            "UPDATE tts_cache SET last_used = strftime('%Y-%m-%dT%H:%M:%fZ','now'), use_count = use_count + 1
             WHERE text_hash = ?",
        )
        .bind(text_hash)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    /// 删除一条缓存记录
    pub async fn delete_cache_entry(&self, text_hash: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM tts_cache WHERE text_hash = ?")
            .bind(text_hash)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    /// 写入（或覆盖）一条缓存记录
    pub async fn upsert_cache_entry(
        &self,
        text_hash: &str,
        original_text: &str,
        voice_id: &str,
        model_id: &str,
        file_path: &str,
        file_size: i64,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO tts_cache (text_hash, original_text, voice_id, model_id, file_path, file_size, created_at, last_used)
             VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(text_hash)
        .bind(original_text)
        .bind(voice_id)
        .bind(model_id)
        .bind(file_path)
        .bind(file_size)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    /// 缓存统计：(条数, 字节数, 超过 `days` 天未用的条数, 其字节数)
    pub async fn cache_stats(&self, days: i64) -> AppResult<(i64, i64, i64, i64)> {
        let row = sqlx::query(
            "SELECT COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes,
                    COALESCE(SUM(CASE WHEN last_used < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-' || ?1 || ' days') THEN 1 ELSE 0 END), 0) AS stale_n,
                    COALESCE(SUM(CASE WHEN last_used < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-' || ?1 || ' days') THEN file_size ELSE 0 END), 0) AS stale_bytes
             FROM tts_cache",
        )
        .bind(days)
        .fetch_one(self.pool.as_ref())
        .await?;
        Ok((
            row.get("n"),
            row.get("bytes"),
            row.get("stale_n"),
            row.get("stale_bytes"),
        ))
    }

    /// 最近使用时间早于 `days` 天前的缓存：返回 (text_hash, file_path)
    pub async fn find_cache_unused_for_days(&self, days: i64) -> AppResult<Vec<(String, String)>> {
        let rows = sqlx::query(
            "SELECT text_hash, file_path FROM tts_cache
             WHERE last_used < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-' || ? || ' days')",
        )
        .bind(days)
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.get("text_hash"), row.get("file_path")))
            .collect())
    }
}
