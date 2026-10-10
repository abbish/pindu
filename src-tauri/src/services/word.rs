//! 单词业务逻辑服务
//!
//! 封装单词相关的业务逻辑
//!
//! # 注意
//! 此模块当前独立实现,未来将集成到 handlers

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::word_repository::WordRepository;
use crate::types::{
    common::{Id, PaginatedResponse},
    wordbook::*,
};
use sqlx::SqlitePool;
use std::sync::Arc;

/// 单词服务
///
/// 负责单词的业务逻辑处理
pub struct WordService {
    repository: WordRepository,
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl WordService {
    /// 创建新的服务实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: WordRepository::new(pool.clone(), logger.clone()),
            pool,
            logger,
        }
    }

    /// 单词与释义必填、单词最长 50 字；同一词汇本内不能重复（忽略大小写，`except` 为正在编辑的自己）
    async fn validate_word(
        &self,
        book_id: Id,
        word: &str,
        meaning: &str,
        except: Option<Id>,
    ) -> AppResult<()> {
        if word.is_empty() {
            return Err(AppError::ValidationError("请填写单词".to_string()));
        }
        if word.chars().count() > 50 {
            return Err(AppError::ValidationError(
                "单词不能超过 50 个字符".to_string(),
            ));
        }
        if meaning.is_empty() {
            return Err(AppError::ValidationError("请填写中文释义".to_string()));
        }
        let existing = self
            .repository
            .find_existing_words_by_book(book_id, &[word.to_string()])
            .await?;
        if existing
            .get(&word.to_lowercase())
            .is_some_and(|&id| Some(id) != except)
        {
            return Err(AppError::ValidationError(format!(
                "词汇本里已经有「{}」了",
                word
            )));
        }
        Ok(())
    }

    /// 添加单词到词汇本
    pub async fn add_word_to_book(
        &self,
        book_id: Id,
        word_data: CreateWordRequest,
    ) -> AppResult<Id> {
        // 词汇本必须存在且没被删除
        let books = crate::repositories::wordbook_repository::WordBookRepository::new(
            self.pool.clone(),
            self.logger.clone(),
        );
        if books.find_by_id(book_id).await?.is_none() {
            return Err(AppError::NotFound("词汇本不存在，可能已被删除".to_string()));
        }
        let word_data = CreateWordRequest {
            word: crate::types::wordbook::normalize_vocab(&word_data.word),
            meaning: word_data.meaning.trim().to_string(),
            ..word_data
        };
        self.validate_word(book_id, &word_data.word, &word_data.meaning, None)
            .await?;

        // 将 CreateWordRequest 转换为 Word
        let phrase_type = phrase_type_for(&word_data.word, word_data.phrase_type.as_deref());
        let separable =
            phrase_type.as_deref() == Some("phrasal_verb") && word_data.separable.unwrap_or(false);
        let kind = crate::types::wordbook::vocab_kind(&word_data.word).to_string();
        let word = Word {
            id: 0, // 新单词，ID 由数据库生成
            word: word_data.word,
            meaning: word_data.meaning,
            description: word_data.description,
            ipa: word_data.ipa,
            syllables: word_data.syllables,
            phonics_segments: word_data.phonics_segments,
            image_path: None,
            audio_path: None,
            part_of_speech: word_data.part_of_speech,
            category_id: word_data.category_id,
            word_book_id: Some(book_id),
            pos_abbreviation: word_data.pos_abbreviation,
            pos_english: word_data.pos_english,
            pos_chinese: word_data.pos_chinese,
            phonics_rule: word_data.phonics_rule,
            analysis_explanation: word_data.analysis_explanation,
            kind,
            phrase_type,
            separable,
            examples: clean_examples(word_data.examples.unwrap_or_default()),
            created_at: String::new(),
            updated_at: String::new(),
        };

        // 调用 repository 创建
        let word_id = self.repository.create(&word).await?;

        Ok(word_id)
    }

    /// 更新单词
    pub async fn update_word(&self, word_id: Id, word_data: UpdateWordRequest) -> AppResult<()> {
        // 先查询单词是否存在
        let existing_word = self
            .repository
            .find_by_id(word_id)
            .await?
            .ok_or_else(|| AppError::NotFound("单词不存在，可能已被删除".to_string()))?;

        // 更新字段
        let mut updated_word = existing_word.clone();
        if let Some(word) = word_data.word {
            updated_word.word = crate::types::wordbook::normalize_vocab(&word);
        }
        if let Some(meaning) = word_data.meaning {
            updated_word.meaning = meaning.trim().to_string();
        }
        if let Some(book_id) = updated_word.word_book_id {
            self.validate_word(
                book_id,
                &updated_word.word,
                &updated_word.meaning,
                Some(word_id),
            )
            .await?;
        }
        if let Some(description) = word_data.description {
            updated_word.description = Some(description);
        }
        if let Some(ipa) = word_data.ipa {
            updated_word.ipa = Some(ipa);
        }
        if let Some(syllables) = word_data.syllables {
            updated_word.syllables = Some(syllables);
        }
        if let Some(phonics_segments) = word_data.phonics_segments {
            updated_word.phonics_segments = Some(phonics_segments);
        }
        if let Some(part_of_speech) = word_data.part_of_speech {
            updated_word.part_of_speech = Some(part_of_speech);
        }
        if let Some(category_id) = word_data.category_id {
            updated_word.category_id = Some(category_id);
        }
        if let Some(pos_abbreviation) = word_data.pos_abbreviation {
            updated_word.pos_abbreviation = Some(pos_abbreviation);
        }
        if let Some(pos_english) = word_data.pos_english {
            updated_word.pos_english = Some(pos_english);
        }
        if let Some(pos_chinese) = word_data.pos_chinese {
            updated_word.pos_chinese = Some(pos_chinese);
        }
        if let Some(phonics_rule) = word_data.phonics_rule {
            updated_word.phonics_rule = Some(phonics_rule);
        }
        if let Some(analysis_explanation) = word_data.analysis_explanation {
            updated_word.analysis_explanation = Some(analysis_explanation);
        }
        // 例句：传入即整体替换（空句子被丢弃）
        if let Some(examples) = word_data.examples {
            updated_word.examples = clean_examples(examples);
        }
        // 词组类型与能否拆开：只对词组有效，改成单词时清除；只有短语动词能拆开
        if let Some(pt) = word_data.phrase_type {
            updated_word.phrase_type = Some(pt);
        }
        if let Some(separable) = word_data.separable {
            updated_word.separable = separable;
        }
        updated_word.kind = crate::types::wordbook::vocab_kind(&updated_word.word).to_string();
        updated_word.phrase_type =
            phrase_type_for(&updated_word.word, updated_word.phrase_type.as_deref());
        updated_word.separable &= updated_word.phrase_type.as_deref() == Some("phrasal_verb");

        // 调用 repository 更新
        self.repository.update(&updated_word).await
    }

    /// 批量删除单词，全部在一个事务里：先把这些词从用到它们的计划里移除（按计划聚合一次，
    /// 日程计数、掌握数、计划总词数随之重算，变空的日程删除），再删词汇本身（作答记录、例句等随外键删除）。
    /// 任何一步失败整体回滚。返回实际删除的单词数（不存在的 ID 忽略）。
    pub async fn delete_words(&self, word_ids: &[Id]) -> AppResult<usize> {
        use crate::repositories::study_plan_repository::StudyPlanRepository;
        use crate::repositories::study_schedule_repository::StudyScheduleRepository;
        use std::collections::{BTreeMap, BTreeSet};

        let ids: Vec<Id> = word_ids
            .iter()
            .copied()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        if ids.is_empty() {
            return Err(AppError::ValidationError("请至少选择一个单词".to_string()));
        }

        let plan_repo = StudyPlanRepository::new(self.pool.clone(), self.logger.clone());
        let schedule_repo = StudyScheduleRepository::new(self.pool.clone(), self.logger.clone());
        let mut tx = crate::services::srs::begin_write(&self.pool).await?;

        let mut words_by_plan: BTreeMap<Id, Vec<Id>> = BTreeMap::new();
        for &word_id in &ids {
            for plan_id in plan_repo
                .plans_containing_word_conn(&mut tx, word_id)
                .await?
            {
                words_by_plan.entry(plan_id).or_default().push(word_id);
            }
        }
        for (plan_id, plan_words) in &words_by_plan {
            let (_, schedules) = plan_repo
                .remove_words_conn(&mut tx, *plan_id, plan_words)
                .await?;
            for schedule_id in schedules {
                schedule_repo
                    .refresh_completion(&mut tx, schedule_id)
                    .await?;
            }
        }
        let mut deleted = 0;
        for &word_id in &ids {
            if WordRepository::delete_conn(&mut tx, word_id).await? {
                deleted += 1;
            }
        }
        tx.commit().await?;
        Ok(deleted)
    }

    /// 分页获取词汇本中的单词
    #[allow(clippy::too_many_arguments)]
    pub async fn get_words_by_book(
        &self,
        book_id: Id,
        page: u32,
        page_size: u32,
        search_term: Option<String>,
        part_of_speech: Option<String>,
        sort_by: Option<&str>,
        kind: Option<&str>,
    ) -> AppResult<PaginatedResponse<Word>> {
        let (words, total) = self
            .repository
            .find_by_book_paginated(
                book_id,
                page,
                page_size,
                search_term.as_deref(),
                part_of_speech.as_deref(),
                sort_by,
                kind,
            )
            .await?;

        Ok(PaginatedResponse::new(words, total, page, page_size))
    }
}

