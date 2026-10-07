//! AI 模型数据访问层
//!
//! `ai_providers` / `ai_models` 两张表的全部 SQL。返回的 `AIProvider` / `AIModelConfig`
//! 含 API Key 明文，只能在后端使用；返回给前端前由调用方转换为 `*Safe` 类型。

use crate::error::AppResult;
use crate::logger::Logger;
use crate::types::ai_model::{
    AIModelConfig, AIModelQuery, AIModelUpdate, AIProvider, AIProviderUpdate, NewAIModel,
    NewAIProvider,
};
use crate::types::common::Id;
use sqlx::sqlite::SqliteRow;
use sqlx::{QueryBuilder, Row, Sqlite, SqliteConnection, SqlitePool};
use std::sync::Arc;

const PROVIDER_COLUMNS: &str = "SELECT id, name, display_name, base_url, api_key, description, pi_provider, api, is_active, created_at, updated_at FROM ai_providers";

const MODEL_SELECT: &str = r#"
    SELECT
        m.id, m.name, m.display_name, m.model_id, m.description,
        m.max_tokens, m.temperature, m.thinking_level, m.extra_params, m.context_window, m.reasoning,
        m.is_active, m.is_default,
        m.created_at, m.updated_at,
        p.id as provider_id, p.name as provider_name, p.display_name as provider_display_name,
        p.base_url, p.api_key, p.description as provider_description,
        p.pi_provider, p.api,
        p.is_active as provider_is_active, p.created_at as provider_created_at,
        p.updated_at as provider_updated_at
    FROM ai_models m
    JOIN ai_providers p ON m.provider_id = p.id
"#;

