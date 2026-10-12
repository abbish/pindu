//! 局域网设备互传的设置：存 `app_settings` 的 `lan.settings`（JSON：enabled、alias）。
//! 默认关闭（不开就不广播、不监听端口），名字默认用系统的设备名。

use crate::error::{AppError, AppResult};
use crate::lan::protocol::clean_alias;
use crate::repositories::settings_repository::SettingsRepository;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

const KEY: &str = "lan.settings";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LanSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub alias: String,
}

/// 系统的设备名（如「小明的 MacBook Air」），取不到时用「拼读」
pub fn default_alias() -> String {
    whoami::fallible::devicename()
        .ok()
        .and_then(|n| clean_alias(&n))
        .unwrap_or_else(|| "拼读".to_string())
}

pub struct LanSettingsService;

impl LanSettingsService {
    pub async fn load(pool: &SqlitePool) -> AppResult<LanSettings> {
        let mut settings = match SettingsRepository::get(pool, KEY).await? {
            Some(raw) => serde_json::from_str(&raw).unwrap_or_else(|e| {
                tracing::warn!(component = "LAN", error = %e, "互传设置读不出来，用默认值");
                LanSettings {
                    enabled: false,
                    alias: String::new(),
                }
            }),
            None => LanSettings {
                enabled: false,
                alias: String::new(),
            },
        };
        settings.alias = clean_alias(&settings.alias).unwrap_or_else(default_alias);
        Ok(settings)
    }

    /// 校验并保存，返回保存后的设置
    pub async fn save(pool: &SqlitePool, enabled: bool, alias: &str) -> AppResult<LanSettings> {
        let alias = clean_alias(alias)
            .ok_or_else(|| AppError::ValidationError("请填写这台电脑的名字".into()))?;
        let settings = LanSettings { enabled, alias };
        let raw =
            serde_json::to_string(&settings).map_err(|e| AppError::InternalError(e.to_string()))?;
        let mut conn = pool.acquire().await?;
        SettingsRepository::set(&mut conn, KEY, Some(&raw)).await?;
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::memory_pool;

    #[tokio::test]
    async fn defaults_off_and_saves() {
        let pool = memory_pool().await;
        let s = LanSettingsService::load(&pool).await.unwrap();
        assert!(!s.enabled);
        assert!(!s.alias.is_empty());

        let saved = LanSettingsService::save(&pool, true, "  书房的电脑 ")
            .await
            .unwrap();
        assert_eq!(saved.alias, "书房的电脑");
        assert_eq!(LanSettingsService::load(&pool).await.unwrap(), saved);
        assert!(LanSettingsService::save(&pool, true, "   ").await.is_err());
    }
}
