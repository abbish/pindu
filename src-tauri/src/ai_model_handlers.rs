use tauri::{AppHandle, Manager};
use sqlx::{SqlitePool, Row};
use crate::types::*;
use crate::error::{AppResult, AppError};
use crate::logger::Logger;

/// 获取所有AI提供商
#[tauri::command]
pub async fn get_ai_providers(app: AppHandle) -> AppResult<Vec<AIProvider>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_ai_providers", None);

    let query = r#"
        SELECT id, name, display_name, base_url, api_key, description, is_active, created_at, updated_at
        FROM ai_providers
        WHERE is_active = 1
        ORDER BY display_name
    "#;

    let rows = match sqlx::query(query).fetch_all(pool.inner()).await {
        Ok(rows) => {
            logger.database_operation("SELECT", "ai_providers", true, Some(&format!("Found {} providers", rows.len())));
            rows
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "ai_providers", false, Some(&error_msg));
            logger.api_response("get_ai_providers", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    let providers: Vec<AIProvider> = rows
        .into_iter()
        .map(|row| AIProvider {
            id: row.get("id"),
            name: row.get("name"),
            display_name: row.get("display_name"),
            base_url: row.get("base_url"),
            api_key: row.get("api_key"),
            description: row.get("description"),
            is_active: row.get("is_active"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect();

    logger.api_response("get_ai_providers", true, Some(&format!("Returned {} providers", providers.len())));
    Ok(providers)
}

/// 获取AI模型列表
#[tauri::command]
pub async fn get_ai_models(
    app: AppHandle,
    query: Option<AIModelQuery>,
) -> AppResult<Vec<AIModelConfig>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_ai_models", query.as_ref().map(|q| format!("provider_id: {:?}", q.provider_id)).as_deref());

    let mut sql = r#"
        SELECT 
            m.id, m.name, m.display_name, m.model_id, m.description, 
            m.max_tokens, m.temperature, m.is_active, m.is_default,
            m.created_at, m.updated_at,
            p.id as provider_id, p.name as provider_name, p.display_name as provider_display_name,
            p.base_url, p.api_key, p.description as provider_description,
            p.is_active as provider_is_active, p.created_at as provider_created_at, 
            p.updated_at as provider_updated_at
        FROM ai_models m
        JOIN ai_providers p ON m.provider_id = p.id
        WHERE m.is_active = 1 AND p.is_active = 1
    "#.to_string();

    if let Some(q) = &query {
        if let Some(provider_id) = q.provider_id {
            sql.push_str(&format!(" AND m.provider_id = {}", provider_id));
        }
        if let Some(is_default) = q.is_default {
            sql.push_str(&format!(" AND m.is_default = {}", if is_default { 1 } else { 0 }));
        }
    }

    sql.push_str(" ORDER BY m.is_default DESC, p.display_name, m.display_name");

    let rows = match sqlx::query(&sql).fetch_all(pool.inner()).await {
        Ok(rows) => {
            logger.database_operation("SELECT", "ai_models", true, Some(&format!("Found {} models", rows.len())));
            rows
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "ai_models", false, Some(&error_msg));
            logger.api_response("get_ai_models", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    let models: Vec<AIModelConfig> = rows
        .into_iter()
        .map(|row| AIModelConfig {
            id: row.get("id"),
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
            provider: AIProvider {
                id: row.get("provider_id"),
                name: row.get("provider_name"),
                display_name: row.get("provider_display_name"),
                base_url: row.get("base_url"),
                api_key: row.get("api_key"),
                description: row.get("provider_description"),
                is_active: row.get("provider_is_active"),
                created_at: row.get("provider_created_at"),
                updated_at: row.get("provider_updated_at"),
            },
        })
        .collect();

    logger.api_response("get_ai_models", true, Some(&format!("Returned {} models", models.len())));
    Ok(models)
}

/// 获取默认AI模型
#[tauri::command]
pub async fn get_default_ai_model(app: AppHandle) -> AppResult<Option<AIModelConfig>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_default_ai_model", None);

    let query = r#"
        SELECT 
            m.id, m.name, m.display_name, m.model_id, m.description, 
            m.max_tokens, m.temperature, m.is_active, m.is_default,
            m.created_at, m.updated_at,
            p.id as provider_id, p.name as provider_name, p.display_name as provider_display_name,
            p.base_url, p.api_key, p.description as provider_description,
            p.is_active as provider_is_active, p.created_at as provider_created_at, 
            p.updated_at as provider_updated_at
        FROM ai_models m
        JOIN ai_providers p ON m.provider_id = p.id
        WHERE m.is_default = 1 AND m.is_active = 1 AND p.is_active = 1
        LIMIT 1
    "#;

    let row = match sqlx::query(query).fetch_optional(pool.inner()).await {
        Ok(row) => {
            logger.database_operation("SELECT", "ai_models", true, Some("Default model query successful"));
            row
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "ai_models", false, Some(&error_msg));
            logger.api_response("get_default_ai_model", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    let model = row.map(|row| AIModelConfig {
        id: row.get("id"),
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
        provider: AIProvider {
            id: row.get("provider_id"),
            name: row.get("provider_name"),
            display_name: row.get("provider_display_name"),
            base_url: row.get("base_url"),
            api_key: row.get("api_key"),
            description: row.get("provider_description"),
            is_active: row.get("provider_is_active"),
            created_at: row.get("provider_created_at"),
            updated_at: row.get("provider_updated_at"),
        },
    });

    logger.api_response("get_default_ai_model", true, Some(&format!("Default model: {:?}", model.as_ref().map(|m| &m.display_name))));
    Ok(model)
}

/// 设置默认AI模型
#[tauri::command]
pub async fn set_default_ai_model(app: AppHandle, model_id: Id) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("set_default_ai_model", Some(&format!("model_id: {}", model_id)));

    // 开始事务
    let mut tx = match pool.inner().begin().await {
        Ok(tx) => tx,
        Err(e) => {
            let error_msg = format!("Failed to start transaction: {}", e);
            logger.database_operation("BEGIN", "ai_models", false, Some(&error_msg));
            logger.api_response("set_default_ai_model", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    // 清除所有默认标记
    let clear_query = "UPDATE ai_models SET is_default = 0, updated_at = datetime('now')";
    if let Err(e) = sqlx::query(clear_query).execute(&mut *tx).await {
        let error_msg = format!("Failed to clear default flags: {}", e);
        logger.database_operation("UPDATE", "ai_models", false, Some(&error_msg));
        logger.api_response("set_default_ai_model", false, Some(&error_msg));
        return Err(AppError::DatabaseError(error_msg));
    }

    // 设置新的默认模型
    let set_query = "UPDATE ai_models SET is_default = 1, updated_at = datetime('now') WHERE id = ?";
    let result = match sqlx::query(set_query).bind(model_id).execute(&mut *tx).await {
        Ok(result) => result,
        Err(e) => {
            let error_msg = format!("Failed to set default model: {}", e);
            logger.database_operation("UPDATE", "ai_models", false, Some(&error_msg));
            logger.api_response("set_default_ai_model", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    if result.rows_affected() == 0 {
        let error_msg = "Model not found";
        logger.api_response("set_default_ai_model", false, Some(error_msg));
        return Err(AppError::NotFound(error_msg.to_string()));
    }

    // 提交事务
    if let Err(e) = tx.commit().await {
        let error_msg = format!("Failed to commit transaction: {}", e);
        logger.database_operation("COMMIT", "ai_models", false, Some(&error_msg));
        logger.api_response("set_default_ai_model", false, Some(&error_msg));
        return Err(AppError::DatabaseError(error_msg));
    }

    logger.database_operation("UPDATE", "ai_models", true, Some(&format!("Set model {} as default", model_id)));
    logger.api_response("set_default_ai_model", true, Some("Default model updated successfully"));
    Ok(())
}

/// 创建AI提供商
#[tauri::command]
pub async fn create_ai_provider(
    app: AppHandle,
    name: String,
    display_name: String,
    base_url: String,
    api_key: String,
    description: Option<String>,
) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("create_ai_provider", Some(&format!("name: {}", name)));

    // 验证输入
    if name.trim().is_empty() {
        let error_msg = "Provider name cannot be empty";
        logger.api_response("create_ai_provider", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if display_name.trim().is_empty() {
        let error_msg = "Provider display name cannot be empty";
        logger.api_response("create_ai_provider", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    let query = r#"
        INSERT INTO ai_providers (name, display_name, base_url, api_key, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    "#;

    let result = match sqlx::query(query)
        .bind(&name)
        .bind(&display_name)
        .bind(&base_url)
        .bind(&api_key)
        .bind(&description)
        .execute(pool.inner())
        .await
    {
        Ok(result) => {
            logger.database_operation("INSERT", "ai_providers", true, Some(&format!("Created provider: {}", name)));
            result
        }
        Err(e) => {
            let error_msg = format!("Failed to create provider: {}", e);
            logger.database_operation("INSERT", "ai_providers", false, Some(&error_msg));
            logger.api_response("create_ai_provider", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    let provider_id = result.last_insert_rowid();
    logger.api_response("create_ai_provider", true, Some(&format!("Created provider with ID: {}", provider_id)));
    Ok(provider_id)
}

/// 更新AI提供商
#[tauri::command]
pub async fn update_ai_provider(
    app: AppHandle,
    provider_id: Id,
    display_name: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    description: Option<String>,
    is_active: Option<bool>,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("update_ai_provider", Some(&format!("provider_id: {}", provider_id)));

    // Build query dynamically
    let mut query_parts = Vec::new();
    let mut has_updates = false;

    if display_name.is_some() {
        query_parts.push("display_name = ?");
        has_updates = true;
    }
    if base_url.is_some() {
        query_parts.push("base_url = ?");
        has_updates = true;
    }
    if api_key.is_some() {
        query_parts.push("api_key = ?");
        has_updates = true;
    }
    if description.is_some() {
        query_parts.push("description = ?");
        has_updates = true;
    }
    if is_active.is_some() {
        query_parts.push("is_active = ?");
        has_updates = true;
    }

    if !has_updates {
        let error_msg = "No fields to update";
        logger.api_response("update_ai_provider", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    query_parts.push("updated_at = datetime('now')");
    let update_query = format!("UPDATE ai_providers SET {} WHERE id = ?", query_parts.join(", "));

    let mut query = sqlx::query(&update_query);

    if let Some(display_name_val) = &display_name {
        query = query.bind(display_name_val);
    }
    if let Some(base_url_val) = &base_url {
        query = query.bind(base_url_val);
    }
    if let Some(api_key_val) = &api_key {
        query = query.bind(api_key_val);
    }
    if let Some(description_val) = &description {
        query = query.bind(description_val);
    }
    if let Some(is_active_val) = is_active {
        query = query.bind(is_active_val);
    }
    query = query.bind(provider_id);

    let result = match query.execute(pool.inner()).await {
        Ok(result) => result,
        Err(e) => {
            let error_msg = format!("Failed to update provider: {}", e);
            logger.database_operation("UPDATE", "ai_providers", false, Some(&error_msg));
            logger.api_response("update_ai_provider", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    if result.rows_affected() == 0 {
        let error_msg = "Provider not found";
        logger.api_response("update_ai_provider", false, Some(error_msg));
        return Err(AppError::NotFound(error_msg.to_string()));
    }

    logger.database_operation("UPDATE", "ai_providers", true, Some(&format!("Updated provider: {}", provider_id)));
    logger.api_response("update_ai_provider", true, Some("Provider updated successfully"));
    Ok(())
}

/// 删除AI提供商
#[tauri::command]
pub async fn delete_ai_provider(
    app: AppHandle,
    provider_id: Id,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("delete_ai_provider", Some(&format!("provider_id: {}", provider_id)));

    // 首先删除关联的模型
    let delete_models_query = "DELETE FROM ai_models WHERE provider_id = ?";
    let models_result = match sqlx::query(delete_models_query).bind(provider_id).execute(pool.inner()).await {
        Ok(result) => result,
        Err(e) => {
            let error_msg = format!("Failed to delete associated models: {}", e);
            logger.database_operation("DELETE", "ai_models", false, Some(&error_msg));
            logger.api_response("delete_ai_provider", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    let deleted_models_count = models_result.rows_affected();
    if deleted_models_count > 0 {
        logger.database_operation("DELETE", "ai_models", true, Some(&format!("Deleted {} associated models for provider: {}", deleted_models_count, provider_id)));
    }

    let delete_query = "DELETE FROM ai_providers WHERE id = ?";
    let result = match sqlx::query(delete_query).bind(provider_id).execute(pool.inner()).await {
        Ok(result) => result,
        Err(e) => {
            let error_msg = format!("Failed to delete provider: {}", e);
            logger.database_operation("DELETE", "ai_providers", false, Some(&error_msg));
            logger.api_response("delete_ai_provider", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    if result.rows_affected() == 0 {
        let error_msg = "Provider not found";
        logger.api_response("delete_ai_provider", false, Some(error_msg));
        return Err(AppError::NotFound(error_msg.to_string()));
    }

    logger.database_operation("DELETE", "ai_providers", true, Some(&format!("Deleted provider: {}", provider_id)));
    logger.api_response("delete_ai_provider", true, Some("Provider deleted successfully"));
    Ok(())
}

/// 创建AI模型
#[tauri::command]
pub async fn create_ai_model(
    app: AppHandle,
    provider_id: Id,
    name: String,
    display_name: String,
    model_id: String,
    description: Option<String>,
    max_tokens: Option<i32>,
    temperature: Option<f64>,
) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("create_ai_model", Some(&format!("name: {}, provider_id: {}", name, provider_id)));

    // 验证输入
    if name.trim().is_empty() {
        let error_msg = "Model name cannot be empty";
        logger.api_response("create_ai_model", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if display_name.trim().is_empty() {
        let error_msg = "Model display name cannot be empty";
        logger.api_response("create_ai_model", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if model_id.trim().is_empty() {
        let error_msg = "Model ID cannot be empty";
        logger.api_response("create_ai_model", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 验证提供商是否存在
    let provider_check = "SELECT id FROM ai_providers WHERE id = ? AND is_active = 1";
    let provider_exists = match sqlx::query(provider_check).bind(provider_id).fetch_optional(pool.inner()).await {
        Ok(row) => row.is_some(),
        Err(e) => {
            let error_msg = format!("Failed to check provider: {}", e);
            logger.api_response("create_ai_model", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    if !provider_exists {
        let error_msg = "Provider not found or inactive";
        logger.api_response("create_ai_model", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    let query = r#"
        INSERT INTO ai_models (
            provider_id, name, display_name, model_id, description,
            max_tokens, temperature, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    "#;

    let result = match sqlx::query(query)
        .bind(provider_id)
        .bind(&name)
        .bind(&display_name)
        .bind(&model_id)
        .bind(&description)
        .bind(max_tokens)
        .bind(temperature)
        .execute(pool.inner())
        .await
    {
        Ok(result) => {
            logger.database_operation("INSERT", "ai_models", true, Some(&format!("Created model: {}", name)));
            result
        }
        Err(e) => {
            let error_msg = format!("Failed to create model: {}", e);
            logger.database_operation("INSERT", "ai_models", false, Some(&error_msg));
            logger.api_response("create_ai_model", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    let model_id = result.last_insert_rowid();
    logger.api_response("create_ai_model", true, Some(&format!("Created model with ID: {}", model_id)));
    Ok(model_id)
}

/// 更新AI模型
#[tauri::command]
pub async fn update_ai_model(
    app: AppHandle,
    model_id: Id,
    display_name: Option<String>,
    model_id_param: Option<String>,
    description: Option<String>,
    max_tokens: Option<i32>,
    temperature: Option<f64>,
    is_active: Option<bool>,
    is_default: Option<bool>,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("update_ai_model", Some(&format!("model_id: {}", model_id)));

    let mut query_parts = Vec::new();
    let mut has_updates = false;

    if display_name.is_some() {
        query_parts.push("display_name = ?");
        has_updates = true;
    }
    if model_id_param.is_some() {
        query_parts.push("model_id = ?");
        has_updates = true;
    }
    if description.is_some() {
        query_parts.push("description = ?");
        has_updates = true;
    }
    if max_tokens.is_some() {
        query_parts.push("max_tokens = ?");
        has_updates = true;
    }
    if temperature.is_some() {
        query_parts.push("temperature = ?");
        has_updates = true;
    }
    if is_active.is_some() {
        query_parts.push("is_active = ?");
        has_updates = true;
    }
    if is_default.is_some() {
        query_parts.push("is_default = ?");
        has_updates = true;
    }

    if !has_updates {
        let error_msg = "No fields to update";
        logger.api_response("update_ai_model", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    query_parts.push("updated_at = datetime('now')");
    let update_query = format!("UPDATE ai_models SET {} WHERE id = ?", query_parts.join(", "));

    let mut query = sqlx::query(&update_query);

    if let Some(display_name_val) = &display_name {
        query = query.bind(display_name_val);
    }
    if let Some(model_id_val) = &model_id_param {
        query = query.bind(model_id_val);
    }
    if let Some(description_val) = &description {
        query = query.bind(description_val);
    }
    if let Some(max_tokens_val) = max_tokens {
        query = query.bind(max_tokens_val);
    }
    if let Some(temperature_val) = temperature {
        query = query.bind(temperature_val);
    }
    if let Some(is_active_val) = is_active {
        query = query.bind(is_active_val);
    }
    if let Some(is_default_val) = is_default {
        query = query.bind(is_default_val);
    }
    query = query.bind(model_id);

    let result = match query.execute(pool.inner()).await {
        Ok(result) => result,
        Err(e) => {
            let error_msg = format!("Failed to update model: {}", e);
            logger.database_operation("UPDATE", "ai_models", false, Some(&error_msg));
            logger.api_response("update_ai_model", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    if result.rows_affected() == 0 {
        let error_msg = "Model not found";
        logger.api_response("update_ai_model", false, Some(error_msg));
        return Err(AppError::NotFound(error_msg.to_string()));
    }

    logger.database_operation("UPDATE", "ai_models", true, Some(&format!("Updated model: {}", model_id)));
    logger.api_response("update_ai_model", true, Some("Model updated successfully"));
    Ok(())
}

/// 删除AI模型
#[tauri::command]
pub async fn delete_ai_model(
    app: AppHandle,
    model_id: Id,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("delete_ai_model", Some(&format!("model_id: {}", model_id)));

    let delete_query = "DELETE FROM ai_models WHERE id = ?";
    let result = match sqlx::query(delete_query).bind(model_id).execute(pool.inner()).await {
        Ok(result) => result,
        Err(e) => {
            let error_msg = format!("Failed to delete model: {}", e);
            logger.database_operation("DELETE", "ai_models", false, Some(&error_msg));
            logger.api_response("delete_ai_model", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    if result.rows_affected() == 0 {
        let error_msg = "Model not found";
        logger.api_response("delete_ai_model", false, Some(error_msg));
        return Err(AppError::NotFound(error_msg.to_string()));
    }

    logger.database_operation("DELETE", "ai_models", true, Some(&format!("Deleted model: {}", model_id)));
    logger.api_response("delete_ai_model", true, Some("Model deleted successfully"));
    Ok(())
}

/// 自然拼读分析
#[tauri::command]
pub async fn analyze_phonics_with_model(
    app: AppHandle,
    text: String,
    model_id: Option<i64>,
    extraction_mode: Option<String>,
) -> AppResult<crate::ai_service::PhonicsAnalysisResult> {
    use crate::ai_service::AIService;

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();



    logger.api_request("analyze_phonics_with_model", Some(&format!("text_length: {}, model_id: {:?}", text.len(), model_id)));

    // 如果指定了模型ID，从数据库获取模型配置
    let (ai_service, model_config) = if let Some(model_id_val) = &model_id {
        // 将数字 ID 转换为字符串进行数据库查询
        let _model_id_str = model_id_val.to_string();

        // 通过数字 ID 查询指定模型
        let query = r#"
            SELECT m.id, m.model_id, m.display_name, m.description, m.max_tokens, m.temperature, m.is_active, m.is_default,
                   m.created_at, m.updated_at,
                   p.id as provider_id, p.name as provider_name, p.display_name as provider_display_name,
                   p.base_url, p.api_key, p.description as provider_description, p.is_active as provider_is_active,
                   p.created_at as provider_created_at, p.updated_at as provider_updated_at
            FROM ai_models m
            JOIN ai_providers p ON m.provider_id = p.id
            WHERE m.id = ? AND m.is_active = 1 AND p.is_active = 1
        "#;

        let row = match sqlx::query(query).bind(model_id_val).fetch_optional(pool.inner()).await {
            Ok(Some(row)) => row,
            Ok(None) => {
                let error_msg = format!("Model not found or inactive: {}", model_id_val);
                logger.api_response("analyze_phonics_with_model", false, Some(&error_msg));
                return Err(AppError::NotFound(error_msg));
            }
            Err(e) => {
                let error_msg = format!("Database error: {}", e);
                logger.api_response("analyze_phonics_with_model", false, Some(&error_msg));
                return Err(AppError::InternalError(error_msg));
            }
        };

            let model_config = AIModelConfig {
                id: row.get("id"),
                name: row.get("model_id"),
                model_id: row.get("model_id"),
                display_name: row.get("display_name"),
                description: row.get("description"),
                max_tokens: row.get("max_tokens"),
                temperature: row.get("temperature"),
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
                    is_active: row.get("provider_is_active"),
                    created_at: row.get("provider_created_at"),
                    updated_at: row.get("provider_updated_at"),
                },
            };

        let service = match AIService::from_model_config(&model_config) {
            Ok(service) => service,
            Err(e) => {
                let error_msg = format!("Failed to create AI service from model config: {}", e);
                logger.api_response("analyze_phonics_with_model", false, Some(&error_msg));
                return Err(AppError::InternalError(error_msg));
            }
        };
        (service, model_config)
    } else {
        // 使用默认模型
        let query = r#"
            SELECT m.id, m.model_id, m.display_name, m.description, m.max_tokens, m.temperature, m.is_active, m.is_default,
                   m.created_at, m.updated_at,
                   p.id as provider_id, p.name as provider_name, p.display_name as provider_display_name,
                   p.base_url, p.api_key, p.description as provider_description, p.is_active as provider_is_active,
                   p.created_at as provider_created_at, p.updated_at as provider_updated_at
            FROM ai_models m
            JOIN ai_providers p ON m.provider_id = p.id
            WHERE m.is_default = 1 AND m.is_active = 1 AND p.is_active = 1
            LIMIT 1
        "#;

        let row = match sqlx::query(query).fetch_optional(pool.inner()).await {
            Ok(Some(row)) => row,
            Ok(None) => {
                let error_msg = "No default AI model found in database".to_string();
                logger.api_response("analyze_phonics_with_model", false, Some(&error_msg));
                return Err(AppError::InternalError(error_msg));
            }
            Err(e) => {
                let error_msg = format!("Database error: {}", e);
                logger.api_response("analyze_phonics_with_model", false, Some(&error_msg));
                return Err(AppError::InternalError(error_msg));
            }
        };

        let model_config = AIModelConfig {
            id: row.get("id"),
            name: row.get("model_id"),
            model_id: row.get("model_id"),
            display_name: row.get("display_name"),
            description: row.get("description"),
            max_tokens: row.get("max_tokens"),
            temperature: row.get("temperature"),
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
                is_active: row.get("provider_is_active"),
                created_at: row.get("provider_created_at"),
                updated_at: row.get("provider_updated_at"),
            },
        };

        let service = match AIService::from_model_config(&model_config) {
            Ok(service) => service,
            Err(e) => {
                let error_msg = format!("Failed to create AI service from default model: {}", e);
                logger.api_response("analyze_phonics_with_model", false, Some(&error_msg));
                return Err(AppError::InternalError(error_msg));
            }
        };
        (service, model_config)
    };

    // 记录模型配置参数
    logger.info("AI_MODEL_HANDLERS", &format!(
        "Model config - ID: {}, model_id: {}, max_tokens: {:?}, temperature: {:?}",
        model_config.id, model_config.model_id, model_config.max_tokens, model_config.temperature
    ));

    // 执行自然拼读分析，使用模型配置中的参数
    let max_tokens_u32 = model_config.max_tokens.map(|t| t as u32);
    let temperature_f32 = model_config.temperature.map(|t| t as f32);

    logger.info("AI_MODEL_HANDLERS", &format!(
        "Converted parameters - max_tokens: {:?}, temperature: {:?}",
        max_tokens_u32, temperature_f32
    ));

    // 处理提取模式，默认为focus
    let extraction_mode = extraction_mode.unwrap_or_else(|| "focus".to_string());

    // 记录提取模式
    logger.info(
        "AI_HANDLER",
        &format!(
            "🎯 Phonics Analysis - Extraction Mode: {}, Text Length: {} chars",
            extraction_mode,
            text.len()
        ),
    );

    match ai_service.analyze_phonics(
        &text,
        Some(&model_config.model_id), // 使用模型配置中的实际模型名称
        max_tokens_u32,
        temperature_f32,
        &extraction_mode,
        &logger
    ).await {
        Ok(result) => {
            logger.api_response("analyze_phonics_with_model", true, Some(&format!("Successfully analyzed {} words", result.words.len())));
            Ok(result)
        }
        Err(e) => {
            let error_msg = format!("Phonics analysis failed: {}", e);
            logger.api_response("analyze_phonics_with_model", false, Some(&error_msg));
            Err(AppError::InternalError(error_msg))
        }
    }
}
