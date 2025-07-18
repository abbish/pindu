use tauri::{AppHandle, Manager};
use sqlx::{SqlitePool, Row, query::Query};
use crate::types::*;
use crate::types::common::WordSaveResult;
use crate::types::wordbook::WordTypeDistribution;
use crate::error::{AppResult, AppError};
use crate::logger::Logger;
use crate::ai_service::AnalysisProgress;


/// 获取所有单词本
#[tauri::command]
pub async fn get_word_books(app: AppHandle, include_deleted: Option<bool>, status: Option<String>) -> AppResult<Vec<WordBook>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    let include_deleted = include_deleted.unwrap_or(false);
    logger.api_request("get_word_books", Some(&format!("include_deleted: {}, status: {:?}", include_deleted, status)));

    let mut query = r#"
        SELECT
            id,
            title,
            description,
            icon,
            icon_color,
            total_words,
            linked_plans,
            created_at,
            updated_at,
            last_used,
            deleted_at,
            status
        FROM word_books
    "#.to_string();

    let mut conditions = Vec::new();

    if let Some(status_filter) = status {
        match status_filter.as_str() {
            "deleted" => {
                // 只显示已删除的单词本
                conditions.push("deleted_at IS NOT NULL".to_string());
            }
            _ => {
                // 显示指定状态的未删除单词本
                conditions.push("deleted_at IS NULL".to_string());
                conditions.push(format!("status = '{}'", status_filter));
            }
        }
    } else if !include_deleted {
        // 默认情况下不包含已删除的单词本
        conditions.push("deleted_at IS NULL".to_string());
    }

    if !conditions.is_empty() {
        query.push_str(&format!(" WHERE {}", conditions.join(" AND ")));
    }

    query.push_str(" ORDER BY created_at DESC");

    match sqlx::query(&query).fetch_all(pool.inner()).await {
        Ok(rows) => {
            logger.database_operation("SELECT", "word_books", true, Some(&format!("Found {} records", rows.len())));

            // 获取所有单词本ID
            let book_ids: Vec<Id> = rows.iter().map(|row| row.get("id")).collect();

            // 如果没有单词本，直接返回空列表
            if book_ids.is_empty() {
                return Ok(Vec::new());
            }

            // 构建ID列表的占位符
            let placeholders = (0..book_ids.len())
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");

            // 获取所有单词本的主题标签
            let theme_tags_query = format!(
                r#"
                SELECT wbtt.word_book_id, tt.id, tt.name, tt.icon, tt.color, tt.created_at
                FROM theme_tags tt
                INNER JOIN word_book_theme_tags wbtt ON tt.id = wbtt.theme_tag_id
                WHERE wbtt.word_book_id IN ({})
                ORDER BY tt.name
                "#,
                placeholders
            );

            // 构建查询参数
            let mut theme_query = sqlx::query(&theme_tags_query);
            for id in &book_ids {
                theme_query = theme_query.bind(id);
            }

            // 执行查询
            let theme_rows = theme_query.fetch_all(pool.inner()).await?;

            // 将主题标签按单词本ID分组
            let mut theme_tags_map: std::collections::HashMap<Id, Vec<ThemeTag>> = std::collections::HashMap::new();
            for row in theme_rows {
                let book_id: Id = row.get("word_book_id");
                let theme_tag = ThemeTag {
                    id: row.get("id"),
                    name: row.get("name"),
                    icon: row.get("icon"),
                    color: row.get("color"),
                    created_at: row.get("created_at"),
                };

                theme_tags_map.entry(book_id).or_insert_with(Vec::new).push(theme_tag);
            }

            // 构建单词本列表，包含主题标签
            let word_books: Vec<WordBook> = rows.into_iter().map(|row| {
                let id: Id = row.get("id");
                let theme_tags = theme_tags_map.get(&id).cloned();

                WordBook {
                    id,
                    title: row.get("title"),
                    description: row.get("description"),
                    icon: row.get("icon"),
                    icon_color: row.get("icon_color"),
                    total_words: row.get("total_words"),
                    linked_plans: row.get("linked_plans"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                    last_used: row.get("last_used"),
                    deleted_at: row.get("deleted_at"),
                    status: row.get("status"),
                    theme_tags,
                }
            }).collect();

            logger.api_response("get_word_books", true, Some(&format!("Returned {} word books", word_books.len())));
            Ok(word_books)
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "word_books", false, Some(&error_msg));
            logger.api_response("get_word_books", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 根据ID获取单词本详情
#[tauri::command]
pub async fn get_word_book_detail(app: AppHandle, bookId: Id) -> AppResult<WordBook> {
    let pool = app.state::<SqlitePool>();

    let query = r#"
        SELECT
            id,
            title,
            description,
            icon,
            icon_color,
            total_words,
            linked_plans,
            created_at,
            updated_at,
            last_used,
            deleted_at,
            status
        FROM word_books
        WHERE id = ?
    "#;

    let row = sqlx::query(query)
        .bind(bookId)
        .fetch_optional(pool.inner())
        .await?
        .ok_or_else(|| AppError::NotFound("单词本未找到".to_string()))?;

    // 获取主题标签
    let theme_tags_query = r#"
        SELECT tt.id, tt.name, tt.icon, tt.color, tt.created_at
        FROM theme_tags tt
        INNER JOIN word_book_theme_tags wbtt ON tt.id = wbtt.theme_tag_id
        WHERE wbtt.word_book_id = ?
        ORDER BY tt.name
    "#;

    let theme_rows = sqlx::query(theme_tags_query)
        .bind(bookId)
        .fetch_all(pool.inner())
        .await?;

    let theme_tags: Vec<ThemeTag> = theme_rows.into_iter().map(|row| {
        ThemeTag {
            id: row.get("id"),
            name: row.get("name"),
            icon: row.get("icon"),
            color: row.get("color"),
            created_at: row.get("created_at"),
        }
    }).collect();

    let word_book = WordBook {
        id: row.get("id"),
        title: row.get("title"),
        description: row.get("description"),
        icon: row.get("icon"),
        icon_color: row.get("icon_color"),
        total_words: row.get("total_words"),
        linked_plans: row.get("linked_plans"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        last_used: row.get("last_used"),
        deleted_at: row.get("deleted_at"),
        status: row.get("status"),
        theme_tags: if theme_tags.is_empty() { None } else { Some(theme_tags) },
    };

    Ok(word_book)
}

/// 获取所有主题标签
#[tauri::command]
pub async fn get_theme_tags(app: AppHandle) -> AppResult<Vec<ThemeTag>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_theme_tags", None);

    let query = r#"
        SELECT id, name, icon, color, created_at
        FROM theme_tags
        ORDER BY name
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool.inner())
        .await?;

    let theme_tags: Vec<ThemeTag> = rows.into_iter().map(|row| {
        ThemeTag {
            id: row.get("id"),
            name: row.get("name"),
            icon: row.get("icon"),
            color: row.get("color"),
            created_at: row.get("created_at"),
        }
    }).collect();

    logger.api_response("get_theme_tags", true, Some(&format!("Found {} theme tags", theme_tags.len())));
    Ok(theme_tags)
}

/// 获取单词本词性统计
#[tauri::command]
pub async fn get_word_book_statistics(app: AppHandle, bookId: Id) -> AppResult<WordTypeDistribution> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_word_book_statistics", Some(&format!("bookId: {}", bookId)));

    let query = r#"
        SELECT
            part_of_speech,
            COUNT(*) as count
        FROM words
        WHERE word_book_id = ? AND part_of_speech IS NOT NULL
        GROUP BY part_of_speech
    "#;

    let rows = sqlx::query(query)
        .bind(bookId)
        .fetch_all(pool.inner())
        .await?;

    let mut nouns = 0;
    let mut verbs = 0;
    let mut adjectives = 0;
    let mut others = 0;

    for row in rows {
        let pos: String = row.get("part_of_speech");
        let count: i32 = row.get("count");
        let pos_lower = pos.to_lowercase();

        // 根据词性分类统计 - 支持多种格式
        if pos_lower.starts_with("n.") ||
           pos_lower.starts_with("n ") ||
           pos_lower.contains("noun") ||
           pos_lower.contains("名词") {
            nouns += count;
        } else if pos_lower.starts_with("v.") ||
                  pos_lower.starts_with("v ") ||
                  pos_lower.contains("verb") ||
                  pos_lower.contains("动词") {
            verbs += count;
        } else if pos_lower.starts_with("adj") ||
                  pos_lower.contains("adjective") ||
                  pos_lower.contains("形容词") {
            adjectives += count;
        } else {
            others += count;
        }
    }

    let result = WordTypeDistribution {
        nouns,
        verbs,
        adjectives,
        others,
    };

    logger.api_response("get_word_book_statistics", true, Some(&format!("Statistics: nouns={}, verbs={}, adjectives={}, others={}", nouns, verbs, adjectives, others)));
    Ok(result)
}

/// 获取全局单词本统计
#[tauri::command]
pub async fn get_global_word_book_statistics(app: AppHandle) -> AppResult<WordBookStatistics> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_global_word_book_statistics", None);

    // 获取单词本总数
    let books_query = "SELECT COUNT(*) as count FROM word_books";
    let books_row = sqlx::query(books_query)
        .fetch_one(pool.inner())
        .await?;
    let total_books: i64 = books_row.get("count");

    // 获取单词总数
    let words_query = "SELECT COUNT(*) as count FROM words";
    let words_row = sqlx::query(words_query)
        .fetch_one(pool.inner())
        .await?;
    let total_words: i64 = words_row.get("count");

    // 获取词性统计
    let pos_query = r#"
        SELECT
            part_of_speech,
            COUNT(*) as count
        FROM words
        WHERE part_of_speech IS NOT NULL
        GROUP BY part_of_speech
    "#;
    let pos_rows = sqlx::query(pos_query)
        .fetch_all(pool.inner())
        .await?;

    let mut nouns = 0;
    let mut verbs = 0;
    let mut adjectives = 0;
    let mut others = 0;

    for row in pos_rows {
        let pos: String = row.get("part_of_speech");
        let count: i64 = row.get("count");

        match pos.as_str() {
            "noun" | "n." | "n" => nouns += count,
            "verb" | "v." | "v" => verbs += count,
            "adjective" | "adj." | "adj" => adjectives += count,
            _ => others += count,
        }
    }

    let word_types = WordTypeDistribution {
        nouns: nouns as i32,
        verbs: verbs as i32,
        adjectives: adjectives as i32,
        others: others as i32,
    };

    let result = WordBookStatistics {
        total_books: total_books as i32,
        total_words: total_words as i32,
        word_types,
    };

    logger.api_response("get_global_word_book_statistics", true, Some(&format!("Global stats: books={}, words={}", total_books, total_words)));
    Ok(result)
}

