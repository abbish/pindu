//! 单词业务逻辑服务
//!
//! 封装单词相关的业务逻辑
//!
//! # 注意
//! 此模块当前独立实现,未来将集成到 handlers



use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::word_repository::WordRepository;
use crate::types::{common::{Id, PaginatedResponse}, wordbook::*};
use sqlx::SqlitePool;
use std::sync::Arc;

/// 单词服务
///
/// 负责单词的业务逻辑处理
pub struct WordService {
    repository: WordRepository,
}

impl WordService {
    /// 创建新的服务实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: WordRepository::new(pool, logger),
        }
    }


    /// 添加单词到单词本
    pub async fn add_word_to_book(
        &self,
        book_id: Id,
        word_data: CreateWordRequest,
    ) -> AppResult<Id> {
        // 将 CreateWordRequest 转换为 Word
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
            .ok_or_else(|| AppError::NotFound(format!("单词 {} 不存在", word_id)))?;

        // 更新字段
        let mut updated_word = existing_word.clone();
        if let Some(word) = word_data.word {
            updated_word.word = word;
        }
        if let Some(meaning) = word_data.meaning {
            updated_word.meaning = meaning;
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

        // 调用 repository 更新
        self.repository.update(&updated_word).await
    }

    /// 删除单词
    pub async fn delete_word(&self, word_id: Id) -> AppResult<Option<Id>> {
        // 先获取单词的单词本ID
        let book_id = self.repository.get_word_book_id(word_id).await?;
        
        // 调用 repository 删除
        self.repository.delete(word_id).await?;
        
        Ok(book_id)
    }

    /// 分页获取单词本中的单词
    pub async fn get_words_by_book(
        &self,
        book_id: Id,
        page: u32,
        page_size: u32,
        search_term: Option<String>,
        part_of_speech: Option<String>,
    ) -> AppResult<PaginatedResponse<Word>> {
        let (words, total) = self
            .repository
            .find_by_book_paginated(
                book_id,
                page,
                page_size,
                search_term.as_deref(),
                part_of_speech.as_deref(),
            )
            .await?;

        Ok(PaginatedResponse::new(words, total, page, page_size))
    }
}