fn provider_from_row(row: &SqliteRow) -> AIProvider {
    AIProvider {
        id: row.get("id"),
        name: row.get("name"),
        display_name: row.get("display_name"),
        base_url: row.get("base_url"),
        api_key: row.get("api_key"),
        description: row.get("description"),
        pi_provider: row.get("pi_provider"),
        api: row.get("api"),
        is_active: row.get("is_active"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn model_from_row(row: &SqliteRow) -> AIModelConfig {
    AIModelConfig {
        id: row.get("id"),
        name: row.get("name"),
        display_name: row.get("display_name"),
        model_id: row.get("model_id"),
        description: row.get("description"),
        max_tokens: row.get("max_tokens"),
        temperature: row.get("temperature"),
        thinking_level: row.get("thinking_level"),
        // 非法 JSON 视为未设置（写入时由服务层校验）
        extra_params: row
            .get::<Option<String>, _>("extra_params")
            .and_then(|s| serde_json::from_str(&s).ok()),
        context_window: row.get("context_window"),
        reasoning: row.get("reasoning"),
        is_active: row.get("is_active"),
        is_default: row.get("is_default"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        provider: AIProvider {
            id: row.get("provider_id"),
            name: row.get("provider_name"),
            display_name: row.get("provider_display_name"),
            base_url: row.get("base_url"),
            api_key: row.get("api_key"),
            description: row.get("provider_description"),
            pi_provider: row.get("pi_provider"),
            api: row.get("api"),
            is_active: row.get("provider_is_active"),
            created_at: row.get("provider_created_at"),
            updated_at: row.get("provider_updated_at"),
        },
    }
}

/// AI 模型仓储
pub struct AIModelRepository {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl AIModelRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    // ==================== 提供商 ====================

    /// 查询提供商；`include_inactive` 为 false 时只返回启用的
    pub async fn find_providers(&self, include_inactive: bool) -> AppResult<Vec<AIProvider>> {
        let sql = if include_inactive {
            format!("{} ORDER BY is_active DESC, display_name", PROVIDER_COLUMNS)
        } else {
            format!(
                "{} WHERE is_active = 1 ORDER BY display_name",
                PROVIDER_COLUMNS
            )
        };
        let rows = sqlx::query(&sql).fetch_all(self.pool.as_ref()).await?;
        self.logger.database_operation(
            "SELECT",
            "ai_providers",
            true,
            Some(&format!("Found {} providers", rows.len())),
        );
        Ok(rows.iter().map(provider_from_row).collect())
    }

    /// 按 ID 查询提供商（含 API Key，仅后端使用）
    pub async fn find_provider_by_id(&self, provider_id: Id) -> AppResult<Option<AIProvider>> {
        let sql = format!("{} WHERE id = ?", PROVIDER_COLUMNS);
        let row = sqlx::query(&sql)
            .bind(provider_id)
            .fetch_optional(self.pool.as_ref())
            .await?;
        Ok(row.as_ref().map(provider_from_row))
    }

    /// 提供商是否存在且启用
    pub async fn is_provider_active(&self, provider_id: Id) -> AppResult<bool> {
        let row = sqlx::query("SELECT id FROM ai_providers WHERE id = ? AND is_active = 1")
            .bind(provider_id)
            .fetch_optional(self.pool.as_ref())
            .await?;
        Ok(row.is_some())
    }

    /// 新建提供商，返回 ID
    pub async fn insert_provider(&self, provider: &NewAIProvider) -> AppResult<Id> {
        let result = sqlx::query(
            r#"
            INSERT INTO ai_providers (name, display_name, base_url, api_key, description, pi_provider, api, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        "#,
        )
        .bind(&provider.name)
        .bind(&provider.display_name)
        .bind(&provider.base_url)
        .bind(&provider.api_key)
        .bind(&provider.description)
        .bind(&provider.pi_provider)
        .bind(&provider.api)
        .execute(self.pool.as_ref())
        .await?;
        Ok(result.last_insert_rowid())
    }

    /// 部分更新提供商，返回受影响行数；调用方保证至少有一个字段
    pub async fn update_provider(
        &self,
        provider_id: Id,
        update: &AIProviderUpdate,
    ) -> AppResult<u64> {
        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("UPDATE ai_providers SET ");
        let mut set = qb.separated(", ");
        if let Some(v) = &update.display_name {
            set.push("display_name = ").push_bind_unseparated(v.clone());
        }
        if let Some(v) = &update.base_url {
            set.push("base_url = ").push_bind_unseparated(v.clone());
        }
        if let Some(v) = &update.api_key {
            set.push("api_key = ").push_bind_unseparated(v.clone());
        }
        if let Some(v) = &update.description {
            set.push("description = ").push_bind_unseparated(v.clone());
        }
        if let Some(v) = update.is_active {
            set.push("is_active = ").push_bind_unseparated(v);
        }
        if let Some(v) = &update.pi_provider {
            let v = v.trim();
            set.push("pi_provider = ")
                .push_bind_unseparated((!v.is_empty()).then(|| v.to_string()));
        }
        if let Some(v) = &update.api {
            set.push("api = ").push_bind_unseparated(v.clone());
        }
        set.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        qb.push(" WHERE id = ").push_bind(provider_id);

        let result = qb.build().execute(self.pool.as_ref()).await?;
        Ok(result.rows_affected())
    }

    /// 删除提供商下的全部模型（在调用方事务内执行），返回删除数
    pub async fn delete_models_by_provider(
        &self,
        conn: &mut SqliteConnection,
        provider_id: Id,
    ) -> AppResult<u64> {
        let result = sqlx::query("DELETE FROM ai_models WHERE provider_id = ?")
            .bind(provider_id)
            .execute(&mut *conn)
            .await?;
        Ok(result.rows_affected())
    }

    /// 删除提供商（在调用方事务内执行），返回受影响行数
    pub async fn delete_provider(
        &self,
        conn: &mut SqliteConnection,
        provider_id: Id,
    ) -> AppResult<u64> {
        let result = sqlx::query("DELETE FROM ai_providers WHERE id = ?")
            .bind(provider_id)
            .execute(&mut *conn)
            .await?;
        Ok(result.rows_affected())
    }

    // ==================== 模型 ====================

    /// 查询模型（含提供商）。
    /// `include_inactive` 为 false 时只返回模型与提供商都启用的；`query.is_active` 未使用（保持既有行为）。
    pub async fn find_models(
        &self,
        query: Option<&AIModelQuery>,
        include_inactive: bool,
    ) -> AppResult<Vec<AIModelConfig>> {
        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(MODEL_SELECT);
        qb.push(if include_inactive {
            " WHERE 1 = 1"
        } else {
            " WHERE m.is_active = 1 AND p.is_active = 1"
        });
        if let Some(q) = query {
            if let Some(provider_id) = q.provider_id {
                qb.push(" AND m.provider_id = ").push_bind(provider_id);
            }
            if let Some(is_default) = q.is_default {
                qb.push(" AND m.is_default = ").push_bind(is_default);
            }
        }
        qb.push(if include_inactive {
            " ORDER BY m.is_active DESC, m.is_default DESC, p.display_name, m.display_name"
        } else {
            " ORDER BY m.is_default DESC, p.display_name, m.display_name"
        });

        let rows = qb.build().fetch_all(self.pool.as_ref()).await?;
        self.logger.database_operation(
            "SELECT",
            "ai_models",
            true,
            Some(&format!("Found {} models", rows.len())),
        );
        Ok(rows.iter().map(model_from_row).collect())
    }

    /// 按 ID 查找启用中的模型（模型与提供商都启用）
    pub async fn find_model_config_by_id(&self, model_id: Id) -> AppResult<Option<AIModelConfig>> {
        let sql = format!(
            "{} WHERE m.id = ? AND m.is_active = 1 AND p.is_active = 1 LIMIT 1",
            MODEL_SELECT
        );
        let row = sqlx::query(&sql)
            .bind(model_id)
            .fetch_optional(self.pool.as_ref())
            .await?;
        Ok(row.as_ref().map(model_from_row))
    }

    /// 查找默认模型（模型与提供商都启用）
    pub async fn find_default_model_config(&self) -> AppResult<Option<AIModelConfig>> {
        let sql = format!(
            "{} WHERE m.is_default = 1 AND m.is_active = 1 AND p.is_active = 1 LIMIT 1",
            MODEL_SELECT
        );
        let row = sqlx::query(&sql).fetch_optional(self.pool.as_ref()).await?;
        Ok(row.as_ref().map(model_from_row))
    }

    /// 清除所有模型的默认标记（在调用方事务内执行）
    pub async fn clear_default_flags(&self, conn: &mut SqliteConnection) -> AppResult<()> {
        sqlx::query("UPDATE ai_models SET is_default = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')")
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    /// 把指定模型设为默认（在调用方事务内执行），返回受影响行数
    pub async fn set_default_flag(
        &self,
        conn: &mut SqliteConnection,
        model_id: Id,
    ) -> AppResult<u64> {
        let result = sqlx::query(
            "UPDATE ai_models SET is_default = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        )
        .bind(model_id)
        .execute(&mut *conn)
        .await?;
        Ok(result.rows_affected())
    }

    /// 新建模型，返回 ID
    pub async fn insert_model(&self, model: &NewAIModel) -> AppResult<Id> {
        let result = sqlx::query(
            r#"
            INSERT INTO ai_models (
                provider_id, name, display_name, model_id, description,
                max_tokens, temperature, thinking_level, extra_params, context_window, reasoning,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        "#,
        )
        .bind(model.provider_id)
        .bind(&model.name)
        .bind(&model.display_name)
        .bind(&model.model_id)
        .bind(&model.description)
        .bind(model.generation.max_tokens)
        .bind(model.generation.temperature)
        .bind(&model.generation.thinking_level)
        .bind(
            model
                .generation
                .extra_params
                .as_ref()
                .map(|v| v.to_string()),
        )
        .bind(model.generation.context_window)
        .bind(model.generation.reasoning)
        .execute(self.pool.as_ref())
        .await?;
        Ok(result.last_insert_rowid())
    }

    /// 部分更新模型，返回受影响行数；调用方保证至少有一个字段
    pub async fn update_model(&self, model_id: Id, update: &AIModelUpdate) -> AppResult<u64> {
        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("UPDATE ai_models SET ");
        let mut set = qb.separated(", ");
        if let Some(v) = &update.display_name {
            set.push("display_name = ").push_bind_unseparated(v.clone());
        }
        if let Some(v) = &update.model_id {
            set.push("model_id = ").push_bind_unseparated(v.clone());
        }
        if let Some(v) = &update.description {
            set.push("description = ").push_bind_unseparated(v.clone());
        }
        if let Some(g) = &update.generation {
            set.push("max_tokens = ")
                .push_bind_unseparated(g.max_tokens);
            set.push("temperature = ")
                .push_bind_unseparated(g.temperature);
            set.push("thinking_level = ")
                .push_bind_unseparated(g.thinking_level.clone());
            set.push("extra_params = ")
                .push_bind_unseparated(g.extra_params.as_ref().map(|v| v.to_string()));
            set.push("context_window = ")
                .push_bind_unseparated(g.context_window);
            set.push("reasoning = ").push_bind_unseparated(g.reasoning);
        }
        if let Some(v) = update.is_active {
            set.push("is_active = ").push_bind_unseparated(v);
        }
        if let Some(v) = update.is_default {
            set.push("is_default = ").push_bind_unseparated(v);
        }
        set.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        qb.push(" WHERE id = ").push_bind(model_id);

        let result = qb.build().execute(self.pool.as_ref()).await?;
        Ok(result.rows_affected())
    }

    /// 删除模型，返回受影响行数
    pub async fn delete_model(&self, model_id: Id) -> AppResult<u64> {
        let result = sqlx::query("DELETE FROM ai_models WHERE id = ?")
            .bind(model_id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(result.rows_affected())
    }
}
