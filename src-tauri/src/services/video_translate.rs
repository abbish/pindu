//! 整理字幕（后台任务，agent 队列）：AI 读字幕，判断每条是不是接着上一条（断句，不依赖标点，见 services::sentences），
//! 同时给缺中文的条目翻译；结果写回视频的字幕（cues 的 join / zh），之后编辑器显示、AI 规划、切分都直接用，不会重复处理。
//! 导入视频时自动对整部字幕启动一次（与转码并行）；编辑器里也可以对缺中文的再翻译（整部或一段）。
//! 每块 `CHUNK` 句、`CONCURRENCY` 块并行、失败的块重试一次；每翻完一块就写回，中途停止或失败后再翻只补剩下的。

use crate::agent::tasks;
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

/// 写回字幕的锁：整部翻译与「先翻译这一段」可以同时进行，写回（读 → 补空 → 写）必须一个一个来
static WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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

/// 这一条还要整理：没断过句，或者没有中文
pub fn needs_work(c: &Cue) -> bool {
    !c.en.trim().is_empty() && (c.join.is_none() || c.zh.trim().is_empty())
}

/// 要整理的字幕，切成交给 AI 的块：连续的一段一段（不连续处断开），每块不超过 `CHUNK` 条。
/// 有范围时只取大半落在范围里的（与切分取字幕的规则一致）
pub fn work_chunks(cues: &[Cue], range: Option<(i64, i64)>) -> Vec<std::ops::Range<usize>> {
    let mut chunks: Vec<std::ops::Range<usize>> = Vec::new();
    for (i, c) in cues.iter().enumerate() {
        let in_range = range.is_none_or(|(start, end)| {
            let overlap = c.end_ms.min(end) - c.start_ms.max(start);
            overlap > 0 && overlap * 2 >= c.end_ms - c.start_ms
        });
        if !in_range || !needs_work(c) {
            continue;
        }
        match chunks.last_mut() {
            Some(last) if last.end == i && last.len() < CHUNK => last.end = i + 1,
            _ => chunks.push(i..i + 1),
        }
    }
    chunks
}

impl VideoTranslateJob {
    pub async fn run(self, ctx: JobCtx) -> AppResult<Value> {
        let row = VideoRepository::get(&self.pool, self.video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?;
        let raw = row.raw_cues();
        let chunks = work_chunks(&row.cues(), self.range);
        if chunks.is_empty() {
            return Ok(serde_json::json!({ "translated": 0, "failed": 0 }));
        }
        let total = chunks.len() as u64;
        let lines: usize = chunks.iter().map(|c| c.len()).sum();
        ctx.stage(format!("AI 正在整理 {lines} 条字幕（断句、翻译）"));
        ctx.progress(0, total);

        let mut results = stream::iter(chunks)
            .map(|chunk| {
                let (job, ctx, raw) = (&self, &ctx, &raw);
                async move {
                    let previous = chunk.start.checked_sub(1).map(|p| &raw[p]);
                    let mut last = None;
                    for attempt in 0..2 {
                        if ctx.is_cancelled() {
                            break;
                        }
                        match tasks::prepare_subtitles(
                            &job.paths,
                            &job.model,
                            &job.profile,
                            &raw[chunk.clone()],
                            previous,
                            &job.logger,
                            || ctx.is_cancelled(),
                        )
                        .await
                        {
                            Ok(items) => return (chunk, Ok(items)),
                            Err(e) => {
                                if attempt == 0 {
                                    job.logger.warn(
                                        "VIDEO",
                                        &format!("视频 {} 字幕整理一块失败，重试", job.video_id),
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
                Ok(items) => translated += self.write_back(chunk.start, items).await?,
                Err(e) => {
                    failed += chunk.len();
                    last_error = Some(e);
                }
            }
        }
        if ctx.is_cancelled() {
            return Err(AppError::InternalError("已取消".to_string()));
        }
        if failed == lines {
            if let Some(e) = last_error {
                return Err(e);
            }
        }
        if failed > 0 {
            self.logger.warn(
                "VIDEO",
                &format!("视频 {} 字幕有 {failed} 条没有整理成", self.video_id),
                None,
            );
        }
        Ok(serde_json::json!({ "translated": translated, "failed": failed }))
    }

    /// 重新读一次再写：断句只补没断过的、中文只补空的，别覆盖别处写入的；返回补了几条中文
    async fn write_back(&self, start: usize, items: Vec<(bool, String)>) -> AppResult<usize> {
        let _guard = WRITE_LOCK.lock().await;
        let Some(row) = VideoRepository::get(&self.pool, self.video_id).await? else {
            return Ok(0);
        };
        let mut cues = row.raw_cues();
        let mut translated = 0;
        for (k, (join, zh)) in items.into_iter().enumerate() {
            let i = start + k;
            let Some(c) = cues.get_mut(i) else { break };
            if c.join.is_none() {
                // 第一条没有上一条可接
                c.join = Some(join && i > 0);
            }
            if c.zh.trim().is_empty() && !zh.is_empty() {
                c.zh = zh;
                translated += 1;
            }
        }
        VideoRepository::update_cues(&self.pool, self.video_id, &cues).await?;
        Ok(translated)
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
            join: None,
        }
    }

    #[test]
    fn chunks_cover_cues_that_need_work_in_range() {
        let mut cues = vec![
            cue(0, 1000, ""),
            cue(900, 3000, ""),
            cue(3000, 4000, "已有"),
            cue(4000, 6000, ""),
        ];
        // 已有中文、也断过句的不用再整理
        cues[2].join = Some(false);
        assert_eq!(work_chunks(&cues, None), vec![0..2, 3..4]);
        // 范围：第一条只有 100ms 在里面不算；最后一条一半在里面算
        assert_eq!(work_chunks(&cues, Some((900, 5000))), vec![1..2, 3..4]);
        // 已有中文但没断过句的也要整理
        cues[2].join = None;
        assert_eq!(work_chunks(&cues, None), vec![0..4]);
        // 每块不超过 CHUNK 条
        let many: Vec<Cue> = (0..100)
            .map(|i| cue(i * 1000, i * 1000 + 900, ""))
            .collect();
        let chunks = work_chunks(&many, None);
        assert_eq!(
            chunks.iter().map(|c| c.len()).collect::<Vec<_>>(),
            vec![40, 40, 20]
        );
    }
}
