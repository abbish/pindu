//! 单词数据访问层
//!
//! 封装所有与单词（words表）相关的数据库操作

use std::sync::Arc;
use sqlx::{SqlitePool, Row};
use crate::{error::AppError, types::common::Id, types::wordbook::Word, logger::Logger, error::AppResult};

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
                self.logger.database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if let Some(row) = row {
            self.logger.database_operation(
                "SELECT",
                "words",
                true,
                Some(&format!("Found word by ID: {}", word_id))
            );
            Ok(Some(self.row_to_word(row)?))
        } else {
            self.logger.database_operation(
                "SELECT",
                "words",
                true,
                Some(&format!("Word not found: {}", word_id))
            );
            Ok(None)
        }
    }

    /// 根据单词本ID查询所有单词
    pub async fn find_by_wordbook_id(&self, wordbook_id: Id) -> AppResult<Vec<Word>> {
        let query = r#"
            SELECT id, word, meaning, description, ipa, syllables, phonics_segments,
                   part_of_speech, pos_abbreviation, pos_english, pos_chinese,
                   phonics_rule, analysis_explanation, word_book_id,
                   created_at, updated_at
            FROM words
            WHERE word_book_id = ?
            ORDER BY id
        "#;

        let rows = sqlx::query(query)
            .bind(wordbook_id)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        self.logger.database_operation(
            "SELECT",
            "words",
            true,
            Some(&format!("Found {} words for wordbook {}", rows.len(), wordbook_id))
        );

        rows.into_iter()
            .map(|row| self.row_to_word(row))
            .collect()
    }

    /// 分页查询单词本中的单词
    pub async fn find_by_wordbook_id_paginated(
        &self,
        wordbook_id: Id,
        offset: i64,
        limit: i64,
    ) -> AppResult<Vec<Word>> {
        let query = r#"
            SELECT id, word, meaning, description, ipa, syllables, phonics_segments,
                   part_of_speech, pos_abbreviation, pos_english, pos_chinese,
                   phonics_rule, analysis_explanation, word_book_id,
                   created_at, updated_at
            FROM words
            WHERE word_book_id = ?
            ORDER BY id
            LIMIT ? OFFSET ?
        "#;

        let rows = sqlx::query(query)
            .bind(wordbook_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        self.logger.database_operation(
            "SELECT",
            "words",
            true,
            Some(&format!("Paginated query: {} words for wordbook {}", rows.len(), wordbook_id))
        );

        rows.into_iter()
            .map(|row| self.row_to_word(row))
            .collect()
    }

    /// 搜索单词（按关键词和词性过滤）
    pub async fn search(
        &self,
        wordbook_id: Id,
        keyword: Option<String>,
        part_of_speech: Option<String>,
        offset: i64,
        limit: i64,
    ) -> AppResult<Vec<Word>> {
        let mut query = String::from(r#"
            SELECT id, word, meaning, description, ipa, syllables, phonics_segments,
                   part_of_speech, pos_abbreviation, pos_english, pos_chinese,
                   phonics_rule, analysis_explanation, word_book_id,
                   created_at, updated_at
            FROM words
            WHERE word_book_id = ?
        "#);

        if keyword.is_some() || part_of_speech.is_some() {
            if let Some(keyword) = &keyword {
                query.push_str(&format!(" AND (word LIKE '%{}%' OR meaning LIKE '%{}%')",
                    keyword.replace("'", "''"),
                    keyword.replace("'", "''")
                ));
            }

            if let Some(pos) = &part_of_speech {
                query.push_str(&format!(" AND part_of_speech = '{}'", pos));
            }
        }

        query.push_str(" ORDER BY id LIMIT ? OFFSET ?");

        let rows = sqlx::query(&query)
            .bind(wordbook_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        self.logger.database_operation(
            "SELECT",
            "words",
            true,
            Some(&format!("Search: {} words for wordbook {}", rows.len(), wordbook_id))
        );

        rows.into_iter()
            .map(|row| self.row_to_word(row))
            .collect()
    }

    /// 统计单词本中的单词数量
    pub async fn count_by_wordbook_id(&self, wordbook_id: Id) -> AppResult<i64> {
        let query = "SELECT COUNT(*) as count FROM words WHERE word_book_id = ?";

        let row = sqlx::query(query)
            .bind(wordbook_id)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let count: i64 = row.get("count");
        self.logger.database_operation(
            "SELECT",
            "words",
            true,
            Some(&format!("Count: {} words in wordbook {}", count, wordbook_id))
        );

        Ok(count)
    }

    /// 统计搜索结果数量
    pub async fn count_search(
        &self,
        wordbook_id: Id,
        keyword: Option<String>,
        part_of_speech: Option<String>,
    ) -> AppResult<i64> {
        let mut query = String::from("SELECT COUNT(*) as count FROM words WHERE word_book_id = ?");

        if keyword.is_some() || part_of_speech.is_some() {
            if let Some(keyword) = &keyword {
                query.push_str(&format!(" AND (word LIKE '%{}%' OR meaning LIKE '%{}%')",
                    keyword.replace("'", "''"),
                    keyword.replace("'", "''")
                ));
            }

            if let Some(pos) = &part_of_speech {
                query.push_str(&format!(" AND part_of_speech = '{}'", pos));
            }
        }

        let row = sqlx::query(&query)
            .bind(wordbook_id)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let count: i64 = row.get("count");
        self.logger.database_operation(
            "SELECT",
            "words",
            true,
            Some(&format!("Search count: {} words in wordbook {}", count, wordbook_id))
        );

        Ok(count)
    }

    /// 批量查询单词是否存在
    pub async fn find_existing_words(
        &self,
        wordbook_id: Id,
        words: &[String],
    ) -> AppResult<Vec<(String, Id)>> {
        if words.is_empty() {
            return Ok(Vec::new());
        }

        // 构建IN查询
        let word_list: Vec<String> = words.iter()
            .map(|w| w.to_lowercase())
            .collect();

        let word_list_str = word_list.iter()
            .map(|w| format!("'{}'", w.replace("'", "''")))
            .collect::<Vec<_>>()
            .join(",");

        let query = format!(
            "SELECT id, LOWER(word) as word_lower FROM words WHERE word_book_id = {} AND LOWER(word) IN ({})",
            wordbook_id, word_list_str
        );

        let rows = sqlx::query(&query)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        self.logger.database_operation(
            "SELECT",
            "words",
            true,
            Some(&format!("Found {} existing words for wordbook {}", rows.len(), wordbook_id))
        );

        let result: Vec<(String, Id)> = rows.into_iter()
            .map(|row| {
                let word: String = row.get("word_lower");
                let id: Id = row.get("id");
                (word, id)
            })
            .collect();

        Ok(result)
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
                self.logger.database_operation("INSERT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let word_id = result.last_insert_rowid();
        self.logger.database_operation(
            "INSERT",
            "words",
            true,
            Some(&format!("Created word '{}' with ID {}", word.word, word_id))
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
                self.logger.database_operation("UPDATE", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if result.rows_affected() == 0 {
            self.logger.database_operation(
                "UPDATE",
                "words",
                false,
                Some(&format!("Word not found: {}", word.id))
            );
            return Err(AppError::NotFound(format!("单词未找到: {}", word.id)));
        }

        self.logger.database_operation(
            "UPDATE",
            "words",
            true,
            Some(&format!("Updated word '{}' (ID {})", word.word, word.id))
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
                self.logger.database_operation("DELETE", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        if result.rows_affected() == 0 {
            self.logger.database_operation(
                "DELETE",
                "words",
                false,
                Some(&format!("Word not found: {}", word_id))
            );
            return Err(AppError::NotFound(format!("单词未找到: {}", word_id)));
        }

        self.logger.database_operation(
            "DELETE",
            "words",
            true,
            Some(&format!("Deleted word ID {}", word_id))
        );

        Ok(())
    }

    /// 批量删除单词
    pub async fn delete_batch(&self, word_ids: &[Id]) -> AppResult<usize> {
        if word_ids.is_empty() {
            return Ok(0);
        }

        let ids_str = word_ids.iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");

        let query = format!("DELETE FROM words WHERE id IN ({})", ids_str);

        let result = sqlx::query(&query)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation("DELETE", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let affected = result.rows_affected();
        self.logger.database_operation(
            "DELETE",
            "words",
            true,
            Some(&format!("Batch deleted {} words", affected))
        );

        Ok(affected as usize)
    }

    /// 检查单词是否存在（不区分大小写）
    pub async fn exists_case_insensitive(
        &self,
        wordbook_id: Id,
        word: &str,
    ) -> AppResult<Option<Id>> {
        let query = "SELECT id FROM words WHERE word_book_id = ? AND LOWER(word) = LOWER(?)";

        let row = sqlx::query(query)
            .bind(wordbook_id)
            .bind(word)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        Ok(row.map(|r| r.get("id")))
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
            part_of_speech: row.get("part_of_speech"),
            pos_abbreviation: row.get("pos_abbreviation"),
            pos_english: row.get("pos_english"),
            pos_chinese: row.get("pos_chinese"),
            phonics_rule: row.get("phonics_rule"),
            analysis_explanation: row.get("analysis_explanation"),
            word_book_id: row.get("word_book_id"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }
}
