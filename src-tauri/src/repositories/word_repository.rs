//! 单词数据访问层
//!
//! 封装所有与单词（words表）相关的数据库操作
//!
//! # 注意
//! 此模块当前独立实现,未来将集成到 Service 层



use crate::{
    error::AppError, error::AppResult, logger::Logger, types::common::Id, types::wordbook::Word,
};
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

/// 单词数据仓库
pub struct WordRepository {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl WordRepository {
    /// 创建新的单词仓库实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 查找单词本中已存在的单词（用于去重）
    pub async fn find_existing_words_by_book(
        &self,
        book_id: Id,
        word_list: &[String],
    ) -> AppResult<std::collections::HashMap<String, Id>> {
        if word_list.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        // 构建 IN 查询
        let placeholders: Vec<String> = (0..word_list.len()).map(|_| "?".to_string()).collect();
        let query = format!(
            "SELECT id, LOWER(word) as word_lower FROM words WHERE word_book_id = ? AND LOWER(word) IN ({})",
            placeholders.join(",")
        );

        let mut query_builder = sqlx::query(&query).bind(book_id);
        for word in word_list {
            query_builder = query_builder.bind(word.to_lowercase());
        }

        let rows = query_builder
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let mut result = std::collections::HashMap::new();
        for row in rows {
            let id: Id = row.get("id");
            let word_lower: String = row.get("word_lower");
            result.insert(word_lower, id);
        }

        Ok(result)
    }