/// 更新所有单词本的单词数量
#[tauri::command]
pub async fn update_all_word_book_counts(app: AppHandle) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("update_all_word_book_counts", None);

    let update_query = r#"
        UPDATE word_books
        SET total_words = (
            SELECT COUNT(*)
            FROM words
            WHERE words.word_book_id = word_books.id
        )
    "#;

    sqlx::query(update_query)
        .execute(pool.inner())
        .await?;

    logger.api_response("update_all_word_book_counts", true, Some("Updated all word book counts"));
    Ok(())
}

/// 创建单词本
#[tauri::command]
pub async fn create_word_book(app: AppHandle, request: CreateWordBookRequest) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();

    // 开始事务
    let mut tx = pool.begin().await?;

    // 创建单词本
    let query = r#"
        INSERT INTO word_books (title, description, icon, icon_color, total_words, linked_plans)
        VALUES (?, ?, ?, ?, 0, 0)
    "#;

    let result = sqlx::query(query)
        .bind(&request.title)
        .bind(&request.description)
        .bind(&request.icon)
        .bind(&request.icon_color)
        .execute(&mut *tx)
        .await?;

    let book_id = result.last_insert_rowid();

    // 如果提供了主题标签ID，创建关联
    if let Some(theme_tag_ids) = &request.theme_tag_ids {
        for theme_tag_id in theme_tag_ids {
            let insert_query = r#"
                INSERT INTO word_book_theme_tags (word_book_id, theme_tag_id)
                VALUES (?, ?)
            "#;
            sqlx::query(insert_query)
                .bind(book_id)
                .bind(theme_tag_id)
                .execute(&mut *tx)
                .await?;
        }
    }

    // 提交事务
    tx.commit().await?;

    Ok(book_id)
}

/// 更新单词本
#[tauri::command]
pub async fn update_word_book(
    app: AppHandle,
    bookId: Id,
    request: UpdateWordBookRequest,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();

    // 开始事务
    let mut tx = pool.begin().await?;

    // 更新单词本基本信息
    let query = r#"
        UPDATE word_books
        SET title = COALESCE(?, title),
            description = COALESCE(?, description),
            icon = COALESCE(?, icon),
            icon_color = COALESCE(?, icon_color),
            status = COALESCE(?, status),
            updated_at = datetime('now')
        WHERE id = ?
    "#;

    sqlx::query(query)
        .bind(&request.title)
        .bind(&request.description)
        .bind(&request.icon)
        .bind(&request.icon_color)
        .bind(&request.status)
        .bind(bookId)
        .execute(&mut *tx)
        .await?;

    // 如果提供了主题标签ID，更新主题标签关联
    if let Some(theme_tag_ids) = &request.theme_tag_ids {
        // 删除现有的主题标签关联
        let delete_query = "DELETE FROM word_book_theme_tags WHERE word_book_id = ?";
        sqlx::query(delete_query)
            .bind(bookId)
            .execute(&mut *tx)
            .await?;

        // 添加新的主题标签关联
        for theme_tag_id in theme_tag_ids {
            let insert_query = r#"
                INSERT INTO word_book_theme_tags (word_book_id, theme_tag_id)
                VALUES (?, ?)
            "#;
            sqlx::query(insert_query)
                .bind(bookId)
                .bind(theme_tag_id)
                .execute(&mut *tx)
                .await?;
        }
    }

    // 提交事务
    tx.commit().await?;

    Ok(())
}

/// 删除单词本（软删除）
#[tauri::command]
pub async fn delete_word_book(app: AppHandle, bookId: Id) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("delete_word_book", Some(&format!("bookId: {}", bookId)));

    // 软删除单词本：设置 deleted_at 字段
    let query = "UPDATE word_books SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL";
    let result = sqlx::query(query)
        .bind(bookId)
        .execute(pool.inner())
        .await?;

    if result.rows_affected() == 0 {
        let error_msg = "单词本未找到或已被删除";
        logger.api_response("delete_word_book", false, Some(error_msg));
        return Err(AppError::NotFound(error_msg.to_string()));
    }

    logger.api_response("delete_word_book", true, Some("Word book soft deleted successfully"));
    Ok(())
}

/// 获取单词本中的单词
#[tauri::command]
pub async fn get_words_by_book(
    app: AppHandle,
    bookId: Id,
    page: Option<u32>,
    page_size: Option<u32>,
    search_term: Option<String>,
    part_of_speech: Option<String>,
) -> AppResult<PaginatedResponse<Word>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    let page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(20);
    let offset = (page - 1) * page_size;

    logger.api_request("get_words_by_book", Some(&format!(
        "bookId: {}, page: {}, page_size: {}, search_term: {:?}, part_of_speech: {:?}",
        bookId, page, page_size, search_term, part_of_speech
    )));

    // 构建查询，使用更简单的方法
    let (final_query, _final_params) = build_words_query(bookId, &search_term, &part_of_speech);

    let mut query_builder = sqlx::query(&final_query)
        .bind(bookId);

    // 绑定搜索参数（使用前匹配模式）
    if let Some(ref term) = search_term {
        if !term.trim().is_empty() {
            let search_pattern = format!("{}%", term.trim());
            query_builder = query_builder.bind(search_pattern);
        }
    }

    // 绑定词性参数
    if let Some(ref pos) = part_of_speech {
        if !pos.trim().is_empty() && pos != "all" {
            query_builder = query_builder.bind(pos.clone());
        }
    }

    // 绑定分页参数
    query_builder = query_builder
        .bind(page_size as i64)
        .bind(offset as i64);

    let rows = query_builder.fetch_all(pool.inner()).await?;

    let words: Vec<Word> = rows.into_iter().map(|row| {
        Word {
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
        }
    }).collect();

    // 构建计数查询
    let (count_query, _) = build_words_count_query(bookId, &search_term, &part_of_speech);
    let mut count_query_builder = sqlx::query(&count_query)
        .bind(bookId);

    // 绑定搜索参数（使用前匹配模式）
    if let Some(ref term) = search_term {
        if !term.trim().is_empty() {
            let search_pattern = format!("{}%", term.trim());
            count_query_builder = count_query_builder.bind(search_pattern);
        }
    }

    // 绑定词性参数
    if let Some(ref pos) = part_of_speech {
        if !pos.trim().is_empty() && pos != "all" {
            count_query_builder = count_query_builder.bind(pos.clone());
        }
    }

    let count_row = count_query_builder.fetch_one(pool.inner()).await?;
    let total: i64 = count_row.get("count");

    logger.api_response("get_words_by_book", true, Some(&format!("Found {} words, total: {}", words.len(), total)));

    Ok(PaginatedResponse::new(words, total as u32, page, page_size))
}

