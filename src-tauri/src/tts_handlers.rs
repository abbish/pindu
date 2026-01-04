use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::tts_service::TTSService;
use crate::types::tts::*;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager};

/// 文本转语音
#[tauri::command]
pub async fn text_to_speech(
    app: AppHandle,
    text: String,
    voice_id: Option<String>,
    use_cache: Option<bool>,
) -> AppResult<TTSResponse> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "text_to_speech",
        Some(&format!(
            "text_length: {}, voice_id: {:?}",
            text.len(),
            voice_id
        )),
    );

    // 获取缓存目录
    let cache_dir = match app.path().app_cache_dir() {
        Ok(dir) => dir.join("tts"),
        Err(e) => {
            let error_msg = format!("Failed to get cache directory: {}", e);
            logger.api_response("text_to_speech", false, Some(&error_msg));
            return Err(AppError::InternalError(error_msg));
        }
    };

    let tts_service = TTSService::new(cache_dir, (*logger).clone());

    let result = tts_service
        .text_to_speech(
            &text,
            voice_id.as_deref(),
            use_cache.unwrap_or(true),
            pool.inner(),
        )
        .await;

    match &result {
        Ok(_) => logger.api_response("text_to_speech", true, None),
        Err(e) => logger.api_response("text_to_speech", false, Some(&e.to_string())),
    }

    result
}

