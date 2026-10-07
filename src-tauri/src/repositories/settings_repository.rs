//! 应用设置（app_settings 键值表）的数据访问

use crate::error::AppResult;
use sqlx::SqlitePool;
use std::collections::HashMap;

pub struct SettingsRepository;

impl SettingsRepository {
    /// 读取以 `prefix` 开头的全部设置
    pub async fn with_prefix(
        pool: &SqlitePool,
        prefix: &str,
    ) -> AppResult<HashMap<String, String>> {
        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT key, value FROM app_settings WHERE key LIKE ? || '%'")
                .bind(prefix)
                .fetch_all(pool)
                .await?;
        Ok(rows.into_iter().collect())
    }

    pub async fn get(pool: &SqlitePool, key: &str) -> AppResult<Option<String>> {
        Ok(
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = ?")
                .bind(key)
                .fetch_optional(pool)
                .await?,
        )
    }

    /// 写入（None 表示删除，回到默认值）
    pub async fn set(
        conn: &mut sqlx::SqliteConnection,
        key: &str,
        value: Option<&str>,
    ) -> AppResult<()> {
        match value {
            Some(v) => {
                sqlx::query(&format!(
                    "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, {now})
                     ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = {now}",
                    now = crate::time::SQL_NOW_UTC
                ))
                .bind(key)
                .bind(v)
                .execute(&mut *conn)
                .await?;
            }
            None => {
                sqlx::query("DELETE FROM app_settings WHERE key = ?")
                    .bind(key)
                    .execute(&mut *conn)
                    .await?;
            }
        }
        Ok(())
    }
}
