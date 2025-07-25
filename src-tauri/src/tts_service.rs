use reqwest::Client;
use sha2::{Sha256, Digest};
use std::path::PathBuf;
use tokio::fs;
use sqlx::{SqlitePool, Row};
use crate::types::tts::*;
use crate::error::{AppResult, AppError};
use crate::logger::Logger;
use base64::{Engine as _, engine::general_purpose};

pub struct TTSService {
    client: Client,
    cache_dir: PathBuf,
    logger: Logger,
}

impl TTSService {
    pub fn new(cache_dir: PathBuf, logger: Logger) -> Self {
        Self {
            client: Client::new(),
            cache_dir,
            logger,
        }
    }

    /// 生成文本哈希
    fn generate_text_hash(&self, text: &str, voice_id: &str, model_id: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        hasher.update(voice_id.as_bytes());
        hasher.update(model_id.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// 检查缓存
    async fn check_cache(&self, text_hash: &str, pool: &SqlitePool) -> Option<TTSCacheEntry> {
        let result = sqlx::query(
            "SELECT id, text_hash, original_text, voice_id, model_id, file_path, file_size, 
                    duration_ms, created_at, last_used, use_count 
             FROM tts_cache WHERE text_hash = ?"
        )
        .bind(text_hash)
        .fetch_optional(pool)
        .await;

        match result {
            Ok(Some(row)) => {
                self.logger.info("TTS", &format!("Cache hit for text_hash: {}", text_hash));
                Some(TTSCacheEntry {
                    id: row.get("id"),
                    text_hash: row.get("text_hash"),
                    original_text: row.get("original_text"),
                    voice_id: row.get("voice_id"),
                    model_id: row.get("model_id"),
                    file_path: row.get("file_path"),
                    file_size: row.get("file_size"),
                    duration_ms: row.get("duration_ms"),
                    created_at: row.get("created_at"),
                    last_used: row.get("last_used"),
                    use_count: row.get("use_count"),
                })
            }
            Ok(None) => {
                self.logger.info("TTS", &format!("Cache miss for text_hash: {}", text_hash));
                None
            }
            Err(e) => {
                self.logger.error("TTS", &format!("Cache check error: {}", e), None);
                None
            }
        }
    }

    /// 更新缓存使用统计
    async fn update_cache_usage(&self, text_hash: &str, pool: &SqlitePool) -> AppResult<()> {
        sqlx::query(
            "UPDATE tts_cache SET last_used = CURRENT_TIMESTAMP, use_count = use_count + 1 
             WHERE text_hash = ?"
        )
        .bind(text_hash)
        .execute(pool)
        .await?;
        
        self.logger.info("TTS", &format!("Updated cache usage for: {}", text_hash));
        Ok(())
    }

    /// 获取ElevenLabs配置
    async fn get_elevenlabs_config(&self, pool: &SqlitePool) -> AppResult<ElevenLabsConfig> {
        let row = sqlx::query(
            "SELECT api_key, model_id, voice_stability, voice_similarity, voice_style, 
                    voice_boost, optimize_streaming_latency, output_format, default_voice_id 
             FROM elevenlabs_config WHERE id = 1"
        )
        .fetch_one(pool)
        .await?;

        Ok(ElevenLabsConfig {
            api_key: row.get("api_key"),
            model_id: row.get("model_id"),
            voice_stability: row.get("voice_stability"),
            voice_similarity: row.get("voice_similarity"),
            voice_style: row.get("voice_style"),
            voice_boost: row.get("voice_boost"),
            optimize_streaming_latency: row.get("optimize_streaming_latency"),
            output_format: row.get("output_format"),
            default_voice_id: row.get("default_voice_id"),
        })
    }

    /// 调用ElevenLabs API
    async fn call_elevenlabs_api(
        &self,
        text: &str,
        config: &ElevenLabsConfig,
        voice_id: &str,
    ) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{}", voice_id);
        
        let request_body = ElevenLabsRequest {
            text: text.to_string(),
            model_id: config.model_id.clone(),
            output_format: config.output_format.clone(),
        };

        self.logger.info("TTS", &format!("Calling ElevenLabs API: {}", url));

        let response = self.client
            .post(&url)
            .header("xi-api-key", &config.api_key)
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("ElevenLabs API error: {}", error_text).into());
        }

