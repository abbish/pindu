//! TTS 命令：豆包语音合成、配置（脱敏返回）、默认音色、缓存清理

use crate::error::AppResult;
use crate::logger::Logger;
use crate::services::tts::{volcengine_voices, SpeechStyle, TTSService};
use crate::types::tts::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

fn tts_service(app: &AppHandle) -> AppResult<TTSService> {
    let cache_dir = crate::app_paths::dirs(app).cache.join("tts");
    Ok(TTSService::new(
        Arc::new(app.state::<SqlitePool>().inner().clone()),
        Arc::new(app.state::<Logger>().inner().clone()),
        cache_dir,
    ))
}

fn log_result<T>(logger: &Logger, cmd: &str, result: &AppResult<T>) {
    match result {
        Ok(_) => logger.api_response(cmd, true, None),
        Err(e) => logger.api_response(cmd, false, Some(&e.to_string())),
    }
}

/// 文本转语音
#[tauri::command]
pub async fn text_to_speech(
    app: AppHandle,
    text: String,
    voice_id: Option<String>,
    use_cache: Option<bool>,
    style: Option<String>,
    speed: Option<String>,
    with_timings: Option<bool>,
) -> AppResult<TTSResponse> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "text_to_speech",
        Some(&format!(
            "text_length: {}, voice_id: {:?}, style: {:?}, speed: {:?}",
            text.len(),
            voice_id,
            style,
            speed
        )),
    );

    let result = match tts_service(&app) {
        Ok(service) => match SpeechStyle::parse(style.as_deref()) {
            Ok(style) => {
                service
                    .text_to_speech(
                        &text,
                        voice_id.as_deref(),
                        use_cache.unwrap_or(true),
                        style,
                        speed.as_deref() == Some("slow"),
                        with_timings.unwrap_or(false),
                    )
                    .await
            }
            Err(e) => Err(e),
        },
        Err(e) => Err(e),
    };
    log_result(&logger, "text_to_speech", &result);
    result
}

/// 获取预置音色列表（豆包语音合成英文音色）
#[tauri::command]
pub async fn get_tts_voices(app: AppHandle) -> AppResult<Vec<TTSVoice>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_tts_voices", None);
    let voices = volcengine_voices();
    logger.api_response(
        "get_tts_voices",
        true,
        Some(&format!("Returned {} voices", voices.len())),
    );
    Ok(voices)
}

/// 获取默认音色（预置音色或用户填写的自定义音色 ID）
#[tauri::command]
pub async fn get_default_tts_voice(app: AppHandle) -> AppResult<Option<TTSVoice>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_default_tts_voice", None);
    let result = match tts_service(&app) {
        Ok(service) => service.get_default_voice().await,
        Err(e) => Err(e),
    };
    log_result(&logger, "get_default_tts_voice", &result);
    result
}

/// 清理超过 `older_than_days`（默认 30）天未使用的语音缓存，返回清理条数
#[tauri::command]
pub async fn clear_tts_cache(app: AppHandle, older_than_days: Option<i32>) -> AppResult<i32> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "clear_tts_cache",
        Some(&format!("older_than_days: {:?}", older_than_days)),
    );
    let result = match tts_service(&app) {
        Ok(service) => service.clear_cache(older_than_days).await,
        Err(e) => Err(e),
    };
    log_result(&logger, "clear_tts_cache", &result);
    result
}

/// 语音缓存统计：条数、占用空间、很久没用的部分
#[tauri::command]
pub async fn get_tts_cache_stats(app: AppHandle) -> AppResult<TtsCacheStats> {
    let logger = app.state::<Logger>();
    logger.api_request("get_tts_cache_stats", None);
    let result = match tts_service(&app) {
        Ok(service) => service.cache_stats().await,
        Err(e) => Err(e),
    };
    log_result(&logger, "get_tts_cache_stats", &result);
    result
}

/// 获取豆包语音合成配置（脱敏：只返回是否已配置与前 4 位预览）
#[tauri::command]
pub async fn get_tts_config(app: AppHandle) -> AppResult<TtsConfigSafe> {
    let logger = app.state::<Logger>();
    logger.api_request("get_tts_config", None);
    let result = match tts_service(&app) {
        Ok(service) => service.get_config().await,
        Err(e) => Err(e),
    };
    log_result(&logger, "get_tts_config", &result);
    result
}

/// 更新豆包语音合成配置（None 字段不修改；密钥传空字符串表示清除）
#[tauri::command]
pub async fn update_tts_config(app: AppHandle, request: UpdateTtsConfigRequest) -> AppResult<()> {
    let logger = app.state::<Logger>();
    // 日志中不得出现密钥明文
    logger.api_request(
        "update_tts_config",
        Some(&format!(
            "api_key_changed: {}, app_id_changed: {}, access_key_changed: {}, resource_id: {:?}, default_voice_id: {:?}, speech_rate: {:?}",
            request.api_key.is_some(),
            request.app_id.is_some(),
            request.access_key.is_some(),
            request.resource_id,
            request.default_voice_id,
            request.speech_rate
        )),
    );
    let result = match tts_service(&app) {
        Ok(service) => service.update_config(request).await,
        Err(e) => Err(e),
    };
    log_result(&logger, "update_tts_config", &result);
    result
}

/// 朗读偏好（风格预设、自定义风格、音调、音量）
#[tauri::command]
pub async fn get_tts_preferences(app: AppHandle) -> AppResult<TtsPreferences> {
    let logger = app.state::<Logger>();
    logger.api_request("get_tts_preferences", None);
    let result = match tts_service(&app) {
        Ok(service) => Ok(service.preferences().await),
        Err(e) => Err(e),
    };
    log_result(&logger, "get_tts_preferences", &result);
    result
}

/// 保存朗读偏好；返回校正后的值
#[tauri::command]
pub async fn update_tts_preferences(
    app: AppHandle,
    request: TtsPreferences,
) -> AppResult<TtsPreferences> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "update_tts_preferences",
        Some(&format!(
            "style: {}, custom_chars: {}, pitch: {}, loudness: {}",
            request.style,
            request.custom_instruction.chars().count(),
            request.pitch,
            request.loudness
        )),
    );
    let result = match tts_service(&app) {
        Ok(service) => service.save_preferences(request).await,
        Err(e) => Err(e),
    };
    log_result(&logger, "update_tts_preferences", &result);
    result
}
