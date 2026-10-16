//! 场景片段的内容精讲：先讲全貌，再逐段讲清内容，背景、句式、词汇与听力难点穿插在讲到的地方（agent 任务，Markdown，流式）。
//! 一个片段一份，保存在 passage_guides（071）；「重新生成」时覆盖。

use crate::agent::{tasks, AgentPaths};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::passage_guide_repository::PassageGuideRepository;
use crate::repositories::passage_repository::PassageRepository;
use crate::services::agent_settings::{AgentSettingsService, AgentTaskKind};
use crate::services::prompt_profile::PromptProfileService;
use crate::types::common::Id;
use crate::types::passage::ClipGuide;
use sqlx::SqlitePool;
use std::sync::Arc;

pub struct ClipGuideService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl ClipGuideService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 已有的讲解（没有为 None）
    pub async fn cached(&self, passage_id: Id) -> AppResult<Option<ClipGuide>> {
        PassageGuideRepository::new(self.pool.clone())
            .find(passage_id)
            .await
    }

    /// 生成讲解并保存（覆盖已有的）
    pub async fn generate(
        &self,
        passage_id: Id,
        paths: &AgentPaths,
        on_delta: impl FnMut(&str),
    ) -> AppResult<ClipGuide> {
        let passage = PassageRepository::new(self.pool.clone())
            .find(passage_id)
            .await?
            .ok_or_else(|| AppError::NotFound("片段不存在，可能已被删除".to_string()))?;
        if passage.sentences.is_empty() {
            return Err(AppError::ValidationError("这个片段没有台词".to_string()));
        }
        let model = AgentSettingsService::new(self.pool.clone(), self.logger.clone())
            .model_for(AgentTaskKind::Explain, None)
            .await?;
        let profile = PromptProfileService::load(&self.pool).await?;
        let lines: Vec<(String, String)> = passage
            .sentences
            .iter()
            .map(|s| (s.en.clone(), s.zh.clone()))
            .collect();
        let targets: Vec<String> = passage
            .target_words
            .iter()
            .map(|t| t.word.clone())
            .collect();
        let message = tasks::clip_guide_message(&passage.title, &lines, &targets);
        let content =
            tasks::clip_guide(paths, &model, &profile, &message, &self.logger, on_delta).await?;
        let guide = ClipGuide {
            passage_id,
            content,
            model_name: Some(model.display_name),
            generated_at: crate::time::now_utc(),
        };
        PassageGuideRepository::new(self.pool.clone())
            .upsert(&guide)
            .await?;
        Ok(guide)
    }
}
