//! 单词深度讲解：每次调用 agent 实时生成 Markdown（流式增量回调）与推荐追问，不落库。

use crate::agent::{tasks, AgentPaths};
use crate::error::AppResult;
use crate::logger::Logger;
use crate::services::prompt_profile::PromptProfileService;
use crate::types::common::Id;
use crate::types::wordbook::WordExplanation;
use sqlx::SqlitePool;
use std::sync::Arc;

pub struct WordExplanationService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl WordExplanationService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 生成讲解
    pub async fn generate(
        &self,
        word_id: Id,
        card_word: Option<&str>,
        model_id: Option<Id>,
        paths: &AgentPaths,
        on_delta: impl FnMut(&str),
    ) -> AppResult<WordExplanation> {
        let word = crate::services::word_cards::learning_word(
            &self.pool,
            &self.logger,
            word_id,
            card_word,
        )
        .await?;
        let model = crate::services::agent_settings::AgentSettingsService::new(
            self.pool.clone(),
            self.logger.clone(),
        )
        .model_for(
            crate::services::agent_settings::AgentTaskKind::Explain,
            model_id,
        )
        .await?;
        let profile = PromptProfileService::load(&self.pool).await?;
        let scene =
            PromptProfileService::book_scene(&self.pool, &self.logger, word.word_book_id).await?;
        let reply = tasks::explain_word(
            paths,
            &model,
            &profile,
            &scene,
            &word,
            &self.logger,
            on_delta,
        )
        .await?;
        Ok(WordExplanation {
            word_id,
            content: reply.content,
            follow_ups: reply.follow_ups,
            model_name: Some(model.display_name),
            generated_at: crate::time::now_utc(),
        })
    }
}