    /// 批量创建单词
    pub async fn create_batch(&self, words: &[Word]) -> AppResult<Vec<Id>> {
        if words.is_empty() {
            return Ok(Vec::new());
        }

        let query = r#"
            INSERT INTO words (
                word, meaning, description, ipa, syllables, phonics_segments,
                part_of_speech, pos_abbreviation, pos_english, pos_chinese,
                phonics_rule, analysis_explanation, word_book_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        "#;

        let mut word_ids = Vec::new();
        for word in words {
            let result = sqlx::query(r#"
                INSERT INTO words (
                    word, meaning, description, ipa, syllables, phonics_segments,
                    part_of_speech, pos_abbreviation, pos_english, pos_chinese,
                    phonics_rule, analysis_explanation, word_book_id,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            "#)
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
                .execute(self.pool.as_ref())
                .await
                .map_err(|e| {
                    self.logger
                        .database_operation("INSERT", "words", false, Some(&e.to_string()));
                    AppError::DatabaseError(format!("Failed to insert word '{}': {}", word.word, e))
                })?;

            word_ids.push(result.last_insert_rowid());
        }

        self.logger.database_operation(
            "INSERT",
            "words",
            true,
            Some(&format!("Created {} words in batch", words.len())),
        );

        Ok(word_ids)
    }

    /// 批量更新单词
    pub async fn update_batch(&self, words: &[(Id, Word)]) -> AppResult<()> {
        if words.is_empty() {
            return Ok(());
        }

        let query = r#"
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

        for (word_id, word) in words {
            sqlx::query(query)
                .bind(&word.meaning)
                .bind(&word.ipa)
                .bind(&word.syllables)
                .bind(&word.part_of_speech)
                .bind(&word.pos_abbreviation)
                .bind(&word.pos_english)
                .bind(&word.pos_chinese)
                .bind(&word.phonics_rule)
                .bind(&word.analysis_explanation)
                .bind(word_id)
                .execute(self.pool.as_ref())
                .await
                .map_err(|e| {
                    self.logger
                        .database_operation("UPDATE", "words", false, Some(&e.to_string()));
                    AppError::DatabaseError(format!("Failed to update word '{}': {}", word.word, e))
                })?;
        }

        self.logger.database_operation(
            "UPDATE",
            "words",
            true,
            Some(&format!("Updated {} words in batch", words.len())),
        );

        Ok(())
    }

    /// 根据单词本ID列表查询单词（用于AI规划）
    pub async fn find_words_by_wordbook_ids(
        &self,
        wordbook_ids: &[Id],
    ) -> AppResult<Vec<(Id, String, Id)>> {
        if wordbook_ids.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders: Vec<String> = (0..wordbook_ids.len()).map(|_| "?".to_string()).collect();
        let query = format!(
            r#"
            SELECT id, word, word_book_id
            FROM words
            WHERE word_book_id IN ({})
                AND word_book_id IN (
                    SELECT id FROM word_books WHERE status = 'normal'
                )
            ORDER BY word_book_id, id
            "#,
            placeholders.join(",")
        );

        let mut query_builder = sqlx::query(&query);
        for wordbook_id in wordbook_ids {
            query_builder = query_builder.bind(wordbook_id);
        }

        let rows = query_builder
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let words: Vec<(Id, String, Id)> = rows
            .into_iter()
            .map(|row| {
                (
                    row.get("id"),
                    row.get("word"),
                    row.get("word_book_id"),
                )
            })
            .collect();

        self.logger.database_operation(
            "SELECT",
            "words",
            true,
            Some(&format!("Found {} words from {} wordbooks", words.len(), wordbook_ids.len())),
        );

        Ok(words)
    }

    /// 验证单词ID是否存在
    pub async fn validate_word_ids(&self, word_ids: &[Id]) -> AppResult<usize> {
        if word_ids.is_empty() {
            return Ok(0);
        }

        // 构建 IN 查询
        let placeholders: Vec<String> = (0..word_ids.len()).map(|_| "?".to_string()).collect();
        let query = format!(
            "SELECT COUNT(*) as count FROM words WHERE id IN ({})",
            placeholders.join(",")
        );

        let mut query_builder = sqlx::query(&query);
        for word_id in word_ids {
            query_builder = query_builder.bind(word_id);
        }

        let row = query_builder
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let count: i64 = row.get("count");
        Ok(count as usize)
    }

    /// 获取单词的单词本ID
    pub async fn get_word_book_id(&self, word_id: Id) -> AppResult<Option<Id>> {
        let query = "SELECT word_book_id FROM words WHERE id = ?";

        let row = sqlx::query(query)
            .bind(word_id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        match row {
            Some(row) => {
                let book_id: Option<Id> = row.get("word_book_id");
                Ok(book_id)
            }
            None => Ok(None),
        }
    }

    /// 根据ID查询单词
    pub async fn find_by_id(&self, word_id: Id) -> AppResult<Option<Word>> {
        let query = r#"
            SELECT id, word, meaning, description, ipa, syllables, phonics_segments,
                   part_of_speech, pos_abbreviation, pos_english, pos_chinese,
                   phonics_rule, analysis_explanation, word_book_id,
                   created_at, updated_at
            FROM words
            WHERE id = ?
        "#;

        let row = sqlx::query(query)
            .bind(word_id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if let Some(row) = row {
            self.logger.database_operation(
                "SELECT",
                "words",
                true,
                Some(&format!("Found word by ID: {}", word_id)),
            );
            Ok(Some(self.row_to_word(row)?))
        } else {
            self.logger.database_operation(
                "SELECT",
                "words",
                true,
                Some(&format!("Word not found: {}", word_id)),
            );
            Ok(None)
        }
    }

    /// 添加新单词
    pub async fn create(&self, word: &Word) -> AppResult<Id> {
        let query = r#"
            INSERT INTO words (
                word, meaning, description, ipa, syllables, phonics_segments,
                part_of_speech, pos_abbreviation, pos_english, pos_chinese,
                phonics_rule, analysis_explanation, word_book_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        "#;

        let result = sqlx::query(query)
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
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("INSERT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let word_id = result.last_insert_rowid();
        self.logger.database_operation(
            "INSERT",
            "words",
            true,
            Some(&format!("Created word '{}' with ID {}", word.word, word_id)),
        );

        Ok(word_id)
    }

    /// 更新单词
    pub async fn update(&self, word: &Word) -> AppResult<()> {
        let query = r#"
            UPDATE words SET
                word = ?,
                meaning = ?,
                description = ?,
                ipa = ?,
                syllables = ?,
                phonics_segments = ?,
                part_of_speech = ?,
                pos_abbreviation = ?,
                pos_english = ?,
                pos_chinese = ?,
                phonics_rule = ?,
                analysis_explanation = ?,
                updated_at = datetime('now')
            WHERE id = ?
        "#;

        let result = sqlx::query(query)
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
            .bind(word.id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if result.rows_affected() == 0 {
            self.logger.database_operation(
                "UPDATE",
                "words",
                false,
                Some(&format!("Word not found: {}", word.id)),
            );
            return Err(AppError::NotFound(format!("单词未找到: {}", word.id)));
        }

        self.logger.database_operation(
            "UPDATE",
            "words",
            true,
            Some(&format!("Updated word '{}' (ID {})", word.word, word.id)),
        );

        Ok(())
    }

    /// 删除单词
    pub async fn delete(&self, word_id: Id) -> AppResult<()> {
        let query = "DELETE FROM words WHERE id = ?";

        let result = sqlx::query(query)
            .bind(word_id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("DELETE", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if result.rows_affected() == 0 {
            self.logger.database_operation(
                "DELETE",
                "words",
                false,
                Some(&format!("Word not found: {}", word_id)),
            );
            return Err(AppError::NotFound(format!("单词未找到: {}", word_id)));
        }

        self.logger.database_operation(
            "DELETE",
            "words",
            true,
            Some(&format!("Deleted word ID {}", word_id)),
        );

        Ok(())
    }

    /// 分页查询单词本中的单词
    pub async fn find_by_book_paginated(
        &self,
        book_id: Id,
        page: u32,
        page_size: u32,
        search_term: Option<&str>,
        part_of_speech: Option<&str>,
    ) -> AppResult<(Vec<Word>, u32)> {
        let offset = (page - 1) * page_size;

        // 构建 WHERE 条件
        let mut where_conditions = vec!["word_book_id = ?".to_string()];
        
        if let Some(term) = search_term {
            if !term.trim().is_empty() {
                where_conditions.push("word LIKE ?".to_string());
            }
        }

        if let Some(pos) = part_of_speech {
            if !pos.trim().is_empty() && pos != "all" {
                where_conditions.push("part_of_speech = ?".to_string());
            }
        }

        let where_clause = where_conditions.join(" AND ");

        // 构建查询
        let query = format!(
            r#"
            SELECT
                id, word, meaning, description, ipa, syllables, phonics_segments,
                image_path, audio_path, part_of_speech, category_id, word_book_id,
                pos_abbreviation, pos_english, pos_chinese, phonics_rule,
                analysis_explanation, created_at, updated_at
            FROM words
            WHERE {}
            ORDER BY word
            LIMIT ? OFFSET ?
            "#,
            where_clause
        );

        let mut query_builder = sqlx::query(&query).bind(book_id);

        if let Some(term) = search_term {
            if !term.trim().is_empty() {
                let search_pattern = format!("{}%", term.trim());
                query_builder = query_builder.bind(search_pattern);
            }
        }

        if let Some(pos) = part_of_speech {
            if !pos.trim().is_empty() && pos != "all" {
                query_builder = query_builder.bind(pos);
            }
        }

        query_builder = query_builder.bind(page_size as i64).bind(offset as i64);

        let rows = query_builder
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let words: Vec<Word> = rows
            .into_iter()
            .map(|row| self.row_to_word(row))
            .collect::<Result<Vec<_>, _>>()?;

        // 构建计数查询
        let count_query = format!("SELECT COUNT(*) as count FROM words WHERE {}", where_clause);
        let mut count_query_builder = sqlx::query(&count_query).bind(book_id);

        if let Some(term) = search_term {
            if !term.trim().is_empty() {
                let search_pattern = format!("{}%", term.trim());
                count_query_builder = count_query_builder.bind(search_pattern);
            }
        }

        if let Some(pos) = part_of_speech {
            if !pos.trim().is_empty() && pos != "all" {
                count_query_builder = count_query_builder.bind(pos);
            }
        }

        let count_row = count_query_builder
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let total: i64 = count_row.get("count");

        self.logger.database_operation(
            "SELECT",
            "words",
            true,
            Some(&format!(
                "Found {} words (page {}, total: {})",
                words.len(),
                page,
                total
            )),
        );

        Ok((words, total as u32))
    }

    /// 将数据库行转换为Word对象
    fn row_to_word(&self, row: sqlx::sqlite::SqliteRow) -> AppResult<Word> {
        Ok(Word {
            id: row.get("id"),
            word: row.get("word"),
            meaning: row.get("meaning"),
            description: row.get("description"),
            ipa: row.get("ipa"),
            syllables: row.get("syllables"),
            phonics_segments: row.get("phonics_segments"),
            image_path: row.get("image_path"),
            audio_path: row.get("audio_path"),
            part_of_speech: row.get("part_of_speech"),
            category_id: row.get("category_id"),
            word_book_id: row.get("word_book_id"),
            pos_abbreviation: row.get("pos_abbreviation"),
            pos_english: row.get("pos_english"),
            pos_chinese: row.get("pos_chinese"),
            phonics_rule: row.get("phonics_rule"),
            analysis_explanation: row.get("analysis_explanation"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }
}
