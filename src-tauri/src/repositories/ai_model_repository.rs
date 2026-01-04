//! AI 模型数据访问层
//!
//! 提供 Repository 模式的数据访问封装

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::ai_model::AIModelConfig;
use crate::types::common::Id;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

/// AI 模型仓储
///
/// 负责 AI 模型的数据访问逻辑,封装所有数据库操作
pub struct AIModelRepository {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl AIModelRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 根据 ID 查找 AI 模型配置
    pub async fn find_model_config_by_id(&self, model_id: Id) -> AppResult<Option<AIModelConfig>> {
        use crate::types::ai_model::AIProvider;

        let query = r#"
            SELECT m.*, p.name as provider_name, p.base_url, p.api_key
            FROM ai_models m
            JOIN ai_providers p ON m.provider_id = p.id
            WHERE m.id = ? AND m.is_active = 1 AND p.is_active = 1
            LIMIT 1
        "#;

        let row = sqlx::query(query)
            .bind(model_id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "ai_models", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        match row {
            Some(row) => {
                self.logger.database_operation(
                    "SELECT",
                    "ai_models",
                    true,
                    Some(&format!("Found AI model {}", model_id)),
                );
                Ok(Some(AIModelConfig {
                    id: row.get("id"),
                    provider: AIProvider {
                        id: row.get("provider_id"),
                        name: row.get("provider_name"),
                        display_name: row.get("provider_name"),
                        base_url: row.get("base_url"),
                        api_key: row.get("api_key"),
                        description: None,
                        is_active: true,
                        created_at: row.get("created_at"),
                        updated_at: row.get("updated_at"),
                    },
                    name: row.get("name"),
                    display_name: row.get("display_name"),
                    model_id: row.get("model_id"),
                    description: row.get("description"),
                    max_tokens: row.get("max_tokens"),
                    temperature: row.get("temperature"),
                    is_active: row.get("is_active"),
                    is_default: row.get("is_default"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }))
            }
            None => Ok(None),
        }
    }

    /// 查找默认 AI 模型配置
    pub async fn find_default_model_config(&self) -> AppResult<Option<AIModelConfig>> {
        use crate::types::ai_model::AIProvider;

        let query = r#"
            SELECT m.*, p.name as provider_name, p.base_url, p.api_key
            FROM ai_models m
            JOIN ai_providers p ON m.provider_id = p.id
            WHERE m.is_default = 1 AND m.is_active = 1 AND p.is_active = 1
            LIMIT 1
        "#;

        let row = sqlx::query(query)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "ai_models", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        match row {
            Some(row) => {
                self.logger.database_operation(
                    "SELECT",
                    "ai_models",
                    true,
                    Some("Found default AI model"),
                );
                Ok(Some(AIModelConfig {
                    id: row.get("id"),
                    provider: AIProvider {
                        id: row.get("provider_id"),
                        name: row.get("provider_name"),
                        display_name: row.get("provider_name"),
                        base_url: row.get("base_url"),
                        api_key: row.get("api_key"),
                        description: None,
                        is_active: true,
                        created_at: row.get("created_at"),
                        updated_at: row.get("updated_at"),
                    },
                    name: row.get("name"),
                    display_name: row.get("display_name"),
                    model_id: row.get("model_id"),
                    description: row.get("description"),
                    max_tokens: row.get("max_tokens"),
                    temperature: row.get("temperature"),
                    is_active: row.get("is_active"),
                    is_default: row.get("is_default"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }))
            }
            None => Ok(None),
        }
    }
}
