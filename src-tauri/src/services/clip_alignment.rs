//! 场景片段的台词与声音对齐（单句播放按它切：跟读、原文的原声朗读、听力题）。
//!
//! 字幕的时间常常不准（自动生成的字幕整句早、晚一两秒都有），单句播放按字幕切会切在说话中间——前一句被掐断、
//! 下一句从半个词开始。打开片段时从短片里取出声音，用本机发音模型听一遍，把每句台词对上去
//! （`pronunciation::align`，字幕时间只当参考范围），得到每句真正说出来的起止。
//! 发音评估模型没下载时返回 None，界面照用字幕时间（按声音停顿校准）。结果按短片与台词缓存在内存里。

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::media::MediaTools;
use crate::pronunciation::{self, model, score::LogProbs};
use crate::repositories::video_repository::VideoRepository;
use crate::services::passage::PassageService;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

/// 太长的短片不对齐（对齐的计算量随长度增长；场景片段一般一两分钟）
const MAX_CLIP_MS: i64 = 10 * 60 * 1000;

/// 一句台词在短片里真正说出来的起止（毫秒，相对短片开头）
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SentenceSpan {
    pub start_ms: i64,
    pub end_ms: i64,
}

type Spans = Vec<Option<SentenceSpan>>;

fn cache() -> &'static Mutex<HashMap<(i64, u64), Spans>> {
    static CACHE: OnceLock<Mutex<HashMap<(i64, u64), Spans>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// 每句台词的起止；模型没下载、不是场景片段、短片太长时为 None
pub async fn align(
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
    tools: Option<MediaTools>,
    data_dir: &Path,
    cache_dir: &Path,
    passage_id: i64,
) -> AppResult<Option<Spans>> {
    if !model::ready(data_dir) {
        return Ok(None);
    }
    let Some(clip) = VideoRepository::clip_of_passage(&pool, passage_id).await? else {
        return Ok(None);
    };
    let duration_ms = clip.end_ms - clip.start_ms;
    if duration_ms <= 0 || duration_ms > MAX_CLIP_MS {
        return Ok(None);
    }
    let passage = PassageService::new(pool.clone(), logger.clone())
        .get(passage_id)
        .await?;
    let texts: Vec<String> = passage.sentences.iter().map(|s| s.en.clone()).collect();
    let windows: Vec<(i64, i64)> = passage
        .sentences
        .iter()
        .map(|s| {
            let start = s.start_ms.unwrap_or(0);
            (start, s.end_ms.unwrap_or(start).max(start))
        })
        .collect();
    let key = {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (&clip.file, &texts, &windows).hash(&mut h);
        (passage_id, h.finish())
    };
    if let Some(hit) = cache().lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return Ok(Some(hit.clone()));
    }
    let Some(tools) = tools else {
        return Ok(None);
    };
    let src = crate::services::video_processing::clip_path(data_dir, clip.video_id, &clip.file);
    std::fs::create_dir_all(cache_dir)
        .map_err(|e| AppError::InternalError(format!("创建缓存目录失败：{e}")))?;
    let wav = cache_dir.join(format!(
        "align-{passage_id}-{}.wav",
        uuid::Uuid::new_v4().simple()
    ));
    let extracted = tools
        .speech_audio(&src, &wav, duration_ms, |_| {}, || false)
        .await;
    let samples = extracted.and_then(|_| read_wav(&wav));
    let _ = std::fs::remove_file(&wav);
    let samples = samples?;
    let path = model::path(data_dir);
    // 空闲一阵后卸载模型（释放内存）
    tauri::async_runtime::spawn(async {
        tokio::time::sleep(model::IDLE_UNLOAD + std::time::Duration::from_secs(1)).await;
        model::unload_if_idle();
    });
    let spans = tokio::task::spawn_blocking(move || -> AppResult<Spans> {
        let (frames, vocab, raw) = model::log_probs(&path, &samples)?;
        let lp = LogProbs::new(frames, vocab, &raw);
        let ms = samples.len() as f64 / 16.0 / frames as f64;
        let windows: Vec<(f64, f64)> = windows
            .iter()
            .map(|&(a, b)| (a as f64 / ms, b as f64 / ms))
            .collect();
        Ok(
            pronunciation::align::align_sentences(&lp, &texts, Some(&windows))
                .into_iter()
                .map(|span| {
                    span.map(|(a, b)| SentenceSpan {
                        start_ms: (a as f64 * ms).round() as i64,
                        end_ms: (b as f64 * ms).round() as i64,
                    })
                })
                .collect(),
        )
    })
    .await
    .map_err(|e| AppError::InternalError(format!("台词对齐失败：{e}")))??;
    cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(key, spans.clone());
    Ok(Some(spans))
}

/// 读 16 位单声道 wav（ffmpeg 写的，找 data 块）
fn read_wav(path: &Path) -> AppResult<Vec<f32>> {
    let bytes = std::fs::read(path)
        .map_err(|e| AppError::InternalError(format!("读取短片声音失败：{e}")))?;
    let at = bytes
        .windows(4)
        .position(|w| w == b"data")
        .map(|p| p + 8)
        .filter(|&p| p <= bytes.len())
        .ok_or_else(|| AppError::InternalError("短片声音格式不对".to_string()))?;
    Ok(bytes[at..]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect())
}
