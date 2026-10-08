//! 日志级别设置：存 `app_settings` 的 `log.level`（DEBUG / INFO / WARN / ERROR），
//! 启动时读出来应用到 Logger，设置页修改后立即生效。低于该级别的日志不写入文件。

use crate::error::{AppError, AppResult};
use crate::logger::{LogLevel, Logger};
use crate::repositories::settings_repository::SettingsRepository;
use sqlx::SqlitePool;

const KEY: &str = "log.level";

pub struct LogSettingsService;

impl LogSettingsService {
    /// 保存的级别；未设置或无法识别时为默认（发布版 INFO、开发版 DEBUG）
    pub async fn saved_level(pool: &SqlitePool) -> AppResult<LogLevel> {
        Ok(SettingsRepository::get(pool, KEY)
            .await?
            .as_deref()
            .and_then(LogLevel::parse)
            .unwrap_or(LogLevel::DEFAULT))
    }

    /// 启动时把保存的级别应用到 Logger（读取失败保持默认，只记一条警告）
    pub async fn apply_saved(pool: &SqlitePool, logger: &Logger) {
        match Self::saved_level(pool).await {
            Ok(level) => logger.set_min_level(level),
            Err(e) => logger.warn(
                "APP",
                "读取日志级别设置失败，使用默认级别",
                Some(&e.to_string()),
            ),
        }
    }

    /// 保存并立即生效；返回生效后的级别名
    pub async fn set_level(pool: &SqlitePool, logger: &Logger, level: &str) -> AppResult<String> {
        let parsed = LogLevel::parse(level).ok_or_else(|| {
            AppError::ValidationError(format!(
                "日志级别只能是 DEBUG / INFO / WARN / ERROR，收到「{}」",
                level
            ))
        })?;
        let mut conn = pool.acquire().await?;
        SettingsRepository::set(&mut conn, KEY, Some(parsed.as_str())).await?;
        // 记为 WARN：调到 WARN 后这条仍会留下，说明之后为什么没有 INFO
        logger.warn("APP", &format!("日志级别改为 {}", parsed.as_str()), None);
        logger.set_min_level(parsed);
        Ok(parsed.as_str().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::memory_pool;

    #[tokio::test]
    async fn saves_and_applies_level() {
        let pool = memory_pool().await;
        let dir = std::env::temp_dir().join(format!("redlark-logset-{}", uuid::Uuid::new_v4()));
        let logger = Logger::new(&dir).unwrap();
        assert_eq!(
            LogSettingsService::saved_level(&pool).await.unwrap(),
            LogLevel::DEFAULT
        );

        assert_eq!(
            LogSettingsService::set_level(&pool, &logger, "warn")
                .await
                .unwrap(),
            "WARN"
        );
        assert_eq!(logger.min_level(), LogLevel::Warn);
        assert_eq!(
            LogSettingsService::saved_level(&pool).await.unwrap(),
            LogLevel::Warn
        );

        let fresh = Logger::new(&dir).unwrap();
        LogSettingsService::apply_saved(&pool, &fresh).await;
        assert_eq!(fresh.min_level(), LogLevel::Warn);

        assert!(LogSettingsService::set_level(&pool, &logger, "verbose")
            .await
            .is_err());
        assert_eq!(logger.min_level(), LogLevel::Warn);
    }
}
