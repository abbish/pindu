//! AI 提供商 / 模型管理与 AI 调用命令
//!
//! 列表类返回值一律为 `*Safe` 脱敏类型，API Key 不出后端。

use super::agent_paths;
use crate::agent::catalog::{self, CatalogModel, CatalogProviderSummary};
use crate::error::AppResult;
use crate::logger::Logger;
use crate::services::ai_model::AIModelService;
use crate::types::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// 获取全部 AI 提供商，含禁用的（设置页，脱敏）
#[tauri::command]
pub async fn get_all_ai_providers(app: AppHandle) -> AppResult<Vec<AIProviderSafe>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_all_ai_providers", None);

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.get_providers(true).await {
        Ok(v) => {
            logger.api_response(
                "get_all_ai_providers",
                true,
                Some(&format!(
                    "Returned {} providers (including inactive, safe)",
                    v.len()
                )),
            );
            Ok(v)
        }
        Err(e) => {
            logger.api_response("get_all_ai_providers", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取全部 AI 模型，含禁用的（设置页）
#[tauri::command]
pub async fn get_all_ai_models(
    app: AppHandle,
    query: Option<AIModelQuery>,
) -> AppResult<Vec<AIModelConfigSafe>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_all_ai_models",
        query
            .as_ref()
            .map(|q| format!("provider_id: {:?}", q.provider_id))
            .as_deref(),
    );

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.get_all_models(query).await {
        Ok(v) => {
            logger.api_response(
                "get_all_ai_models",
                true,
                Some(&format!("Returned {} models (including inactive)", v.len())),
            );
            Ok(v)
        }
        Err(e) => {
            logger.api_response("get_all_ai_models", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 设置默认 AI 模型
#[tauri::command]
pub async fn set_default_ai_model(app: AppHandle, model_id: Id) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "set_default_ai_model",
        Some(&format!("model_id: {}", model_id)),
    );

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.set_default_model(model_id).await {
        Ok(_v) => {
            logger.api_response(
                "set_default_ai_model",
                true,
                Some("Default model updated successfully"),
            );
            Ok(_v)
        }
        Err(e) => {
            logger.api_response("set_default_ai_model", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 创建 AI 提供商
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_ai_provider(
    app: AppHandle,
    name: String,
    display_name: String,
    base_url: String,
    api_key: String,
    description: Option<String>,
    pi_provider: Option<String>,
    api: Option<String>,
) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("create_ai_provider", Some(&format!("name: {}", name)));

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service
        .create_provider(NewAIProvider {
            name,
            display_name,
            base_url,
            api_key,
            description,
            pi_provider: pi_provider.filter(|p| !p.trim().is_empty()),
            api: api.unwrap_or_else(default_api),
        })
        .await
    {
        Ok(v) => {
            logger.api_response(
                "create_ai_provider",
                true,
                Some(&format!("Created provider with ID: {}", v)),
            );
            Ok(v)
        }
        Err(e) => {
            logger.api_response("create_ai_provider", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 更新 AI 提供商（None 字段不修改）
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_ai_provider(
    app: AppHandle,
    provider_id: Id,
    display_name: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    description: Option<String>,
    is_active: Option<bool>,
    pi_provider: Option<String>,
    api: Option<String>,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "update_ai_provider",
        Some(&format!("provider_id: {}", provider_id)),
    );

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service
        .update_provider(
            provider_id,
            AIProviderUpdate {
                display_name,
                base_url,
                api_key,
                description,
                is_active,
                pi_provider,
                api,
            },
        )
        .await
    {
        Ok(_v) => {
            logger.api_response(
                "update_ai_provider",
                true,
                Some("Provider updated successfully"),
            );
            Ok(_v)
        }
        Err(e) => {
            logger.api_response("update_ai_provider", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 删除 AI 提供商及其全部模型
#[tauri::command]
pub async fn delete_ai_provider(app: AppHandle, provider_id: Id) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "delete_ai_provider",
        Some(&format!("provider_id: {}", provider_id)),
    );

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.delete_provider(provider_id).await {
        Ok(_v) => {
            logger.api_response(
                "delete_ai_provider",
                true,
                Some("Provider deleted successfully"),
            );
            Ok(_v)
        }
        Err(e) => {
            logger.api_response("delete_ai_provider", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 创建 AI 模型
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_ai_model(
    app: AppHandle,
    provider_id: Id,
    name: String,
    display_name: String,
    model_id: String,
    description: Option<String>,
    generation: Option<ModelGenerationSettings>,
) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "create_ai_model",
        Some(&format!("name: {}, provider_id: {}", name, provider_id)),
    );

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service
        .create_model(NewAIModel {
            provider_id,
            name,
            display_name,
            model_id,
            description,
            generation: generation.unwrap_or_default(),
        })
        .await
    {
        Ok(v) => {
            logger.api_response(
                "create_ai_model",
                true,
                Some(&format!("Created model with ID: {}", v)),
            );
            Ok(v)
        }
        Err(e) => {
            logger.api_response("create_ai_model", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 更新 AI 模型（None 字段不修改）
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_ai_model(
    app: AppHandle,
    model_id: Id,
    display_name: Option<String>,
    model_id_param: Option<String>,
    description: Option<String>,
    is_active: Option<bool>,
    is_default: Option<bool>,
    generation: Option<ModelGenerationSettings>,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("update_ai_model", Some(&format!("model_id: {}", model_id)));

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service
        .update_model(
            model_id,
            AIModelUpdate {
                display_name,
                model_id: model_id_param,
                description,
                is_active,
                is_default,
                generation,
            },
        )
        .await
    {
        Ok(_v) => {
            logger.api_response("update_ai_model", true, Some("Model updated successfully"));
            Ok(_v)
        }
        Err(e) => {
            logger.api_response("update_ai_model", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 删除 AI 模型
#[tauri::command]
pub async fn delete_ai_model(app: AppHandle, model_id: Id) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("delete_ai_model", Some(&format!("model_id: {}", model_id)));

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.delete_model(model_id).await {
        Ok(_v) => {
            logger.api_response("delete_ai_model", true, Some("Model deleted successfully"));
            Ok(_v)
        }
        Err(e) => {
            logger.api_response("delete_ai_model", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 测试 AI 模型：发送一条简单对话
#[tauri::command]
pub async fn test_ai_model(
    app: AppHandle,
    model_id: i64,
    test_text: Option<String>,
) -> AppResult<TestAIModelResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "test_ai_model",
        Some(&format!(
            "model_id: {}, test_text: {:?}",
            model_id, test_text
        )),
    );

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    let paths = match agent_paths(&app) {
        Ok(paths) => paths,
        Err(e) => {
            logger.api_response("test_ai_model", false, Some(&e.to_string()));
            return Err(e);
        }
    };
    match service.test_model(model_id, test_text, &paths).await {
        Ok(_v) => {
            logger.api_response("test_ai_model", true, Some("Model test successful"));
            Ok(_v)
        }
        Err(e) => {
            logger.api_response("test_ai_model", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 可添加的模型列表（设置页「同步模型」）：映射了 pi 内置 provider 时合并 pi 目录与提供商 `/models`
#[tauri::command]
pub async fn list_provider_remote_models(
    app: AppHandle,
    provider_id: Id,
) -> AppResult<Vec<RemoteModelInfo>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "list_provider_remote_models",
        Some(&format!("provider_id: {}", provider_id)),
    );

    let service = AIModelService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );
    // 目录读取失败（如 sidecar 缺失）不阻断：退回只读远端
    let catalog = match agent_paths(&app) {
        Ok(paths) => catalog::load_catalog(&paths).await.ok(),
        Err(_) => None,
    };

    match service
        .list_remote_models(provider_id, catalog.as_deref().map(Vec::as_slice))
        .await
    {
        Ok(v) => {
            logger.api_response(
                "list_provider_remote_models",
                true,
                Some(&format!("Returned {} models", v.len())),
            );
            Ok(v)
        }
        Err(e) => {
            logger.api_response("list_provider_remote_models", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// pi 内置提供商列表（设置页「映射到 pi 内置提供商」下拉）
#[tauri::command]
pub async fn get_agent_catalog_providers(app: AppHandle) -> AppResult<Vec<CatalogProviderSummary>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_agent_catalog_providers", None);
    let result = match agent_paths(&app) {
        Ok(paths) => catalog::load_catalog(&paths).await.map(|c| {
            c.iter()
                .map(CatalogProviderSummary::from)
                .collect::<Vec<_>>()
        }),
        Err(e) => Err(e),
    };
    match &result {
        Ok(v) => logger.api_response(
            "get_agent_catalog_providers",
            true,
            Some(&format!("Returned {} providers", v.len())),
        ),
        Err(e) => logger.api_response("get_agent_catalog_providers", false, Some(&e.to_string())),
    }
    result
}

/// 某个 pi 内置提供商的模型目录（思考档、上下文、价格）
#[tauri::command]
pub async fn get_agent_catalog_models(
    app: AppHandle,
    pi_provider: String,
) -> AppResult<Vec<CatalogModel>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_agent_catalog_models",
        Some(&format!("pi_provider: {}", pi_provider)),
    );
    let result = match agent_paths(&app) {
        Ok(paths) => catalog::load_catalog(&paths)
            .await
            .map(|c| catalog::provider_models(&c, &pi_provider).to_vec()),
        Err(e) => Err(e),
    };
    match &result {
        Ok(v) => logger.api_response(
            "get_agent_catalog_models",
            true,
            Some(&format!("Returned {} models", v.len())),
        ),
        Err(e) => logger.api_response("get_agent_catalog_models", false, Some(&e.to_string())),
    }
    result
}
