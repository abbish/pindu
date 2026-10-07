//! 提词：经 agent（pi sidecar）执行（docs/agent-harness/DECISIONS.md D12）。

use crate::agent::{tasks, AgentPaths};
use crate::error::AppResult;
use crate::logger::Logger;
use crate::prompts::PromptProfile;
use crate::types::word_analysis::WordExtractionResult;
use crate::types::AIModelConfig;
use std::path::Path;
use std::sync::Arc;

pub struct WordExtractionService {
    logger: Arc<Logger>,
    paths: AgentPaths,
}

impl WordExtractionService {
    pub fn new(logger: Arc<Logger>, app_data_dir: &Path) -> AppResult<Self> {
        Ok(Self {
            logger,
            paths: AgentPaths::resolve(app_data_dir)?,
        })
    }

    pub async fn extract(
        &self,
        model: &AIModelConfig,
        profile: &PromptProfile,
        scene: &str,
        text: &str,
        mode: &str,
    ) -> AppResult<WordExtractionResult> {
        tasks::extract_words(&self.paths, model, profile, scene, text, mode, &self.logger).await
    }

    /// 按学习意图生成单词（避开 `existing` 中的已有单词，小写）
    pub async fn generate(
        &self,
        model: &AIModelConfig,
        profile: &PromptProfile,
        scene: &str,
        intent: &str,
        count: usize,
        existing: &std::collections::HashSet<String>,
    ) -> AppResult<WordExtractionResult> {
        tasks::generate_words(
            &self.paths,
            model,
            profile,
            scene,
            intent,
            count,
            existing,
            &self.logger,
        )
        .await
    }
}