/// 词组的类型：只接受四种取值；单词没有类型
pub fn phrase_type_for(word: &str, phrase_type: Option<&str>) -> Option<String> {
    const TYPES: [&str; 4] = ["phrasal_verb", "collocation", "idiom", "fixed"];
    let t = phrase_type?.trim();
    (crate::types::wordbook::vocab_kind(word) == "phrase" && TYPES.contains(&t))
        .then(|| t.to_string())
}

/// 去掉首尾空白并丢弃空句子
pub fn clean_examples(examples: Vec<WordExample>) -> Vec<WordExample> {
    examples
        .into_iter()
        .map(|e| WordExample {
            sentence: e.sentence.trim().to_string(),
            translation: e.translation.trim().to_string(),
        })
        .filter(|e| !e.sentence.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, seed_schedule, test_logger};

    fn new_word(word: &str, meaning: &str) -> CreateWordRequest {
        CreateWordRequest {
            word: word.to_string(),
            meaning: meaning.to_string(),
            description: None,
            ipa: None,
            syllables: None,
            phonics_segments: None,
            part_of_speech: Some("n.".to_string()),
            category_id: None,
            pos_abbreviation: None,
            pos_english: None,
            pos_chinese: None,
            phonics_rule: None,
            analysis_explanation: None,
            examples: None,
            phrase_type: None,
            separable: None,
        }
    }

    #[tokio::test]
    async fn adding_and_editing_words_validate_and_reject_duplicates() {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 1).await; // 单词 word1
        let book: Id = sqlx::query_scalar("SELECT word_book_id FROM words WHERE id = ?")
            .bind(fx.word_ids[0])
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        let service = WordService::new(pool.clone(), test_logger());

        assert!(service
            .add_word_to_book(book, new_word(" ", "x"))
            .await
            .is_err());
        assert!(service
            .add_word_to_book(book, new_word("cat", " "))
            .await
            .is_err());
        let err = service
            .add_word_to_book(book, new_word("WORD1", "重复"))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("已经有"), "{err}");

        let id = service
            .add_word_to_book(book, new_word("  cat ", " 猫 "))
            .await
            .unwrap();
        let saved = service.repository.find_by_id(id).await.unwrap().unwrap();
        assert_eq!((saved.word.as_str(), saved.meaning.as_str()), ("cat", "猫"));

        // 改名成已有的词被拒绝；改自己的大小写可以
        let rename = |w: &str| UpdateWordRequest {
            word: Some(w.to_string()),
            ..Default::default()
        };
        assert!(service.update_word(id, rename("word1")).await.is_err());
        service.update_word(id, rename("Cat")).await.unwrap();

        // 词组：保存类型与能否拆开；改回单词时清除
        let phrase = service
            .add_word_to_book(
                book,
                CreateWordRequest {
                    phrase_type: Some("phrasal_verb".into()),
                    separable: Some(true),
                    ..new_word("give  up", "放弃")
                },
            )
            .await
            .unwrap();
        let saved = service
            .repository
            .find_by_id(phrase)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.word, "give up");
        assert_eq!(
            (
                saved.kind.as_str(),
                saved.phrase_type.as_deref(),
                saved.separable
            ),
            ("phrase", Some("phrasal_verb"), true)
        );
        service
            .update_word(
                phrase,
                UpdateWordRequest {
                    phrase_type: Some("idiom".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let saved = service
            .repository
            .find_by_id(phrase)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (saved.phrase_type.as_deref(), saved.separable),
            (Some("idiom"), false)
        );
        service.update_word(phrase, rename("quit")).await.unwrap();
        let saved = service
            .repository
            .find_by_id(phrase)
            .await
            .unwrap()
            .unwrap();
        assert_eq!((saved.kind.as_str(), saved.phrase_type), ("word", None));
        crate::time::assert_instants_canonical(&pool).await;
    }
}
