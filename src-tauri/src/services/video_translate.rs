//! 翻译一段字幕（后台任务，agent 队列）：编辑器里点「翻译这一段」，只翻译这段里还没有中文的字幕，
//! 译文写回视频的字幕（cues 的 zh），之后显示、切分都直接用，不会重复翻译。

use crate::agent::tasks::{self, TranslateSpec};
use crate::agent::AgentPaths;
use crate::error::{AppError, AppResult};
use crate::jobs::JobCtx;
use crate::logger::Logger;
use crate::repositories::video_repository::VideoRepository;
use crate::services::subtitle::Cue;
use crate::types::ai_model::AIModelConfig;
use serde_json::Value;
use sqlx::SqlitePool;
use std::sync::Arc;

pub struct VideoTranslateJob {
    pub pool: Arc<SqlitePool>,
    pub logger: Arc<Logger>,
    pub paths: AgentPaths,
    pub model: AIModelConfig,
    pub profile: crate::prompts::PromptProfile,
    pub video_id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// 片段里还没有中文的字幕下标（与切分取字幕的规则一致：大半落在片段里）
pub fn untranslated(cues: &[Cue], start_ms: i64, end_ms: i64) -> Vec<usize> {
    cues.iter()
        .enumerate()
        .filter(|(_, c)| {
            let overlap = c.end_ms.min(end_ms) - c.start_ms.max(start_ms);
            overlap > 0 && overlap * 2 >= c.end_ms - c.start_ms && c.zh.trim().is_empty()
        })
        .map(|(i, _)| i)
        .collect()
}

impl VideoTranslateJob {
    pub async fn run(self, ctx: JobCtx) -> AppResult<Value> {
        let row = VideoRepository::get(&self.pool, self.video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?;
        let indices = untranslated(&row.cues(), self.start_ms, self.end_ms);
        if indices.is_empty() {
            return Ok(serde_json::json!({ "translated": 0 }));
        }
        ctx.stage("AI 正在翻译");
        let raw = row.raw_cues();
        let english: Vec<String> = indices.iter().map(|&i| raw[i].en.clone()).collect();
        let translation = tasks::translate_passage(
            &self.paths,
            &self.model,
            &self.profile,
            &TranslateSpec {
                title: Some("字幕片段"),
                sentences: &english,
                key_words: false,
            },
            &self.logger,
            || ctx.is_cancelled(),
        )
        .await?;
        // 重新读一次再写：只补空的中文，别覆盖期间别处写入的
        let mut cues = VideoRepository::get(&self.pool, self.video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?
            .raw_cues();
        let mut translated = 0;
        for (&i, zh) in indices.iter().zip(translation.zh) {
            if let Some(c) = cues.get_mut(i) {
                if c.zh.trim().is_empty() && !zh.trim().is_empty() {
                    c.zh = zh;
                    translated += 1;
                }
            }
        }
        VideoRepository::update_cues(&self.pool, self.video_id, &cues).await?;
        Ok(serde_json::json!({ "translated": translated }))
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
    fn only_untranslated_cues_mostly_inside_the_segment() {
        let cues = vec![
            cue(0, 1000, ""),
            cue(900, 3000, ""),
            cue(3000, 4000, "已有"),
            cue(4000, 6000, ""),
        ];
        // 第一条只有 100ms 在片段里不算；已有中文的跳过；最后一条一半在里面算
        assert_eq!(untranslated(&cues, 900, 5000), vec![1, 3]);
    }
}
