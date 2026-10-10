//! TTS 业务逻辑：火山引擎豆包语音合成（V3 HTTP 单向流式，带 SHA256 文件缓存）、配置与默认音色、缓存清理
//!
//! 接口：`POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`，响应为逐行 JSON（NDJSON），
//! `code = 0` 的行带 base64 音频片段，`code = 20000000` 表示结束，其它 code 为错误。

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::tts_repository::TtsRepository;
use crate::types::ai_model::mask_api_key;
use crate::types::tts::*;
use base64::{engine::general_purpose, Engine as _};
use reqwest::Client;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;

/// 默认清理多少天未使用的缓存
const DEFAULT_CACHE_MAX_AGE_DAYS: i32 = 30;
/// 豆包语音合成 V3 HTTP 单向流式接口
/// 慢速朗读比设置的语速再慢多少（约 0.7 倍）
const SLOW_RATE_DELTA: i64 = 30;
const VOLCENGINE_TTS_URL: &str = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
/// 流式响应的结束码
const STREAM_END_CODE: i64 = 20_000_000;
/// 音色与资源 ID 不匹配
const RESOURCE_MISMATCH_CODE: i64 = 55_000_000;
/// 语速范围（0 为正常语速）
const SPEECH_RATE_RANGE: std::ops::RangeInclusive<i64> = -50..=100;

/// 朗读风格：豆包 2.0 是生成式模型，同一文本每次合成的语调都会有差异，单个单词尤其容易读成疑问或夸张的语气。
/// 用固定的语音指令（`additions.context_texts`）约束成“老师示范”的平稳语气，并指定只按英语读（`explicit_language`，
/// 不指定时豆包按中英混读，句子里的数字会读成中文）；缓存键包含风格版本，改指令或参数时把版本号加一。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpeechStyle {
    /// 不加指令（设置页试听等）
    Plain,
    /// 单词示范发音
    Word,
    /// 例句朗读
    Sentence,
}

impl SpeechStyle {
    pub fn parse(value: Option<&str>) -> AppResult<Self> {
        match value.map(str::trim).unwrap_or("") {
            "" | "plain" => Ok(Self::Plain),
            "word" => Ok(Self::Word),
            "sentence" => Ok(Self::Sentence),
            other => Err(AppError::ValidationError(format!(
                "朗读风格需为 word / sentence：{}",
                other
            ))),
        }
    }

    /// 语音指令（只对支持指令的 2.0 资源生效）
    fn instruction(self) -> Option<&'static str> {
        match self {
            Self::Plain => None,
            // 指令用英文：与朗读的语言一致，减少模型被带到中文语境；每句都带同一条，句与句之间语气一致
            Self::Word => Some("Say this English word the way an English teacher models pronunciation for learners: clear, calm, neutral statement tone with a natural falling intonation, no emotion, not a question."),
            Self::Sentence => Some("Read this English sentence the way an English teacher reads examples aloud for learners: clear, calm, neutral and consistent tone at a slightly slow pace, no dramatic emotion. Read all numbers, dates and abbreviations in English."),
        }
    }

    /// 缓存键中的风格标记（带版本）
    fn cache_tag(self) -> &'static str {
        match self {
            Self::Plain => "",
            Self::Word => "|style=word-v2",
            Self::Sentence => "|style=sentence-v2",
        }
    }

    /// 朗读语种（`additions.explicit_language`）：单词与句子都是英文内容，只按英语读（数字也读英文）；
    /// 设置页试听不限定（试听文字可能是中文）
    fn language(self) -> Option<&'static str> {
        match self {
            Self::Plain => None,
            Self::Word | Self::Sentence => Some("en"),
        }
    }
}

/// 支持语音指令（context_texts）的资源：豆包语音合成 2.0 与声音复刻 2.0
fn supports_instruction(resource_id: &str) -> bool {
    matches!(resource_id, "seed-tts-2.0" | "seed-icl-2.0")
}

/// 豆包请求体：`additions` 必须是序列化后的 JSON 字符串
fn request_body(
    text: &str,
    voice_id: &str,
    config: &VolcengineTtsConfig,
    instruction: Option<&str>,
    language: Option<&str>,
    with_timings: bool,
) -> serde_json::Value {
    let mut req_params = serde_json::json!({
        "text": text,
        "speaker": voice_id,
        "audio_params": {
            "format": "mp3",
            "sample_rate": config.sample_rate,
            "speech_rate": config.speech_rate,
        }
    });
    if with_timings {
        // 逐词时间戳：必须是布尔值，结果在 `sentence.words` 里（秒）
        req_params["audio_params"]["enable_subtitle"] = serde_json::Value::Bool(true);
    }
    let mut additions = serde_json::Map::new();
    if let Some(instruction) = instruction {
        additions.insert("context_texts".into(), serde_json::json!([instruction]));
    }
    if let Some(language) = language {
        additions.insert("explicit_language".into(), serde_json::json!(language));
    }
    if !additions.is_empty() {
        req_params["additions"] =
            serde_json::Value::String(serde_json::Value::Object(additions).to_string());
    }
    serde_json::json!({ "user": { "uid": "redlark" }, "req_params": req_params })
}

