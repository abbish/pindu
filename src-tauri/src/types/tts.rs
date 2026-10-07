use crate::types::common::{Id, Timestamp};
use serde::{Deserialize, Serialize};

/// TTS 语音（音色）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TTSVoice {
    pub id: Id,
    pub provider_id: Id,
    /// 火山引擎音色 ID（请求里的 `speaker`）
    pub voice_id: String,
    pub voice_name: String,
    pub display_name: String,
    pub language: String,
    pub gender: Option<String>,
    pub description: Option<String>,
    /// 该音色对应的资源 ID（`X-Api-Resource-Id`）
    pub model_id: String,
    pub is_active: bool,
    pub is_default: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// 火山引擎豆包语音合成配置（含密钥，仅后端使用）
#[derive(Debug, Clone, Default)]
pub struct VolcengineTtsConfig {
    /// 新控制台 API Key（`X-Api-Key`）
    pub api_key: String,
    /// 旧控制台 AppID（`X-Api-App-Id`）
    pub app_id: String,
    /// 旧控制台 Access Token（`X-Api-Access-Key`）
    pub access_key: String,
    /// 资源 ID；空表示按音色自动推断
    pub resource_id: String,
    pub default_voice_id: String,
    /// 语速 [-50, 100]：0 为正常，100 为 2 倍速，-50 为 0.5 倍速
    pub speech_rate: i64,
    pub sample_rate: i64,
}

impl VolcengineTtsConfig {
    /// 新控制台 API Key 优先；否则需要旧控制台 AppID + Access Token 同时配置
    pub fn has_credentials(&self) -> bool {
        !self.api_key.trim().is_empty()
            || (!self.app_id.trim().is_empty() && !self.access_key.trim().is_empty())
    }
}

/// 返回给前端的 TTS 配置：不含任何密钥本身
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TtsConfigSafe {
    /// 鉴权是否完整（可以发起合成）
    pub configured: bool,
    pub has_api_key: bool,
    pub api_key_preview: Option<String>,
    /// AppID 不是密钥，原样返回便于核对
    pub app_id: String,
    pub has_access_key: bool,
    pub access_key_preview: Option<String>,
    /// 用户填写的资源 ID；空表示自动
    pub resource_id: String,
    pub default_voice_id: String,
    /// 默认音色实际使用的资源 ID（自动推断或用户填写）
    pub effective_resource_id: String,
    pub speech_rate: i64,
    pub sample_rate: i64,
}

/// TTS 配置的部分更新；`None` 表示不修改。密钥传空字符串表示清除。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTtsConfigRequest {
    pub api_key: Option<String>,
    pub app_id: Option<String>,
    pub access_key: Option<String>,
    pub resource_id: Option<String>,
    pub default_voice_id: Option<String>,
    pub speech_rate: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TTSResponse {
    pub audio_url: String,
    pub cached: bool,
    pub duration_ms: Option<i32>,
    /// 逐词时间（请求 `with_timings` 时返回；豆包 `enable_subtitle`）
    pub words: Option<Vec<WordTiming>>,
}

/// 一个词在音频里的起止时间（毫秒）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WordTiming {
    /// 原文中的写法（可能带标点，如 "day,"）
    pub word: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TTSCacheEntry {
    pub id: Id,
    pub text_hash: String,
    pub original_text: String,
    pub voice_id: String,
    pub model_id: String,
    pub file_path: String,
    pub file_size: i64,
    pub duration_ms: Option<i32>,
    pub created_at: Timestamp,
    pub last_used: Timestamp,
    pub use_count: i32,
}

/// 语音缓存统计（设置页显示占用空间）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TtsCacheStats {
    /// 缓存条数
    pub entries: i64,
    /// 占用空间（字节）
    pub total_bytes: i64,
    /// 超过 `stale_days` 天没用过的条数
    pub stale_entries: i64,
    /// 超过 `stale_days` 天没用过的占用空间（字节）
    pub stale_bytes: i64,
    /// “很久没用”的天数口径（与清理默认值一致）
    pub stale_days: i64,
}
