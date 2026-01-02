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