pub struct TTSService {
    client: Client,
    cache_dir: PathBuf,
    logger: Arc<Logger>,
    repository: TtsRepository,
}

impl TTSService {
    /// `cache_dir`：音频缓存文件目录（`<app_cache_dir>/tts`）
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>, cache_dir: PathBuf) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            cache_dir,
            logger,
            repository: TtsRepository::new(pool),
        }
    }

    /// 缓存键：文本 + 音色 + 影响音频的参数（资源 ID、语速、采样率）
    fn generate_text_hash(&self, text: &str, voice_id: &str, variant: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        hasher.update(voice_id.as_bytes());
        hasher.update(variant.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// 检查缓存；查询失败按未命中处理（缓存是旁路，不影响合成）
    async fn check_cache(&self, text_hash: &str) -> Option<TTSCacheEntry> {
        match self.repository.find_cache_entry(text_hash).await {
            Ok(entry) => entry,
            Err(e) => {
                self.logger
                    .error("TTS", &format!("Cache check error: {}", e), None);
                None
            }
        }
    }

    /// 读取配置（含密钥，仅后端使用）
    async fn load_config(&self) -> AppResult<VolcengineTtsConfig> {
        self.repository
            .find_volcengine_config()
            .await?
            .ok_or_else(|| {
                AppError::NotFound("还没有语音合成配置，请到「设置 → 语音合成」填写".to_string())
            })
    }

    /// 调用豆包语音合成，返回完整 mp3 字节
    async fn call_volcengine_api(
        &self,
        text: &str,
        config: &VolcengineTtsConfig,
        voice_id: &str,
        resource_id: &str,
        style: SpeechStyle,
        with_timings: bool,
    ) -> AppResult<(Vec<u8>, Vec<WordTiming>)> {
        let request_id = uuid::Uuid::new_v4().to_string();
        // 指令只对支持的 2.0 资源加；语种对所有资源都加
        let instruction = style
            .instruction()
            .filter(|_| supports_instruction(resource_id));
        let body = request_body(
            text,
            voice_id,
            config,
            instruction,
            style.language(),
            with_timings,
        );

        // 日志不含任何密钥
        self.logger.info(
            "TTS",
            &format!(
                "Calling Volcengine TTS: speaker={}, resource={}, instruction={}, request_id={}",
                voice_id,
                resource_id,
                instruction.is_some(),
                request_id
            ),
        );

        let mut request = self
            .client
            .post(VOLCENGINE_TTS_URL)
            .header("X-Api-Resource-Id", resource_id)
            .header("X-Api-Request-Id", &request_id)
            .json(&body);
        request = if !config.api_key.trim().is_empty() {
            request.header("X-Api-Key", config.api_key.trim())
        } else {
            request
                .header("X-Api-App-Id", config.app_id.trim())
                .header("X-Api-Access-Key", config.access_key.trim())
        };

        let response = request.send().await.map_err(|e| {
            AppError::ExternalServiceError(format!("无法连接豆包语音合成服务: {}", e))
        })?;
        let status = response.status();
        let text_body = response
            .text()
            .await
            .map_err(|e| AppError::ExternalServiceError(format!("读取语音合成响应失败: {}", e)))?;

        if !status.is_success() {
            // 错误响应通常也是 {code, message}；尽量给出可操作的提示
            let detail = parse_tts_stream(&text_body)
                .err()
                .unwrap_or_else(|| text_body.chars().take(200).collect());
            let hint = match status.as_u16() {
                401 => "（鉴权失败：请检查 API Key，或 AppID 与 Access Token 是否对应）",
                // 403 = 密钥有效但账号/Key 未开通所请求的资源（code 45000030）
                403 => "（密钥有效，但未开通该语音合成资源：请在火山引擎控制台开通对应的语音合成大模型并授权给此 Key）",
                _ => "",
            };
            return Err(AppError::ExternalServiceError(format!(
                "豆包语音合成失败（HTTP {}）{}：{}",
                status.as_u16(),
                hint,
                detail
            )));
        }

        let timings = parse_word_timings(&text_body);
        parse_tts_stream(&text_body)
            .map(|audio| (audio, timings))
            .map_err(|e| AppError::ExternalServiceError(format!("豆包语音合成失败：{}", e)))
    }

    /// 逐词时间的缓存文件（与音频同名，`.words.json`）
    fn timings_path(&self, text_hash: &str) -> PathBuf {
        self.cache_dir.join(format!("{}.words.json", text_hash))
    }

    /// 保存逐词时间（失败只记日志：缺了下次需要时重新合成）
    async fn save_timings(&self, timings: &[WordTiming], text_hash: &str) {
        let result = match serde_json::to_vec(timings) {
            Ok(bytes) => fs::write(self.timings_path(text_hash), bytes).await,
            Err(e) => Err(std::io::Error::other(e)),
        };
        if let Err(e) = result {
            self.logger
                .error("TTS", "无法保存逐词时间缓存", Some(&e.to_string()));
        }
    }

    async fn read_cached_timings(&self, text_hash: &str) -> Option<Vec<WordTiming>> {
        let bytes = fs::read(self.timings_path(text_hash)).await.ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    /// 保存音频文件
    async fn save_audio_file(&self, audio_data: &[u8], text_hash: &str) -> AppResult<PathBuf> {
        fs::create_dir_all(&self.cache_dir)
            .await
            .map_err(|e| AppError::InternalError(format!("无法创建语音缓存目录：{}", e)))?;
        let file_path = self.cache_dir.join(format!("{}.mp3", text_hash));
        fs::write(&file_path, audio_data)
            .await
            .map_err(|e| AppError::InternalError(format!("无法保存语音缓存：{}", e)))?;
        Ok(file_path)
    }

    /// 文本转语音：命中缓存直接返回；否则调用豆包合成，`use_cache` 为 true 时写入缓存。
    /// 同一（文本、音色、参数、风格）只合成一次，之后永远播放同一段音频。
    /// 返回 `data:audio/mpeg;base64,...`，前端可直接播放。
    pub async fn text_to_speech(
        &self,
        text: &str,
        voice_id: Option<&str>,
        use_cache: bool,
        style: SpeechStyle,
        slow: bool,
        with_timings: bool,
    ) -> AppResult<TTSResponse> {
        self.logger.info(
            "TTS",
            &format!(
                "Processing TTS request: text_length={}, voice_id={:?}, use_cache={}",
                text.len(),
                voice_id,
                use_cache
            ),
        );

        if text.trim().is_empty() {
            return Err(AppError::ValidationError("没有要朗读的文字".to_string()));
        }
        if text.chars().count() > 1000 {
            return Err(AppError::ValidationError(
                "要朗读的文字太长了（最多 1000 个字符）".to_string(),
            ));
        }

        let mut config = self.load_config().await?;
        // 慢速：在设置的语速上再慢一档（豆包 speech_rate：-50 = 0.5 倍，0 = 正常），单独缓存
        if slow {
            config.speech_rate = (config.speech_rate - SLOW_RATE_DELTA).clamp(-50, 100);
        }
        if !config.has_credentials() {
            return Err(AppError::ValidationError(
                "请先在设置页配置豆包语音合成的 API Key（或 AppID + Access Token）".to_string(),
            ));
        }

        let voice = voice_id
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or(config.default_voice_id.as_str());
        validate_identifier("音色 ID", voice)?;
        let resource_id = effective_resource_id(&config.resource_id, voice);
        let instruction = style
            .instruction()
            .filter(|_| supports_instruction(&resource_id));
        let variant = format!(
            "{}|rate={}|sr={}{}",
            resource_id,
            config.speech_rate,
            config.sample_rate,
            // 语种对所有资源生效、指令只对 2.0 生效：两者任一有就带风格版本
            if instruction.is_some() || style.language().is_some() {
                style.cache_tag()
            } else {
                ""
            }
        );
        let text_hash = self.generate_text_hash(text, voice, &variant);

        if use_cache {
            if let Some(audio) = self.read_cached_audio(&text_hash).await {
                let words = self.read_cached_timings(&text_hash).await;
                // 需要逐词时间但旧缓存没有：重新合成一次（之后就有了）
                if !with_timings || words.is_some() {
                    return Ok(TTSResponse {
                        audio_url: to_data_url(&audio),
                        cached: true,
                        duration_ms: None,
                        words: words.filter(|_| with_timings),
                    });
                }
            }
        }

        let (audio_data, timings) = self
            .call_volcengine_api(text, &config, voice, &resource_id, style, with_timings)
            .await?;

        if use_cache {
            let file_path = self.save_audio_file(&audio_data, &text_hash).await?;
            if !timings.is_empty() {
                self.save_timings(&timings, &text_hash).await;
            }
            let file_path_str = file_path.to_string_lossy().to_string();
            self.repository
                .upsert_cache_entry(
                    &text_hash,
                    text,
                    voice,
                    &variant,
                    &file_path_str,
                    audio_data.len() as i64,
                )
                .await?;
            self.logger.info(
                "TTS",
                &format!("Generated and cached new audio: {}", file_path_str),
            );
        } else {
            self.logger.info(
                "TTS",
                &format!(
                    "Generated temporary audio for preview: {} bytes",
                    audio_data.len()
                ),
            );
        }

        Ok(TTSResponse {
            audio_url: to_data_url(&audio_data),
            cached: false,
            duration_ms: None,
            words: (with_timings && !timings.is_empty()).then_some(timings),
        })
    }

    /// 读取缓存音频；记录存在但文件缺失或读取失败时删除记录并按未命中处理
    async fn read_cached_audio(&self, text_hash: &str) -> Option<Vec<u8>> {
        let entry = self.check_cache(text_hash).await?;
        match fs::read(&entry.file_path).await {
            Ok(audio) => {
                let _ = self.repository.touch_cache_entry(text_hash).await;
                Some(audio)
            }
            Err(e) => {
                self.logger.info(
                    "TTS",
                    &format!(
                        "Cache file unreadable ({}), removing cache entry: {}",
                        e, entry.file_path
                    ),
                );
                let _ = self.repository.delete_cache_entry(text_hash).await;
                None
            }
        }
    }

    // ==================== 配置与音色 ====================

    /// 当前配置（脱敏）
    pub async fn get_config(&self) -> AppResult<TtsConfigSafe> {
        Ok(to_safe(self.load_config().await?))
    }

    /// 部分更新配置（None 字段不修改；密钥传空字符串表示清除）
    pub async fn update_config(&self, update: UpdateTtsConfigRequest) -> AppResult<()> {
        let has_updates = update.api_key.is_some()
            || update.app_id.is_some()
            || update.access_key.is_some()
            || update.resource_id.is_some()
            || update.default_voice_id.is_some()
            || update.speech_rate.is_some();
        if !has_updates {
            return Err(AppError::ValidationError("没有要保存的修改".to_string()));
        }
        if let Some(rate) = update.speech_rate {
            if !SPEECH_RATE_RANGE.contains(&rate) {
                return Err(AppError::ValidationError(format!(
                    "语速必须在 {} 到 {} 之间",
                    SPEECH_RATE_RANGE.start(),
                    SPEECH_RATE_RANGE.end()
                )));
            }
        }
        if let Some(voice) = &update.default_voice_id {
            validate_identifier("音色 ID", voice.trim())?;
        }
        if let Some(resource) = &update.resource_id {
            if !resource.trim().is_empty() {
                validate_identifier("资源 ID", resource.trim())?;
            }
        }
        if self.repository.update_volcengine_config(&update).await? == 0 {
            return Err(AppError::NotFound(
                "还没有语音合成配置，请到「设置 → 语音合成」填写".to_string(),
            ));
        }
        Ok(())
    }

    /// 默认音色：预置音色直接返回；用户自定义的音色 ID 构造一个“自定义音色”条目
    pub async fn get_default_voice(&self) -> AppResult<Option<TTSVoice>> {
        let Some(config) = self.repository.find_volcengine_config().await? else {
            return Ok(None);
        };
        let voice = volcengine_voices()
            .into_iter()
            .find(|v| v.voice_id == config.default_voice_id)
            .unwrap_or_else(|| custom_voice(&config.default_voice_id, &config.resource_id));
        Ok(Some(voice))
    }

    // ==================== 缓存清理 ====================

    /// 缓存统计（按记录里的文件大小汇总；“很久没用”按默认清理天数）
    pub async fn cache_stats(&self) -> AppResult<TtsCacheStats> {
        let days = DEFAULT_CACHE_MAX_AGE_DAYS as i64;
        let (entries, total_bytes, stale_entries, stale_bytes) =
            self.repository.cache_stats(days).await?;
        Ok(TtsCacheStats {
            entries,
            total_bytes,
            stale_entries,
            stale_bytes,
            stale_days: days,
        })
    }

    /// 删除超过 `older_than_days`（默认 30）天未使用的缓存文件与记录，返回删除条数。
    /// 文件已不存在视为已删除；其它文件删除失败的记录保留，下次再试。
    pub async fn clear_cache(&self, older_than_days: Option<i32>) -> AppResult<i32> {
        let days = older_than_days.unwrap_or(DEFAULT_CACHE_MAX_AGE_DAYS).max(0) as i64;
        let entries = self.repository.find_cache_unused_for_days(days).await?;

        let mut removed = 0;
        for (text_hash, file_path) in entries {
            let _ = fs::remove_file(self.timings_path(&text_hash)).await;
            match fs::remove_file(&file_path).await {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    self.logger.error(
                        "TTS",
                        &format!("Failed to remove cache file {}: {}", file_path, e),
                        None,
                    );
                    continue;
                }
            }
            self.repository.delete_cache_entry(&text_hash).await?;
            removed += 1;
        }

        self.logger.info(
            "TTS",
            &format!("Cleared {} cache entries unused for {} days", removed, days),
        );
        Ok(removed)
    }
}

/// 预置英文音色（有公开资料可核实的豆包语音合成 2.0 音色）；其它音色可在设置页填写控制台中的音色 ID
pub fn volcengine_voices() -> Vec<TTSVoice> {
    let voice =
        |id: i64, voice_id: &str, name: &str, display: &str, gender: &str, desc: &str| TTSVoice {
            id,
            provider_id: 1,
            voice_id: voice_id.to_string(),
            voice_name: name.to_string(),
            display_name: display.to_string(),
            language: "en".to_string(),
            gender: Some(gender.to_string()),
            description: (!desc.is_empty()).then(|| desc.to_string()),
            model_id: infer_resource_id(voice_id).to_string(),
            is_active: true,
            is_default: id == 1,
            created_at: "2026-10-06T00:00:00Z".to_string(),
            updated_at: "2026-10-06T00:00:00Z".to_string(),
        };
    vec![
        voice(
            1,
            "en_male_tim_uranus_bigtts",
            "Tim",
            "Tim · 美式",
            "male",
            "",
        ),
        voice(
            2,
            "en_female_dacey_uranus_bigtts",
            "Dacey",
            "Dacey · 英式",
            "female",
            "",
        ),
    ]
}

/// 非预置音色的展示条目
fn custom_voice(voice_id: &str, resource_id: &str) -> TTSVoice {
    TTSVoice {
        id: 0,
        provider_id: 1,
        voice_id: voice_id.to_string(),
        voice_name: voice_id.to_string(),
        display_name: format!("自定义音色 · {}", voice_id),
        language: "en".to_string(),
        gender: None,
        description: None,
        model_id: effective_resource_id(resource_id, voice_id),
        is_active: true,
        is_default: true,
        created_at: "2026-10-06T00:00:00Z".to_string(),
        updated_at: "2026-10-06T00:00:00Z".to_string(),
    }
}

/// 按音色推断资源 ID（音色与资源不匹配会返回 55000000）：
/// `S_*`（声音复刻）→ seed-icl-2.0；`*_uranus_*` / `saturn_*`（2.0 音色）→ seed-tts-2.0；其余 → seed-tts-1.0
pub fn infer_resource_id(voice_id: &str) -> &'static str {
    if voice_id.starts_with("S_") {
        "seed-icl-2.0"
    } else if voice_id.contains("_uranus_") || voice_id.starts_with("saturn_") {
        "seed-tts-2.0"
    } else {
        "seed-tts-1.0"
    }
}

