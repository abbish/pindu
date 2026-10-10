//! 单词数据访问层
//!
//! 封装所有与单词（words表）相关的数据库操作
//!
//! # 注意
//! 此模块当前独立实现,未来将集成到 Service 层

use crate::{
    error::AppError,
    error::AppResult,
    logger::Logger,
    types::common::Id,
    types::wordbook::{Word, WordExample},
};
use sqlx::{Row, SqliteConnection, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;

/// 用给定列表替换单词的全部例句（按列表顺序写 sort_order；在调用方事务内执行）
pub async fn replace_examples_conn(
    conn: &mut SqliteConnection,
    word_id: Id,
    examples: &[WordExample],
) -> AppResult<()> {
    sqlx::query("DELETE FROM word_examples WHERE word_id = ?")
        .bind(word_id)
        .execute(&mut *conn)
        .await?;
    for (order, example) in examples.iter().enumerate() {
        sqlx::query(
            "INSERT INTO word_examples (word_id, sentence, translation, sort_order, created_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(word_id)
        .bind(&example.sentence)
        .bind(&example.translation)
        .bind(order as i64)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// 批量读取例句：word_id → 按 sort_order 排好的例句（没有例句的单词不在结果中）
pub async fn examples_by_word_ids(
    pool: &SqlitePool,
    word_ids: &[Id],
) -> AppResult<HashMap<Id, Vec<WordExample>>> {
    let mut result: HashMap<Id, Vec<WordExample>> = HashMap::new();
    // SQLite 绑定参数数量有限，分块查询
    for chunk in word_ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT word_id, sentence, translation FROM word_examples WHERE word_id IN ({}) ORDER BY word_id, sort_order, id",
            placeholders
        );
        let mut query = sqlx::query(&sql);
        for id in chunk {
            query = query.bind(id);
        }
        for row in query.fetch_all(pool).await? {
            result
                .entry(row.get("word_id"))
                .or_default()
                .push(WordExample {
                    sentence: row.get("sentence"),
                    translation: row.get("translation"),
                });
        }
    }
    Ok(result)
}

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

    /// 查找词汇本中已存在的单词（用于去重）
    /// 词汇本里全部单词（小写，去重），用于“生成单词时避开已有词”
    pub async fn word_texts_by_book(&self, book_id: Id) -> AppResult<Vec<String>> {
        Ok(sqlx::query_scalar(
            "SELECT DISTINCT LOWER(word) FROM words WHERE word_book_id = ? ORDER BY LOWER(word)",
        )
        .bind(book_id)
        .fetch_all(self.pool.as_ref())
        .await?)
    }

    /// 词汇本里全部单词的 id 与拼写（单词 ↔ 素材计数用）
    pub async fn id_texts_by_book(&self, book_id: Id) -> AppResult<Vec<(Id, String)>> {
        Ok(
            sqlx::query_as("SELECT id, word FROM words WHERE word_book_id = ? ORDER BY id")
                .bind(book_id)
                .fetch_all(self.pool.as_ref())
                .await?,
        )
    }

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

    /// 批量创建单词（在调用方事务内执行），返回新 ID
    pub async fn create_batch(
        &self,
        conn: &mut SqliteConnection,
        words: &[Word],
    ) -> AppResult<Vec<Id>> {
        let mut word_ids = Vec::with_capacity(words.len());
        for word in words {
            let result = sqlx::query(
                r#"
                INSERT INTO words (
                    word, meaning, description, ipa, syllables, phonics_segments,
                    part_of_speech, pos_abbreviation, pos_english, pos_chinese,
                    phonics_rule, analysis_explanation, kind, phrase_type, separable, word_book_id,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            "#,
            )
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
            .bind(crate::types::wordbook::vocab_kind(&word.word))
            .bind(&word.phrase_type)
            .bind(word.separable)
            .bind(word.word_book_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| {
                AppError::DatabaseError(format!("保存单词「{}」失败：{}", word.word, e))
            })?;
            let word_id = result.last_insert_rowid();
            replace_examples_conn(&mut *conn, word_id, &word.examples).await?;
            word_ids.push(word_id);
        }
        Ok(word_ids)
    }

    /// 用分析结果覆盖已有单词的释义、音标、拼读等字段（在调用方事务内执行）
    pub async fn update_batch(
        &self,
        conn: &mut SqliteConnection,
        words: &[(Id, Word)],
    ) -> AppResult<()> {
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
                phrase_type = COALESCE(?, phrase_type),
                separable = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
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
                .bind(&word.phrase_type)
                .bind(word.separable)
                .bind(word_id)
                .execute(&mut *conn)
                .await
                .map_err(|e| {
                    AppError::DatabaseError(format!("更新单词「{}」失败：{}", word.word, e))
                })?;
            // 新结果有例句才替换，否则保留原例句
            if !word.examples.is_empty() {
                replace_examples_conn(&mut *conn, *word_id, &word.examples).await?;
            }
        }
        Ok(())
    }

    /// 根据词汇本ID列表查询单词（用于AI规划）
    pub async fn find_words_by_wordbook_ids(
        &self,
        wordbook_ids: &[Id],
    ) -> AppResult<Vec<(Id, String, Id, Option<String>)>> {
        if wordbook_ids.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders: Vec<String> = (0..wordbook_ids.len()).map(|_| "?".to_string()).collect();
        let query = format!(
            r#"
            SELECT id, word, word_book_id, meaning
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

        let words: Vec<(Id, String, Id, Option<String>)> = rows
            .into_iter()
            .map(|row| {
                (
                    row.get("id"),
                    row.get("word"),
                    row.get("word_book_id"),
                    row.get("meaning"),
                )
            })
            .collect();

        self.logger.database_operation(
            "SELECT",
            "words",
            true,
            Some(&format!(
                "Found {} words from {} wordbooks",
                words.len(),
                wordbook_ids.len()
            )),
        );

        Ok(words)
    }

    /// 根据ID查询单词
    pub async fn find_by_id(&self, word_id: Id) -> AppResult<Option<Word>> {
        let query = r#"
            SELECT id, word, meaning, description, ipa, syllables, phonics_segments,
                   image_path, audio_path, part_of_speech, category_id,
                   pos_abbreviation, pos_english, pos_chinese,
                   phonics_rule, analysis_explanation, kind, phrase_type, separable,
                   word_book_id, created_at, updated_at
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
            let mut word = self.row_to_word(row)?;
            word.examples = examples_by_word_ids(self.pool.as_ref(), &[word_id])
                .await?
                .remove(&word_id)
                .unwrap_or_default();
            Ok(Some(word))
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
                phonics_rule, analysis_explanation, kind, phrase_type, separable, word_book_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        "#;

        let mut tx = self.pool.begin().await?;
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
            .bind(crate::types::wordbook::vocab_kind(&word.word))
            .bind(&word.phrase_type)
            .bind(word.separable)
            .bind(word.word_book_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("INSERT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let word_id = result.last_insert_rowid();
        replace_examples_conn(&mut tx, word_id, &word.examples).await?;
        tx.commit().await?;
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
                kind = ?,
                phrase_type = ?,
                separable = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id = ?
        "#;

        let mut tx = self.pool.begin().await?;
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
            .bind(crate::types::wordbook::vocab_kind(&word.word))
            .bind(&word.phrase_type)
            .bind(word.separable)
            .bind(word.id)
            .execute(&mut *tx)
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
        replace_examples_conn(&mut tx, word.id, &word.examples).await?;
        tx.commit().await?;

        self.logger.database_operation(
            "UPDATE",
            "words",
            true,
            Some(&format!("Updated word '{}' (ID {})", word.word, word.id)),
        );

        Ok(())
    }

    /// 在调用方事务内删除单词（例句、讲解、计划单词与作答记录随外键一起删除）
    pub async fn delete_conn(conn: &mut sqlx::SqliteConnection, word_id: Id) -> AppResult<bool> {
        Ok(sqlx::query("DELETE FROM words WHERE id = ?")
            .bind(word_id)
            .execute(&mut *conn)
            .await?
            .rows_affected()
            > 0)
    }

    /// 分页查询词汇本中的单词；sort_by：word 字母顺序（默认）/ newest 最近添加 / oldest 最早添加
    #[allow(clippy::too_many_arguments)]
    pub async fn find_by_book_paginated(
        &self,
        book_id: Id,
        page: u32,
        page_size: u32,
        search_term: Option<&str>,
        part_of_speech: Option<&str>,
        sort_by: Option<&str>,
        kind: Option<&str>,
    ) -> AppResult<(Vec<Word>, u32)> {
        // 只看单词 / 只看词组（D45）
        let kind = kind.filter(|k| matches!(*k, "word" | "phrase"));
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
        if kind.is_some() {
            where_conditions.push("kind = ?".to_string());
        }

        let where_clause = where_conditions.join(" AND ");
        let order_by = match sort_by {
            Some("newest") => "id DESC",
            Some("oldest") => "id",
            _ => "word COLLATE NOCASE, id",
        };

        // 构建查询
        let query = format!(
            r#"
            SELECT
                id, word, meaning, description, ipa, syllables, phonics_segments,
                image_path, audio_path, part_of_speech, category_id, word_book_id,
                pos_abbreviation, pos_english, pos_chinese, phonics_rule,
                analysis_explanation, kind, phrase_type, separable, created_at, updated_at
            FROM words
            WHERE {where_clause}
            ORDER BY {order_by}
            LIMIT ? OFFSET ?
            "#
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
        if let Some(k) = kind {
            query_builder = query_builder.bind(k);
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

        let mut words: Vec<Word> = rows
            .into_iter()
            .map(|row| self.row_to_word(row))
            .collect::<Result<Vec<_>, _>>()?;
        let ids: Vec<Id> = words.iter().map(|w| w.id).collect();
        let mut examples = examples_by_word_ids(self.pool.as_ref(), &ids).await?;
        for word in &mut words {
            word.examples = examples.remove(&word.id).unwrap_or_default();
        }

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
        if let Some(k) = kind {
            count_query_builder = count_query_builder.bind(k);
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
            // 个别查询没选这几列时按内容推断
            kind: row.try_get("kind").unwrap_or_else(|_| {
                crate::types::wordbook::vocab_kind(&row.get::<String, _>("word")).to_string()
            }),
            phrase_type: row.try_get("phrase_type").unwrap_or(None),
            separable: row.try_get("separable").unwrap_or(false),
            examples: Vec::new(),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }
}