// 辅助函数：构建单词查询SQL
fn build_words_query(_book_id: Id, search_term: &Option<String>, part_of_speech: &Option<String>) -> (String, Vec<String>) {
    let mut where_conditions = vec!["word_book_id = ?".to_string()];
    let mut params = vec![];

    // 添加搜索条件（只在单词字段进行前匹配）
    if let Some(ref term) = search_term {
        if !term.trim().is_empty() {
            where_conditions.push("word LIKE ?".to_string());
            params.push("search".to_string()); // 占位符，实际绑定时会替换
        }
    }

    // 添加词性过滤条件
    if let Some(ref pos) = part_of_speech {
        if !pos.trim().is_empty() && pos != "all" {
            where_conditions.push("part_of_speech = ?".to_string());
            params.push("pos".to_string()); // 占位符，实际绑定时会替换
        }
    }

    let where_clause = where_conditions.join(" AND ");

    let query = format!(r#"
        SELECT
            id,
            word,
            meaning,
            description,
            ipa,
            syllables,
            phonics_segments,
            image_path,
            audio_path,
            part_of_speech,
            category_id,
            word_book_id,
            pos_abbreviation,
            pos_english,
            pos_chinese,
            phonics_rule,
            analysis_explanation,
            created_at,
            updated_at
        FROM words
        WHERE {}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    "#, where_clause);

    (query, params)
}

// 辅助函数：构建单词计数查询SQL
fn build_words_count_query(_book_id: Id, search_term: &Option<String>, part_of_speech: &Option<String>) -> (String, Vec<String>) {
    let mut where_conditions = vec!["word_book_id = ?".to_string()];
    let mut params = vec![];

    // 添加搜索条件（只在单词字段进行前匹配）
    if let Some(ref term) = search_term {
        if !term.trim().is_empty() {
            where_conditions.push("word LIKE ?".to_string());
            params.push("search".to_string()); // 占位符，实际绑定时会替换
        }
    }

    // 添加词性过滤条件
    if let Some(ref pos) = part_of_speech {
        if !pos.trim().is_empty() && pos != "all" {
            where_conditions.push("part_of_speech = ?".to_string());
            params.push("pos".to_string()); // 占位符，实际绑定时会替换
        }
    }

    let where_clause = where_conditions.join(" AND ");
    let query = format!("SELECT COUNT(*) as count FROM words WHERE {}", where_clause);

    (query, params)
}

/// 添加单词到单词本
#[tauri::command]
pub async fn add_word_to_book(
    app: AppHandle,
    bookId: Id,
    wordData: CreateWordRequest,
) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();
    
    let query = r#"
        INSERT INTO words (
            word_book_id, word, meaning, description, ipa,
            syllables, phonics_segments, part_of_speech, category_id,
            pos_abbreviation, pos_english, pos_chinese, phonics_rule,
            analysis_explanation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    "#;

    let result = sqlx::query(query)
        .bind(bookId)
        .bind(&wordData.word)
        .bind(&wordData.meaning)
        .bind(&wordData.description)
        .bind(&wordData.ipa)
        .bind(&wordData.syllables)
        .bind(&wordData.phonics_segments)
        .bind(&wordData.part_of_speech)
        .bind(wordData.category_id)
        .bind(&wordData.pos_abbreviation)
        .bind(&wordData.pos_english)
        .bind(&wordData.pos_chinese)
        .bind(&wordData.phonics_rule)
        .bind(&wordData.analysis_explanation)
        .execute(pool.inner())
        .await?;

    // 更新单词本的单词数量、最后使用时间和更新时间
    let update_query = "UPDATE word_books SET total_words = (SELECT COUNT(*) FROM words WHERE word_book_id = ?), last_used = datetime('now'), updated_at = datetime('now') WHERE id = ?";
    sqlx::query(update_query)
        .bind(bookId)
        .bind(bookId)
        .execute(pool.inner())
        .await?;

    Ok(result.last_insert_rowid())
}

/// 更新单词
#[tauri::command]
pub async fn update_word(
    app: AppHandle,
    wordId: Id,
    wordData: UpdateWordRequest,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();

    let query = r#"
        UPDATE words
        SET word = COALESCE(?, word),
            meaning = COALESCE(?, meaning),
            description = COALESCE(?, description),
            ipa = COALESCE(?, ipa),
            syllables = COALESCE(?, syllables),
            phonics_segments = COALESCE(?, phonics_segments),
            part_of_speech = COALESCE(?, part_of_speech),
            category_id = COALESCE(?, category_id),
            pos_abbreviation = COALESCE(?, pos_abbreviation),
            pos_english = COALESCE(?, pos_english),
            pos_chinese = COALESCE(?, pos_chinese),
            phonics_rule = COALESCE(?, phonics_rule),
            analysis_explanation = COALESCE(?, analysis_explanation),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    "#;

    sqlx::query(query)
        .bind(&wordData.word)
        .bind(&wordData.meaning)
        .bind(&wordData.description)
        .bind(&wordData.ipa)
        .bind(&wordData.syllables)
        .bind(&wordData.phonics_segments)
        .bind(&wordData.part_of_speech)
        .bind(wordData.category_id)
        .bind(&wordData.pos_abbreviation)
        .bind(&wordData.pos_english)
        .bind(&wordData.pos_chinese)
        .bind(&wordData.phonics_rule)
        .bind(&wordData.analysis_explanation)
        .bind(wordId)
        .execute(pool.inner())
        .await?;

    Ok(())
}

/// 删除单词
#[tauri::command]
pub async fn delete_word(app: AppHandle, wordId: Id) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();

    // 获取单词所属的单词本ID
    let book_query = "SELECT word_book_id FROM words WHERE id = ?";
    let book_row = sqlx::query(book_query)
        .bind(wordId)
        .fetch_optional(pool.inner())
        .await?;

    // 删除单词
    sqlx::query("DELETE FROM words WHERE id = ?")
        .bind(wordId)
        .execute(pool.inner())
        .await?;

    // 更新单词本的单词数量
    if let Some(row) = book_row {
        let book_id: i64 = row.get("word_book_id");
        let update_query = "UPDATE word_books SET total_words = (SELECT COUNT(*) FROM words WHERE word_book_id = ?) WHERE id = ?";
        sqlx::query(update_query)
            .bind(book_id)
            .bind(book_id)
            .execute(pool.inner())
            .await?;
    }

    Ok(())
}

