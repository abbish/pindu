use crate::types::common::{Id, Timestamp};
use serde::{Deserialize, Serialize};

/// TTS服务提供商 (保持兼容性)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TTSProvider {
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

/// TTS语音配置 (保持兼容性)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TTSVoice {
    pub id: Id,
    pub provider_id: Id,
    pub voice_id: String,
    pub voice_name: String,
    pub display_name: String,
    pub language: String,
    pub gender: Option<String>,
    pub description: Option<String>,
    pub model_id: String,
    pub is_active: bool,
    pub is_default: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// ElevenLabs TTS配置 (新增)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ElevenLabsConfig {
    pub api_key: String,
    pub model_id: String,         // 语音模型 (如: eleven_multilingual_v2)
    pub voice_stability: f32,     // 语音稳定性 (0.0-1.0)
    pub voice_similarity: f32,    // 语音相似度 (0.0-1.0)
    pub voice_style: Option<f32>, // 语音风格 (0.0-1.0, 可选)
    pub voice_boost: bool,        // 语音增强
    pub optimize_streaming_latency: Option<i32>, // 流式延迟优化 (0-4)
    pub output_format: String,    // 输出格式 (mp3_44100_128, pcm_16000等)
    pub default_voice_id: String, // 默认语音ID
}

/// TTS响应
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TTSResponse {
    pub audio_url: String,
    pub cached: bool,
    pub duration_ms: Option<i32>,
}

/// TTS缓存条目
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


/// ElevenLabs API请求体
#[derive(Debug, Serialize, Deserialize)]
pub struct ElevenLabsRequest {
    pub text: String,
    pub model_id: String,
    pub output_format: String,
}

