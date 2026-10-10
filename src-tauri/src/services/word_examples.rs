//! 例句补充 / 重新生成：agent 写新例句（submit_examples 校验），按方式合并后整体写回 word_examples。

use crate::agent::tasks::{self, ExampleMode};
use crate::agent::AgentPaths;
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::word_repository::{replace_examples_conn, WordRepository};
use crate::types::common::Id;
use crate::types::wordbook::WordExample;
use sqlx::SqlitePool;
use std::sync::Arc;

/// 每个单词最多保留的例句数（补充时超出的新例句丢弃）
pub const MAX_EXAMPLES: usize = 20;

/// 解析前端传入的方式：`append`（补充）/ `replace`（重新生成）
pub fn parse_mode(mode: &str) -> AppResult<ExampleMode> {
    match mode.trim() {
        "append" => Ok(ExampleMode::Append),
        "replace" => Ok(ExampleMode::Replace),
        other => Err(AppError::ValidationError(format!(
            "例句生成方式需为 append / replace：{}",
            other
        ))),
    }
}

/// 合并已有与新例句：补充时追加在后（不超过上限），重新生成时只保留新例句
pub fn merge_examples(
    existing: Vec<WordExample>,
    new: Vec<WordExample>,
    mode: ExampleMode,
) -> Vec<WordExample> {
    match mode {
        ExampleMode::Replace => new.into_iter().take(MAX_EXAMPLES).collect(),
        ExampleMode::Append => existing.into_iter().chain(new).take(MAX_EXAMPLES).collect(),
    }
}

pub struct WordExampleService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl WordExampleService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 生成例句并写回，返回该单词最新的全部例句
    pub async fn generate(
        &self,
        word_id: Id,
        mode: ExampleMode,
        model_id: Option<Id>,
        paths: &AgentPaths,
    ) -> AppResult<Vec<WordExample>> {
        let word = WordRepository::new(self.pool.clone(), self.logger.clone())
            .find_by_id(word_id)
            .await?
            .ok_or_else(|| AppError::NotFound("单词不存在，可能已被删除".to_string()))?;
        if mode == ExampleMode::Append && word.examples.len() >= MAX_EXAMPLES {
            return Err(AppError::ValidationError(format!(
                "这个单词已有 {} 条例句，可以选择「重新生成」",
                MAX_EXAMPLES
            )));
        }
        let model = crate::services::agent_settings::AgentSettingsService::new(
            self.pool.clone(),
            self.logger.clone(),
        )
        .model_for(
            crate::services::agent_settings::AgentTaskKind::Examples,
            model_id,
        )
        .await?;
        let profile =
            crate::services::prompt_profile::PromptProfileService::load(&self.pool).await?;
        let scene = crate::services::prompt_profile::PromptProfileService::book_scene(
            &self.pool,
            &self.logger,
            word.word_book_id,
        )
        .await?;
        let new =
            tasks::generate_examples(paths, &model, &profile, &scene, &word, mode, &self.logger)
                .await?;
        let examples = merge_examples(word.examples, new, mode);

        let mut tx = self.pool.begin().await?;
        replace_examples_conn(&mut tx, word_id, &examples).await?;
        tx.commit().await?;
        Ok(examples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ex(s: &str) -> WordExample {
        WordExample {
            sentence: s.to_string(),
            translation: "中".to_string(),
        }
    }

    #[test]
    fn modes_merge_as_expected() {
        let existing = vec![ex("A cat."), ex("Two cats.")];
        let new = vec![ex("My cat sleeps.")];
        let appended = merge_examples(existing.clone(), new.clone(), ExampleMode::Append);
        assert_eq!(appended.len(), 3);
        assert_eq!(appended[2].sentence, "My cat sleeps.");
        assert_eq!(merge_examples(existing, new, ExampleMode::Replace).len(), 1);

        let many: Vec<WordExample> = (0..MAX_EXAMPLES)
            .map(|i| ex(&format!("Cat {i}.")))
            .collect();
        assert_eq!(
            merge_examples(many, vec![ex("Extra cat.")], ExampleMode::Append).len(),
            MAX_EXAMPLES
        );
        assert!(parse_mode("append").is_ok() && parse_mode("replace").is_ok());
        assert!(matches!(
            parse_mode("more"),
            Err(AppError::ValidationError(_))
        ));
    }

    #[test]
    fn submission_drops_existing_and_incomplete_examples() {
        let details = serde_json::json!({ "examples": [
            { "sentence": " a cat. ", "translation": "重复（已有）" },
            { "sentence": "The cat is sleeping.", "translation": "猫在睡觉。" },
            { "sentence": "the cat is sleeping.", "translation": "重复（本次）" },
            { "sentence": "My cat likes milk.", "translation": "" }
        ]});
        let got = tasks::examples_from_submission(&details, &[ex("A cat.")]);
        let sentences: Vec<&str> = got.iter().map(|e| e.sentence.as_str()).collect();
        assert_eq!(sentences, vec!["The cat is sleeping."]);

        // 已有例句会带进请求；只改一两个词的近似重复也被丢弃
        let details = serde_json::json!({ "examples": [
            { "sentence": "All students are in the class!", "translation": "近似（已有）" },
            { "sentence": "All the birds fly away in winter.", "translation": "鸟儿冬天都飞走了。" },
            { "sentence": "All birds fly away in the winter.", "translation": "近似（本次）" },
            { "sentence": "We are all happy on the holiday.", "translation": "假期里我们都很开心。" }
        ]});
        let got =
            tasks::examples_from_submission(&details, &[ex("All the students are in class.")]);
        let sentences: Vec<&str> = got.iter().map(|e| e.sentence.as_str()).collect();
        assert_eq!(
            sentences,
            vec![
                "All the birds fly away in winter.",
                "We are all happy on the holiday."
            ]
        );
        // 只共享目标词和常用词的不同句子不算重复
        assert!(!tasks::is_near_duplicate("I have a cat.", "I see a cat."));
        assert!(!tasks::is_near_duplicate(
            "I like cake.",
            "Mom makes a big cake."
        ));

        let message = tasks::word_examples_message(
            &crate::types::wordbook::Word {
                id: 1,
                word: "cat".into(),
                meaning: "猫".into(),
                description: None,
                ipa: None,
                syllables: None,
                phonics_segments: None,
                image_path: None,
                audio_path: None,
                part_of_speech: Some("n.".into()),
                category_id: None,
                word_book_id: None,
                pos_abbreviation: None,
                pos_english: None,
                pos_chinese: None,
                phonics_rule: None,
                analysis_explanation: None,
                kind: "word".to_string(),
                phrase_type: None,
                separable: false,
                examples: vec![ex("A cat.")],
                created_at: String::new(),
                updated_at: String::new(),
            },
            ExampleMode::Append,
            "",
        );
        assert!(message.contains("1. A cat.") && message.contains("补充"));
        assert_eq!(
            tasks::word_examples_task(&Default::default()).tools,
            &["submit_examples"]
        );
    }
}
