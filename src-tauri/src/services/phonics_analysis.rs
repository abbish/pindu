//! 批量拼读分析：经 agent（pi sidecar，submit_phonics 自带校验）执行（docs/agent-harness/DECISIONS.md D11 / D12）。

use crate::agent::tasks::{self, PhonicsBatchOutcome, PhonicsContext};
use crate::agent::AgentPaths;
use crate::error::AppResult;
use crate::logger::Logger;
use crate::prompts::PromptProfile;
use crate::types::AIModelConfig;
use std::path::Path;
use std::sync::Arc;

pub struct PhonicsBatchAnalyzer {
    logger: Arc<Logger>,
    paths: AgentPaths,
    model: AIModelConfig,
    profile: PromptProfile,
    context: PhonicsContext,
}

impl PhonicsBatchAnalyzer {
    pub fn new(
        logger: Arc<Logger>,
        app_data_dir: &Path,
        model: AIModelConfig,
        profile: PromptProfile,
        context: PhonicsContext,
    ) -> AppResult<Self> {
        Ok(Self {
            logger,
            paths: AgentPaths::resolve(app_data_dir)?,
            model,
            profile,
            context,
        })
    }

    /// 分析一批单词；返回成功条目与模型未覆盖的单词
    pub async fn analyze_batch(
        &self,
        words: &[String],
        _batch_index: usize,
        _total_batches: usize,
    ) -> AppResult<PhonicsBatchOutcome> {
        tasks::analyze_phonics_batch(
            &self.paths,
            &self.model,
            &self.profile,
            &self.context,
            words,
            &self.logger,
        )
        .await
    }
}