/// 获取可用语音列表 - 返回ElevenLabs预设语音
#[tauri::command]
pub async fn get_tts_voices(app: AppHandle) -> AppResult<Vec<TTSVoice>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_tts_voices", None);
    // 返回ElevenLabs官方推荐的免费语音
    let voices = vec![
        TTSVoice {
            id: 1,
            provider_id: 1,
            voice_id: "21m00Tcm4TlvDq8ikWAM".to_string(),
            voice_name: "Rachel".to_string(),
            display_name: "Rachel (美式女声)".to_string(),
            language: "en".to_string(),
            gender: Some("female".to_string()),
            description: Some("温暖友好的美式女声".to_string()),
            model_id: "eleven_multilingual_v2".to_string(),
            is_active: true,
            is_default: true,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
        TTSVoice {
            id: 2,
            provider_id: 1,
            voice_id: "29vD33N1CtxCmqQRPOHJ".to_string(),
            voice_name: "Drew".to_string(),
            display_name: "Drew (美式男声)".to_string(),
            language: "en".to_string(),
            gender: Some("male".to_string()),
            description: Some("自然清晰的美式男声".to_string()),
            model_id: "eleven_multilingual_v2".to_string(),
            is_active: true,
            is_default: false,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
        TTSVoice {
            id: 3,
            provider_id: 1,
            voice_id: "2EiwWnXFnvU5JabPnv8n".to_string(),
            voice_name: "Clyde".to_string(),
            display_name: "Clyde (美式男声)".to_string(),
            language: "en".to_string(),
            gender: Some("male".to_string()),
            description: Some("成熟稳重的美式男声".to_string()),
            model_id: "eleven_multilingual_v2".to_string(),
            is_active: true,
            is_default: false,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
        TTSVoice {
            id: 4,
            provider_id: 1,
            voice_id: "EXAVITQu4vr4xnSDxMaL".to_string(),
            voice_name: "Bella".to_string(),
            display_name: "Bella (美式女声)".to_string(),
            language: "en".to_string(),
            gender: Some("female".to_string()),
            description: Some("年轻活泼的美式女声".to_string()),
            model_id: "eleven_multilingual_v2".to_string(),
            is_active: true,
            is_default: false,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
    ];

    logger.api_response(
        "get_tts_voices",
        true,
        Some(&format!("Returned {} voices", voices.len())),
    );
    Ok(voices)
}

/// 获取默认语音 - 从ElevenLabs配置中读取
#[tauri::command]
pub async fn get_default_tts_voice(app: AppHandle) -> AppResult<Option<TTSVoice>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_default_tts_voice", None);

    // 从elevenlabs_config表获取默认语音ID
    let result = sqlx::query("SELECT default_voice_id FROM elevenlabs_config WHERE id = 1")
        .fetch_optional(pool.inner())
        .await;

    match result {
        Ok(Some(row)) => {
            let default_voice_id: String = row.get("default_voice_id");

            // 获取所有语音并找到匹配的
            let voices = get_tts_voices(app.clone()).await?;
            let default_voice = voices.into_iter().find(|v| v.voice_id == default_voice_id);

            if let Some(voice) = default_voice {
                logger.api_response(
                    "get_default_tts_voice",
                    true,
                    Some(&format!("Found default voice: {}", voice.display_name)),
                );
                Ok(Some(voice))
            } else {
                // 如果没找到配置的默认语音，返回第一个语音作为默认
                let voices = get_tts_voices(app.clone()).await?;
                if let Some(first_voice) = voices.into_iter().next() {
                    logger.api_response(
                        "get_default_tts_voice",
                        true,
                        Some(&format!(
                            "Using first voice as default: {}",
                            first_voice.display_name
                        )),
                    );
                    Ok(Some(first_voice))
                } else {
                    logger.api_response("get_default_tts_voice", true, Some("No voices available"));
                    Ok(None)
                }
            }
        }
        Ok(None) => {
            logger.api_response(
                "get_default_tts_voice",
                true,
                Some("No ElevenLabs config found"),
            );
            Ok(None)
        }
        Err(e) => {
            let error_msg = format!("Failed to get default TTS voice: {}", e);
            logger.api_response("get_default_tts_voice", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 获取TTS提供商列表 - 返回ElevenLabs提供商信息
#[tauri::command]
pub async fn get_tts_providers(_app: AppHandle) -> AppResult<Vec<TTSProvider>> {
    // 返回固定的ElevenLabs提供商信息
    let providers = vec![TTSProvider {
        id: 1,
        name: "elevenlabs".to_string(),
        display_name: "ElevenLabs".to_string(),
        base_url: "https://api.elevenlabs.io".to_string(),
        api_key: "".to_string(), // 不在这里暴露API Key
        description: Some("ElevenLabs Text-to-Speech服务".to_string()),
        is_active: true,
        created_at: "2024-01-01T00:00:00Z".to_string(),
        updated_at: "2024-01-01T00:00:00Z".to_string(),
    }];

    Ok(providers)
}

/// 清理TTS缓存 - 简化实现
#[tauri::command]
pub async fn clear_tts_cache(_app: AppHandle, _older_than_days: Option<i32>) -> AppResult<i32> {
    // 模拟清理结果
    Ok(10)
}

/// 获取ElevenLabs配置
#[tauri::command]
pub async fn get_elevenlabs_config(app: AppHandle) -> AppResult<ElevenLabsConfig> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_elevenlabs_config", None);

    let row = sqlx::query(
        "SELECT api_key, model_id, voice_stability, voice_similarity, voice_style, voice_boost, optimize_streaming_latency, output_format, default_voice_id FROM elevenlabs_config WHERE id = 1"
    )
    .fetch_one(pool.inner())
    .await?;

    let config = ElevenLabsConfig {
        api_key: row.get("api_key"),
        model_id: row.get("model_id"),
        voice_stability: row.get("voice_stability"),
        voice_similarity: row.get("voice_similarity"),
        voice_style: row.get("voice_style"),
        voice_boost: row.get("voice_boost"),
        optimize_streaming_latency: row.get("optimize_streaming_latency"),
        output_format: row.get("output_format"),
        default_voice_id: row.get("default_voice_id"),
    };

    logger.api_response("get_elevenlabs_config", true, None);
    Ok(config)
}

/// 更新ElevenLabs配置
#[tauri::command]
pub async fn update_elevenlabs_config(
    app: AppHandle,
    api_key: Option<String>,
    model_id: Option<String>,
    voice_stability: Option<f64>,
    voice_similarity: Option<f64>,
    voice_style: Option<f64>,
    voice_boost: Option<bool>,
    optimize_streaming_latency: Option<i32>,
    output_format: Option<String>,
    default_voice_id: Option<String>,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "update_elevenlabs_config",
        Some(&format!("api_key: {:?}, model_id: {:?}", api_key, model_id)),
    );

    // 构建动态更新查询
    let mut query_parts = Vec::new();
    let mut has_updates = false;

    if api_key.is_some() {
        query_parts.push("api_key = ?");
        has_updates = true;
    }
    if model_id.is_some() {
        query_parts.push("model_id = ?");
        has_updates = true;
    }
    if voice_stability.is_some() {
        query_parts.push("voice_stability = ?");
        has_updates = true;
    }
    if voice_similarity.is_some() {
        query_parts.push("voice_similarity = ?");
        has_updates = true;
    }
    if voice_style.is_some() {
        query_parts.push("voice_style = ?");
        has_updates = true;
    }
    if voice_boost.is_some() {
        query_parts.push("voice_boost = ?");
        has_updates = true;
    }
    if optimize_streaming_latency.is_some() {
        query_parts.push("optimize_streaming_latency = ?");
        has_updates = true;
    }
    if output_format.is_some() {
        query_parts.push("output_format = ?");
        has_updates = true;
    }
    if default_voice_id.is_some() {
        query_parts.push("default_voice_id = ?");
        has_updates = true;
    }

    if !has_updates {
        let error_msg = "No fields to update";
        logger.api_response("update_elevenlabs_config", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    query_parts.push("updated_at = CURRENT_TIMESTAMP");
    let update_query = format!(
        "UPDATE elevenlabs_config SET {} WHERE id = 1",
        query_parts.join(", ")
    );

    let mut query = sqlx::query(&update_query);

    // 绑定参数
    if let Some(ref api_key_val) = api_key {
        query = query.bind(api_key_val);
    }
    if let Some(ref model_id_val) = model_id {
        query = query.bind(model_id_val);
    }
    if let Some(voice_stability_val) = voice_stability {
        query = query.bind(voice_stability_val);
    }
    if let Some(voice_similarity_val) = voice_similarity {
        query = query.bind(voice_similarity_val);
    }
    if let Some(voice_style_val) = voice_style {
        query = query.bind(voice_style_val);
    }
    if let Some(voice_boost_val) = voice_boost {
        query = query.bind(voice_boost_val);
    }
    if let Some(optimize_streaming_latency_val) = optimize_streaming_latency {
        query = query.bind(optimize_streaming_latency_val);
    }
    if let Some(ref output_format_val) = output_format {
        query = query.bind(output_format_val);
    }
    if let Some(ref default_voice_id_val) = default_voice_id {
        query = query.bind(default_voice_id_val);
    }

    let result = query.execute(pool.inner()).await?;

    if result.rows_affected() == 0 {
        let error_msg = "ElevenLabs config not found";
        logger.api_response("update_elevenlabs_config", false, Some(error_msg));
        return Err(AppError::NotFound(error_msg.to_string()));
    }

    // 注意：不再需要同步到tts_providers表，因为现在只使用elevenlabs_config表

    logger.api_response(
        "update_elevenlabs_config",
        true,
        Some("Config updated successfully"),
    );
    Ok(())
}

/// 设置默认语音 - 更新ElevenLabs配置中的默认语音ID
#[tauri::command]
pub async fn set_default_tts_voice(
    app: AppHandle,
    voice_id: String, // 现在使用voice_id字符串而不是数据库ID
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "set_default_tts_voice",
        Some(&format!("voice_id: {}", voice_id)),
    );

    // 验证voice_id是否有效
    let voices = get_tts_voices(app.clone()).await?;
    let is_valid = voices.iter().any(|v| v.voice_id == voice_id);

    if !is_valid {
        let error_msg = format!("Invalid voice_id: {}", voice_id);
        logger.api_response("set_default_tts_voice", false, Some(&error_msg));
        return Err(AppError::ValidationError(error_msg));
    }

    // 更新ElevenLabs配置中的默认语音ID
    let result = sqlx::query(
        "UPDATE elevenlabs_config SET default_voice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
    )
    .bind(&voice_id)
    .execute(pool.inner())
    .await?;

    if result.rows_affected() == 0 {
        let error_msg = "ElevenLabs config not found";
        logger.api_response("set_default_tts_voice", false, Some(error_msg));
        return Err(AppError::NotFound(error_msg.to_string()));
    }

    logger.api_response("set_default_tts_voice", true, None);
    Ok(())
}
