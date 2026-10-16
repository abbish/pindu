//! 场景片段的台词与声音对齐（单句播放按它切：跟读、原文的原声朗读、听力题）。
//!
//! 字幕的时间常常不准（自动生成的字幕整句早、晚一两秒都有），单句播放按字幕切会切在说话中间——前一句被掐断、
//! 下一句从半个词开始。打开片段时从短片里取出声音，用本机发音模型听一遍，把每句台词对上去
//! （`pronunciation::align`，字幕时间只当参考范围），得到每句真正说出来的起止。
//! 发音评估模型没下载时返回 None，界面照用字幕时间（按声音停顿校准）。结果按短片与台词缓存在内存里。

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::media::MediaTools;
use crate::pronunciation::{self, model};
use crate::repositories::video_repository::VideoRepository;
use crate::services::passage::PassageService;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

/// 太长的短片不对齐（超过 3 分钟按句子分段对齐，见 `align::align_audio`；场景片段一般一两分钟）
const MAX_CLIP_MS: i64 = 30 * 60 * 1000;
/// 对齐结果离字幕时间多远就不信（与 align::WINDOW_MARGIN_FRAMES 的 1.5 秒一致）
const TRUST_MARGIN_MS: i64 = 1500;

/// 对出来的这句像不像真的说出来了：太短（字幕里有、其实没说的行被硬塞进几帧，如 [Music]）、太长、离字幕太远都不信，
/// 这句照用字幕时间（界面按声音停顿校准）
fn plausible(span: &SentenceSpan, window: Option<(i64, i64)>) -> bool {
    let len = span.end_ms - span.start_ms;
    let Some((a, b)) = window else {
        return len >= 150;
    };
    let sub = b - a;
    len >= 150.max(sub / 4)
        && len <= sub * 3 + 2000
        && span.end_ms > a - TRUST_MARGIN_MS
        && span.start_ms < b + TRUST_MARGIN_MS
}

/// 一句台词在短片里真正说出来的起止（毫秒，相对短片开头）
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SentenceSpan {
    pub start_ms: i64,
    pub end_ms: i64,
    /// 每个词说出来的起止（同步跟读逐词标出）：句子里读出来的词按顺序，没对上的词不在里面
    pub words: Vec<WordSpan>,
}

/// 一个词说出来的起止（毫秒，相对短片开头）
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WordSpan {
    pub word: String,
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
    // 没有时间的句子不给参考范围（不当成在开头）
    let windows: Vec<Option<(i64, i64)>> = passage
        .sentences
        .iter()
        .map(|s| {
            s.start_ms
                .map(|start| (start, s.end_ms.unwrap_or(start).max(start)))
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
        Ok(
            pronunciation::align::align_audio(&path, &samples, &texts, &windows)?
                .into_iter()
                .zip(&windows)
                .map(|(aligned, window)| {
                    aligned
                        .map(|a| SentenceSpan {
                            start_ms: a.start_ms,
                            end_ms: a.end_ms,
                            words: a
                                .words
                                .into_iter()
                                .map(|w| WordSpan {
                                    word: w.word,
                                    start_ms: w.start_ms,
                                    end_ms: w.end_ms,
                                })
                                .collect(),
                        })
                        .filter(|s| plausible(s, *window))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn span(start_ms: i64, end_ms: i64) -> SentenceSpan {
        SentenceSpan {
            start_ms,
            end_ms,
            words: Vec::new(),
        }
    }

    #[test]
    fn untrusted_spans_fall_back_to_subtitles() {
        // 字幕早了一秒：照样可信
        assert!(plausible(&span(2030, 3960), Some((1300, 3300))));
        // 字幕里有、其实没说的行被塞进几帧
        assert!(!plausible(&span(5000, 5080), Some((4000, 7000))));
        // 离字幕太远
        assert!(!plausible(&span(9000, 11000), Some((1000, 3000))));
        // 拖得太长
        assert!(!plausible(&span(1000, 12000), Some((1000, 3000))));
        // 没有字幕时间：只看长短
        assert!(plausible(&span(0, 800), None));
    }
}
