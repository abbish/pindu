//! 单词深度讲解：读缓存；需要时调用 agent 生成 Markdown（流式增量回调）并覆盖缓存。

use crate::agent::{tasks, AgentPaths};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::word_explanation_repository::WordExplanationRepository;
use crate::repositories::word_repository::WordRepository;
use crate::services::prompt_profile::PromptProfileService;
use crate::types::common::Id;
use crate::types::wordbook::WordExplanation;
use sqlx::SqlitePool;
use std::sync::Arc;

/// 讲解提示词版本：`word_explain.md` 的规范有实质变化时加一，旧缓存自动失效
/// （1 = 初版；2 = 正规记忆法 + 正确性自查，D17；3 = 例句逐句讲解 + 开放性思考题，D18）
pub const EXPLAIN_PROMPT_VERSION: i64 = 3;

pub struct WordExplanationService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
    repository: WordExplanationRepository,
}

impl WordExplanationService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: WordExplanationRepository::new(pool.clone()),
            pool,
            logger,
        }
    }

    /// 缓存的讲解（没有、或按旧的学习者档案 / 讲解风格生成的，返回 None）
    pub async fn get(&self, word_id: Id) -> AppResult<Option<WordExplanation>> {
        let profile = PromptProfileService::load(&self.pool).await?;
        let current = PromptProfileService::explain_fingerprint(&profile);
        // 指纹列之前的缓存都是按默认档案生成的：档案仍为默认时继续有效
        let accept_unmarked =
            current == PromptProfileService::explain_fingerprint(&Default::default());
        self.repository
            .find(
                word_id,
                EXPLAIN_PROMPT_VERSION,
                Some(&current),
                accept_unmarked,
            )
            .await
    }

    /// 生成（或重新生成）讲解并写入缓存
    pub async fn generate(
        &self,
        word_id: Id,
        model_id: Option<Id>,
        paths: &AgentPaths,
        on_delta: impl FnMut(&str),
    ) -> AppResult<WordExplanation> {
        let word = WordRepository::new(self.pool.clone(), self.logger.clone())
            .find_by_id(word_id)
            .await?
            .ok_or_else(|| AppError::NotFound("单词不存在，可能已被删除".to_string()))?;
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
        let content = tasks::explain_word(
            paths,
            &model,
            &profile,
            &scene,
            &word,
            &self.logger,
            on_delta,
        )
        .await?;
        self.repository
            .upsert(
                word_id,
                &content,
                Some(model.display_name.as_str()),
                EXPLAIN_PROMPT_VERSION,
                &PromptProfileService::explain_fingerprint(&profile),
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, test_logger};

    #[tokio::test]
    async fn explanations_are_cached_per_word_and_overwritten() {
        let pool = memory_pool().await;
        sqlx::raw_sql(
            "INSERT INTO word_books (id, title, description) VALUES (950, '讲解', '');
             INSERT INTO words (id, word, meaning, word_book_id) VALUES (9501, 'cat', '猫', 950);",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();
        let service = WordExplanationService::new(pool.clone(), test_logger());
        assert!(service.get(9501).await.unwrap().is_none());

        let repo = WordExplanationRepository::new(pool.clone());
        // 旧版提示词生成的缓存视为过期
        let fp = PromptProfileService::explain_fingerprint(&Default::default());
        repo.upsert(
            9501,
            "## 旧规范",
            Some("K3"),
            EXPLAIN_PROMPT_VERSION - 1,
            &fp,
        )
        .await
        .unwrap();
        assert!(service.get(9501).await.unwrap().is_none());
        repo.upsert(9501, "## 第一版", Some("K3"), EXPLAIN_PROMPT_VERSION, &fp)
            .await
            .unwrap();
        let saved = repo
            .upsert(9501, "## 第二版", None, EXPLAIN_PROMPT_VERSION, &fp)
            .await
            .unwrap();
        assert_eq!(saved.content, "## 第二版");
        assert_eq!(
            service.get(9501).await.unwrap().unwrap().content,
            "## 第二版"
        );

        // 学习者档案变了：按旧档案生成的讲解视为过期
        let mut adult = crate::prompts::PromptProfile::preset("adult").unwrap();
        adult.tutor_name = "Lark".into();
        PromptProfileService::save(&pool, &adult).await.unwrap();
        assert!(service.get(9501).await.unwrap().is_none());
        // 指纹列之前的旧缓存（NULL）只在默认档案下有效
        sqlx::query("UPDATE word_explanations SET prompt_fingerprint = NULL")
            .execute(pool.as_ref())
            .await
            .unwrap();
        assert!(service.get(9501).await.unwrap().is_none());
        PromptProfileService::save(&pool, &Default::default())
            .await
            .unwrap();
        assert!(service.get(9501).await.unwrap().is_some());

        // 删除单词时讲解一并删除
        sqlx::query("DELETE FROM words WHERE id = 9501")
            .execute(pool.as_ref())
            .await
            .unwrap();
        assert!(service.get(9501).await.unwrap().is_none());
    }
}