/// 用户填写了资源 ID 就用它，否则按音色推断
fn effective_resource_id(configured: &str, voice_id: &str) -> String {
    let configured = configured.trim();
    if configured.is_empty() {
        infer_resource_id(voice_id).to_string()
    } else {
        configured.to_string()
    }
}

/// 音色 / 资源 ID 只允许字母、数字与 `_ - .`，避免把任意字符串塞进请求头
fn validate_identifier(label: &str, value: &str) -> AppResult<()> {
    let ok = !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    if ok {
        Ok(())
    } else {
        Err(AppError::ValidationError(format!(
            "{}格式不正确：{}",
            label, value
        )))
    }
}

fn to_data_url(audio: &[u8]) -> String {
    format!(
        "data:audio/mpeg;base64,{}",
        general_purpose::STANDARD.encode(audio)
    )
}

fn to_safe(config: VolcengineTtsConfig) -> TtsConfigSafe {
    let api_key = config.api_key.trim();
    let access_key = config.access_key.trim();
    TtsConfigSafe {
        configured: config.has_credentials(),
        has_api_key: !api_key.is_empty(),
        api_key_preview: (!api_key.is_empty()).then(|| mask_api_key(api_key)),
        app_id: config.app_id.trim().to_string(),
        has_access_key: !access_key.is_empty(),
        access_key_preview: (!access_key.is_empty()).then(|| mask_api_key(access_key)),
        effective_resource_id: effective_resource_id(&config.resource_id, &config.default_voice_id),
        resource_id: config.resource_id,
        default_voice_id: config.default_voice_id,
        speech_rate: config.speech_rate,
        sample_rate: config.sample_rate,
    }
}