/// 获取学习计划
#[tauri::command]
pub async fn get_study_plans(app: AppHandle) -> AppResult<Vec<StudyPlanWithProgress>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_plans", None);

    let query = r#"
        SELECT
            id,
            name,
            description,
            status,
            total_words,
            learned_words,
            accuracy_rate,
            mastery_level,
            intensity_level,
            study_period_days,
            review_frequency,
            start_date,
            end_date,
            ai_plan_data,
            created_at,
            updated_at,
            CASE
                WHEN total_words > 0 THEN (learned_words * 100.0 / total_words)
                ELSE 0.0
            END as progress_percentage
        FROM study_plans
        ORDER BY created_at DESC
    "#;

    match sqlx::query(query).fetch_all(pool.inner()).await {
        Ok(rows) => {
            logger.database_operation("SELECT", "study_plans", true, Some(&format!("Found {} records", rows.len())));

            let plans: Vec<StudyPlanWithProgress> = rows.into_iter().map(|row| {
                StudyPlanWithProgress {
                    id: row.get("id"),
                    name: row.get("name"),
                    description: row.get("description"),
                    status: row.get("status"),
                    total_words: row.get("total_words"),
                    learned_words: row.get("learned_words"),
                    accuracy_rate: row.get("accuracy_rate"),
                    mastery_level: row.get("mastery_level"),
                    intensity_level: row.get("intensity_level"),
                    study_period_days: row.get("study_period_days"),
                    review_frequency: row.get("review_frequency"),
                    start_date: row.get("start_date"),
                    end_date: row.get("end_date"),
                    ai_plan_data: row.get("ai_plan_data"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                    progress_percentage: row.get("progress_percentage"),
                }
            }).collect();

            logger.api_response("get_study_plans", true, Some(&format!("Returned {} study plans", plans.len())));
            Ok(plans)
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "study_plans", false, Some(&error_msg));
            logger.api_response("get_study_plans", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 获取单个学习计划详情
#[tauri::command]
pub async fn get_study_plan(app: AppHandle, plan_id: i64) -> AppResult<StudyPlanWithProgress> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let query = r#"
        SELECT
            id,
            name,
            description,
            status,
            total_words,
            learned_words,
            accuracy_rate,
            mastery_level,
            intensity_level,
            study_period_days,
            review_frequency,
            start_date,
            end_date,
            ai_plan_data,
            created_at,
            updated_at,
            CASE
                WHEN total_words > 0 THEN (CAST(learned_words AS REAL) / CAST(total_words AS REAL)) * 100.0
                ELSE 0.0
            END as progress_percentage
        FROM study_plans
        WHERE id = ?
    "#;

    match sqlx::query(query)
        .bind(plan_id)
        .fetch_optional(pool.inner())
        .await
    {
        Ok(Some(row)) => {
            logger.database_operation("SELECT", "study_plans", true, Some(&format!("Found plan with ID: {}", plan_id)));

            let plan = StudyPlanWithProgress {
                id: row.get("id"),
                name: row.get("name"),
                description: row.get("description"),
                status: row.get("status"),
                total_words: row.get("total_words"),
                learned_words: row.get("learned_words"),
                accuracy_rate: row.get("accuracy_rate"),
                mastery_level: row.get("mastery_level"),
                intensity_level: row.get("intensity_level"),
                study_period_days: row.get("study_period_days"),
                review_frequency: row.get("review_frequency"),
                start_date: row.get("start_date"),
                end_date: row.get("end_date"),
                ai_plan_data: row.get("ai_plan_data"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                progress_percentage: row.get("progress_percentage"),
            };

            logger.api_response("get_study_plan", true, Some(&format!("Returned plan: {}", plan.name)));
            Ok(plan)
        }
        Ok(None) => {
            let error_msg = format!("Study plan with ID {} not found", plan_id);
            logger.api_response("get_study_plan", false, Some(&error_msg));
            Err(AppError::NotFound(error_msg))
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "study_plans", false, Some(&error_msg));
            logger.api_response("get_study_plan", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 更新学习计划
#[tauri::command]
pub async fn update_study_plan(
    app: AppHandle,
    plan_id: i64,
    updates: serde_json::Value
) -> AppResult<bool> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("update_study_plan", Some(&format!("plan_id: {}, updates: {}", plan_id, updates)));

    // 构建动态更新查询
    let mut set_clauses = Vec::new();
    let mut values: Vec<Box<dyn sqlx::Encode<'_, sqlx::Sqlite> + Send + Sync>> = Vec::new();

    if let Some(name) = updates.get("name").and_then(|v| v.as_str()) {
        set_clauses.push("name = ?");
        values.push(Box::new(name.to_string()));
    }

    if let Some(description) = updates.get("description").and_then(|v| v.as_str()) {
        set_clauses.push("description = ?");
        values.push(Box::new(description.to_string()));
    }

    if let Some(status) = updates.get("status").and_then(|v| v.as_str()) {
        set_clauses.push("status = ?");
        values.push(Box::new(status.to_string()));
    }

    if let Some(intensity_level) = updates.get("intensity_level").and_then(|v| v.as_str()) {
        set_clauses.push("intensity_level = ?");
        values.push(Box::new(intensity_level.to_string()));
    }

    if let Some(review_frequency) = updates.get("review_frequency").and_then(|v| v.as_i64()) {
        set_clauses.push("review_frequency = ?");
        values.push(Box::new(review_frequency as i32));
    }

    if set_clauses.is_empty() {
        let error_msg = "No valid fields to update";
        logger.api_response("update_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 添加 updated_at
    set_clauses.push("updated_at = ?");
    values.push(Box::new(chrono::Utc::now().to_rfc3339()));

    let query = format!(
        "UPDATE study_plans SET {} WHERE id = ?",
        set_clauses.join(", ")
    );

    // 创建查询并绑定参数
    let mut query_builder: Query<'_, sqlx::Sqlite, _> = sqlx::query(&query);
    for value in values {
        // 这里需要使用不同的方法来绑定动态参数
        // 由于 sqlx 的限制，我们使用简化的方法
    }

    // 简化的更新方法 - 只支持状态更新
    if let Some(status) = updates.get("status").and_then(|v| v.as_str()) {
        let simple_query = "UPDATE study_plans SET status = ?, updated_at = ? WHERE id = ?";

        match sqlx::query(simple_query)
            .bind(status)
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(plan_id)
            .execute(pool.inner())
            .await
        {
            Ok(result) => {
                if result.rows_affected() > 0 {
                    logger.database_operation("UPDATE", "study_plans", true, Some(&format!("Updated plan {} status to {}", plan_id, status)));
                    logger.api_response("update_study_plan", true, Some(&format!("Updated plan status to {}", status)));
                    Ok(true)
                } else {
                    let error_msg = format!("Study plan with ID {} not found", plan_id);
                    logger.api_response("update_study_plan", false, Some(&error_msg));
                    Err(AppError::NotFound(error_msg))
                }
            }
            Err(e) => {
                let error_msg = e.to_string();
                logger.database_operation("UPDATE", "study_plans", false, Some(&error_msg));
                logger.api_response("update_study_plan", false, Some(&error_msg));
                Err(AppError::DatabaseError(error_msg))
            }
        }
    } else {
        let error_msg = "Only status updates are currently supported";
        logger.api_response("update_study_plan", false, Some(error_msg));
        Err(AppError::ValidationError(error_msg.to_string()))
    }
}

/// 创建学习计划
#[tauri::command]
pub async fn create_study_plan(app: AppHandle, request: CreateStudyPlanRequest) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("create_study_plan", Some(&format!("name: {}, words: {}", request.name, request.word_ids.len())));

    // 验证输入
    if request.name.trim().is_empty() {
        let error_msg = "Study plan name cannot be empty";
        logger.api_response("create_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if request.word_ids.is_empty() {
        let error_msg = "Study plan must contain at least one word";
        logger.api_response("create_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 验证单词是否存在 - 使用简单的方法逐个检查
    let mut valid_word_count = 0;
    for word_id in &request.word_ids {
        let word_check_query = "SELECT COUNT(*) as count FROM words WHERE id = ?";
        match sqlx::query(word_check_query)
            .bind(word_id)
            .fetch_one(pool.inner())
            .await
        {
            Ok(row) => {
                let count: i64 = row.get("count");
                if count > 0 {
                    valid_word_count += 1;
                }
            }
            Err(e) => {
                let error_msg = format!("Failed to validate word {}: {}", word_id, e);
                logger.database_operation("SELECT", "words", false, Some(&error_msg));
                logger.api_response("create_study_plan", false, Some(&error_msg));
                return Err(AppError::DatabaseError(error_msg));
            }
        }
    }

    if valid_word_count != request.word_ids.len() {
        let error_msg = format!("Some words do not exist. Expected: {}, Found: {}", request.word_ids.len(), valid_word_count);
        logger.api_response("create_study_plan", false, Some(&error_msg));
        return Err(AppError::ValidationError(error_msg));
    }

    logger.database_operation("SELECT", "words", true, Some(&format!("Validated {} words", valid_word_count)));

    // 创建学习计划
    let insert_query = r#"
        INSERT INTO study_plans (
            name,
            description,
            status,
            total_words,
            learned_words,
            accuracy_rate,
            mastery_level,
            created_at,
            updated_at
        ) VALUES (?, ?, 'active', ?, 0, 0.0, ?, datetime('now'), datetime('now'))
    "#;

    let mastery_level = request.mastery_level.unwrap_or(1);
    let total_words = request.word_ids.len() as i32;

    let result = match sqlx::query(insert_query)
        .bind(&request.name)
        .bind(&request.description)
        .bind(total_words)
        .bind(mastery_level)
        .execute(pool.inner())
        .await
    {
        Ok(result) => {
            logger.database_operation("INSERT", "study_plans", true, Some(&format!("Created plan with {} words", total_words)));
            result
        }
        Err(e) => {
            let error_msg = format!("Failed to create study plan: {}", e);
            logger.database_operation("INSERT", "study_plans", false, Some(&error_msg));
            logger.api_response("create_study_plan", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    let plan_id = result.last_insert_rowid();

    // 创建学习进度记录
    let progress_query = r#"
        INSERT INTO study_plan_words (
            word_id,
            plan_id,
            learned,
            correct_count,
            total_attempts,
            mastery_score,
            last_studied,
            next_review
        ) VALUES (?, ?, false, 0, 0, 0.0, NULL, NULL)
    "#;

    for word_id in &request.word_ids {
        if let Err(e) = sqlx::query(progress_query)
            .bind(word_id)
            .bind(plan_id)
            .execute(pool.inner())
            .await
        {
            let error_msg = format!("Failed to create progress record for word {}: {}", word_id, e);
            logger.database_operation("INSERT", "study_plan_words", false, Some(&error_msg));
            logger.api_response("create_study_plan", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    }

    logger.database_operation("INSERT", "study_plan_words", true, Some(&format!("Created {} progress records", request.word_ids.len())));
    logger.api_response("create_study_plan", true, Some(&format!("Created study plan with ID: {}", plan_id)));

    Ok(plan_id)
}

/// 获取学习统计
#[tauri::command]
pub async fn get_study_statistics(app: AppHandle) -> AppResult<StudyStatistics> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_statistics", None);

    // 获取总学习单词数
    let total_query = "SELECT COALESCE(SUM(learned_words), 0) as total FROM study_plans";
    let total_row = match sqlx::query(total_query).fetch_one(pool.inner()).await {
        Ok(row) => {
            logger.database_operation("SELECT", "study_plans", true, Some("Total words query successful"));
            row
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "study_plans", false, Some(&error_msg));
            logger.api_response("get_study_statistics", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };
    let total_words_learned: i32 = total_row.get("total");

    // 获取平均正确率
    let accuracy_query = "SELECT COALESCE(AVG(accuracy_rate), 0.0) as avg_accuracy FROM study_plans WHERE learned_words > 0";
    let accuracy_row = match sqlx::query(accuracy_query).fetch_one(pool.inner()).await {
        Ok(row) => {
            logger.database_operation("SELECT", "study_plans", true, Some("Accuracy query successful"));
            row
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "study_plans", false, Some(&error_msg));
            logger.api_response("get_study_statistics", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };
    let average_accuracy: f64 = accuracy_row.get("avg_accuracy");

    // 简化的统计数据
    let streak_days = 7;
    let completion_query = r#"
        SELECT
            CASE
                WHEN COUNT(*) > 0 THEN (COUNT(CASE WHEN status = 'completed' THEN 1 END) * 100.0 / COUNT(*))
                ELSE 0.0
            END as completion_rate
        FROM study_plans
    "#;
    let completion_row = match sqlx::query(completion_query).fetch_one(pool.inner()).await {
        Ok(row) => {
            logger.database_operation("SELECT", "study_plans", true, Some("Completion rate query successful"));
            row
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "study_plans", false, Some(&error_msg));
            logger.api_response("get_study_statistics", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };
    let completion_rate: f64 = completion_row.get("completion_rate");

    let weekly_progress = vec![15, 22, 18, 28, 35, 20, 25];

    let result = StudyStatistics {
        total_words_learned,
        average_accuracy,
        streak_days,
        completion_rate,
        weekly_progress,
    };

    logger.api_response("get_study_statistics", true, Some("Statistics retrieved successfully"));
    Ok(result)
}

/// 获取系统日志
#[tauri::command]
pub async fn get_system_logs(app: AppHandle) -> AppResult<Vec<String>> {
    let logger = app.state::<Logger>();

    logger.api_request("get_system_logs", None);

    // 获取应用数据目录
    let app_data_dir = app.path()
        .app_data_dir()
        .map_err(|e| AppError::DatabaseError(format!("Failed to get app data dir: {}", e)))?;

    let log_file_path = app_data_dir.join("logs").join("app.log");

    match std::fs::read_to_string(&log_file_path) {
        Ok(content) => {
            let lines: Vec<String> = content
                .lines()
                .rev() // 最新的日志在前
                .take(100) // 只取最近的100条
                .map(|s| s.to_string())
                .collect();

            logger.api_response("get_system_logs", true, Some(&format!("Retrieved {} log lines", lines.len())));
            Ok(lines)
        }
        Err(e) => {
            let error_msg = format!("Failed to read log file: {}", e);
            logger.api_response("get_system_logs", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

// 移除了传统词汇分析的命令处理器，只保留自然拼读分析

/// 从分析结果创建单词本
#[tauri::command]
pub async fn create_word_book_from_analysis(
    app: AppHandle,
    request: CreateWordBookFromAnalysisRequest,
) -> AppResult<WordSaveResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("create_word_book_from_analysis", Some(&format!("title: {}, words: {}", request.title, request.words.len())));

    // 验证输入
    if request.title.trim().is_empty() {
        let error_msg = "Word book title cannot be empty";
        logger.api_response("create_word_book_from_analysis", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if request.words.is_empty() {
        let error_msg = "Word book must contain at least one word";
        logger.api_response("create_word_book_from_analysis", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 1. 内部去重：移除列表中的重复单词
    let mut unique_words = Vec::new();
    let mut seen_words = std::collections::HashSet::new();

    for word in &request.words {
        let word_lower = word.word.to_lowercase();
        if !seen_words.contains(&word_lower) {
            seen_words.insert(word_lower);
            unique_words.push(word.clone());
        }
    }

    logger.info("DEDUPLICATION", &format!("Internal dedup: {} -> {} words", request.words.len(), unique_words.len()));

    // 2. 数据库查重：分类处理新增和更新的单词
    let book_id_for_check = request.book_id.unwrap_or(0); // 如果是新建单词本，book_id为0，不会有重复
    let mut words_to_add = Vec::new();
    let mut words_to_update = Vec::new();

    if book_id_for_check > 0 {
        // 如果是向现有单词本添加单词，需要检查数据库重复
        for word in &unique_words {
            let check_query = "SELECT id FROM words WHERE word_book_id = ? AND LOWER(word) = LOWER(?)";
            let existing_word: Option<(i64,)> = match sqlx::query_as(check_query)
                .bind(book_id_for_check)
                .bind(&word.word)
                .fetch_optional(pool.inner())
                .await
            {
                Ok(result) => result,
                Err(e) => {
                    let error_msg = format!("Failed to check word duplication: {}", e);
                    logger.api_response("create_word_book_from_analysis", false, Some(&error_msg));
                    return Err(AppError::DatabaseError(error_msg));
                }
            };

            if let Some((existing_id,)) = existing_word {
                // 单词已存在，标记为更新
                words_to_update.push((existing_id, word.clone()));
                logger.info("DEDUPLICATION", &format!("Will update existing word: {} (ID: {})", word.word, existing_id));
            } else {
                // 单词不存在，标记为新增
                words_to_add.push(word.clone());
            }
        }

        logger.info("DEDUPLICATION", &format!("Database check: {} words -> {} to add, {} to update",
            unique_words.len(), words_to_add.len(), words_to_update.len()));
    } else {
        // 新建单词本，所有单词都是新增
        words_to_add = unique_words;
    }

    if words_to_add.is_empty() && words_to_update.is_empty() {
        let error_msg = "No words to process after deduplication";
        logger.api_response("create_word_book_from_analysis", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 确定目标单词本ID
    let book_id = if let Some(existing_book_id) = request.book_id {
        // 向现有单词本添加单词
        logger.info("WORD_BOOK", &format!("Processing {} words for existing book {} ({} to add, {} to update)",
            words_to_add.len() + words_to_update.len(), existing_book_id, words_to_add.len(), words_to_update.len()));
        existing_book_id
    } else {
        // 创建新单词本
        let insert_query = r#"
            INSERT INTO word_books (
                title,
                description,
                icon,
                icon_color,
                total_words,
                linked_plans,
                created_at,
                last_used,
                status
            ) VALUES (?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'), ?)
        "#;

        let total_words = words_to_add.len() as i32;
        let icon = request.icon.unwrap_or_else(|| "📚".to_string());
        let icon_color = request.icon_color.unwrap_or_else(|| "#3B82F6".to_string());
        let status = request.status.unwrap_or_else(|| "normal".to_string());

        let result = match sqlx::query(insert_query)
            .bind(&request.title)
            .bind(&request.description)
            .bind(&icon)
            .bind(&icon_color)
            .bind(total_words)
            .bind(&status)
            .execute(pool.inner())
            .await
        {
            Ok(result) => {
                logger.database_operation("INSERT", "word_books", true, Some(&format!("Created word book with {} words", total_words)));
                result
            }
            Err(e) => {
                let error_msg = format!("Failed to create word book: {}", e);
                logger.database_operation("INSERT", "word_books", false, Some(&error_msg));
                logger.api_response("create_word_book_from_analysis", false, Some(&error_msg));
                return Err(AppError::DatabaseError(error_msg));
            }
        };

        let new_book_id = result.last_insert_rowid();

        // 如果是新创建的单词本且提供了主题标签ID，创建关联
        if let Some(theme_tag_ids) = &request.theme_tag_ids {
            for theme_tag_id in theme_tag_ids {
                let insert_theme_query = r#"
                    INSERT INTO word_book_theme_tags (word_book_id, theme_tag_id)
                    VALUES (?, ?)
                "#;
                if let Err(e) = sqlx::query(insert_theme_query)
                    .bind(new_book_id)
                    .bind(theme_tag_id)
                    .execute(pool.inner())
                    .await
                {
                    let error_msg = format!("Failed to create theme tag association: {}", e);
                    logger.database_operation("INSERT", "word_book_theme_tags", false, Some(&error_msg));
                    // 不返回错误，因为单词本已经创建成功
                    logger.info("WORD_BOOK", &format!("Warning: Failed to associate theme tag {} with book {}: {}", theme_tag_id, new_book_id, e));
                } else {
                    logger.database_operation("INSERT", "word_book_theme_tags", true, Some(&format!("Associated theme tag {} with book {}", theme_tag_id, new_book_id)));
                }
            }
        }

        new_book_id
    };

    // 统计计数器
    let mut added_count = 0;
    let mut updated_count = 0;

    // 1. 添加新单词
    let word_insert_query = r#"
        INSERT INTO words (
            word,
            meaning,
            ipa,
            syllables,
            part_of_speech,
            pos_abbreviation,
            pos_english,
            pos_chinese,
            phonics_rule,
            analysis_explanation,
            word_book_id,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    "#;

    for analyzed_word in &words_to_add {
        if let Err(e) = sqlx::query(word_insert_query)
            .bind(&analyzed_word.word)
            .bind(&analyzed_word.meaning)
            .bind(&analyzed_word.ipa)
            .bind(&analyzed_word.syllables)
            .bind(&analyzed_word.part_of_speech)
            .bind(&analyzed_word.pos_abbreviation)
            .bind(&analyzed_word.pos_english)
            .bind(&analyzed_word.pos_chinese)
            .bind(&analyzed_word.phonics_rule)
            .bind(&analyzed_word.analysis_explanation)
            .bind(book_id)
            .execute(pool.inner())
            .await
        {
            let error_msg = format!("Failed to insert word '{}': {}", analyzed_word.word, e);
            logger.database_operation("INSERT", "words", false, Some(&error_msg));
            logger.api_response("create_word_book_from_analysis", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        } else {
            added_count += 1;
        }
    }

    // 2. 更新现有单词
    let word_update_query = r#"
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

    for (existing_id, analyzed_word) in &words_to_update {
        if let Err(e) = sqlx::query(word_update_query)
            .bind(&analyzed_word.meaning)
            .bind(&analyzed_word.ipa)
            .bind(&analyzed_word.syllables)
            .bind(&analyzed_word.part_of_speech)
            .bind(&analyzed_word.pos_abbreviation)
            .bind(&analyzed_word.pos_english)
            .bind(&analyzed_word.pos_chinese)
            .bind(&analyzed_word.phonics_rule)
            .bind(&analyzed_word.analysis_explanation)
            .bind(existing_id)
            .execute(pool.inner())
            .await
        {
            let error_msg = format!("Failed to update word '{}': {}", analyzed_word.word, e);
            logger.database_operation("UPDATE", "words", false, Some(&error_msg));
            logger.api_response("create_word_book_from_analysis", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        } else {
            updated_count += 1;
        }
    }

    // 更新单词本的实际单词数量、最后使用时间和更新时间
    let update_count_query = "UPDATE word_books SET total_words = (SELECT COUNT(*) FROM words WHERE word_book_id = ?), last_used = datetime('now'), updated_at = datetime('now') WHERE id = ?";
    if let Err(e) = sqlx::query(update_count_query)
        .bind(book_id)
        .bind(book_id)
        .execute(pool.inner())
        .await
    {
        let error_msg = format!("Failed to update word count, last_used and updated_at: {}", e);
        logger.database_operation("UPDATE", "word_books", false, Some(&error_msg));
        // 不返回错误，因为单词本和单词都已经创建成功
        logger.api_response("create_word_book_from_analysis", true, Some(&format!("Processed words for book ID: {} (warning: count update failed)", book_id)));
    } else {
        logger.database_operation("UPDATE", "word_books", true, Some("Updated word count, last_used and updated_at"));
        logger.database_operation("INSERT/UPDATE", "words", true, Some(&format!("Added {} words, updated {} words", added_count, updated_count)));
        logger.api_response("create_word_book_from_analysis", true, Some(&format!("Processed words for book ID: {}", book_id)));
    }

    Ok(WordSaveResult {
        book_id,
        added_count,
        updated_count,
        skipped_count: 0, // 现在不跳过任何单词
    })
}

/// 获取分析进度
#[tauri::command]
pub async fn get_analysis_progress(app: AppHandle) -> AppResult<Option<AnalysisProgress>> {
    use crate::ai_service::get_global_progress_manager;

    let logger = app.state::<Logger>();

    logger.api_request("get_analysis_progress", None);

    let progress = get_global_progress_manager().get_progress();

    logger.api_response("get_analysis_progress", true, Some(&format!("Progress: {:?}", progress.is_some())));

    Ok(progress)
}

/// 清除分析进度
#[tauri::command]
pub async fn clear_analysis_progress(app: AppHandle) -> AppResult<()> {
    use crate::ai_service::get_global_progress_manager;

    let logger = app.state::<Logger>();

    logger.api_request("clear_analysis_progress", None);

    get_global_progress_manager().clear_progress();

    logger.api_response("clear_analysis_progress", true, Some("Progress cleared"));

    Ok(())
}

/// 取消分析
#[tauri::command]
pub async fn cancel_analysis(app: AppHandle) -> AppResult<()> {
    use crate::ai_service::get_global_progress_manager;

    let logger = app.state::<Logger>();

    logger.api_request("cancel_analysis", None);

    get_global_progress_manager().cancel_analysis();

    logger.api_response("cancel_analysis", true, Some("Analysis cancelled"));

    Ok(())
}

// ==================== 学习计划AI规划相关命令 ====================

/// 生成学习计划AI规划
#[tauri::command]
pub async fn generate_study_plan_schedule(
    app: AppHandle,
    request: StudyPlanScheduleRequest,
) -> AppResult<StudyPlanAIResult> {
    use crate::ai_service::AIService;
    use crate::types::study::{StudyPlanAIParams, StudyWordInfo};

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("generate_study_plan_schedule", Some(&format!(
        "name: {}, intensity: {}, period: {} days, wordbooks: {:?}",
        request.name, request.intensity_level, request.study_period_days, request.wordbook_ids
    )));

    // 验证输入参数
    if request.name.trim().is_empty() {
        let error_msg = "Study plan name cannot be empty";
        logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if !["easy", "normal", "intensive"].contains(&request.intensity_level.as_str()) {
        let error_msg = "Invalid intensity level";
        logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if ![7, 14, 28].contains(&request.study_period_days) {
        let error_msg = "Invalid study period days, must be 7, 14, or 28";
        logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if request.wordbook_ids.is_empty() {
        let error_msg = "At least one wordbook must be selected";
        logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 获取选中单词本的所有单词
    let mut all_words = Vec::new();
    for wordbook_id in &request.wordbook_ids {
        let query = r#"
            SELECT id, word, word_book_id
            FROM words
            WHERE word_book_id = ? AND word_book_id IN (
                SELECT id FROM word_books WHERE status = 'normal'
            )
            ORDER BY id
        "#;

        match sqlx::query(query)
            .bind(wordbook_id)
            .fetch_all(pool.inner())
            .await
        {
            Ok(rows) => {
                for row in rows {
                    all_words.push(StudyWordInfo {
                        word: row.get("word"),
                        word_id: row.get::<i64, _>("id").to_string(),
                        wordbook_id: row.get::<i64, _>("word_book_id").to_string(),
                    });
                }
            }
            Err(e) => {
                let error_msg = format!("Failed to fetch words from wordbook {}: {}", wordbook_id, e);
                logger.database_operation("SELECT", "words", false, Some(&error_msg));
                logger.api_response("generate_study_plan_schedule", false, Some(&error_msg));
                return Err(AppError::DatabaseError(error_msg));
            }
        }
    }

    if all_words.is_empty() {
        let error_msg = "No words found in selected wordbooks";
        logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    logger.info("STUDY_PLAN_SCHEDULE", &format!("Collected {} words from {} wordbooks", all_words.len(), request.wordbook_ids.len()));

    // 准备AI规划参数
    let ai_params = StudyPlanAIParams {
        intensity_level: request.intensity_level.clone(),
        total_words: all_words.len() as i32,
        period_days: request.study_period_days,
        review_frequency: request.review_frequency,
        start_date: request.start_date.clone(),
        word_list: all_words,
    };

    // 获取AI模型配置
    let model_config = if let Some(model_id) = request.model_id {
        // 使用指定的模型
        let query = r#"
            SELECT m.*, p.name as provider_name, p.base_url, p.api_key
            FROM ai_models m
            JOIN ai_providers p ON m.provider_id = p.id
            WHERE m.id = ? AND m.is_active = 1 AND p.is_active = 1
        "#;

        match sqlx::query(query)
            .bind(model_id)
            .fetch_optional(pool.inner())
            .await
        {
            Ok(Some(row)) => {
                use crate::types::ai_model::AIModelConfig;
                use crate::types::ai_model::AIProvider;

                AIModelConfig {
                    id: row.get("id"),
                    provider: AIProvider {
                        id: row.get("provider_id"),
                        name: row.get("provider_name"),
                        display_name: row.get("provider_name"), // 使用name作为display_name
                        base_url: row.get("base_url"),
                        api_key: row.get("api_key"),
                        description: None,
                        is_active: true,
                        created_at: row.get("created_at"),
                        updated_at: row.get("updated_at"),
                    },
                    name: row.get("name"),
                    display_name: row.get("display_name"),
                    model_id: row.get("model_id"),
                    description: row.get("description"),
                    max_tokens: row.get("max_tokens"),
                    temperature: row.get("temperature"),
                    is_active: row.get("is_active"),
                    is_default: row.get("is_default"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
            }
            Ok(None) => {
                let error_msg = format!("AI model with id {} not found or inactive", model_id);
                logger.api_response("generate_study_plan_schedule", false, Some(&error_msg));
                return Err(AppError::ValidationError(error_msg));
            }
            Err(e) => {
                let error_msg = format!("Failed to fetch AI model: {}", e);
                logger.database_operation("SELECT", "ai_models", false, Some(&error_msg));
                logger.api_response("generate_study_plan_schedule", false, Some(&error_msg));
                return Err(AppError::DatabaseError(error_msg));
            }
        }
    } else {
        // 使用默认模型
        let query = r#"
            SELECT m.*, p.name as provider_name, p.base_url, p.api_key
            FROM ai_models m
            JOIN ai_providers p ON m.provider_id = p.id
            WHERE m.is_default = 1 AND m.is_active = 1 AND p.is_active = 1
            LIMIT 1
        "#;

        match sqlx::query(query).fetch_optional(pool.inner()).await {
            Ok(Some(row)) => {
                use crate::types::ai_model::AIModelConfig;
                use crate::types::ai_model::AIProvider;

                AIModelConfig {
                    id: row.get("id"),
                    provider: AIProvider {
                        id: row.get("provider_id"),
                        name: row.get("provider_name"),
                        display_name: row.get("provider_name"),
                        base_url: row.get("base_url"),
                        api_key: row.get("api_key"),
                        description: None,
                        is_active: true,
                        created_at: row.get("created_at"),
                        updated_at: row.get("updated_at"),
                    },
                    name: row.get("name"),
                    display_name: row.get("display_name"),
                    model_id: row.get("model_id"),
                    description: row.get("description"),
                    max_tokens: row.get("max_tokens"),
                    temperature: row.get("temperature"),
                    is_active: row.get("is_active"),
                    is_default: row.get("is_default"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
            }
            Ok(None) => {
                let error_msg = "No default AI model found";
                logger.api_response("generate_study_plan_schedule", false, Some(error_msg));
                return Err(AppError::ValidationError(error_msg.to_string()));
            }
            Err(e) => {
                let error_msg = format!("Failed to fetch default AI model: {}", e);
                logger.database_operation("SELECT", "ai_models", false, Some(&error_msg));
                logger.api_response("generate_study_plan_schedule", false, Some(&error_msg));
                return Err(AppError::DatabaseError(error_msg));
            }
        }
    };

    // 检查API Key是否有效
    if model_config.provider.api_key.is_empty() || model_config.provider.api_key == "PLEASE_SET_YOUR_API_KEY" {
        let error_msg = format!("AI模型 '{}' 的API Key未配置。请前往设置页面配置有效的API Key。", model_config.display_name);
        logger.api_response("generate_study_plan_schedule", false, Some(&error_msg));
        return Err(AppError::ValidationError(error_msg));
    }

    // 创建AI服务并调用学习计划规划
    let ai_service = match AIService::from_model_config(&model_config) {
        Ok(service) => service,
        Err(e) => {
            let error_msg = format!("Failed to create AI service: {}", e);
            logger.api_response("generate_study_plan_schedule", false, Some(&error_msg));
            return Err(AppError::InternalError(error_msg));
        }
    };

    // 调用AI服务生成学习计划
    match ai_service.generate_study_plan_schedule(ai_params, &model_config, &logger).await {
        Ok(result) => {
            logger.api_response("generate_study_plan_schedule", true, Some(&format!(
                "Generated schedule with {} daily plans", result.daily_plans.len()
            )));
            Ok(result)
        }
        Err(e) => {
            let error_msg = format!("Failed to generate study plan schedule: {}", e);
            logger.api_response("generate_study_plan_schedule", false, Some(&error_msg));
            Err(AppError::InternalError(error_msg))
        }
    }
}

/// 创建带AI规划的学习计划
#[tauri::command]
pub async fn create_study_plan_with_schedule(
    app: AppHandle,
    request: CreateStudyPlanWithScheduleRequest,
) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("create_study_plan_with_schedule", Some(&format!(
        "name: {}, status: {:?}, period: {} days",
        request.name, request.status, request.study_period_days
    )));

    // 验证输入
    if request.name.trim().is_empty() {
        let error_msg = "Study plan name cannot be empty";
        logger.api_response("create_study_plan_with_schedule", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 解析AI规划数据
    let ai_result: StudyPlanAIResult = match serde_json::from_str(&request.ai_plan_data) {
        Ok(result) => result,
        Err(e) => {
            let error_msg = format!("Invalid AI plan data: {}", e);
            logger.api_response("create_study_plan_with_schedule", false, Some(&error_msg));
            return Err(AppError::ValidationError(error_msg));
        }
    };

    // 开始数据库事务
    let mut tx = match pool.inner().begin().await {
        Ok(tx) => tx,
        Err(e) => {
            let error_msg = format!("Failed to start transaction: {}", e);
            logger.database_operation("BEGIN", "transaction", false, Some(&error_msg));
            logger.api_response("create_study_plan_with_schedule", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    // 创建学习计划
    let insert_plan_query = r#"
        INSERT INTO study_plans (
            name, description, status, total_words, learned_words, accuracy_rate, mastery_level,
            intensity_level, study_period_days, review_frequency, start_date, end_date, ai_plan_data,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, 0.0, 1, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    "#;

    let status = request.status.as_deref().unwrap_or("active");
    let total_words = ai_result.plan_metadata.total_words;

    let plan_result = match sqlx::query(insert_plan_query)
        .bind(&request.name)
        .bind(&request.description)
        .bind(status)
        .bind(total_words)
        .bind(&request.intensity_level)
        .bind(request.study_period_days)
        .bind(request.review_frequency)
        .bind(&request.start_date)
        .bind(&request.end_date)
        .bind(&request.ai_plan_data)
        .execute(&mut *tx)
        .await
    {
        Ok(result) => result,
        Err(e) => {
            let _ = tx.rollback().await;
            let error_msg = format!("Failed to create study plan: {}", e);
            logger.database_operation("INSERT", "study_plans", false, Some(&error_msg));
            logger.api_response("create_study_plan_with_schedule", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    let plan_id = plan_result.last_insert_rowid();
    logger.database_operation("INSERT", "study_plans", true, Some(&format!("Created plan with ID: {}", plan_id)));

    // 创建学习计划日程
    for daily_plan in &ai_result.daily_plans {
        let insert_schedule_query = r#"
            INSERT INTO study_plan_schedules (plan_id, day_number, schedule_date, created_at, updated_at)
            VALUES (?, ?, ?, datetime('now'), datetime('now'))
        "#;

        let schedule_result = match sqlx::query(insert_schedule_query)
            .bind(plan_id)
            .bind(daily_plan.day)
            .bind(&daily_plan.date)
            .execute(&mut *tx)
            .await
        {
            Ok(result) => result,
            Err(e) => {
                let _ = tx.rollback().await;
                let error_msg = format!("Failed to create schedule for day {}: {}", daily_plan.day, e);
                logger.database_operation("INSERT", "study_plan_schedules", false, Some(&error_msg));
                logger.api_response("create_study_plan_with_schedule", false, Some(&error_msg));
                return Err(AppError::DatabaseError(error_msg));
            }
        };

        let schedule_id = schedule_result.last_insert_rowid();

        // 创建日程单词
        for word in &daily_plan.words {
            let insert_word_query = r#"
                INSERT INTO study_plan_schedule_words (
                    schedule_id, word_id, wordbook_id, is_review, review_count,
                    priority, difficulty_level, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            "#;

            let word_id: i64 = match word.word_id.parse() {
                Ok(id) => id,
                Err(e) => {
                    let _ = tx.rollback().await;
                    let error_msg = format!("Invalid word_id format: {}", e);
                    logger.api_response("create_study_plan_with_schedule", false, Some(&error_msg));
                    return Err(AppError::ValidationError(error_msg));
                }
            };

            let wordbook_id: i64 = match word.wordbook_id.parse() {
                Ok(id) => id,
                Err(e) => {
                    let _ = tx.rollback().await;
                    let error_msg = format!("Invalid wordbook_id format: {}", e);
                    logger.api_response("create_study_plan_with_schedule", false, Some(&error_msg));
                    return Err(AppError::ValidationError(error_msg));
                }
            };

            if let Err(e) = sqlx::query(insert_word_query)
                .bind(schedule_id)
                .bind(word_id)
                .bind(wordbook_id)
                .bind(word.is_review)
                .bind(word.review_count)
                .bind(&word.priority)
                .bind(word.difficulty_level)
                .execute(&mut *tx)
                .await
            {
                let _ = tx.rollback().await;
                let error_msg = format!("Failed to create schedule word: {}", e);
                logger.database_operation("INSERT", "study_plan_schedule_words", false, Some(&error_msg));
                logger.api_response("create_study_plan_with_schedule", false, Some(&error_msg));
                return Err(AppError::DatabaseError(error_msg));
            }
        }
    }

    // 创建学习计划单词关联（用于兼容现有系统）
    let mut all_word_ids = std::collections::HashSet::new();
    for daily_plan in &ai_result.daily_plans {
        for word in &daily_plan.words {
            if let Ok(word_id) = word.word_id.parse::<i64>() {
                all_word_ids.insert(word_id);
            }
        }
    }

    for word_id in all_word_ids {
        let insert_plan_word_query = r#"
            INSERT INTO study_plan_words (plan_id, word_id, learned, correct_count, total_attempts, mastery_score)
            VALUES (?, ?, FALSE, 0, 0, 0.0)
        "#;

        if let Err(e) = sqlx::query(insert_plan_word_query)
            .bind(plan_id)
            .bind(word_id)
            .execute(&mut *tx)
            .await
        {
            let _ = tx.rollback().await;
            let error_msg = format!("Failed to create plan word association: {}", e);
            logger.database_operation("INSERT", "study_plan_words", false, Some(&error_msg));
            logger.api_response("create_study_plan_with_schedule", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    }

    // 提交事务
    if let Err(e) = tx.commit().await {
        let error_msg = format!("Failed to commit transaction: {}", e);
        logger.database_operation("COMMIT", "transaction", false, Some(&error_msg));
        logger.api_response("create_study_plan_with_schedule", false, Some(&error_msg));
        return Err(AppError::DatabaseError(error_msg));
    }

    logger.api_response("create_study_plan_with_schedule", true, Some(&format!(
        "Created study plan with ID: {}, {} daily plans, {} total words",
        plan_id, ai_result.daily_plans.len(), total_words
    )));

    Ok(plan_id)
}

/// 获取学习计划的单词列表（显示原始单词本单词，而不是学习日程单词）
#[tauri::command]
pub async fn get_study_plan_words(app: AppHandle, plan_id: i64) -> AppResult<Vec<StudyPlanWord>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_plan_words", Some(&format!("plan_id: {}", plan_id)));

    // 获取学习计划关联的单词本中的原始单词
    let query = r#"
        SELECT DISTINCT
            w.id as word_id,
            w.word,
            w.meaning,
            w.part_of_speech,
            w.ipa,
            w.syllables,
            spw.wordbook_id
        FROM study_plan_schedule_words spw
        JOIN study_plan_schedules sps ON spw.schedule_id = sps.id
        JOIN words w ON w.id = spw.word_id
        WHERE sps.plan_id = ?
        ORDER BY w.word
    "#;

    match sqlx::query(query)
        .bind(plan_id)
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => {
            logger.info("DATABASE", &format!("Found {} original words for plan {}", rows.len(), plan_id));

            let words: Vec<StudyPlanWord> = rows.iter().map(|row| {
                let word_id: i64 = row.get("word_id");
                logger.info("DATABASE", &format!("Processing original word: {} with word_id: {}",
                    row.get::<String, _>("word"), word_id));

                StudyPlanWord {
                    id: word_id,
                    word: row.get("word"),
                    meaning: row.get::<Option<String>, _>("meaning").unwrap_or_default(),
                    part_of_speech: row.get::<Option<String>, _>("part_of_speech").unwrap_or_else(|| "n.".to_string()),
                    ipa: row.get::<Option<String>, _>("ipa").unwrap_or_default(),
                    syllables: row.get::<Option<String>, _>("syllables").unwrap_or_default(),
                    plan_id,
                    // 原始单词不需要这些学习日程相关的字段，设为默认值
                    schedule_id: 0, // 原始单词没有日程ID
                    scheduled_date: "".to_string(), // 原始单词没有日程日期
                    is_review: false, // 原始单词不是复习
                    review_count: Some(0), // 原始单词没有复习次数
                    priority: "1".to_string(), // 默认优先级
                    difficulty_level: 1, // 默认难度
                    completed: false, // 默认未完成
                    completed_at: None, // 默认无完成时间
                    study_time_minutes: 0, // 默认学习时间为0
                    correct_attempts: 0, // 默认正确尝试次数为0
                    total_attempts: 0, // 默认总尝试次数为0
                    wordbook_id: row.get("wordbook_id"),
                    plan_word_id: word_id, // 使用原始单词ID作为标识
                }
            }).collect();

            logger.api_response("get_study_plan_words", true, Some(&format!("Returned {} words", words.len())));
            Ok(words)
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "study_plan_schedule_words", false, Some(&error_msg));
            logger.api_response("get_study_plan_words", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 从学习计划中移除单词（删除该单词的所有学习日程）
#[tauri::command]
pub async fn remove_word_from_plan(app: AppHandle, plan_id: i64, word_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("remove_word_from_plan", Some(&format!("plan_id: {}, word_id: {}", plan_id, word_id)));

    // 删除该单词在学习计划中的所有日程安排
    let query = r#"
        DELETE FROM study_plan_schedule_words
        WHERE word_id = ?
        AND schedule_id IN (
            SELECT id FROM study_plan_schedules WHERE plan_id = ?
        )
    "#;

    match sqlx::query(query)
        .bind(word_id)
        .bind(plan_id)
        .execute(pool.inner())
        .await
    {
        Ok(result) => {
            if result.rows_affected() > 0 {
                logger.api_response("remove_word_from_plan", true, Some(&format!("Removed word {} from plan {} ({} schedule entries deleted)", word_id, plan_id, result.rows_affected())));
                Ok(())
            } else {
                let error_msg = format!("Word {} not found in plan {}", word_id, plan_id);
                logger.api_response("remove_word_from_plan", false, Some(&error_msg));
                Err(AppError::NotFound(error_msg))
            }
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("DELETE", "study_plan_schedule_words", false, Some(&error_msg));
            logger.api_response("remove_word_from_plan", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 批量从学习计划中移除单词（删除这些单词的所有学习日程）
#[tauri::command]
pub async fn batch_remove_words_from_plan(app: AppHandle, plan_id: i64, word_ids: Vec<i64>) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("batch_remove_words_from_plan", Some(&format!("plan_id: {}, word_count: {}", plan_id, word_ids.len())));

    if word_ids.is_empty() {
        logger.api_response("batch_remove_words_from_plan", true, Some("No words to remove"));
        return Ok(());
    }

    let placeholders = word_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        r#"
        DELETE FROM study_plan_schedule_words
        WHERE word_id IN ({})
        AND schedule_id IN (
            SELECT id FROM study_plan_schedules WHERE plan_id = ?
        )
        "#,
        placeholders
    );

    let mut query_builder = sqlx::query(&query);
    for word_id in &word_ids {
        query_builder = query_builder.bind(word_id);
    }
    query_builder = query_builder.bind(plan_id);

    match query_builder.execute(pool.inner()).await {
        Ok(result) => {
            logger.api_response("batch_remove_words_from_plan", true, Some(&format!("Removed {} words from plan {}", result.rows_affected(), plan_id)));
            Ok(())
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("DELETE", "study_plan_schedule_words", false, Some(&error_msg));
            logger.api_response("batch_remove_words_from_plan", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 获取学习计划统计数据
#[tauri::command]
pub async fn get_study_plan_statistics(app: AppHandle, plan_id: i64) -> AppResult<StudyPlanStatistics> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_plan_statistics", Some(&format!("plan_id: {}", plan_id)));

    // 获取基本计划信息
    let plan_query = r#"
        SELECT start_date, end_date, total_words
        FROM study_plans
        WHERE id = ?
    "#;

    let plan_row = match sqlx::query(plan_query)
        .bind(plan_id)
        .fetch_optional(pool.inner())
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            let error_msg = format!("Study plan with ID {} not found", plan_id);
            logger.api_response("get_study_plan_statistics", false, Some(&error_msg));
            return Err(AppError::NotFound(error_msg));
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.api_response("get_study_plan_statistics", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    let start_date: Option<String> = plan_row.get("start_date");
    let end_date: Option<String> = plan_row.get("end_date");
    let total_words: i64 = plan_row.get("total_words");

    // 计算时间相关统计
    let (total_days, time_progress_percentage) = if let (Some(start), Some(end)) = (&start_date, &end_date) {
        // 这里应该使用实际的日期计算，简化处理
        let total_days = 30; // 临时值，实际应该计算日期差
        let time_progress = 50.0; // 临时值，实际应该计算当前进度
        (total_days, time_progress)
    } else {
        (0, 0.0)
    };

    // 获取完成的单词数
    let completed_words_query = r#"
        SELECT COUNT(*) as completed_count
        FROM study_plan_schedule_words spw
        JOIN study_plan_schedules sps ON spw.schedule_id = sps.id
        WHERE sps.plan_id = ? AND spw.completed = true
    "#;

    let completed_words: i64 = match sqlx::query(completed_words_query)
        .bind(plan_id)
        .fetch_one(pool.inner())
        .await
    {
        Ok(row) => row.get("completed_count"),
        Err(_) => 0,
    };

    // 获取学习记录统计
    let sessions_query = r#"
        SELECT
            COUNT(*) as session_count,
            COALESCE(SUM(study_time_minutes), 0) as total_minutes,
            COALESCE(AVG(accuracy_rate), 0.0) as avg_accuracy
        FROM study_sessions
        WHERE plan_id = ?
    "#;

    let (session_count, total_minutes, avg_accuracy) = match sqlx::query(sessions_query)
        .bind(plan_id)
        .fetch_one(pool.inner())
        .await
    {
        Ok(row) => (
            row.get::<i64, _>("session_count"),
            row.get::<i64, _>("total_minutes"),
            row.get::<f64, _>("avg_accuracy"),
        ),
        Err(_) => (0, 0, 0.0),
    };

    let statistics = StudyPlanStatistics {
        average_daily_study_minutes: if session_count > 0 { total_minutes / session_count } else { 0 },
        time_progress_percentage,
        actual_progress_percentage: if total_words > 0 { (completed_words as f64 / total_words as f64) * 100.0 } else { 0.0 },
        average_accuracy_rate: avg_accuracy,
        overdue_ratio: 0.0, // 临时值，需要实际计算
        total_days,
        completed_days: session_count,
        overdue_days: 0, // 临时值，需要实际计算
        total_words,
        completed_words,
        total_study_minutes: total_minutes,
    };

    logger.api_response("get_study_plan_statistics", true, Some("Statistics calculated successfully"));
    Ok(statistics)
}
