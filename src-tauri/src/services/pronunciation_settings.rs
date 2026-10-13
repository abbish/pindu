//! 发音评估设置：存 `app_settings` 的 `pronunciation.settings`（整体 JSON）：开不开、多严格。
//! 「自动」按学习者档案定（小学生宽松，其余标准），换算在前端 `utils/pronunciation.ts`。

use crate::error::{AppError, AppResult};
use crate::repositories::settings_repository::SettingsRepository;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

const KEY: &str = "pronunciation.settings";
const STRICTNESS: [&str; 4] = ["auto", "lenient", "standard", "strict"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PronunciationSettings {
    /// 练习「看 · 说」时跟读并评估
    pub enabled: bool,
    /// auto 跟学习者 / lenient 宽松 / standard 标准 / strict 严格
    pub strictness: String,
}

impl Default for PronunciationSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            strictness: "auto".to_string(),
        }
    }
}

pub struct PronunciationSettingsService;

impl PronunciationSettingsService {
    /// 保存的设置；没设置时为默认，无法识别的严格程度当「自动」
    pub async fn get(pool: &SqlitePool) -> AppResult<PronunciationSettings> {
        let mut settings: PronunciationSettings = SettingsRepository::get(pool, KEY)
            .await?
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        if !STRICTNESS.contains(&settings.strictness.as_str()) {
            settings.strictness = "auto".to_string();
        }
        Ok(settings)
    }

    pub async fn save(
        pool: &SqlitePool,
        settings: PronunciationSettings,
    ) -> AppResult<PronunciationSettings> {
        if !STRICTNESS.contains(&settings.strictness.as_str()) {
            return Err(AppError::ValidationError(format!(
                "评分严格程度不对：{}",
                settings.strictness
            )));
        }
        let json =
            serde_json::to_string(&settings).map_err(|e| AppError::InternalError(e.to_string()))?;
        let mut conn = pool.acquire().await?;
        SettingsRepository::set(&mut conn, KEY, Some(&json)).await?;
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::memory_pool;

    #[tokio::test]
    async fn defaults_saves_and_rejects_unknown_strictness() {
        let pool = memory_pool().await;
        assert_eq!(
            PronunciationSettingsService::get(&pool).await.unwrap(),
            PronunciationSettings::default()
        );
        let saved = PronunciationSettings {
            enabled: false,
            strictness: "strict".to_string(),
        };
        PronunciationSettingsService::save(&pool, saved.clone())
            .await
            .unwrap();
        assert_eq!(
            PronunciationSettingsService::get(&pool).await.unwrap(),
            saved
        );
        assert!(PronunciationSettingsService::save(
            &pool,
            PronunciationSettings {
                enabled: true,
                strictness: "harsh".to_string()
            }
        )
        .await
        .is_err());
    }
}