/// 解析流式响应（NDJSON，也容忍 SSE 的 `data:` 前缀）：拼接所有 `code = 0` 行的 base64 音频；
/// 遇到非 0 且非结束码的行返回错误（含服务端 message）。
/// 响应里的逐词时间（`sentence.words`，秒 → 毫秒）；多句时按顺序拼接，空的 sentence 事件跳过
fn parse_word_timings(body: &str) -> Vec<WordTiming> {
    let mut timings = Vec::new();
    for raw in body.lines() {
        let line = raw.trim();
        let line = line.strip_prefix("data:").map(str::trim).unwrap_or(line);
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let words = value
            .get("sentence")
            .and_then(|s| s.get("words"))
            .and_then(|w| w.as_array());
        for w in words.into_iter().flatten() {
            let (Some(word), Some(start), Some(end)) = (
                w.get("word").and_then(|v| v.as_str()),
                w.get("startTime").and_then(|v| v.as_f64()),
                w.get("endTime").and_then(|v| v.as_f64()),
            ) else {
                continue;
            };
            timings.push(WordTiming {
                word: word.to_string(),
                start_ms: (start * 1000.0).round() as i64,
                end_ms: (end * 1000.0).round() as i64,
            });
        }
    }
    timings
}

fn parse_tts_stream(body: &str) -> Result<Vec<u8>, String> {
    let mut audio = Vec::new();
    let mut finished = false;
    for raw in body.lines() {
        let line = raw.trim();
        let line = line.strip_prefix("data:").map(str::trim).unwrap_or(line);
        if line.is_empty() || !line.starts_with('{') {
            continue;
        }
        let value: serde_json::Value =
            serde_json::from_str(line).map_err(|e| format!("响应行不是有效 JSON: {}", e))?;
        // 错误响应可能把 code / message 放在 `header` 里：{"header":{"code":45000010,"message":"Invalid X-Api-Key"}}
        let field = |key: &str| value.get(key).or_else(|| value.get("header")?.get(key));
        let code = field("code").and_then(|c| c.as_i64()).unwrap_or(0);
        match code {
            0 => {
                if let Some(data) = value.get("data").and_then(|d| d.as_str()) {
                    if !data.is_empty() {
                        let chunk = general_purpose::STANDARD
                            .decode(data)
                            .map_err(|e| format!("音频数据 base64 解码失败: {}", e))?;
                        audio.extend_from_slice(&chunk);
                    }
                }
            }
            STREAM_END_CODE => {
                finished = true;
                break;
            }
            _ => {
                let message = field("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("未知错误");
                let hint = if code == RESOURCE_MISMATCH_CODE {
                    "（音色与资源 ID 不匹配：请把资源 ID 留空自动推断，或改成与音色对应的版本）"
                } else {
                    ""
                };
                return Err(format!("code {}{}：{}", code, hint, message));
            }
        }
    }
    if audio.is_empty() {
        return Err(if finished {
            "服务端未返回音频".to_string()
        } else {
            "响应中没有音频数据".to_string()
        });
    }
    Ok(audio)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, test_logger};

    const API_KEY: &str = "volc-api-key-0123456789";
    const ACCESS_KEY: &str = "volc-access-token-abcdef";

    async fn setup() -> (TTSService, Arc<SqlitePool>, PathBuf) {
        let pool = memory_pool().await;
        let dir = std::env::temp_dir().join(format!("redlark-tts-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        (
            TTSService::new(pool.clone(), test_logger(), dir.clone()),
            pool,
            dir,
        )
    }

    fn update() -> UpdateTtsConfigRequest {
        UpdateTtsConfigRequest::default()
    }

    async fn seed_cache(
        pool: &SqlitePool,
        dir: &std::path::Path,
        hash: &str,
        days_ago: i64,
        with_file: bool,
    ) -> PathBuf {
        let path = dir.join(format!("{}.mp3", hash));
        if with_file {
            std::fs::write(&path, b"audio").unwrap();
        }
        sqlx::query(
            "INSERT INTO tts_cache (text_hash, original_text, voice_id, model_id, file_path, file_size, created_at, last_used)
             VALUES (?, 't', 'v', 'm', ?, 5, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now', ?))",
        )
        .bind(hash)
        .bind(path.to_string_lossy().to_string())
        .bind(format!("-{} days", days_ago))
        .execute(pool)
        .await
        .unwrap();
        path
    }

    #[tokio::test]
    async fn config_response_never_contains_secrets() {
        let (service, _pool, _dir) = setup().await;
        let initial = service.get_config().await.unwrap();
        assert!(!initial.configured);
        assert_eq!(initial.effective_resource_id, "seed-tts-2.0");

        service
            .update_config(UpdateTtsConfigRequest {
                api_key: Some(format!("  {}  ", API_KEY)),
                ..update()
            })
            .await
            .unwrap();
        // 只改语速不影响已保存的密钥
        service
            .update_config(UpdateTtsConfigRequest {
                speech_rate: Some(-20),
                ..update()
            })
            .await
            .unwrap();
        let config = service.get_config().await.unwrap();
        assert!(config.configured && config.has_api_key);
        assert_eq!(config.api_key_preview.as_deref(), Some("volc****"));
        assert_eq!(config.speech_rate, -20);
        assert_eq!(service.load_config().await.unwrap().api_key, API_KEY);

        // 切换到旧控制台鉴权：清空 API Key，填 AppID + Access Token
        service
            .update_config(UpdateTtsConfigRequest {
                api_key: Some(String::new()),
                app_id: Some("1234567".to_string()),
                ..update()
            })
            .await
            .unwrap();
        assert!(
            !service.get_config().await.unwrap().configured,
            "缺 Access Token"
        );
        service
            .update_config(UpdateTtsConfigRequest {
                access_key: Some(ACCESS_KEY.to_string()),
                ..update()
            })
            .await
            .unwrap();
        let config = service.get_config().await.unwrap();
        assert!(config.configured && !config.has_api_key && config.has_access_key);
        assert_eq!(config.app_id, "1234567");

        let json = serde_json::to_string(&config).unwrap();
        assert!(!json.contains(API_KEY) && !json.contains(ACCESS_KEY));
    }

    #[tokio::test]
    async fn invalid_updates_are_rejected() {
        let (service, _pool, _dir) = setup().await;
        for bad in [
            UpdateTtsConfigRequest::default(),
            UpdateTtsConfigRequest {
                speech_rate: Some(101),
                ..update()
            },
            UpdateTtsConfigRequest {
                default_voice_id: Some("bad voice\r\nX-Evil: 1".to_string()),
                ..update()
            },
            UpdateTtsConfigRequest {
                resource_id: Some("seed tts".to_string()),
                ..update()
            },
        ] {
            assert!(matches!(
                service.update_config(bad).await,
                Err(AppError::ValidationError(_))
            ));
        }
        // 资源 ID 传空字符串 = 恢复自动推断
        service
            .update_config(UpdateTtsConfigRequest {
                resource_id: Some(String::new()),
                ..update()
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn default_voice_supports_presets_and_custom_ids() {
        let (service, _pool, _dir) = setup().await;
        let voice = service.get_default_voice().await.unwrap().unwrap();
        assert_eq!(voice.voice_id, "en_male_tim_uranus_bigtts");
        assert_eq!(voice.voice_name, "Tim");

        service
            .update_config(crate::types::tts::UpdateTtsConfigRequest {
                default_voice_id: Some("en_female_sarah_mars_bigtts".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        let voice = service.get_default_voice().await.unwrap().unwrap();
        assert_eq!(voice.voice_id, "en_female_sarah_mars_bigtts");
        assert_eq!(voice.model_id, "seed-tts-1.0");
        assert!(voice.display_name.contains("自定义"));
        assert_eq!(
            service.get_config().await.unwrap().effective_resource_id,
            "seed-tts-1.0"
        );
    }

    #[test]
    fn resource_id_is_inferred_from_voice_and_can_be_overridden() {
        assert_eq!(
            infer_resource_id("en_male_tim_uranus_bigtts"),
            "seed-tts-2.0"
        );
        assert_eq!(infer_resource_id("saturn_zh_female_x"), "seed-tts-2.0");
        assert_eq!(
            infer_resource_id("zh_female_shuangkuaisisi_moon_bigtts"),
            "seed-tts-1.0"
        );
        assert_eq!(infer_resource_id("S_EVeoGUVU1"), "seed-icl-2.0");
        assert_eq!(effective_resource_id("", "S_abc"), "seed-icl-2.0");
        assert_eq!(
            effective_resource_id(" seed-tts-1.0 ", "S_abc"),
            "seed-tts-1.0"
        );
    }

    /// 真实调用：逐词时间与慢速、缓存。`REDLARK_E2E_TTS_KEY=<key> cargo test services::tts::tests::real_ -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn real_word_timings_are_returned_and_cached() {
        let key = std::env::var("REDLARK_E2E_TTS_KEY").expect("需要 REDLARK_E2E_TTS_KEY");
        let (service, _pool, dir) = setup().await;
        service
            .update_config(UpdateTtsConfigRequest {
                api_key: Some(key),
                app_id: None,
                access_key: None,
                resource_id: None,
                default_voice_id: Some("en_male_tim_uranus_bigtts".into()),
                speech_rate: None,
            })
            .await
            .unwrap();
        let text = "Day by day, the elephant ate more and got stronger.";
        let first = service
            .text_to_speech(text, None, true, SpeechStyle::Sentence, false, true)
            .await
            .unwrap();
        let words = first.words.expect("应返回逐词时间");
        println!(
            "{:?}",
            words
                .iter()
                .map(|w| (&w.word, w.start_ms, w.end_ms))
                .collect::<Vec<_>>()
        );
        assert!(!first.cached && words.len() >= 9);
        assert!(words.windows(2).all(|w| w[0].start_ms <= w[1].start_ms));
        // 第二次命中缓存，逐词时间也从缓存读出
        let second = service
            .text_to_speech(text, None, true, SpeechStyle::Sentence, false, true)
            .await
            .unwrap();
        assert!(second.cached);
        assert_eq!(second.words.as_ref().map(Vec::len), Some(words.len()));
        // 慢速单独缓存，时长更长
        let slow = service
            .text_to_speech(text, None, true, SpeechStyle::Sentence, true, true)
            .await
            .unwrap();
        assert!(!slow.cached);
        let slow_end = slow.words.unwrap().last().unwrap().end_ms;
        println!(
            "常速结束 {} ms，慢速结束 {} ms",
            words.last().unwrap().end_ms,
            slow_end
        );
        assert!(slow_end > words.last().unwrap().end_ms);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn word_timings_are_collected_from_sentence_events() {
        let body = concat!(
            "{\"code\":0,\"data\":null,\"sentence\":{\"text\":\"Hi there.\",\"words\":[]}}\n",
            "{\"code\":0,\"data\":null,\"sentence\":{\"text\":\"Hi there.\",\"words\":[",
            "{\"word\":\"Hi\",\"startTime\":0.235,\"endTime\":0.6},{\"word\":\"there.\",\"startTime\":0.6,\"endTime\":1.0}]}}\n",
            "{\"code\":20000000}\n"
        );
        assert_eq!(
            parse_word_timings(body),
            vec![
                WordTiming {
                    word: "Hi".into(),
                    start_ms: 235,
                    end_ms: 600
                },
                WordTiming {
                    word: "there.".into(),
                    start_ms: 600,
                    end_ms: 1000
                },
            ]
        );
        let body = request_body("x", "v", &VolcengineTtsConfig::default(), None, None, true);
        assert_eq!(body["req_params"]["audio_params"]["enable_subtitle"], true);
    }

    #[test]
    fn stream_chunks_are_decoded_and_concatenated() {
        let a = general_purpose::STANDARD.encode(b"ID3-part1");
        let b = general_purpose::STANDARD.encode(b"-part2");
        let body = format!(
            "{{\"code\":0,\"message\":\"\",\"data\":\"{a}\"}}\n\n{{\"code\":0,\"data\":null,\"sentence\":{{\"text\":\"hi\"}}}}\n{{\"code\":0,\"data\":\"{b}\"}}\n{{\"code\":20000000,\"message\":\"OK\",\"usage\":{{\"text_words\":2}}}}\n"
        );
        assert_eq!(parse_tts_stream(&body).unwrap(), b"ID3-part1-part2");

        // SSE 形式
        let sse = format!(
            "event: 352\ndata: {{\"code\":0,\"data\":\"{a}\"}}\n\ndata: {{\"code\":20000000}}\n"
        );
        assert_eq!(parse_tts_stream(&sse).unwrap(), b"ID3-part1");
    }

    #[test]
    fn stream_errors_carry_code_message_and_hint() {
        let err = parse_tts_stream(
            r#"{"code":55000000,"message":"resource ID is mismatched with speaker related resource"}"#,
        )
        .unwrap_err();
        assert!(err.contains("55000000") && err.contains("资源 ID") && err.contains("mismatched"));

        let a = general_purpose::STANDARD.encode(b"x");
        let mid_error = format!(
            "{{\"code\":0,\"data\":\"{a}\"}}\n{{\"code\":45000000,\"message\":\"quota exceeded\"}}"
        );
        assert!(parse_tts_stream(&mid_error)
            .unwrap_err()
            .contains("quota exceeded"));

        // 实测（2026-10-06）无效 Key 的 401 响应体
        let err = parse_tts_stream(
            r#"{"header":{"reqid":"probe-15979","code":45000010,"message":"Invalid X-Api-Key"}}"#,
        )
        .unwrap_err();
        assert!(err.contains("45000010") && err.contains("Invalid X-Api-Key"));

        assert!(parse_tts_stream(r#"{"code":20000000}"#).is_err());
        assert!(parse_tts_stream("").is_err());
        assert!(parse_tts_stream(r#"{"code":0,"data":"***"}"#).is_err());
    }

    #[test]
    fn style_instruction_goes_into_additions_only_when_given() {
        let config = VolcengineTtsConfig {
            sample_rate: 24000,
            ..Default::default()
        };
        let plain = request_body("cat", "v", &config, None, None, false);
        assert!(plain["req_params"].get("additions").is_none());

        let styled = request_body(
            "cat",
            "v",
            &config,
            SpeechStyle::Word.instruction(),
            SpeechStyle::Word.language(),
            false,
        );
        let additions = styled["req_params"]["additions"]
            .as_str()
            .expect("additions 是字符串");
        let parsed: serde_json::Value = serde_json::from_str(additions).unwrap();
        assert!(parsed["context_texts"][0]
            .as_str()
            .unwrap()
            .contains("English word"));
        // 只按英语读（数字也读英文）
        assert_eq!(parsed["explicit_language"], "en");
        // 1.0 资源不支持指令，但语种照样带上
        let lang_only = request_body("3 cats", "v", &config, None, Some("en"), false);
        let parsed: serde_json::Value =
            serde_json::from_str(lang_only["req_params"]["additions"].as_str().unwrap()).unwrap();
        assert!(parsed.get("context_texts").is_none());
        assert_eq!(parsed["explicit_language"], "en");
        assert_eq!(SpeechStyle::Plain.language(), None);

        assert!(supports_instruction("seed-tts-2.0") && !supports_instruction("seed-tts-1.0"));
        assert_eq!(SpeechStyle::parse(None).unwrap(), SpeechStyle::Plain);
        assert_eq!(
            SpeechStyle::parse(Some("sentence")).unwrap(),
            SpeechStyle::Sentence
        );
        assert!(SpeechStyle::parse(Some("loud")).is_err());
        assert_ne!(
            SpeechStyle::Word.cache_tag(),
            SpeechStyle::Sentence.cache_tag()
        );
    }

    #[tokio::test]
    async fn clear_cache_removes_only_entries_unused_for_the_given_days() {
        let (service, pool, dir) = setup().await;
        let old = seed_cache(&pool, &dir, "old", 40, true).await;
        seed_cache(&pool, &dir, "old-missing-file", 40, false).await;
        let recent = seed_cache(&pool, &dir, "recent", 1, true).await;

        assert_eq!(service.clear_cache(None).await.unwrap(), 2);

        assert!(!old.exists());
        assert!(recent.exists());
        let left: Vec<String> = sqlx::query_scalar("SELECT text_hash FROM tts_cache")
            .fetch_all(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(left, vec!["recent".to_string()]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn cache_stats_sum_sizes_and_split_out_stale_entries() {
        let (service, pool, dir) = setup().await;
        seed_cache(&pool, &dir, "old", 40, true).await;
        seed_cache(&pool, &dir, "recent", 1, true).await;
        sqlx::query(
            "UPDATE tts_cache SET file_size = CASE text_hash WHEN 'old' THEN 1000 ELSE 2500 END",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();

        let stats = service.cache_stats().await.unwrap();
        assert_eq!(
            (
                stats.entries,
                stats.total_bytes,
                stats.stale_entries,
                stats.stale_bytes,
                stats.stale_days
            ),
            (2, 3500, 1, 1000, 30)
        );
        let v = serde_json::to_value(&stats).unwrap();
        assert_eq!(v["totalBytes"], 3500);
        assert_eq!(v["staleBytes"], 1000);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn speech_requires_credentials_and_valid_input_before_calling_the_api() {
        let (service, _pool, _dir) = setup().await;
        assert!(matches!(
            service
                .text_to_speech("hello", None, true, SpeechStyle::Word, false, false)
                .await,
            Err(AppError::ValidationError(_))
        ));
        service
            .update_config(UpdateTtsConfigRequest {
                api_key: Some(API_KEY.to_string()),
                ..update()
            })
            .await
            .unwrap();
        for (text, voice) in [("  ", None), ("hello", Some("bad voice"))] {
            assert!(matches!(
                service
                    .text_to_speech(text, voice, true, SpeechStyle::Plain, false, false)
                    .await,
                Err(AppError::ValidationError(_))
            ));
        }
        let long = "a".repeat(1001);
        assert!(matches!(
            service
                .text_to_speech(&long, None, true, SpeechStyle::Sentence, false, false)
                .await,
            Err(AppError::ValidationError(_))
        ));
    }
}
