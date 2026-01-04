//! 单词本业务逻辑服务
//!
//! 封装单词本相关的业务逻辑
//!
//! # 注意
//! 此模块当前独立实现,未来将集成到 handlers



use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::wordbook_repository::{WordBookRepository, WordBookFilters};
use crate::types::{common::{Id, WordSaveResult}, wordbook::*};
use sqlx::SqlitePool;
use std::sync::Arc;

/// 单词本服务
///
/// 负责单词本的业务逻辑处理
pub struct WordBookService {
    repository: WordBookRepository,
}

impl WordBookService {
    /// 创建新的服务实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: WordBookRepository::new(pool, logger),
        }
    }

    /// 获取单词本列表
    pub async fn get_word_books(
        &self,
        include_deleted: bool,
        status: Option<String>,
    ) -> AppResult<Vec<WordBook>> {
        // Repository 的 find_all 默认不包含已删除的单词本
        // 如果需要包含已删除的,需要单独处理
        if include_deleted {
            // TODO: 实现包含已删除单词本的查询
            // 目前暂时返回未删除的单词本
        }

        // 构建过滤条件
        let filters = WordBookFilters { status };

        // 调用 repository 查询
        self.repository.find_all(filters).await
    }

    /// 获取单词本(仅基本信息)
    pub async fn get_word_book(&self, id: Id) -> AppResult<WordBook> {
        // 获取基本信息
        let word_book = self
            .repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("单词本 {} 不存在", id)))?;

        Ok(word_book)
    }

    /// 创建单词本
    pub async fn create_word_book(&self, request: CreateWordBookRequest) -> AppResult<Id> {
        // 数据验证
        if request.title.trim().is_empty() {
            return Err(AppError::ValidationError("单词本标题不能为空".to_string()));
        }

        // 调用 repository 创建
        self.repository.create(request).await
    }

    /// 更新单词本
    pub async fn update_word_book(&self, id: Id, request: UpdateWordBookRequest) -> AppResult<()> {
        // 验证单词本是否存在
        let _existing = self
            .repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("单词本 {} 不存在", id)))?;

        // 数据验证 - 如果提供了 title，验证它不为空
        if let Some(title) = &request.title {
            if title.trim().is_empty() {
                return Err(AppError::ValidationError("单词本标题不能为空".to_string()));
            }
        }

        // 调用 repository 更新
        self.repository.update(id, request).await
    }

    /// 删除单词本(软删除)
    pub async fn delete_word_book(&self, id: Id) -> AppResult<()> {
        // 验证单词本是否存在
        let _existing = self
            .repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("单词本 {} 不存在", id)))?;

        // 调用 repository 删除
        self.repository.delete(id).await
    }

    /// 获取单词本统计信息
    pub async fn get_word_book_statistics(&self, id: Id) -> AppResult<WordBookStatistics> {
        // 验证单词本是否存在
        let _existing = self
            .repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("单词本 {} 不存在", id)))?;

        // 调用 repository 获取统计
        self.repository.get_statistics(id).await
    }

    /// 获取单词本词性分布
    pub async fn get_word_type_distribution(&self, id: Id) -> AppResult<WordTypeDistribution> {
        let stats = self.get_word_book_statistics(id).await?;
        Ok(stats.word_types)
    }

    /// 更新所有单词本的统计信息
    pub async fn update_all_counts(&self) -> AppResult<()> {
        self.repository.update_all_counts().await
    }

    /// 更新单词本的统计信息
    pub async fn update_statistics(&self, id: Id) -> AppResult<()> {
        self.repository.update_statistics(id).await
    }

    /// 从分析结果创建单词本（批量操作）
    pub async fn create_word_book_from_analysis(
        &self,
        request: CreateWordBookFromAnalysisRequest,
    ) -> AppResult<WordSaveResult> {
        use crate::repositories::word_repository::WordRepository;
        use crate::types::wordbook::{AnalyzedWord, Word};

        // 验证输入
        if request.title.trim().is_empty() {
            return Err(AppError::ValidationError("单词本标题不能为空".to_string()));
        }

        if request.words.is_empty() {
            return Err(AppError::ValidationError("单词本必须包含至少一个单词".to_string()));
        }

        // 1. 内部去重
        let mut unique_words = Vec::new();
        let mut seen_words = std::collections::HashSet::new();

        for word in &request.words {
            let word_lower = word.word.to_lowercase();
            if !seen_words.contains(&word_lower) {
                seen_words.insert(word_lower);
                unique_words.push(word.clone());
            }
        }

        // 2. 数据库查重和分类
        let book_id_for_check = request.book_id.unwrap_or(0);
        let mut words_to_add = Vec::new();
        let mut words_to_update = Vec::new();

        if book_id_for_check > 0 {
            // 检查数据库重复
            let word_repo = WordRepository::new(
                self.repository.get_pool(),
                self.repository.get_logger(),
            );

            let word_list: Vec<String> = unique_words.iter().map(|w| w.word.to_lowercase()).collect();
            let existing_map = word_repo
                .find_existing_words_by_book(book_id_for_check, &word_list)
                .await?;

            for word in &unique_words {
                let word_lower = word.word.to_lowercase();
                if let Some(&existing_id) = existing_map.get(&word_lower) {
                    words_to_update.push((existing_id, word.clone()));
                } else {
                    words_to_add.push(word.clone());
                }
            }
        } else {
            words_to_add = unique_words;
        }

        if words_to_add.is_empty() && words_to_update.is_empty() {
            return Err(AppError::ValidationError("去重后没有单词需要处理".to_string()));
        }

        // 3. 开始事务，确保原子性
        let mut tx = self.repository.get_pool().begin().await.map_err(|e| {
            AppError::DatabaseError(format!("Failed to begin transaction: {}", e))
        })?;

        // 4. 确定目标单词本ID
        let book_id = if let Some(existing_book_id) = request.book_id {
            // 验证单词本是否存在
            let exists = sqlx::query("SELECT id FROM word_books WHERE id = ? AND deleted_at IS NULL")
                .bind(existing_book_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            
            if exists.is_none() {
                let _ = tx.rollback().await;
                return Err(AppError::NotFound(format!("单词本 {} 不存在", existing_book_id)));
            }
            
            existing_book_id
        } else {
            // 在事务中创建新单词本
            let query = r#"
                INSERT INTO word_books (title, description, icon, icon_color, status)
                VALUES (?, ?, ?, ?, 'normal')
            "#;

            let result = match sqlx::query(query)
                .bind(&request.title)
                .bind(&request.description)
                .bind(&request.icon.unwrap_or_else(|| "📚".to_string()))
                .bind(&request.icon_color.unwrap_or_else(|| "#3B82F6".to_string()))
                .execute(&mut *tx)
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.rollback().await;
                    return Err(AppError::DatabaseError(format!("Failed to create word book: {}", e)));
                }
            };

            let new_book_id = result.last_insert_rowid();

            // 插入主题标签关联（如果有）
            if let Some(tag_ids) = &request.theme_tag_ids {
                for tag_id in tag_ids {
                    let tag_query = r#"
                        INSERT OR IGNORE INTO word_book_theme_tags (word_book_id, theme_tag_id)
                        VALUES (?, ?)
                    "#;
                    if let Err(e) = sqlx::query(tag_query)
                        .bind(new_book_id)
                        .bind(tag_id)
                        .execute(&mut *tx)
                        .await
                    {
                        let _ = tx.rollback().await;
                        return Err(AppError::DatabaseError(format!(
                            "Failed to add theme tag {}: {}",
                            tag_id, e
                        )));
                    }
                }
            }

            new_book_id
        };

        // 5. 批量添加和更新单词（在事务中）
        let word_repo = WordRepository::new(
            self.repository.get_pool(),
            self.repository.get_logger(),
        );

        let mut added_count = 0;
        let mut updated_count = 0;

        // 添加新单词（在事务中）
        if !words_to_add.is_empty() {
            let words: Vec<Word> = words_to_add
                .into_iter()
                .map(|aw| Word {
                    id: 0,
                    word: aw.word,
                    meaning: aw.meaning,
                    description: None,
                    ipa: aw.ipa,
                    syllables: aw.syllables,
                    phonics_segments: None,
                    image_path: None,
                    audio_path: None,
                    part_of_speech: aw.part_of_speech,
                    category_id: None,
                    word_book_id: Some(book_id),
                    pos_abbreviation: aw.pos_abbreviation,
                    pos_english: aw.pos_english,
                    pos_chinese: aw.pos_chinese,
                    phonics_rule: aw.phonics_rule,
                    analysis_explanation: aw.analysis_explanation,
                    created_at: String::new(),
                    updated_at: String::new(),
                })
                .collect();

            // 在事务中批量插入单词
            let insert_query = r#"
                INSERT INTO words (
                    word, meaning, description, ipa, syllables, phonics_segments,
                    part_of_speech, pos_abbreviation, pos_english, pos_chinese,
                    phonics_rule, analysis_explanation, word_book_id,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            "#;

            for word in &words {
                match sqlx::query(insert_query)
                    .bind(&word.word)
                    .bind(&word.meaning)
                    .bind(&word.description)
                    .bind(&word.ipa)
                    .bind(&word.syllables)
                    .bind(&word.phonics_segments)
                    .bind(&word.part_of_speech)
                    .bind(&word.pos_abbreviation)
                    .bind(&word.pos_english)
                    .bind(&word.pos_chinese)
                    .bind(&word.phonics_rule)
                    .bind(&word.analysis_explanation)
                    .bind(word.word_book_id)
                    .execute(&mut *tx)
                    .await
                {
                    Ok(_) => {}
                    Err(e) => {
                        let _ = tx.rollback().await;
                        return Err(AppError::DatabaseError(format!("Failed to insert word '{}': {}", word.word, e)));
                    }
                }
            }

            added_count = words.len();
        }

        // 更新现有单词（在事务中）
        if !words_to_update.is_empty() {
            let update_query = r#"
                UPDATE words SET
                    meaning = ?,
                    ipa = ?,
                    syllables = ?,
                    part_of_speech = ?,
                    pos_abbreviation = ?,
                    pos_english = ?,
                    pos_chinese = ?,
                    phonics_rule = ?,
                    analysis_explanation = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            "#;

            for (word_id, aw) in &words_to_update {
                match sqlx::query(update_query)
                    .bind(&aw.meaning)
                    .bind(&aw.ipa)
                    .bind(&aw.syllables)
                    .bind(&aw.part_of_speech)
                    .bind(&aw.pos_abbreviation)
                    .bind(&aw.pos_english)
                    .bind(&aw.pos_chinese)
                    .bind(&aw.phonics_rule)
                    .bind(&aw.analysis_explanation)
                    .bind(word_id)
                    .execute(&mut *tx)
                    .await
                {
                    Ok(_) => {}
                    Err(e) => {
                        let _ = tx.rollback().await;
                        return Err(AppError::DatabaseError(format!("Failed to update word '{}': {}", aw.word, e)));
                    }
                }
            }

            updated_count = words_to_update.len();
        }

        // 6. 提交事务
        tx.commit().await.map_err(|e| {
            AppError::DatabaseError(format!("Failed to commit transaction: {}", e))
        })?;

        // 7. 更新单词本统计（在事务外，避免长时间锁定）
        self.update_statistics(book_id).await?;

        Ok(WordSaveResult {
            book_id,
            added_count: added_count as i32,
            updated_count: updated_count as i32,
            skipped_count: 0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_creation() {
        // 测试服务创建逻辑
        // 这个测试会在后续完善
    }
}
