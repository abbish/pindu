use serde::{Deserialize, Serialize};
use crate::types::common::{Id, Timestamp};

/// AI提供商
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AIProvider {
    pub id: Id,
    pub name: String,
    pub display_name: String,
    pub base_url: String,
    pub api_key: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// AI模型
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AIModel {
    pub id: Id,
    pub provider_id: Id,
    pub name: String,
    pub display_name: String,
    pub model_id: String,
    pub description: Option<String>,
    pub max_tokens: Option<i32>,
    pub temperature: Option<f64>,
    pub is_active: bool,
    pub is_default: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// AI模型配置（包含提供商信息）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AIModelConfig {
    pub id: Id,
    pub name: String,
    pub display_name: String,
    pub model_id: String,
    pub description: Option<String>,
    pub max_tokens: Option<i32>,
    pub temperature: Option<f64>,
    pub is_active: bool,
    pub is_default: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub provider: AIProvider,
}

/// 创建AI提供商请求
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAIProviderRequest {
    pub name: String,
    pub display_name: String,
    pub base_url: String,
    pub api_key: String,
    pub description: Option<String>,
}

/// 更新AI提供商请求
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAIProviderRequest {
    pub display_name: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
}

/// 创建AI模型请求
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAIModelRequest {
    pub provider_id: Id,
    pub name: String,
    pub display_name: String,
    pub model_id: String,
    pub description: Option<String>,
    pub max_tokens: Option<i32>,
    pub temperature: Option<f64>,
}

/// 更新AI模型请求
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAIModelRequest {
    pub display_name: Option<String>,
    pub model_id: Option<String>,
    pub description: Option<String>,
    pub max_tokens: Option<i32>,
    pub temperature: Option<f64>,
    pub is_active: Option<bool>,
    pub is_default: Option<bool>,
}

/// AI模型查询参数
#[derive(Debug, Serialize, Deserialize)]
pub struct AIModelQuery {
    pub provider_id: Option<Id>,
    pub is_active: Option<bool>,
    pub is_default: Option<bool>,
}

/// AI模型测试结果
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestAIModelResult {
    pub success: bool,
    pub message: String,
}

/// AI提供商安全响应（不包含敏感信息）
///
/// 用于向前端返回提供商信息时，隐藏 API Key 等敏感数据
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AIProviderSafe {
    pub id: Id,
    pub name: String,
    pub display_name: String,
    pub base_url: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    /// 标识是否存在 API Key，但不返回实际值
    pub has_api_key: bool,
    /// API Key 的脱敏显示（仅前4个字符），用于确认配置
    pub api_key_preview: Option<String>,
}

impl From<AIProvider> for AIProviderSafe {
    fn from(provider: AIProvider) -> Self {
        let has_api_key = !provider.api_key.is_empty();
        let api_key_preview = if has_api_key {
            Some(mask_api_key(&provider.api_key))
        } else {
            None
        };

        Self {
            id: provider.id,
            name: provider.name,
            display_name: provider.display_name,
            base_url: provider.base_url,
            description: provider.description,
            is_active: provider.is_active,
            created_at: provider.created_at,
            updated_at: provider.updated_at,
            has_api_key,
            api_key_preview,
        }
    }
}

/// 脱敏 API Key，仅显示前4个字符
///
/// # 参数
/// * `api_key` - 原始 API Key
///
/// # 返回值
/// 脱敏后的 API Key，格式为 `abcd****` 或 `****`（如果长度不足4个字符）
fn mask_api_key(api_key: &str) -> String {
    if api_key.len() <= 4 {
        "****".to_string()
    } else {
        format!("{}****", &api_key[..4])
    }
}

/// AI模型配置安全响应（不包含提供商的敏感信息）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AIModelConfigSafe {
    pub id: Id,
    pub name: String,
    pub display_name: String,
    pub model_id: String,
    pub description: Option<String>,
    pub max_tokens: Option<i32>,
    pub temperature: Option<f64>,
    pub is_active: bool,
    pub is_default: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub provider: AIProviderSafe,
}

impl From<AIModelConfig> for AIModelConfigSafe {
    fn from(config: AIModelConfig) -> Self {
        Self {
            id: config.id,
            name: config.name,
            display_name: config.display_name,
            model_id: config.model_id,
            description: config.description,
            max_tokens: config.max_tokens,
            temperature: config.temperature,
            is_active: config.is_active,
            is_default: config.is_default,
            created_at: config.created_at,
            updated_at: config.updated_at,
            provider: AIProviderSafe::from(config.provider),
        }
    }
}
