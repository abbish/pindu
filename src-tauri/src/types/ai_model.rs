use crate::types::common::{Id, Timestamp};
use serde::{Deserialize, Serialize};

/// 迁移种子数据中 API Key 的占位值：视为“未配置”
/// 自定义端点默认接口类型（与迁移 038 的列默认值一致）
pub fn default_api() -> String {
    "openai-completions".to_string()
}

pub const API_KEY_PLACEHOLDER: &str = "PLEASE_SET_YOUR_API_KEY";

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
    /// 映射的 pi 内置 provider id（如 moonshotai-cn）；None = 自定义端点
    #[serde(default)]
    pub pi_provider: Option<String>,
    /// 自定义端点的接口类型（openai-completions / anthropic-messages / openai-responses）
    #[serde(default = "default_api")]
    pub api: String,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// AI模型
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
    /// 思考档（off/minimal/low/medium/high/xhigh/max）；None = 任务默认
    #[serde(default)]
    pub thinking_level: Option<String>,
    /// 额外采样参数（JSON 对象，如 {"top_p":0.95}），与温度合并为 pi 的 samplingParams
    #[serde(default)]
    pub extra_params: Option<serde_json::Value>,
    /// 上下文窗口（仅自定义模型需要）
    #[serde(default)]
    pub context_window: Option<i64>,
    /// 是否推理模型（仅自定义模型需要）
    #[serde(default)]
    pub reasoning: Option<bool>,
    pub is_active: bool,
    pub is_default: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub provider: AIProvider,
}

/// AI模型查询参数（嵌套在 `query` 参数内，字段名不会被 Tauri 自动转换，故显式 camelCase）
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    pub pi_provider: Option<String>,
    pub api: String,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    /// 标识是否存在 API Key，但不返回实际值
    pub has_api_key: bool,
    /// API Key 的脱敏显示（仅前4个字符），用于确认配置
    pub api_key_preview: Option<String>,
}

impl AIProvider {
    /// API Key 是否已配置（非空且不是种子占位值）
    pub fn has_api_key(&self) -> bool {
        !self.api_key.is_empty() && self.api_key != API_KEY_PLACEHOLDER
    }
}

impl From<AIProvider> for AIProviderSafe {
    fn from(provider: AIProvider) -> Self {
        let has_api_key = provider.has_api_key();
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
            pi_provider: provider.pi_provider,
            api: provider.api,
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
pub(crate) fn mask_api_key(api_key: &str) -> String {
    // 按字符截取：按字节切片在多字节字符上会 panic
    if api_key.chars().count() <= 4 {
        "****".to_string()
    } else {
        format!("{}****", api_key.chars().take(4).collect::<String>())
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
    /// 思考档（off/minimal/low/medium/high/xhigh/max）；None = 任务默认
    pub thinking_level: Option<String>,
    /// 额外采样参数（JSON 对象，如 {"top_p":0.95}），与温度合并为 pi 的 samplingParams
    pub extra_params: Option<serde_json::Value>,
    /// 上下文窗口（仅自定义模型需要）
    pub context_window: Option<i64>,
    /// 是否推理模型（仅自定义模型需要）
    pub reasoning: Option<bool>,
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
            thinking_level: config.thinking_level,
            extra_params: config.extra_params,
            context_window: config.context_window,
            reasoning: config.reasoning,
            is_active: config.is_active,
            is_default: config.is_default,
            created_at: config.created_at,
            updated_at: config.updated_at,
            provider: AIProviderSafe::from(config.provider),
        }
    }
}

// ==================== 服务层内部写入参数（不经 IPC） ====================

/// 新建 AI 提供商
/// 提供商 `/models` 接口返回的一个远端模型（设置页「同步模型列表」）
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModelInfo {
    /// 调用时使用的模型 ID（如 `google/gemini-3.8-flash`）
    pub id: String,
    /// 提供商给出的展示名，没有则为 None
    pub name: Option<String>,
    /// 上下文长度（token），提供商未给出则为 None
    pub context_length: Option<i64>,
    /// 该提供商下是否已存在相同 model_id 的模型
    pub already_added: bool,
    /// 是否在 pi 内置目录中（在目录中的模型可直接使用 pi 的兼容参数与思考档）
    #[serde(default)]
    pub in_catalog: bool,
    /// pi 目录给出的支持思考档（不在目录中为空）
    #[serde(default)]
    pub thinking_levels: Vec<String>,
    #[serde(default)]
    pub reasoning: Option<bool>,
    /// 价格：美元 / 百万 token（pi 目录提供）
    #[serde(default)]
    pub cost_input: Option<f64>,
    #[serde(default)]
    pub cost_output: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct NewAIProvider {
    pub name: String,
    pub display_name: String,
    pub base_url: String,
    pub api_key: String,
    pub description: Option<String>,
    /// 映射的 pi 内置 provider；None = 自定义端点
    pub pi_provider: Option<String>,
    /// 自定义端点的接口类型
    pub api: String,
}

/// AI 提供商的部分更新；`None` 表示不修改该列
#[derive(Debug, Clone, Default)]
pub struct AIProviderUpdate {
    pub display_name: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
    /// Some("") 表示清除映射（改为自定义端点）
    pub pi_provider: Option<String>,
    pub api: Option<String>,
}

/// 新建 AI 模型
#[derive(Debug, Clone)]
pub struct NewAIModel {
    pub provider_id: Id,
    pub name: String,
    pub display_name: String,
    pub model_id: String,
    pub description: Option<String>,
    pub generation: ModelGenerationSettings,
}

/// 模型的生成参数（对应 pi 的 maxTokens / samplingParams / thinking / contextWindow / reasoning）。
/// 保存时六项整体替换；None 表示不设置（请求中不发送，使用 pi 目录或服务端默认）。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelGenerationSettings {
    pub max_tokens: Option<i32>,
    pub temperature: Option<f64>,
    /// off / minimal / low / medium / high / xhigh / max
    pub thinking_level: Option<String>,
    /// 额外采样参数（JSON 对象，如 {"top_p":0.95}）
    pub extra_params: Option<serde_json::Value>,
    pub context_window: Option<i64>,
    pub reasoning: Option<bool>,
}

/// AI 模型的部分更新；`None` 表示不修改该列
#[derive(Debug, Clone, Default)]
pub struct AIModelUpdate {
    pub display_name: Option<String>,
    pub model_id: Option<String>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
    pub is_default: Option<bool>,
    /// Some 时整体替换六项生成参数
    pub generation: Option<ModelGenerationSettings>,
}