        let audio_data = response.bytes().await?;
        Ok(audio_data.to_vec())
    }

    /// 保存音频文件
    async fn save_audio_file(&self, audio_data: &[u8], text_hash: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
        // 确保缓存目录存在
        fs::create_dir_all(&self.cache_dir).await?;

        let file_path = self.cache_dir.join(format!("{}.mp3", text_hash));
        fs::write(&file_path, audio_data).await?;

        self.logger.info("TTS", &format!("Saved audio file: {}", file_path.display()));
        Ok(file_path)
    }

    /// 主要的TTS方法
    pub async fn text_to_speech(
        &self,
        text: &str,
        voice_id: Option<&str>,
        use_cache: bool,
        pool: &SqlitePool,
    ) -> AppResult<TTSResponse> {
        self.logger.info("TTS", &format!("Processing TTS request: text_length={}, voice_id={:?}, use_cache={}",
            text.len(), voice_id, use_cache));

        // 验证输入
        if text.trim().is_empty() {
            return Err(AppError::ValidationError("Text cannot be empty".to_string()));
        }

        if text.len() > 5000 {
            return Err(AppError::ValidationError("Text too long (max 5000 characters)".to_string()));
        }

        // 获取ElevenLabs配置
        let config = self.get_elevenlabs_config(pool).await?;

        // 检查API Key
        if config.api_key.is_empty() || config.api_key == "PLEASE_SET_YOUR_API_KEY" {
            return Err(AppError::ValidationError(
                "TTS provider 'ElevenLabs' API key not configured".to_string()
            ));
        }

        // 确定要使用的语音ID
        let voice_id_to_use = voice_id.unwrap_or(&config.default_voice_id);
        
        if voice_id_to_use.is_empty() {
            return Err(AppError::ValidationError("No voice ID specified and no default voice configured".to_string()));
        }

        let text_hash = self.generate_text_hash(text, voice_id_to_use, &config.model_id);

        // 检查缓存
        if use_cache {
            if let Some(cache_entry) = self.check_cache(&text_hash, pool).await {
                // 验证文件是否存在
                let file_path = PathBuf::from(&cache_entry.file_path);
                if file_path.exists() {
                    // 读取缓存文件并转换为base64
                    match tokio::fs::read(&file_path).await {
                        Ok(cached_audio_data) => {
                            // 更新使用统计
                            let _ = self.update_cache_usage(&text_hash, pool).await;

                            let base64_audio = general_purpose::STANDARD.encode(&cached_audio_data);
                            let data_url = format!("data:audio/mpeg;base64,{}", base64_audio);

                            return Ok(TTSResponse {
                                audio_url: data_url,
                                cached: true,
                                duration_ms: cache_entry.duration_ms,
                            });
                        }
                        Err(e) => {
                            self.logger.info("TTS", &format!("Failed to read cached file: {}, removing cache entry", e));
                            // 文件读取失败，删除缓存记录
                            let _ = sqlx::query("DELETE FROM tts_cache WHERE text_hash = ?")
                                .bind(&text_hash)
                                .execute(pool)
                                .await;
                        }
                    }
                } else {
                    // 文件不存在，删除缓存记录
                    self.logger.info("TTS", &format!("Cache file not found, removing cache entry: {}", cache_entry.file_path));
                    let _ = sqlx::query("DELETE FROM tts_cache WHERE text_hash = ?")
                        .bind(&text_hash)
                        .execute(pool)
                        .await;
                }
            }
        }

        // 调用API生成语音
        let audio_data = self.call_elevenlabs_api(text, &config, voice_id_to_use).await
            .map_err(|e| AppError::ExternalServiceError(format!("Failed to generate speech: {}", e)))?;

        if use_cache {
            // 只有在启用缓存时才保存到缓存
            let file_path = self.save_audio_file(&audio_data, &text_hash).await
                .map_err(|e| AppError::InternalError(format!("Failed to save audio file: {}", e)))?;

            // 保存缓存记录（使用 INSERT OR REPLACE 避免冲突）
            let file_path_str = file_path.to_string_lossy().to_string();
            sqlx::query(
                "INSERT OR REPLACE INTO tts_cache (text_hash, original_text, voice_id, model_id, file_path, file_size)
                 VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(&text_hash)
            .bind(text)
            .bind(voice_id_to_use)
            .bind(&config.model_id)
            .bind(&file_path_str)
            .bind(audio_data.len() as i64)
            .execute(pool)
            .await?;

            self.logger.info("TTS", &format!("Generated and cached new audio: {}", file_path_str));

            // 返回base64编码的音频数据，可以直接在浏览器中播放
            let base64_audio = general_purpose::STANDARD.encode(&audio_data);
            let data_url = format!("data:audio/mpeg;base64,{}", base64_audio);

            Ok(TTSResponse {
                audio_url: data_url,
                cached: false,
                duration_ms: None,
            })
        } else {
            // 试听模式：直接返回base64数据，不保存文件
            self.logger.info("TTS", &format!("Generated temporary audio for preview: {} bytes", audio_data.len()));

            // 返回base64编码的音频数据，可以直接在浏览器中播放
            let base64_audio = general_purpose::STANDARD.encode(&audio_data);
            let data_url = format!("data:audio/mpeg;base64,{}", base64_audio);

            Ok(TTSResponse {
                audio_url: data_url,
                cached: false,
                duration_ms: None,
            })
        }
    }

    /// 清理缓存
    pub async fn cleanup_cache(&self, older_than_days: i32, pool: &SqlitePool) -> AppResult<i32> {
        let result = sqlx::query(
            "DELETE FROM tts_cache WHERE last_used < datetime('now', '-' || ? || ' days')"
        )
        .bind(older_than_days)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() as i32)
    }
}
