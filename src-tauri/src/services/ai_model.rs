//! AI 模型业务逻辑服务
//!
//! 封装 AI 模型相关的业务逻辑

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::ai_model_repository::AIModelRepository;
use crate::types::ai_model::AIModelConfig;
use crate::types::common::Id;
use sqlx::SqlitePool;
use std::sync::Arc;

/// AI 模型服务
///
/// 负责 AI 模型的业务逻辑处理
pub struct AIModelService {
    repository: AIModelRepository,
    logger: Arc<Logger>,
}

impl AIModelService {
    /// 创建新的服务实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: AIModelRepository::new(pool, logger.clone()),
            logger,
        }
    }

    /// 获取 AI 模型配置（根据 ID 或默认模型）
    pub async fn get_model_config(&self, model_id: Option<Id>) -> AppResult<AIModelConfig> {
        let model_config = if let Some(id) = model_id {
            self.repository
                .find_model_config_by_id(id)
                .await?
                .ok_or_else(|| {
                    AppError::ValidationError(format!("AI model with id {} not found or inactive", id))
                })?
        } else {
            self.repository
                .find_default_model_config()
                .await?
                .ok_or_else(|| {
                    AppError::ValidationError("No default AI model found".to_string())
                })?
        };

        // 检查 API Key 是否有效
        if model_config.provider.api_key.is_empty()
            || model_config.provider.api_key == "PLEASE_SET_YOUR_API_KEY"
        {
            return Err(AppError::ValidationError(format!(
                "AI模型 '{}' 的API Key未配置。请前往设置页面配置有效的API Key。",
                model_config.display_name
            )));
        }

        Ok(model_config)
    }
}
