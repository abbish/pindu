//! 翻译字幕（后台任务，agent 队列）：只翻译还没有中文的字幕，译文写回视频的字幕（cues 的 zh），
//! 之后编辑器显示、AI 规划、切分都直接用，不会重复翻译。
//! 导入视频时自动对整部字幕启动一次（与转码并行）；编辑器里也可以对缺中文的再翻译（整部或一段）。
//! 每块 `CHUNK` 句、`CONCURRENCY` 块并行、失败的块重试一次；每翻完一块就写回，中途停止或失败后再翻只补剩下的。

use crate::agent::tasks::{self, TranslateSpec};
use crate::agent::AgentPaths;
use crate::error::{AppError, AppResult};
use crate::jobs::JobCtx;
use crate::logger::Logger;
use crate::repositories::video_repository::VideoRepository;
use crate::services::subtitle::Cue;
use crate::types::ai_model::AIModelConfig;
use futures::stream::{self, StreamExt};
use serde_json::Value;
use sqlx::SqlitePool;
use std::sync::Arc;

/// 每次交给 AI 的句数
const CHUNK: usize = 40;
const CONCURRENCY: usize = 3;

pub struct VideoTranslateJob {
    pub pool: Arc<SqlitePool>,
    pub logger: Arc<Logger>,
    pub paths: AgentPaths,
    pub model: AIModelConfig,
    pub profile: crate::prompts::PromptProfile,
    pub video_id: i64,
    /// 只翻译这一段（毫秒）；None 为整部
    pub range: Option<(i64, i64)>,
}

/// 还没有中文的字幕下标；有范围时只取大半落在范围里的（与切分取字幕的规则一致）
pub fn untranslated(cues: &[Cue], range: Option<(i64, i64)>) -> Vec<usize> {
    cues.iter()
        .enumerate()
        .filter(|(_, c)| {
            c.zh.trim().is_empty()
                && !c.en.trim().is_empty()
                && range.is_none_or(|(start, end)| {
                    let overlap = c.end_ms.min(end) - c.start_ms.max(start);
                    overlap > 0 && overlap * 2 >= c.end_ms - c.start_ms
                })
        })
        .map(|(i, _)| i)
        .collect()
}

impl VideoTranslateJob {
    pub async fn run(self, ctx: JobCtx) -> AppResult<Value> {
        let row = VideoRepository::get(&self.pool, self.video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?;
        let raw = row.raw_cues();
        let indices = untranslated(&row.cues(), self.range);
        if indices.is_empty() {
            return Ok(serde_json::json!({ "translated": 0, "failed": 0 }));
        }
        let chunks: Vec<Vec<usize>> = indices.chunks(CHUNK).map(<[usize]>::to_vec).collect();
        let total = chunks.len() as u64;
        ctx.stage(format!("AI 正在翻译 {} 句字幕", indices.len()));
        ctx.progress(0, total);

        let mut results = stream::iter(chunks)
            .map(|chunk| {
                let english: Vec<String> = chunk.iter().map(|&i| raw[i].en.clone()).collect();
                let (job, ctx) = (&self, &ctx);
                async move {
                    let mut last = None;
                    for attempt in 0..2 {
                        if ctx.is_cancelled() {
                            break;
                        }
                        match job.translate(&english, ctx).await {
                            Ok(zh) => return (chunk, Ok(zh)),
                            Err(e) => {
                                if attempt == 0 {
                                    job.logger.warn(
                                        "VIDEO",
                                        &format!("视频 {} 字幕翻译一块失败，重试", job.video_id),
                                        Some(&e.to_string()),
                                    );
                                }
                                last = Some(e);
                            }
                        }
                    }
                    (
                        chunk,
                        Err(last.unwrap_or_else(|| AppError::InternalError("已取消".into()))),
                    )
                }
            })
            .buffer_unordered(CONCURRENCY);

        let (mut translated, mut failed, mut done) = (0usize, 0usize, 0u64);
        let mut last_error: Option<AppError> = None;
        // 结果逐块写回（这里是唯一写入点，顺序执行，不会互相覆盖）
        while let Some((chunk, result)) = results.next().await {
            done += 1;
            ctx.progress(done, total);
            match result {
                Ok(zh) => translated += self.write_back(&chunk, zh).await?,
                Err(e) => {
                    failed += chunk.len();
                    last_error = Some(e);
                }
            }
        }
        if ctx.is_cancelled() {
            return Err(AppError::InternalError("已取消".to_string()));
        }
        if translated == 0 {
            if let Some(e) = last_error {
                return Err(e);
            }
        }
        if failed > 0 {
            self.logger.warn(
                "VIDEO",
                &format!("视频 {} 字幕有 {failed} 句没有翻译成", self.video_id),
                None,
            );
        }
        Ok(serde_json::json!({ "translated": translated, "failed": failed }))
    }

    async fn translate(&self, english: &[String], ctx: &JobCtx) -> AppResult<Vec<String>> {
        Ok(tasks::translate_passage(
            &self.paths,
            &self.model,
            &self.profile,
            &TranslateSpec {
                title: Some("字幕片段"),
                sentences: english,
                key_words: false,
            },
            &self.logger,
            || ctx.is_cancelled(),
        )
        .await?
        .zh)
    }

    /// 重新读一次再写：只补空的中文，别覆盖别处写入的；返回补了几句
    async fn write_back(&self, chunk: &[usize], zh: Vec<String>) -> AppResult<usize> {
        let Some(row) = VideoRepository::get(&self.pool, self.video_id).await? else {
            return Ok(0);
        };
        let mut cues = row.raw_cues();
        let mut n = 0;
        for (&i, text) in chunk.iter().zip(zh) {
            if let Some(c) = cues.get_mut(i) {
                if c.zh.trim().is_empty() && !text.trim().is_empty() {
                    c.zh = text;
                    n += 1;
                }
            }
        }
        if n > 0 {
            VideoRepository::update_cues(&self.pool, self.video_id, &cues).await?;
        }
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(start: i64, end: i64, zh: &str) -> Cue {
        Cue {
            start_ms: start,
            end_ms: end,
            en: "x".into(),
            zh: zh.into(),
        }
    }

    #[test]
    fn only_untranslated_cues_in_range() {
        let cues = vec![
            cue(0, 1000, ""),
            cue(900, 3000, ""),
            cue(3000, 4000, "已有"),
            cue(4000, 6000, ""),
        ];
        // 第一条只有 100ms 在范围里不算；已有中文的跳过；最后一条一半在里面算
        assert_eq!(untranslated(&cues, Some((900, 5000))), vec![1, 3]);
        assert_eq!(untranslated(&cues, None), vec![0, 1, 3]);
    }
}
