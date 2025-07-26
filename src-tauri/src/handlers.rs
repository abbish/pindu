use tauri::{AppHandle, Manager};
use sqlx::{SqlitePool, Row, query::Query};
use chrono::Datelike;
use crate::types::*;
use crate::types::common::WordSaveResult;
use crate::types::wordbook::WordTypeDistribution;
use crate::error::{AppResult, AppError};
use crate::logger::Logger;
use crate::ai_service::AnalysisProgress;

/// 根据表名简单分类表类型
fn classify_table_type(table_name: &str) -> &'static str {
    // 简单的命名约定分类
    match table_name {
        "ai_providers" | "ai_models" | "theme_tags" => "config",
        _ => "user_data"
    }
}

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

/// 获取单词本关联的学习计划
#[tauri::command]
pub async fn get_word_book_linked_plans(app: AppHandle, book_id: Id) -> AppResult<Vec<StudyPlanWithProgress>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_word_book_linked_plans", Some(&format!("book_id: {}", book_id)));

    let query = r#"
        SELECT DISTINCT
            sp.id,
            sp.name,
            sp.description,
            sp.status,
            sp.unified_status,
            sp.total_words,
            sp.mastery_level,
            sp.intensity_level,
            sp.study_period_days,
            sp.review_frequency,
            sp.start_date,
            sp.end_date,
            sp.actual_start_date,
            sp.actual_end_date,
            sp.actual_terminated_date,
            sp.ai_plan_data,
            sp.deleted_at,
            sp.created_at,
            sp.updated_at,
            CASE
                WHEN sp.total_words > 0 THEN
                    COALESCE(
                        (SELECT COUNT(*) * 100.0 / sp.total_words
                         FROM study_plan_words spw2
                         WHERE spw2.plan_id = sp.id AND spw2.learned = 1),
                        0.0
                    )
                ELSE 0.0
            END as progress_percentage
        FROM study_plans sp
        WHERE sp.id IN (
            SELECT DISTINCT spw.plan_id
            FROM study_plan_words spw
            JOIN words w ON spw.word_id = w.id
            WHERE w.word_book_id = ?
        )
        AND sp.deleted_at IS NULL
        AND sp.status = 'normal'
        ORDER BY sp.created_at DESC
    "#;

    // 先检查原始关联数据
    let debug_query = "SELECT DISTINCT spw.plan_id FROM study_plan_words spw JOIN words w ON spw.word_id = w.id WHERE w.word_book_id = ?";
    let debug_rows = sqlx::query(debug_query)
        .bind(book_id)
        .fetch_all(pool.inner())
        .await?;

    let plan_ids: Vec<i64> = debug_rows.iter().map(|row| row.get::<i64, _>("plan_id")).collect();
    logger.info("LINKED_PLANS_DEBUG", &format!("Found plan IDs in study_plan_words: {:?}", plan_ids));

    match sqlx::query(query)
        .bind(book_id)
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => {
            let plan_ids: Vec<i64> = rows.iter().map(|row| row.get::<i64, _>("id")).collect();
            logger.info("LINKED_PLANS_RESULT", &format!("Found actual plan IDs: {:?}", plan_ids));

            let plans: Vec<StudyPlanWithProgress> = rows.into_iter().map(|row| {
                StudyPlanWithProgress {
                    id: row.get("id"),
                    name: row.get("name"),
                    description: row.get("description"),
                    status: row.get("status"),
                    lifecycle_status: "".to_string(), // 已废弃字段
                    unified_status: row.get("unified_status"),
                    total_words: row.get("total_words"),
                    mastery_level: row.get("mastery_level"),
                    intensity_level: row.get("intensity_level"),
                    study_period_days: row.get("study_period_days"),
                    review_frequency: row.get("review_frequency"),
                    start_date: row.get("start_date"),
                    end_date: row.get("end_date"),
                    actual_start_date: row.get("actual_start_date"),
                    actual_end_date: row.get("actual_end_date"),
                    actual_terminated_date: row.get("actual_terminated_date"),
                    ai_plan_data: row.get("ai_plan_data"),
                    deleted_at: row.get("deleted_at"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                    progress_percentage: row.get("progress_percentage"),
                }
            }).collect();

            logger.api_response("get_word_book_linked_plans", true, Some(&format!("Found {} linked plans", plans.len())));
            Ok(plans)
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "study_plans", false, Some(&error_msg));
            logger.api_response("get_word_book_linked_plans", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 根据ID获取单词本详情
#[tauri::command]
pub async fn get_word_book_detail(app: AppHandle, book_id: Id) -> AppResult<WordBook> {
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
        .bind(book_id)
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
        .bind(book_id)
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
pub async fn get_word_book_statistics(app: AppHandle, book_id: Id) -> AppResult<WordTypeDistribution> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_word_book_statistics", Some(&format!("book_id: {}", book_id)));

    let query = r#"
        SELECT
            part_of_speech,
            COUNT(*) as count
        FROM words
        WHERE word_book_id = ? AND part_of_speech IS NOT NULL
        GROUP BY part_of_speech
    "#;

    let rows = sqlx::query(query)
        .bind(book_id)
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
        ),
        linked_plans = (
            SELECT COUNT(DISTINCT sp.id)
            FROM study_plans sp
            JOIN study_plan_words spw ON sp.id = spw.plan_id
            JOIN words w ON spw.word_id = w.id
            WHERE w.word_book_id = word_books.id
            AND sp.deleted_at IS NULL
            AND sp.status = 'normal'
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
    book_id: Id,
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
        .bind(book_id)
        .execute(&mut *tx)
        .await?;

    // 如果提供了主题标签ID，更新主题标签关联
    if let Some(theme_tag_ids) = &request.theme_tag_ids {
        // 删除现有的主题标签关联
        let delete_query = "DELETE FROM word_book_theme_tags WHERE word_book_id = ?";
        sqlx::query(delete_query)
            .bind(book_id)
            .execute(&mut *tx)
            .await?;

        // 添加新的主题标签关联
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

    Ok(())
}

/// 删除单词本（软删除）
#[tauri::command]
pub async fn delete_word_book(app: AppHandle, book_id: Id) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("delete_word_book", Some(&format!("book_id: {}", book_id)));

    // 软删除单词本：设置 deleted_at 字段
    let query = "UPDATE word_books SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL";
    let result = sqlx::query(query)
        .bind(book_id)
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
    book_id: Id,
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
        "book_id: {}, page: {}, page_size: {}, search_term: {:?}, part_of_speech: {:?}",
        book_id, page, page_size, search_term, part_of_speech
    )));

    // 构建查询，使用更简单的方法
    let (final_query, _final_params) = build_words_query(book_id, &search_term, &part_of_speech);

    let mut query_builder = sqlx::query(&final_query)
        .bind(book_id);

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
    let (count_query, _) = build_words_count_query(book_id, &search_term, &part_of_speech);
    let mut count_query_builder = sqlx::query(&count_query)
        .bind(book_id);

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
    book_id: Id,
    word_data: CreateWordRequest,
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
        .bind(book_id)
        .bind(&word_data.word)
        .bind(&word_data.meaning)
        .bind(&word_data.description)
        .bind(&word_data.ipa)
        .bind(&word_data.syllables)
        .bind(&word_data.phonics_segments)
        .bind(&word_data.part_of_speech)
        .bind(word_data.category_id)
        .bind(&word_data.pos_abbreviation)
        .bind(&word_data.pos_english)
        .bind(&word_data.pos_chinese)
        .bind(&word_data.phonics_rule)
        .bind(&word_data.analysis_explanation)
        .execute(pool.inner())
        .await?;

    // 更新单词本的单词数量、最后使用时间和更新时间
    let update_query = "UPDATE word_books SET total_words = (SELECT COUNT(*) FROM words WHERE word_book_id = ?), last_used = datetime('now'), updated_at = datetime('now') WHERE id = ?";
    sqlx::query(update_query)
        .bind(book_id)
        .bind(book_id)
        .execute(pool.inner())
        .await?;

    Ok(result.last_insert_rowid())
}

/// 更新单词
#[tauri::command]
pub async fn update_word(
    app: AppHandle,
    word_id: Id,
    word_data: UpdateWordRequest,
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
        .bind(&word_data.word)
        .bind(&word_data.meaning)
        .bind(&word_data.description)
        .bind(&word_data.ipa)
        .bind(&word_data.syllables)
        .bind(&word_data.phonics_segments)
        .bind(&word_data.part_of_speech)
        .bind(word_data.category_id)
        .bind(&word_data.pos_abbreviation)
        .bind(&word_data.pos_english)
        .bind(&word_data.pos_chinese)
        .bind(&word_data.phonics_rule)
        .bind(&word_data.analysis_explanation)
        .bind(word_id)
        .execute(pool.inner())
        .await?;

    Ok(())
}

/// 删除单词
#[tauri::command]
pub async fn delete_word(app: AppHandle, word_id: Id) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();

    // 获取单词所属的单词本ID
    let book_query = "SELECT word_book_id FROM words WHERE id = ?";
    let book_row = sqlx::query(book_query)
        .bind(word_id)
        .fetch_optional(pool.inner())
        .await?;

    // 删除单词
    sqlx::query("DELETE FROM words WHERE id = ?")
        .bind(word_id)
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
            sp.id,
            sp.name,
            sp.description,
            sp.status,
            sp.unified_status,
            sp.total_words,
            sp.mastery_level,
            sp.intensity_level,
            sp.study_period_days,
            sp.review_frequency,
            sp.start_date,
            sp.end_date,
            sp.actual_start_date,
            sp.actual_end_date,
            sp.actual_terminated_date,
            sp.ai_plan_data,
            sp.deleted_at,
            sp.created_at,
            sp.updated_at,
            CASE
                WHEN sp.total_words > 0 THEN
                    COALESCE(
                        (SELECT COUNT(*) * 100.0 / sp.total_words
                         FROM study_plan_words spw
                         WHERE spw.plan_id = sp.id AND spw.learned = 1),
                        0.0
                    )
                ELSE 0.0
            END as progress_percentage
        FROM study_plans sp
        WHERE sp.deleted_at IS NULL
        AND sp.unified_status != 'Deleted'
        ORDER BY sp.created_at DESC
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
                    lifecycle_status: "".to_string(), // 已废弃字段
                    unified_status: row.get("unified_status"),
                    total_words: row.get("total_words"),
                    mastery_level: row.get("mastery_level"),
                    intensity_level: row.get("intensity_level"),
                    study_period_days: row.get("study_period_days"),
                    review_frequency: row.get("review_frequency"),
                    start_date: row.get("start_date"),
                    end_date: row.get("end_date"),
                    actual_start_date: row.get("actual_start_date"),
                    actual_end_date: row.get("actual_end_date"),
                    actual_terminated_date: row.get("actual_terminated_date"),
                    ai_plan_data: row.get("ai_plan_data"),
                    deleted_at: row.get("deleted_at"),
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

    logger.info("PARAM_DEBUG", &format!("get_study_plan received plan_id: {}", plan_id));
    logger.api_request("get_study_plan", Some(&format!("plan_id: {}", plan_id)));

    let query = r#"
        SELECT
            sp.id,
            sp.name,
            sp.description,
            sp.status,
            sp.unified_status,
            sp.total_words,
            sp.learned_words,
            sp.accuracy_rate,
            sp.mastery_level,
            sp.intensity_level,
            sp.study_period_days,
            sp.review_frequency,
            sp.start_date,
            sp.end_date,
            sp.actual_start_date,
            sp.actual_end_date,
            sp.actual_terminated_date,
            sp.ai_plan_data,
            sp.deleted_at,
            sp.created_at,
            sp.updated_at,
            CASE
                WHEN sp.total_words > 0 THEN
                    COALESCE(
                        (SELECT COUNT(*) * 100.0 / sp.total_words
                         FROM study_plan_words spw
                         WHERE spw.plan_id = sp.id AND spw.learned = 1),
                        0.0
                    )
                ELSE 0.0
            END as progress_percentage
        FROM study_plans sp
        WHERE sp.id = ? AND sp.deleted_at IS NULL
        AND sp.unified_status != 'Deleted'
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
                lifecycle_status: "".to_string(), // 已废弃字段
                unified_status: row.get("unified_status"),
                total_words: row.get("total_words"),
                mastery_level: row.get("mastery_level"),
                intensity_level: row.get("intensity_level"),
                study_period_days: row.get("study_period_days"),
                review_frequency: row.get("review_frequency"),
                start_date: row.get("start_date"),
                end_date: row.get("end_date"),
                actual_start_date: row.get("actual_start_date"),
                actual_end_date: row.get("actual_end_date"),
                actual_terminated_date: row.get("actual_terminated_date"),
                ai_plan_data: row.get("ai_plan_data"),
                deleted_at: row.get("deleted_at"),
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
    let _query_builder: Query<'_, sqlx::Sqlite, _> = sqlx::query(&query);
    for _value in values {
        // 这里需要使用不同的方法来绑定动态参数
        // 由于 sqlx 的限制，我们使用简化的方法
    }

    // 简化的更新方法 - 支持统一状态更新
    if let Some(status) = updates.get("status").and_then(|v| v.as_str()) {
        // 将旧状态转换为新的统一状态
        let unified_status = match status {
            "draft" => "Draft",
            "normal" => "Pending", // 默认为待开始
            _ => "Draft"
        };

        let simple_query = "UPDATE study_plans SET status = ?, unified_status = ?, updated_at = ? WHERE id = ?";

        match sqlx::query(simple_query)
            .bind(status)
            .bind(unified_status)
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

    // 创建学习计划 - 使用新的统一状态管理
    let insert_query = r#"
        INSERT INTO study_plans (
            name,
            description,
            status,
            unified_status,
            total_words,
            learned_words,
            accuracy_rate,
            mastery_level,
            created_at,
            updated_at
        ) VALUES (?, ?, 'draft', 'Draft', ?, 0, 0.0, ?, datetime('now'), datetime('now'))
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

    // 获取平均正确率 - 从实际练习记录计算
    let accuracy_query = r#"
        SELECT
            COALESCE(
                CASE
                    WHEN COUNT(*) > 0 THEN
                        (COUNT(CASE WHEN is_correct = TRUE THEN 1 END) * 100.0 / COUNT(*))
                    ELSE 0.0
                END,
                0.0
            ) as avg_accuracy
        FROM word_practice_records wpr
        JOIN practice_sessions ps ON wpr.session_id = ps.id
        WHERE ps.completed = TRUE
    "#;
    let accuracy_row = match sqlx::query(accuracy_query).fetch_one(pool.inner()).await {
        Ok(row) => {
            logger.database_operation("SELECT", "word_practice_records", true, Some("Accuracy query successful"));
            row
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("SELECT", "word_practice_records", false, Some(&error_msg));
            logger.api_response("get_study_statistics", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };
    let average_accuracy: f64 = accuracy_row.get("avg_accuracy");

    // 计算连续学习天数 - 从今天开始往前数连续有练习记录的天数
    let streak_query = r#"
        SELECT DISTINCT DATE(ps.end_time) as study_date
        FROM practice_sessions ps
        WHERE ps.completed = TRUE
        AND DATE(ps.end_time) >= DATE('now', '-30 days')
        ORDER BY study_date DESC
    "#;

    let mut streak_days = 0i32;

    match sqlx::query(streak_query)
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => {
            if !rows.is_empty() {
                let today = chrono::Utc::now().date_naive();
                let mut current_date = today;

                // 将数据库日期转换为 NaiveDate 并排序
                let mut study_dates: Vec<chrono::NaiveDate> = Vec::new();
                for row in rows {
                    let date_str: String = row.get("study_date");
                    if let Ok(date) = chrono::NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") {
                        study_dates.push(date);
                    }
                }
                study_dates.sort_by(|a, b| b.cmp(a)); // 降序排列，最新的在前

                // 计算连续天数
                for study_date in study_dates {
                    if study_date == current_date {
                        streak_days += 1;
                        current_date = current_date - chrono::Duration::days(1);
                    } else if study_date == current_date - chrono::Duration::days(1) {
                        // 允许跳过今天（如果今天还没学习）
                        current_date = study_date;
                        streak_days += 1;
                        current_date = current_date - chrono::Duration::days(1);
                    } else {
                        break; // 不连续，停止计算
                    }
                }
            }
        }
        Err(_) => {
            streak_days = 0;
        }
    }

    // 调试信息
    logger.info("STREAK_DEBUG", &format!("计算连续学习天数: {}", streak_days));
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

    // 计算最近7天的学习进度
    let weekly_progress_query = r#"
        SELECT
            DATE(ps.end_time) as study_date,
            COUNT(DISTINCT wpr.word_id) as words_learned
        FROM practice_sessions ps
        JOIN word_practice_records wpr ON ps.id = wpr.session_id
        WHERE ps.completed = TRUE
        AND DATE(ps.end_time) >= DATE('now', '-7 days')
        AND DATE(ps.end_time) <= DATE('now')
        GROUP BY DATE(ps.end_time)
        ORDER BY study_date ASC
    "#;

    let mut weekly_progress = vec![0; 7]; // 初始化7天的数据

    match sqlx::query(weekly_progress_query)
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => {
            let today = chrono::Utc::now().date_naive();
            for row in rows {
                let study_date_str: String = row.get("study_date");
                let words_learned: i64 = row.get("words_learned");

                if let Ok(study_date) = chrono::NaiveDate::parse_from_str(&study_date_str, "%Y-%m-%d") {
                    let days_ago = (today - study_date).num_days();
                    if days_ago >= 0 && days_ago < 7 {
                        let index = (6 - days_ago) as usize; // 最新的在最后
                        weekly_progress[index] = words_learned as i32;
                    }
                }
            }
        }
        Err(_) => {
            // 如果查询失败，保持默认的0值
        }
    };

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

    // 设置取消标志并清除进度
    let progress_manager = get_global_progress_manager();
    progress_manager.cancel_analysis(); // 先取消分析
    progress_manager.clear_progress();  // 再清除进度

    logger.api_response("clear_analysis_progress", true, Some("Progress cleared and analysis cancelled"));

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

    if ![1, 3, 7, 14, 28].contains(&request.study_period_days) {
        let error_msg = "Invalid study period days, must be 1, 3, 7, 14, or 28";
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

    // 创建学习计划 - 使用新的统一状态管理
    let insert_plan_query = r#"
        INSERT INTO study_plans (
            name, description, status, unified_status, total_words, mastery_level,
            intensity_level, study_period_days, review_frequency, start_date, end_date, ai_plan_data,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    "#;

    // 使用新的统一状态管理
    let unified_status = match request.status.as_deref().unwrap_or("draft") {
        "draft" => "Draft",
        "active" => "Pending", // 创建后的活跃状态应该是待开始
        "normal" => "Pending", // 正常状态应该是待开始
        _ => "Draft"
    };

    // 保持旧字段兼容性
    let status = if unified_status == "Draft" { "draft" } else { "normal" };
    let total_words = ai_result.plan_metadata.total_words;

    let plan_result = match sqlx::query(insert_plan_query)
        .bind(&request.name)
        .bind(&request.description)
        .bind(status)
        .bind(unified_status)
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
        // 预计算统计数据
        let new_words_count = daily_plan.words.iter().filter(|w| !w.is_review).count() as i32;
        let review_words_count = daily_plan.words.iter().filter(|w| w.is_review).count() as i32;
        let total_words_count = daily_plan.words.len() as i32;

        let insert_schedule_query = r#"
            INSERT INTO study_plan_schedules (
                plan_id, day_number, schedule_date,
                new_words_count, review_words_count, total_words_count, completed_words_count, status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 'not-started', datetime('now'), datetime('now'))
        "#;

        let schedule_result = match sqlx::query(insert_schedule_query)
            .bind(plan_id)
            .bind(daily_plan.day)
            .bind(&daily_plan.date)
            .bind(new_words_count)
            .bind(review_words_count)
            .bind(total_words_count)
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
                let error_msg = format!(
                    "Failed to create schedule word: {}. Details: schedule_id={}, word_id={}, wordbook_id={}, word={}, is_review={}, review_count={:?}, priority={}, difficulty_level={}",
                    e, schedule_id, word_id, wordbook_id, word.word, word.is_review, word.review_count, word.priority, word.difficulty_level
                );
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

    // 更新相关单词本的关联计划数量
    let update_linked_plans_query = r#"
        UPDATE word_books
        SET linked_plans = (
            SELECT COUNT(DISTINCT sp.id)
            FROM study_plans sp
            JOIN study_plan_words spw ON sp.id = spw.plan_id
            JOIN words w ON spw.word_id = w.id
            WHERE w.word_book_id = word_books.id
            AND sp.deleted_at IS NULL
            AND sp.status = 'normal'
        )
        WHERE id IN (
            SELECT DISTINCT w.word_book_id
            FROM study_plan_words spw
            JOIN words w ON spw.word_id = w.id
            WHERE spw.plan_id = ?
        )
    "#;

    if let Err(e) = sqlx::query(update_linked_plans_query)
        .bind(plan_id)
        .execute(pool.inner())
        .await
    {
        // 不返回错误，因为学习计划已经创建成功，只是统计更新失败
        logger.database_operation("UPDATE", "word_books", false, Some(&format!("Failed to update linked_plans: {}", e)));
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
            w.word_book_id as wordbook_id
        FROM study_plan_words spw
        JOIN words w ON w.id = spw.word_id
        WHERE spw.plan_id = ?
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
            logger.database_operation("SELECT", "study_plan_words", false, Some(&error_msg));
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

    // 首先删除学习计划单词关联表中的记录
    let delete_plan_word_query = r#"
        DELETE FROM study_plan_words
        WHERE plan_id = ? AND word_id = ?
    "#;

    match sqlx::query(delete_plan_word_query)
        .bind(plan_id)
        .bind(word_id)
        .execute(pool.inner())
        .await
    {
        Ok(result) => {
            if result.rows_affected() == 0 {
                let error_msg = format!("Word {} not found in plan {}", word_id, plan_id);
                logger.api_response("remove_word_from_plan", false, Some(&error_msg));
                return Err(AppError::NotFound(error_msg));
            }

            logger.info("DATABASE", &format!("Removed word {} from plan {} (study_plan_words)", word_id, plan_id));
        },
        Err(e) => {
            let error_msg = e.to_string();
            logger.database_operation("DELETE", "study_plan_words", false, Some(&error_msg));
            logger.api_response("remove_word_from_plan", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    }

    // 然后删除该单词在学习计划中的所有日程安排
    let delete_schedule_query = r#"
        DELETE FROM study_plan_schedule_words
        WHERE word_id = ?
        AND schedule_id IN (
            SELECT id FROM study_plan_schedules WHERE plan_id = ?
        )
    "#;

    match sqlx::query(delete_schedule_query)
        .bind(word_id)
        .bind(plan_id)
        .execute(pool.inner())
        .await
    {
        Ok(result) => {
            logger.api_response("remove_word_from_plan", true, Some(&format!("Removed word {} from plan {} ({} schedule entries deleted)", word_id, plan_id, result.rows_affected())));
            Ok(())
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

    // 调试信息
    logger.info("STATISTICS_DEBUG", &format!("开始计算学习计划 {} 的统计数据", plan_id));

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

    // 调试信息
    logger.info("STATISTICS_DEBUG", &format!("计划基本信息 - start_date: {:?}, end_date: {:?}, total_words: {}", start_date, end_date, total_words));

    // 计算时间相关统计
    let (total_days, time_progress_percentage) = if let (Some(start), Some(end)) = (&start_date, &end_date) {
        // 解析日期
        let start_date = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
            .map_err(|_| AppError::ValidationError("Invalid start date format".to_string()))?;
        let end_date = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
            .map_err(|_| AppError::ValidationError("Invalid end date format".to_string()))?;

        // 计算总天数
        let total_days = (end_date - start_date).num_days() + 1; // +1 包含开始和结束日期

        // 计算时间进度
        let today = chrono::Utc::now().date_naive();
        let time_progress = if today <= start_date {
            0.0 // 还未开始
        } else if today >= end_date {
            100.0 // 已结束
        } else {
            let elapsed_days = (today - start_date).num_days() + 1;
            (elapsed_days as f64 / total_days as f64) * 100.0
        };

        // 调试信息
        logger.info("STATISTICS_DEBUG", &format!("时间计算 - total_days: {}, time_progress: {:.2}%", total_days, time_progress));

        (total_days, time_progress)
    } else {
        logger.info("STATISTICS_DEBUG", "时间计算 - 缺少开始或结束日期，使用默认值");
        (0, 0.0)
    };

    // 实时计算已学单词数：基于练习记录中的单词（只要练习过就算）
    let completed_words_query = r#"
        SELECT COUNT(DISTINCT wpr.word_id) as completed_count
        FROM word_practice_records wpr
        JOIN practice_sessions ps ON wpr.session_id = ps.id
        WHERE ps.plan_id = ? AND ps.completed = TRUE
    "#;

    let completed_words: i64 = match sqlx::query(completed_words_query)
        .bind(plan_id)
        .fetch_one(pool.inner())
        .await
    {
        Ok(row) => {
            let count = row.get("completed_count");
            logger.info("STATISTICS_DEBUG", &format!("已学单词数查询结果: {}", count));
            count
        },
        Err(e) => {
            logger.info("STATISTICS_DEBUG", &format!("已学单词数查询失败: {}", e));
            0
        },
    };

    // 实时计算练习时间：基于已完成的练习会话
    let practice_time_query = r#"
        SELECT
            COUNT(CASE WHEN completed = TRUE THEN 1 END) as completed_sessions,
            COALESCE(SUM(CASE WHEN completed = TRUE THEN
                CAST((julianday(end_time) - julianday(start_time)) * 24 * 60 * 60 * 1000 AS INTEGER)
            END), 0) as total_active_time_ms
        FROM practice_sessions
        WHERE plan_id = ?
    "#;

    let (completed_sessions, total_active_time) = match sqlx::query(practice_time_query)
        .bind(plan_id)
        .fetch_one(pool.inner())
        .await
    {
        Ok(row) => (
            row.get::<i64, _>("completed_sessions"),
            row.get::<i64, _>("total_active_time_ms"),
        ),
        Err(_) => (0, 0),
    };

    // 获取练习准确率（从 word_practice_records 表计算）
    let accuracy_query = r#"
        SELECT
            COUNT(*) as total_steps,
            COUNT(CASE WHEN is_correct = TRUE THEN 1 END) as correct_steps
        FROM word_practice_records wpr
        JOIN practice_sessions ps ON wpr.session_id = ps.id
        WHERE ps.plan_id = ? AND ps.completed = TRUE
    "#;

    let avg_accuracy = match sqlx::query(accuracy_query)
        .bind(plan_id)
        .fetch_one(pool.inner())
        .await
    {
        Ok(row) => {
            let total_steps: i64 = row.get("total_steps");
            let correct_steps: i64 = row.get("correct_steps");
            if total_steps > 0 {
                (correct_steps as f64 / total_steps as f64) * 100.0
            } else {
                0.0
            }
        },
        Err(_) => 0.0,
    };

    // 将毫秒转换为分钟
    let total_minutes = total_active_time / (1000 * 60);

    // 计算逾期统计
    let (overdue_days, overdue_ratio) = if let Some(start) = &start_date {
        let start_date = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").unwrap_or_default();
        let today = chrono::Utc::now().date_naive();

        if today > start_date {
            // 获取逾期的日程数量
            let overdue_query = r#"
                SELECT COUNT(*) as overdue_count
                FROM study_plan_schedules sps
                LEFT JOIN (
                    SELECT schedule_id, COUNT(*) as completed_words
                    FROM study_plan_schedule_words
                    WHERE completed = TRUE
                    GROUP BY schedule_id
                ) completed ON sps.id = completed.schedule_id
                LEFT JOIN (
                    SELECT schedule_id, COUNT(*) as total_words
                    FROM study_plan_schedule_words
                    GROUP BY schedule_id
                ) total ON sps.id = total.schedule_id
                WHERE sps.plan_id = ?
                AND sps.schedule_date < date('now')
                AND (completed.completed_words IS NULL OR completed.completed_words < total.total_words)
            "#;

            let overdue_count = match sqlx::query(overdue_query)
                .bind(plan_id)
                .fetch_one(pool.inner())
                .await
            {
                Ok(row) => row.get::<i64, _>("overdue_count"),
                Err(_) => 0,
            };

            let overdue_ratio = if total_days > 0 {
                (overdue_count as f64 / total_days as f64) * 100.0
            } else {
                0.0
            };

            (overdue_count, overdue_ratio)
        } else {
            (0, 0.0)
        }
    } else {
        (0, 0.0)
    };

    // 简化连续学习天数计算：统计最近有练习记录的天数
    let plan_streak_query = r#"
        SELECT COUNT(DISTINCT DATE(ps.end_time)) as streak_days
        FROM practice_sessions ps
        WHERE ps.completed = TRUE
        AND ps.plan_id = ?
        AND DATE(ps.end_time) >= DATE('now', '-7 days')
    "#;

    let plan_streak_days = match sqlx::query(plan_streak_query)
        .bind(plan_id)
        .fetch_one(pool.inner())
        .await
    {
        Ok(row) => row.get::<i64, _>("streak_days") as i32,
        Err(_) => 0,
    };

    // 调试信息
    logger.info("PLAN_STREAK_DEBUG", &format!("学习计划 {} 的连续练习天数: {}", plan_id, plan_streak_days));

    let statistics = StudyPlanStatistics {
        average_daily_study_minutes: if completed_sessions > 0 { total_minutes / completed_sessions } else { 0 },
        time_progress_percentage,
        actual_progress_percentage: if total_words > 0 { (completed_words as f64 / total_words as f64) * 100.0 } else { 0.0 },
        average_accuracy_rate: avg_accuracy,
        overdue_ratio,
        streak_days: plan_streak_days,
        total_days,
        completed_days: completed_sessions,
        overdue_days,
        total_words,
        completed_words,
        total_study_minutes: total_minutes,
    };

    logger.api_response("get_study_plan_statistics", true, Some("Statistics calculated successfully"));
    Ok(statistics)
}

// ==================== 学习计划状态管理相关命令 ====================

/// 开始学习计划
#[tauri::command]
pub async fn start_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("start_study_plan", Some(&format!("plan_id: {}", plan_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划状态 - 使用新的统一状态
    let check_query = r#"
        SELECT
            status,
            unified_status
        FROM study_plans WHERE id = ? AND deleted_at IS NULL
    "#;

    let row = match sqlx::query(check_query).bind(plan_id).fetch_optional(&mut *tx).await? {
        Some(row) => row,
        None => {
            let _ = tx.rollback().await;
            let error_msg = "学习计划不存在或已被删除";
            logger.api_response("start_study_plan", false, Some(error_msg));
            return Err(AppError::NotFound(error_msg.to_string()));
        }
    };

    let _current_status: String = row.get("status");
    let current_unified_status: String = row.get("unified_status");

    // 验证状态转换是否合法 - 只有Pending状态的学习计划才能开始
    if current_unified_status != "Pending" {
        let _ = tx.rollback().await;
        let error_msg = match current_unified_status.as_str() {
            "Draft" => "学习计划还未完成配置，请先完成配置",
            "Active" => "学习计划已经在进行中",
            "Paused" => "学习计划已暂停，请使用恢复功能",
            "Completed" => "学习计划已完成",
            "Terminated" => "学习计划已终止",
            "Deleted" => "学习计划已删除",
            _ => "学习计划状态不允许开始学习"
        };
        logger.api_response("start_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 更新学习计划状态 - 使用新的统一状态
    let update_query = r#"
        UPDATE study_plans
        SET unified_status = 'Active',
            actual_start_date = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
    "#;

    sqlx::query(update_query).bind(plan_id).execute(&mut *tx).await?;

    // 记录状态变更历史 - 简化版本，只记录统一状态
    let history_query = r#"
        INSERT INTO study_plan_status_history
        (plan_id, from_status, to_status, reason)
        VALUES (?, ?, ?, ?)
    "#;

    sqlx::query(history_query)
        .bind(plan_id)
        .bind(&current_unified_status)
        .bind("Active")
        .bind("用户手动开始学习")
        .execute(&mut *tx)
        .await?;

    // 提交事务
    tx.commit().await?;

    logger.api_response("start_study_plan", true, Some("学习计划已开始"));
    Ok(())
}

/// 完成学习计划
#[tauri::command]
pub async fn complete_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("complete_study_plan", Some(&format!("plan_id: {}", plan_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划状态
    let check_query = "SELECT status, unified_status FROM study_plans WHERE id = ? AND deleted_at IS NULL";
    let row = match sqlx::query(check_query).bind(plan_id).fetch_optional(&mut *tx).await? {
        Some(row) => row,
        None => {
            let _ = tx.rollback().await;
            let error_msg = "学习计划不存在或已被删除";
            logger.api_response("complete_study_plan", false, Some(error_msg));
            return Err(AppError::NotFound(error_msg.to_string()));
        }
    };

    let current_status: String = row.get("status");
    let current_unified_status: String = row.get("unified_status");

    // 验证状态转换是否合法
    if current_status != "normal" {
        let _ = tx.rollback().await;
        let error_msg = "只有正常状态的学习计划才能完成";
        logger.api_response("complete_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if current_unified_status != "Active" {
        let _ = tx.rollback().await;
        let error_msg = "只有进行中的学习计划才能完成";
        logger.api_response("complete_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 更新学习计划状态
    let update_query = r#"
        UPDATE study_plans
        SET unified_status = 'Completed',
            actual_end_date = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
    "#;

    sqlx::query(update_query).bind(plan_id).execute(&mut *tx).await?;

    // 记录状态变更历史 - 简化版本，只记录统一状态
    let history_query = r#"
        INSERT INTO study_plan_status_history
        (plan_id, from_status, to_status, reason)
        VALUES (?, ?, ?, ?)
    "#;

    sqlx::query(history_query)
        .bind(plan_id)
        .bind(&current_unified_status)
        .bind("Completed")
        .bind("用户手动完成学习")
        .execute(&mut *tx)
        .await?;

    // 提交事务
    tx.commit().await?;

    logger.api_response("complete_study_plan", true, Some("学习计划已完成"));
    Ok(())
}

/// 终止学习计划
#[tauri::command]
pub async fn terminate_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("terminate_study_plan", Some(&format!("plan_id: {}", plan_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划状态
    let check_query = "SELECT status, unified_status FROM study_plans WHERE id = ? AND deleted_at IS NULL";
    let row = match sqlx::query(check_query).bind(plan_id).fetch_optional(&mut *tx).await? {
        Some(row) => row,
        None => {
            let _ = tx.rollback().await;
            let error_msg = "学习计划不存在或已被删除";
            logger.api_response("terminate_study_plan", false, Some(error_msg));
            return Err(AppError::NotFound(error_msg.to_string()));
        }
    };

    let current_status: String = row.get("status");
    let current_unified_status: String = row.get("unified_status");

    // 验证状态转换是否合法
    if current_status != "normal" {
        let _ = tx.rollback().await;
        let error_msg = "只有正常状态的学习计划才能终止";
        logger.api_response("terminate_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if current_unified_status != "Active" {
        let _ = tx.rollback().await;
        let error_msg = "只有进行中的学习计划才能终止";
        logger.api_response("terminate_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 更新学习计划状态 - 使用新的统一状态
    let update_query = r#"
        UPDATE study_plans
        SET unified_status = 'Terminated',
            actual_terminated_date = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
    "#;

    sqlx::query(update_query).bind(plan_id).execute(&mut *tx).await?;

    // 记录状态变更历史 - 简化版本，只记录统一状态
    let history_query = r#"
        INSERT INTO study_plan_status_history
        (plan_id, from_status, to_status, reason)
        VALUES (?, ?, ?, ?)
    "#;

    sqlx::query(history_query)
        .bind(plan_id)
        .bind(&current_unified_status)
        .bind("Terminated")
        .bind("用户手动终止学习")
        .execute(&mut *tx)
        .await?;

    // 提交事务
    tx.commit().await?;

    logger.api_response("terminate_study_plan", true, Some("学习计划已终止"));
    Ok(())
}

/// 重新学习计划（从已完成或已终止状态重新开始）
#[tauri::command]
pub async fn restart_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("restart_study_plan", Some(&format!("plan_id: {}", plan_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划状态
    let check_query = "SELECT status, unified_status FROM study_plans WHERE id = ? AND deleted_at IS NULL";
    let row = match sqlx::query(check_query).bind(plan_id).fetch_optional(&mut *tx).await? {
        Some(row) => row,
        None => {
            let _ = tx.rollback().await;
            let error_msg = "学习计划不存在或已被删除";
            logger.api_response("restart_study_plan", false, Some(error_msg));
            return Err(AppError::NotFound(error_msg.to_string()));
        }
    };

    let current_status: String = row.get("status");
    let current_unified_status: String = row.get("unified_status");

    // 验证状态转换是否合法
    if current_status != "normal" {
        let _ = tx.rollback().await;
        let error_msg = "只有正常状态的学习计划才能重新学习";
        logger.api_response("restart_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    if current_unified_status != "Completed" && current_unified_status != "Terminated" {
        let _ = tx.rollback().await;
        let error_msg = "只有已完成或已终止的学习计划才能重新学习";
        logger.api_response("restart_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 重置学习计划状态和进度
    let update_query = r#"
        UPDATE study_plans
        SET unified_status = 'Pending',
            learned_words = 0,
            actual_start_date = NULL,
            actual_end_date = NULL,
            actual_terminated_date = NULL,
            updated_at = datetime('now')
        WHERE id = ?
    "#;

    sqlx::query(update_query).bind(plan_id).execute(&mut *tx).await?;

    // 清空学习日程
    sqlx::query("DELETE FROM study_plan_schedules WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 清空学习记录
    sqlx::query("DELETE FROM study_sessions WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 清空练习会话记录
    sqlx::query("DELETE FROM practice_sessions WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 清空学习计时器记录
    sqlx::query("DELETE FROM study_timer_records WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 重置学习进度（保留原始单词列表，只清空学习状态）
    sqlx::query("UPDATE study_plan_words SET learned = 0 WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 记录状态变更历史 - 简化版本，只记录统一状态
    let history_query = r#"
        INSERT INTO study_plan_status_history
        (plan_id, from_status, to_status, reason)
        VALUES (?, ?, ?, ?)
    "#;

    sqlx::query(history_query)
        .bind(plan_id)
        .bind(&current_unified_status)
        .bind("Pending")
        .bind("用户重新开始学习，清空历史进度")
        .execute(&mut *tx)
        .await?;

    // 提交事务
    tx.commit().await?;

    logger.api_response("restart_study_plan", true, Some("学习计划已重置，需要重新生成日程"));
    Ok(())
}

/// 编辑学习计划（转为草稿状态）
#[tauri::command]
pub async fn edit_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("edit_study_plan", Some(&format!("plan_id: {}", plan_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划状态
    let check_query = "SELECT status, unified_status FROM study_plans WHERE id = ? AND deleted_at IS NULL";
    let row = match sqlx::query(check_query).bind(plan_id).fetch_optional(&mut *tx).await? {
        Some(row) => row,
        None => {
            let _ = tx.rollback().await;
            let error_msg = "学习计划不存在或已被删除";
            logger.api_response("edit_study_plan", false, Some(error_msg));
            return Err(AppError::NotFound(error_msg.to_string()));
        }
    };

    let current_status: String = row.get("status");
    let current_unified_status: String = row.get("unified_status");

    // 验证状态转换是否合法
    if current_status != "normal" {
        let _ = tx.rollback().await;
        let error_msg = "只有正常状态的学习计划才能编辑";
        logger.api_response("edit_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 更新学习计划状态并重置学习进度
    let update_query = r#"
        UPDATE study_plans
        SET status = 'draft',
            unified_status = 'Draft',
            learned_words = 0,
            accuracy_rate = 0.0,
            actual_start_date = NULL,
            actual_end_date = NULL,
            updated_at = datetime('now')
        WHERE id = ?
    "#;

    sqlx::query(update_query).bind(plan_id).execute(&mut *tx).await?;

    // 清空学习日程
    sqlx::query("DELETE FROM study_plan_schedules WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 清空学习记录
    sqlx::query("DELETE FROM study_sessions WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 清空练习会话记录
    sqlx::query("DELETE FROM practice_sessions WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 清空学习计时器记录
    sqlx::query("DELETE FROM study_timer_records WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 注意：不删除 study_plan_words，保留原始单词关联
    // 只重置学习进度字段，保留单词关联以便在详情页面显示
    sqlx::query("UPDATE study_plan_words SET learned = 0, correct_count = 0, total_attempts = 0, mastery_score = 0.0 WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 记录状态变更历史 - 简化版本，只记录统一状态
    let history_query = r#"
        INSERT INTO study_plan_status_history
        (plan_id, from_status, to_status, reason)
        VALUES (?, ?, ?, ?)
    "#;

    sqlx::query(history_query)
        .bind(plan_id)
        .bind(&current_unified_status)
        .bind("Draft")
        .bind("用户编辑学习计划，重置学习进度")
        .execute(&mut *tx)
        .await?;

    // 提交事务
    tx.commit().await?;

    logger.api_response("edit_study_plan", true, Some("学习计划已转为草稿状态，学习进度已重置"));
    Ok(())
}

/// 发布学习计划（从草稿转为正常）
#[tauri::command]
pub async fn publish_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("publish_study_plan", Some(&format!("plan_id: {}", plan_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划状态
    let check_query = "SELECT status, unified_status FROM study_plans WHERE id = ? AND deleted_at IS NULL";
    let row = match sqlx::query(check_query).bind(plan_id).fetch_optional(&mut *tx).await? {
        Some(row) => row,
        None => {
            let _ = tx.rollback().await;
            let error_msg = "学习计划不存在或已被删除";
            logger.api_response("publish_study_plan", false, Some(error_msg));
            return Err(AppError::NotFound(error_msg.to_string()));
        }
    };

    let current_status: String = row.get("status");
    let current_unified_status: String = row.get("unified_status");

    // 验证状态转换是否合法
    if current_status != "draft" {
        let _ = tx.rollback().await;
        let error_msg = "只有草稿状态的学习计划才能发布";
        logger.api_response("publish_study_plan", false, Some(error_msg));
        return Err(AppError::ValidationError(error_msg.to_string()));
    }

    // 更新学习计划状态 - 使用新的统一状态
    let update_query = r#"
        UPDATE study_plans
        SET status = 'normal',
            unified_status = 'Pending',
            updated_at = datetime('now')
        WHERE id = ?
    "#;

    sqlx::query(update_query).bind(plan_id).execute(&mut *tx).await?;

    // 记录状态变更历史 - 简化版本，只记录统一状态
    let history_query = r#"
        INSERT INTO study_plan_status_history
        (plan_id, from_status, to_status, reason)
        VALUES (?, ?, ?, ?)
    "#;

    sqlx::query(history_query)
        .bind(plan_id)
        .bind(&current_unified_status)
        .bind("Pending")
        .bind("用户发布学习计划")
        .execute(&mut *tx)
        .await?;

    // 提交事务
    tx.commit().await?;

    logger.api_response("publish_study_plan", true, Some("学习计划已发布"));
    Ok(())
}

/// 软删除学习计划
#[tauri::command]
pub async fn delete_study_plan(app: AppHandle, plan_id: i64) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("delete_study_plan", Some(&format!("plan_id: {}", plan_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划是否存在
    let check_query = "SELECT status, unified_status FROM study_plans WHERE id = ? AND deleted_at IS NULL";
    let row = match sqlx::query(check_query).bind(plan_id).fetch_optional(&mut *tx).await? {
        Some(row) => row,
        None => {
            let _ = tx.rollback().await;
            let error_msg = "学习计划不存在或已被删除";
            logger.api_response("delete_study_plan", false, Some(error_msg));
            return Err(AppError::NotFound(error_msg.to_string()));
        }
    };

    let _current_status: String = row.get("status");
    let current_unified_status: String = row.get("unified_status");

    // 软删除学习计划
    let update_query = r#"
        UPDATE study_plans
        SET status = 'deleted',
            unified_status = 'Deleted',
            deleted_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
    "#;

    sqlx::query(update_query).bind(plan_id).execute(&mut *tx).await?;

    // 记录状态变更历史 - 简化版本，只记录统一状态
    let history_query = r#"
        INSERT INTO study_plan_status_history
        (plan_id, from_status, to_status, reason)
        VALUES (?, ?, ?, ?)
    "#;

    sqlx::query(history_query)
        .bind(plan_id)
        .bind(&current_unified_status)
        .bind("Deleted")
        .bind("用户删除学习计划")
        .execute(&mut *tx)
        .await?;

    // 提交事务
    tx.commit().await?;

    logger.api_response("delete_study_plan", true, Some("学习计划已删除"));
    Ok(())
}

/// 获取学习计划状态变更历史
#[tauri::command]
pub async fn get_study_plan_status_history(app: AppHandle, plan_id: i64) -> AppResult<Vec<StudyPlanStatusHistory>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_plan_status_history", Some(&format!("plan_id: {}", plan_id)));

    let query = r#"
        SELECT
            id,
            plan_id,
            from_status,
            to_status,
            changed_at,
            reason
        FROM study_plan_status_history
        WHERE plan_id = ?
        ORDER BY changed_at DESC
    "#;

    match sqlx::query(query).bind(plan_id).fetch_all(pool.inner()).await {
        Ok(rows) => {
            let history: Vec<StudyPlanStatusHistory> = rows.into_iter().map(|row| {
                StudyPlanStatusHistory {
                    id: row.get("id"),
                    plan_id: row.get("plan_id"),
                    from_status: row.get("from_status"),
                    to_status: row.get("to_status"),
                    from_lifecycle_status: None, // 已废弃字段
                    to_lifecycle_status: row.get("to_status"), // 使用to_status作为兼容
                    changed_at: row.get("changed_at"),
                    reason: row.get("reason"),
                }
            }).collect();

            logger.api_response("get_study_plan_status_history", true, Some(&format!("返回 {} 条历史记录", history.len())));
            Ok(history)
        }
        Err(e) => {
            let error_msg = format!("获取状态历史失败: {}", e);
            logger.api_response("get_study_plan_status_history", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 获取学习计划关联的单词本ID列表
#[tauri::command]
pub async fn get_study_plan_word_books(app: AppHandle, plan_id: i64) -> AppResult<Vec<i64>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_plan_word_books", Some(&format!("plan_id: {}", plan_id)));

    let query = r#"
        SELECT DISTINCT w.word_book_id
        FROM study_plan_words spw
        JOIN words w ON w.id = spw.word_id
        WHERE spw.plan_id = ?
        ORDER BY w.word_book_id
    "#;

    match sqlx::query(query)
        .bind(plan_id)
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => {
            let word_book_ids: Vec<i64> = rows.iter()
                .map(|row| row.get::<i64, _>("word_book_id"))
                .collect();

            logger.api_response("get_study_plan_word_books", true, Some(&format!("Found {} word books", word_book_ids.len())));
            Ok(word_book_ids)
        }
        Err(e) => {
            let error_msg = format!("数据库错误: {}", e);
            logger.api_response("get_study_plan_word_books", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 更新学习计划基本信息（仅名称和描述）
#[tauri::command]
pub async fn update_study_plan_basic_info(
    app: AppHandle,
    plan_id: i64,
    name: String,
    description: Option<String>
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("update_study_plan_basic_info", Some(&format!("plan_id: {}", plan_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划是否存在且为草稿状态
    let check_query = "SELECT status FROM study_plans WHERE id = ? AND deleted_at IS NULL";
    let plan_status: String = match sqlx::query_scalar(check_query)
        .bind(plan_id)
        .fetch_optional(&mut *tx)
        .await?
    {
        Some(status) => status,
        None => {
            let error_msg = "学习计划不存在";
            logger.api_response("update_study_plan_basic_info", false, Some(error_msg));
            return Err(AppError::DatabaseError(error_msg.to_string()));
        }
    };

    // 只允许更新草稿状态的计划
    if plan_status != "draft" {
        let error_msg = "只能编辑草稿状态的学习计划";
        logger.api_response("update_study_plan_basic_info", false, Some(error_msg));
        return Err(AppError::DatabaseError(error_msg.to_string()));
    }

    // 更新学习计划基本信息（仅名称和描述）
    let update_query = r#"
        UPDATE study_plans
        SET
            name = ?,
            description = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    "#;

    sqlx::query(update_query)
        .bind(&name)
        .bind(description.as_deref())
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 提交事务
    tx.commit().await?;

    logger.api_response("update_study_plan_basic_info", true, Some("学习计划基本信息已更新"));
    Ok(())
}

/// 获取日历月度数据
#[tauri::command]
pub async fn get_calendar_month_data(
    app: AppHandle,
    year: i32,
    month: i32,
    include_other_months: Option<bool>,
) -> AppResult<CalendarMonthResponse> {
    use crate::types::study::{CalendarMonthResponse, CalendarDayData, CalendarMonthlyStats, CalendarStudyPlan, CalendarStudySession};

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_calendar_month_data", Some(&format!("year: {}, month: {}", year, month)));

    let include_other = include_other_months.unwrap_or(true);

    // 计算日历范围
    let start_date = if include_other {
        // 包含其他月份，从月初的周一开始
        let first_day = chrono::NaiveDate::from_ymd_opt(year, month as u32, 1)
            .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?;
        let weekday = first_day.weekday().num_days_from_monday();
        first_day - chrono::Duration::days(weekday as i64)
    } else {
        // 只包含当前月份
        chrono::NaiveDate::from_ymd_opt(year, month as u32, 1)
            .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
    };

    let end_date = if include_other {
        // 包含其他月份，到月末的周日结束
        let last_day = if month == 12 {
            chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
                .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
                - chrono::Duration::days(1)
        } else {
            chrono::NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)
                .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
                - chrono::Duration::days(1)
        };
        let weekday = last_day.weekday().num_days_from_monday();
        last_day + chrono::Duration::days(6 - weekday as i64)
    } else {
        // 只包含当前月份
        if month == 12 {
            chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
                .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
                - chrono::Duration::days(1)
        } else {
            chrono::NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)
                .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
                - chrono::Duration::days(1)
        }
    };

    // 获取日期范围内的学习计划日程，使用预计算的统计字段
    let schedules_query = r#"
        SELECT
            sps.schedule_date,
            sp.id as plan_id,
            sp.name as plan_name,
            sp.unified_status,
            sps.total_words_count as total_words,
            sps.new_words_count as new_words,
            sps.review_words_count as review_words,
            sps.completed_words_count,
            sps.status as schedule_status
        FROM study_plan_schedules sps
        JOIN study_plans sp ON sps.plan_id = sp.id
        WHERE sps.schedule_date BETWEEN ? AND ?
            AND sp.deleted_at IS NULL
            AND sp.unified_status IN ('Pending', 'Active', 'Paused')
        ORDER BY sps.schedule_date, sp.id
    "#;

    let schedule_rows = match sqlx::query(schedules_query)
        .bind(start_date.format("%Y-%m-%d").to_string())
        .bind(end_date.format("%Y-%m-%d").to_string())
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            let error_msg = format!("Failed to fetch calendar schedules: {}", e);
            logger.database_operation("SELECT", "study_plan_schedules", false, Some(&error_msg));
            logger.api_response("get_calendar_month_data", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    // 获取学习记录
    let sessions_query = r#"
        SELECT
            DATE(ss.started_at) as study_date,
            ss.plan_id,
            sp.name as plan_name,
            SUM(ss.words_studied) as words_studied,
            SUM(CAST(ss.total_time_seconds AS REAL) / 60.0) as study_time_minutes,
            AVG(CAST(ss.correct_answers AS REAL) / NULLIF(ss.words_studied, 0) * 100.0) as accuracy_rate,
            MAX(ss.started_at) as completed_at
        FROM study_sessions ss
        JOIN study_plans sp ON ss.plan_id = sp.id
        WHERE DATE(ss.started_at) BETWEEN ? AND ?
        GROUP BY DATE(ss.started_at), ss.plan_id, sp.name
        ORDER BY study_date, ss.plan_id
    "#;

    let session_rows = match sqlx::query(sessions_query)
        .bind(start_date.format("%Y-%m-%d").to_string())
        .bind(end_date.format("%Y-%m-%d").to_string())
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            let error_msg = format!("Failed to fetch calendar sessions: {}", e);
            logger.database_operation("SELECT", "study_sessions", false, Some(&error_msg));
            logger.api_response("get_calendar_month_data", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    // 构建日历数据
    let mut days = Vec::new();
    let today = chrono::Local::now().date_naive();
    let mut current_date = start_date;

    while current_date <= end_date {
        let date_str = current_date.format("%Y-%m-%d").to_string();
        let is_today = current_date == today;
        let _is_current_month = current_date.month() == month as u32;

        // 收集该日期的学习计划
        let mut study_plans = Vec::new();
        let mut total_words = 0;
        let mut new_words = 0;
        let mut review_words = 0;

        for row in &schedule_rows {
            let schedule_date: String = row.get("schedule_date");
            if schedule_date == date_str {
                let plan_id: i64 = row.get("plan_id");
                let plan_name: String = row.get("plan_name");
                let unified_status: String = row.get("unified_status");
                let plan_total_words: i32 = row.get("total_words");
                let plan_new_words: i32 = row.get("new_words");
                let plan_review_words: i32 = row.get("review_words");
                let plan_completed_words: i32 = row.get("completed_words_count");

                study_plans.push(CalendarStudyPlan {
                    id: plan_id,
                    name: plan_name,
                    color: None, // TODO: 从配置或数据库获取颜色
                    icon: None,
                    target_words: plan_total_words,
                    completed_words: plan_completed_words,
                    status: unified_status,
                });

                total_words += plan_total_words;
                new_words += plan_new_words;
                review_words += plan_review_words;
            }
        }

        // 收集该日期的学习记录
        let mut study_sessions = Vec::new();
        let mut completed_words = 0;
        let mut study_time_minutes = 0;

        for row in &session_rows {
            let study_date: String = row.get("study_date");
            if study_date == date_str {
                let plan_id: i64 = row.get("plan_id");
                let plan_name: String = row.get("plan_name");
                let words_studied: i64 = row.get("words_studied");
                let session_time: f64 = row.get("study_time_minutes");
                let accuracy_rate: Option<f64> = row.try_get("accuracy_rate").ok();
                let completed_at: String = row.get("completed_at");

                study_sessions.push(CalendarStudySession {
                    id: 0, // 使用聚合数据，没有具体的session id
                    plan_id,
                    plan_name,
                    words_studied: words_studied as i32,
                    study_time_minutes: session_time.round() as i32,
                    accuracy_rate: accuracy_rate.unwrap_or(0.0),
                    completed_at,
                });

                completed_words += words_studied as i32;
                study_time_minutes += session_time.round() as i32;
            }
        }

        // 确定状态
        let is_in_plan = !study_plans.is_empty();
        let status = if !is_in_plan {
            "not-started".to_string()
        } else if current_date > today {
            "not-started".to_string()
        } else if completed_words >= total_words && total_words > 0 {
            "completed".to_string()
        } else if completed_words > 0 {
            "in-progress".to_string()
        } else if current_date < today {
            "overdue".to_string()
        } else {
            "not-started".to_string()
        };

        // 计算进度百分比
        let progress_percentage = if total_words > 0 {
            (completed_words as f64 / total_words as f64 * 100.0).min(100.0)
        } else {
            0.0
        };

        days.push(CalendarDayData {
            date: date_str,
            is_today,
            is_in_plan, // 移除月份限制，让所有有计划的日期都显示
            status,
            new_words_count: new_words,
            review_words_count: review_words,
            total_words_count: total_words,
            completed_words_count: completed_words,
            progress_percentage,
            study_time_minutes: if study_time_minutes > 0 { Some(study_time_minutes) } else { None },
            study_plans: if study_plans.is_empty() { None } else { Some(study_plans) },
            study_sessions: if study_sessions.is_empty() { None } else { Some(study_sessions) },
        });

        current_date += chrono::Duration::days(1);
    }

    // 计算月度统计
    let current_month_days: Vec<&CalendarDayData> = days.iter()
        .filter(|d| {
            let date_obj = chrono::NaiveDate::parse_from_str(&d.date, "%Y-%m-%d").unwrap_or_default();
            date_obj.month() == month as u32
        })
        .collect();

    // 计算平均准确率
    let sessions_with_accuracy: Vec<&CalendarStudySession> = current_month_days.iter()
        .filter_map(|d| d.study_sessions.as_ref())
        .flatten()
        .collect();
    let average_accuracy = if !sessions_with_accuracy.is_empty() {
        sessions_with_accuracy.iter().map(|s| s.accuracy_rate).sum::<f64>() / sessions_with_accuracy.len() as f64
    } else {
        0.0
    };

    // 计算连续学习天数（从今天往前数）
    let mut streak_days = 0;
    let _today_str = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
    let mut check_date = chrono::Local::now().date_naive();

    for _ in 0..30 { // 最多检查30天
        let date_str = check_date.format("%Y-%m-%d").to_string();
        if let Some(day_data) = days.iter().find(|d| d.date == date_str) {
            if day_data.status == "completed" {
                streak_days += 1;
            } else if day_data.is_in_plan {
                // 如果有计划但未完成，则中断连续记录
                break;
            }
        }
        check_date -= chrono::Duration::days(1);
    }

    // 计算活跃计划数
    let mut active_plan_ids = std::collections::HashSet::new();
    for day in &current_month_days {
        if let Some(plans) = &day.study_plans {
            for plan in plans {
                active_plan_ids.insert(plan.id);
            }
        }
    }

    let monthly_stats = CalendarMonthlyStats {
        total_days: current_month_days.len() as i32,
        study_days: current_month_days.iter().filter(|d| d.is_in_plan).count() as i32,
        completed_days: current_month_days.iter().filter(|d| d.status == "completed").count() as i32,
        total_words_learned: current_month_days.iter().map(|d| d.completed_words_count).sum(),
        total_study_minutes: current_month_days.iter().filter_map(|d| d.study_time_minutes).sum(),
        average_accuracy,
        streak_days,
        active_plans_count: active_plan_ids.len() as i32,
    };

    let response = CalendarMonthResponse {
        year,
        month,
        days,
        monthly_stats,
    };

    logger.api_response("get_calendar_month_data", true, Some(&format!("Retrieved {} days", response.days.len())));
    Ok(response)
}

/// 诊断学习计划数据
#[tauri::command]
pub async fn diagnose_study_plan_data(app: AppHandle, plan_name: String) -> AppResult<serde_json::Value> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("diagnose_study_plan_data", Some(&format!("plan_name: {}", plan_name)));

    let mut diagnosis = serde_json::Map::new();

    // 检查学习计划基本信息
    let plan_query = "SELECT id, name, status, unified_status, ai_plan_data, total_words, learned_words FROM study_plans WHERE name LIKE ?";
    let plan_rows = sqlx::query(plan_query)
        .bind(format!("%{}%", plan_name))
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default();

    let mut plans_info = Vec::new();
    for row in plan_rows {
        let plan_id: i64 = row.get("id");
        let name: String = row.get("name");
        let status: String = row.get("status");
        let unified_status: String = row.get("unified_status");
        let ai_plan_data: Option<String> = row.get("ai_plan_data");
        let total_words: i32 = row.get("total_words");
        let learned_words: i32 = row.get("learned_words");

        // 检查日程数据
        let schedule_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM study_plan_schedules WHERE plan_id = ?")
            .bind(plan_id)
            .fetch_one(pool.inner())
            .await
            .unwrap_or(0);

        // 检查单词关联数据
        let word_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM study_plan_words WHERE plan_id = ?")
            .bind(plan_id)
            .fetch_one(pool.inner())
            .await
            .unwrap_or(0);

        plans_info.push(serde_json::json!({
            "id": plan_id,
            "name": name,
            "status": status,
            "unified_status": unified_status,
            "has_ai_data": ai_plan_data.is_some(),
            "ai_data_length": ai_plan_data.as_ref().map(|s| s.len()).unwrap_or(0),
            "total_words": total_words,
            "learned_words": learned_words,
            "schedule_count": schedule_count,
            "word_count": word_count
        }));
    }

    diagnosis.insert("plans".to_string(), serde_json::Value::Array(plans_info));

    logger.api_response("diagnose_study_plan_data", true, Some("诊断完成"));
    Ok(serde_json::Value::Object(diagnosis))
}

/// 诊断日历数据状态
#[tauri::command]
pub async fn diagnose_calendar_data(app: AppHandle) -> AppResult<serde_json::Value> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("diagnose_calendar_data", None);

    let mut diagnosis = serde_json::Map::new();

    // 检查学习计划
    let plans_query = "SELECT id, name, ai_plan_data, start_date, end_date, unified_status FROM study_plans WHERE status != 'deleted'";
    let plan_rows = sqlx::query(plans_query).fetch_all(pool.inner()).await.unwrap_or_default();

    let mut plans_info = Vec::new();
    for row in &plan_rows {
        let id: i64 = row.get("id");
        let name: String = row.get("name");
        let ai_plan_data: Option<String> = row.get("ai_plan_data");
        let start_date: Option<String> = row.get("start_date");
        let end_date: Option<String> = row.get("end_date");
        let unified_status: String = row.get("unified_status");

        let has_ai_data = ai_plan_data.is_some() && !ai_plan_data.as_ref().unwrap().is_empty();

        // 检查是否有日程数据
        let schedule_count_query = "SELECT COUNT(*) as count FROM study_plan_schedules WHERE plan_id = ?";
        let schedule_count: i64 = sqlx::query(schedule_count_query)
            .bind(id)
            .fetch_one(pool.inner())
            .await
            .map(|row| row.get("count"))
            .unwrap_or(0);

        plans_info.push(serde_json::json!({
            "id": id,
            "name": name,
            "unified_status": unified_status,
            "start_date": start_date,
            "end_date": end_date,
            "has_ai_data": has_ai_data,
            "schedule_count": schedule_count
        }));
    }

    diagnosis.insert("study_plans".to_string(), serde_json::Value::Array(plans_info));

    // 检查总的日程数据
    let total_schedules_query = "SELECT COUNT(*) as count FROM study_plan_schedules";
    let total_schedules: i64 = sqlx::query(total_schedules_query)
        .fetch_one(pool.inner())
        .await
        .map(|row| row.get("count"))
        .unwrap_or(0);

    diagnosis.insert("total_schedules".to_string(), serde_json::Value::Number(serde_json::Number::from(total_schedules)));

    // 检查日程日期范围
    if total_schedules > 0 {
        let date_range_query = "SELECT MIN(schedule_date) as min_date, MAX(schedule_date) as max_date FROM study_plan_schedules";
        if let Ok(row) = sqlx::query(date_range_query).fetch_one(pool.inner()).await {
            let min_date: Option<String> = row.get("min_date");
            let max_date: Option<String> = row.get("max_date");
            diagnosis.insert("schedule_date_range".to_string(), serde_json::json!({
                "min_date": min_date,
                "max_date": max_date
            }));
        }
    }

    logger.api_response("diagnose_calendar_data", true, Some("Diagnosis completed"));
    Ok(serde_json::Value::Object(diagnosis))
}

/// 更新学习计划完整信息（包括学习设置和日程）
#[tauri::command]
pub async fn update_study_plan_with_schedule(
    app: AppHandle,
    plan_id: i64,
    name: String,
    description: Option<String>,
    intensity_level: String,
    study_period_days: i64,
    review_frequency: i64,
    start_date: String,
    _wordbook_ids: Vec<i64>,
    schedule: serde_json::Value,
    status: String
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("update_study_plan_with_schedule", Some(&format!("plan_id: {}", plan_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划是否存在且为草稿状态
    let plan_status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM study_plans WHERE id = ?"
    )
        .bind(plan_id)
        .fetch_optional(&mut *tx)
        .await?;

    let plan_status = match plan_status {
        Some(status) => status,
        None => {
            let error_msg = "学习计划不存在";
            logger.api_response("update_study_plan_with_schedule", false, Some(error_msg));
            return Err(AppError::DatabaseError(error_msg.to_string()));
        }
    };

    // 只允许更新草稿状态的计划
    if plan_status != "draft" {
        let error_msg = "只能编辑草稿状态的学习计划";
        logger.api_response("update_study_plan_with_schedule", false, Some(error_msg));
        return Err(AppError::DatabaseError(error_msg.to_string()));
    }

    // 更新学习计划基本信息和设置
    let update_query = r#"
        UPDATE study_plans
        SET name = ?,
            description = ?,
            intensity_level = ?,
            study_period_days = ?,
            review_frequency = ?,
            start_date = ?,
            ai_plan_data = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    "#;

    sqlx::query(update_query)
        .bind(&name)
        .bind(&description)
        .bind(&intensity_level)
        .bind(study_period_days)
        .bind(review_frequency)
        .bind(&start_date)
        .bind(schedule.to_string())
        .bind(&status)
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 删除现有的单词关联和日程记录（与创建逻辑保持一致）
    sqlx::query("DELETE FROM study_plan_words WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 删除现有的日程记录（级联删除会自动删除 study_plan_schedule_words）
    sqlx::query("DELETE FROM study_plan_schedules WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 重新创建学习计划单词关联（与创建逻辑保持一致）
    let mut all_word_ids = std::collections::HashSet::new();

    // 直接从 serde_json::Value 解析，避免不必要的序列化/反序列化
    if let Ok(ai_result) = serde_json::from_value::<StudyPlanAIResult>(schedule.clone()) {
        logger.info("UPDATE_PLAN", &format!("Successfully parsed AI result with {} daily plans", ai_result.daily_plans.len()));

        for daily_plan in &ai_result.daily_plans {
            for word in &daily_plan.words {
                if let Ok(word_id) = word.word_id.parse::<i64>() {
                    all_word_ids.insert(word_id);
                }
            }
        }

        logger.info("UPDATE_PLAN", &format!("Extracted {} unique word IDs from AI result", all_word_ids.len()));
    } else {
        logger.error("UPDATE_PLAN", "Failed to parse AI result from schedule data",
            Some(&serde_json::to_string(&schedule).unwrap_or_default().chars().take(200).collect::<String>()));
    }

    for word_id in all_word_ids {
        sqlx::query(
            "INSERT INTO study_plan_words (plan_id, word_id, learned, correct_count, total_attempts, mastery_score) VALUES (?, ?, FALSE, 0, 0, 0.0)"
        )
            .bind(plan_id)
            .bind(word_id)
            .execute(&mut *tx)
            .await?;
    }

    // 重新创建学习计划日程（如果有AI规划数据）
    if let Ok(ai_result) = serde_json::from_str::<crate::types::study::StudyPlanAIResult>(&schedule.to_string()) {
        for daily_plan in &ai_result.daily_plans {
            // 预计算统计数据
            let new_words_count = daily_plan.words.iter().filter(|w| !w.is_review).count() as i32;
            let review_words_count = daily_plan.words.iter().filter(|w| w.is_review).count() as i32;
            let total_words_count = daily_plan.words.len() as i32;

            let insert_schedule_query = r#"
                INSERT INTO study_plan_schedules (
                    plan_id, day_number, schedule_date,
                    new_words_count, review_words_count, total_words_count, completed_words_count, status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, 'not-started', datetime('now'), datetime('now'))
            "#;

            let schedule_result = sqlx::query(insert_schedule_query)
                .bind(plan_id)
                .bind(daily_plan.day)
                .bind(&daily_plan.date)
                .bind(new_words_count)
                .bind(review_words_count)
                .bind(total_words_count)
                .execute(&mut *tx)
                .await?;

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
                        return Err(AppError::ValidationError(error_msg));
                    }
                };

                sqlx::query(insert_word_query)
                    .bind(schedule_id)
                    .bind(word_id)
                    .bind(word.wordbook_id.clone())
                    .bind(word.is_review)
                    .bind(word.review_count)
                    .bind(word.priority.clone())
                    .bind(word.difficulty_level)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        logger.info("UPDATE_SCHEDULE", &format!("Recreated {} daily schedules for plan {}", ai_result.daily_plans.len(), plan_id));
    }

    // 提交事务
    tx.commit().await?;

    logger.api_response("update_study_plan_with_schedule", true, Some("学习计划已完整更新"));
    Ok(())
}

// ==================== 单词练习相关命令 ====================

/// 开始练习会话
#[tauri::command]
pub async fn start_practice_session(
    app: AppHandle,
    plan_id: i64,
    schedule_id: i64,
) -> AppResult<crate::types::study::PracticeSession> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("start_practice_session", Some(&format!("plan_id: {}, schedule_id: {}", plan_id, schedule_id)));

    // 验证学习计划和日程是否存在
    let schedule_row = sqlx::query(
        "SELECT sp.id as plan_id, sp.name as plan_name, sps.id as schedule_id, sps.schedule_date
         FROM study_plans sp
         JOIN study_plan_schedules sps ON sp.id = sps.plan_id
         WHERE sp.id = ? AND sps.id = ?"
    )
    .bind(plan_id)
    .bind(schedule_id)
    .fetch_optional(pool.inner())
    .await?;

    let schedule_row = schedule_row.ok_or_else(|| {
        AppError::ValidationError("指定的学习计划或日程不存在".to_string())
    })?;

    let schedule_date: String = schedule_row.get("schedule_date");

    // 检查是否已有未完成的练习会话
    let existing_session = sqlx::query(
        "SELECT id FROM practice_sessions WHERE plan_id = ? AND schedule_id = ? AND completed = FALSE"
    )
    .bind(plan_id)
    .bind(schedule_id)
    .fetch_optional(pool.inner())
    .await?;

    if let Some(session_row) = existing_session {
        // 如果已有未完成的练习会话，返回该会话
        let session_id: String = session_row.get("id");
        logger.info("API", &format!("找到现有未完成练习会话: {}", session_id));

        // 获取现有会话的完整信息
        return get_practice_session_by_id(&session_id, pool.inner(), &logger).await;
    }

    // 获取该日程的所有单词（包含完整单词信息）
    let words = sqlx::query(
        "SELECT spsw.id as plan_word_id, spsw.word_id,
                w.word, w.meaning, w.description, w.ipa, w.syllables, w.phonics_segments
         FROM study_plan_schedule_words spsw
         JOIN words w ON spsw.word_id = w.id
         WHERE spsw.schedule_id = ?
         ORDER BY spsw.id"
    )
    .bind(schedule_id)
    .fetch_all(pool.inner())
    .await?;

    if words.is_empty() {
        return Err(AppError::ValidationError("该日程没有安排单词练习".to_string()));
    }

    // 生成会话ID
    let session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // 创建练习会话
    sqlx::query(
        "INSERT INTO practice_sessions (id, plan_id, schedule_id, schedule_date, start_time, total_time, active_time, pause_count, completed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, 0, FALSE, ?, ?)"
    )
    .bind(&session_id)
    .bind(plan_id)
    .bind(schedule_id)
    .bind(&schedule_date)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(pool.inner())
    .await?;

    // 初始化单词练习状态
    let mut word_states = Vec::new();
    for word_row in words {
        let word_id: i64 = word_row.get("word_id");
        let plan_word_id: i64 = word_row.get("plan_word_id");

        // 构建单词信息
        let word_info = crate::types::study::PracticeWordInfo {
            word_id,
            word: word_row.get("word"),
            meaning: word_row.get("meaning"),
            description: word_row.get("description"),
            ipa: word_row.get("ipa"),
            syllables: word_row.get("syllables"),
            phonics_segments: word_row.get("phonics_segments"),
        };

        let word_state = crate::types::study::WordPracticeState {
            word_id,
            plan_word_id,
            word_info,
            current_step: crate::types::study::WordPracticeStep::Step1,
            step_results: vec![false, false, false],
            step_attempts: vec![0, 0, 0],
            step_time_spent: vec![0, 0, 0],
            completed: false,
            passed: false,
            start_time: now.clone(),
            end_time: None,
        };
        word_states.push(word_state);
    }

    let session = crate::types::study::PracticeSession {
        session_id: session_id.clone(),
        plan_id,
        plan_title: schedule_row.get("plan_name"),
        schedule_id,
        schedule_date,
        start_time: now.clone(),
        end_time: None,
        total_time: 0,
        active_time: 0,
        pause_count: 0,
        word_states,
        completed: false,
        created_at: now.clone(),
        updated_at: now,
    };

    logger.api_response("start_practice_session", true, Some(&format!("练习会话已创建，会话ID: {}", session_id)));
    Ok(session)
}

/// 提交步骤结果
#[tauri::command]
pub async fn submit_step_result(
    app: AppHandle,
    session_id: String,
    word_id: i64,
    plan_word_id: i64,
    step: i32,
    user_input: String,
    is_correct: bool,
    time_spent: i64,
    attempts: i32,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("submit_step_result", Some(&format!(
        "session_id: {}, word_id: {}, step: {}, is_correct: {}",
        session_id, word_id, step, is_correct
    )));

    // 验证步骤范围
    if step < 1 || step > 3 {
        return Err(AppError::ValidationError("步骤必须在1-3之间".to_string()));
    }

    // 验证会话是否存在且未完成
    let session_exists = sqlx::query(
        "SELECT id FROM practice_sessions WHERE id = ? AND completed = FALSE"
    )
    .bind(&session_id)
    .fetch_optional(pool.inner())
    .await?;

    if session_exists.is_none() {
        return Err(AppError::ValidationError("练习会话不存在或已完成".to_string()));
    }

    // 记录步骤结果
    sqlx::query(
        "INSERT INTO word_practice_records (session_id, word_id, plan_word_id, step, user_input, is_correct, time_spent, attempts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&session_id)
    .bind(word_id)
    .bind(plan_word_id)
    .bind(step)
    .bind(&user_input)
    .bind(is_correct)
    .bind(time_spent)
    .bind(attempts)
    .execute(pool.inner())
    .await?;

    logger.api_response("submit_step_result", true, Some("步骤结果已记录"));
    Ok(())
}

/// 暂停练习会话
#[tauri::command]
pub async fn pause_practice_session(
    app: AppHandle,
    session_id: String,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("pause_practice_session", Some(&format!("session_id: {}", session_id)));

    // 验证会话是否存在且未完成
    let session_exists = sqlx::query(
        "SELECT id FROM practice_sessions WHERE id = ? AND completed = FALSE"
    )
    .bind(&session_id)
    .fetch_optional(pool.inner())
    .await?;

    if session_exists.is_none() {
        return Err(AppError::ValidationError("练习会话不存在或已完成".to_string()));
    }

    // 记录暂停时间
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO practice_pause_records (session_id, pause_start) VALUES (?, ?)"
    )
    .bind(&session_id)
    .bind(&now)
    .execute(pool.inner())
    .await?;

    // 更新暂停次数
    sqlx::query(
        "UPDATE practice_sessions SET pause_count = pause_count + 1, updated_at = ? WHERE id = ?"
    )
    .bind(&now)
    .bind(&session_id)
    .execute(pool.inner())
    .await?;

    logger.api_response("pause_practice_session", true, Some("练习会话已暂停"));
    Ok(())
}

/// 恢复练习会话
#[tauri::command]
pub async fn resume_practice_session(
    app: AppHandle,
    session_id: String,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("resume_practice_session", Some(&format!("session_id: {}", session_id)));

    // 验证会话是否存在且未完成
    logger.info("API", &format!("验证会话是否存在: {}", session_id));
    let session_exists = match sqlx::query(
        "SELECT id FROM practice_sessions WHERE id = ? AND completed = FALSE"
    )
    .bind(&session_id)
    .fetch_optional(pool.inner())
    .await {
        Ok(result) => {
            logger.info("API", &format!("会话查询结果: {:?}", result.is_some()));
            result
        }
        Err(e) => {
            logger.info("API", &format!("会话查询失败: {}", e));
            return Err(AppError::DatabaseError(format!("查询会话失败: {}", e)));
        }
    };

    if session_exists.is_none() {
        logger.info("API", &format!("会话不存在或已完成: {}", session_id));
        return Err(AppError::ValidationError("练习会话不存在或已完成".to_string()));
    }

    // 更新最后一个暂停记录的结束时间
    let now = chrono::Utc::now().to_rfc3339();
    logger.info("API", &format!("更新暂停记录，时间: {}", now));

    // 先查找最新的未结束暂停记录
    let latest_pause_record = sqlx::query(
        "SELECT id FROM practice_pause_records
         WHERE session_id = ? AND pause_end IS NULL
         ORDER BY id DESC LIMIT 1"
    )
    .bind(&session_id)
    .fetch_optional(pool.inner())
    .await?;

    if let Some(record) = latest_pause_record {
        let record_id: i64 = record.get("id");

        // 更新找到的暂停记录
        match sqlx::query(
            "UPDATE practice_pause_records SET pause_end = ? WHERE id = ?"
        )
        .bind(&now)
        .bind(record_id)
        .execute(pool.inner())
        .await {
            Ok(result) => {
                logger.info("API", &format!("暂停记录更新成功，影响行数: {}", result.rows_affected()));
            }
            Err(e) => {
                logger.info("API", &format!("暂停记录更新失败: {}", e));
                return Err(AppError::DatabaseError(format!("更新暂停记录失败: {}", e)));
            }
        };
    } else {
        logger.info("API", "未找到需要更新的暂停记录");
        return Err(AppError::ValidationError("未找到需要更新的暂停记录".to_string()));
    }

    // 更新会话的更新时间
    logger.info("API", "更新会话时间");
    match sqlx::query(
        "UPDATE practice_sessions SET updated_at = ? WHERE id = ?"
    )
    .bind(&now)
    .bind(&session_id)
    .execute(pool.inner())
    .await {
        Ok(result) => {
            logger.info("API", &format!("会话更新成功，影响行数: {}", result.rows_affected()));
        }
        Err(e) => {
            logger.info("API", &format!("会话更新失败: {}", e));
            return Err(AppError::DatabaseError(format!("更新会话失败: {}", e)));
        }
    };

    logger.api_response("resume_practice_session", true, Some("练习会话已恢复"));
    Ok(())
}

/// 完成练习会话
#[tauri::command]
pub async fn complete_practice_session(
    app: AppHandle,
    session_id: String,
    total_time: i64,
    active_time: i64,
) -> AppResult<crate::types::study::PracticeResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("complete_practice_session", Some(&format!("session_id: {}", session_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 获取会话信息（允许已完成的会话）
    let session_row = sqlx::query(
        "SELECT plan_id, schedule_id, schedule_date, pause_count, completed FROM practice_sessions WHERE id = ?"
    )
    .bind(&session_id)
    .fetch_optional(&mut *tx)
    .await?;

    let session_row = session_row.ok_or_else(|| {
        AppError::ValidationError("练习会话不存在".to_string())
    })?;

    let plan_id: i64 = session_row.get("plan_id");
    let schedule_id: i64 = session_row.get("schedule_id");
    let schedule_date: String = session_row.get("schedule_date");
    let pause_count: i32 = session_row.get("pause_count");
    let is_completed: bool = session_row.get("completed");

    // 如果会话已完成，直接返回已有的结果
    if is_completed {
        logger.info("API", &format!("会话已完成，返回已有结果: {}", session_id));

        // 获取已有的练习结果
        let word_states = get_word_practice_states(&session_id, &mut tx).await?;

        // 分离通过和困难的单词
        let (passed_words, difficult_words): (Vec<_>, Vec<_>) = word_states.into_iter()
            .partition(|state| state.passed);

        let total_words = passed_words.len() + difficult_words.len();
        let word_accuracy = if total_words > 0 {
            passed_words.len() as f64 / total_words as f64
        } else {
            0.0
        };

        let total_steps = total_words * 3;
        let correct_steps = passed_words.iter()
            .map(|w| w.step_results.iter().filter(|&&r| r).count())
            .sum::<usize>() + difficult_words.iter()
            .map(|w| w.step_results.iter().filter(|&&r| r).count())
            .sum::<usize>();

        let step_accuracy = if total_steps > 0 {
            correct_steps as f64 / total_steps as f64
        } else {
            0.0
        };

        // 从数据库获取会话的时间信息
        let session_time_row = sqlx::query(
            "SELECT total_time, active_time, end_time FROM practice_sessions WHERE id = ?"
        )
        .bind(&session_id)
        .fetch_one(&mut *tx)
        .await?;

        let total_time: i64 = session_time_row.get("total_time");
        let active_time: i64 = session_time_row.get("active_time");
        let end_time: Option<String> = session_time_row.get("end_time");

        let average_time_per_word = if total_words > 0 {
            active_time as f64 / total_words as f64
        } else {
            0.0
        };

        let existing_result = crate::types::study::PracticeResult {
            session_id: session_id.clone(),
            plan_id,
            schedule_id,
            schedule_date: schedule_date.clone(),
            total_words: total_words as i32,
            passed_words: passed_words.len() as i32,
            total_steps: total_steps as i32,
            correct_steps: correct_steps as i32,
            step_accuracy,
            word_accuracy,
            total_time,
            active_time,
            pause_count,
            average_time_per_word: average_time_per_word as i64,
            difficult_words: difficult_words,
            passed_words_list: passed_words,
            completed_at: end_time.unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        };

        tx.commit().await?;

        logger.info("API", &format!("练习会话结果已返回，正确率: {:.1}%", existing_result.word_accuracy * 100.0));
        return Ok(existing_result);
    }

    // 获取所有练习记录
    let practice_records = sqlx::query(
        "SELECT word_id, plan_word_id, step, is_correct, time_spent, attempts, created_at
         FROM word_practice_records
         WHERE session_id = ?
         ORDER BY word_id, step, created_at"
    )
    .bind(&session_id)
    .fetch_all(&mut *tx)
    .await?;

    // 统计结果 - 只记录每个步骤的第一次尝试
    let mut word_results: std::collections::HashMap<i64, Vec<bool>> = std::collections::HashMap::new();
    let mut word_step_seen: std::collections::HashMap<(i64, i32), bool> = std::collections::HashMap::new();
    let mut total_steps = 0;
    let mut correct_steps = 0;

    for record in &practice_records {
        let word_id: i64 = record.get("word_id");
        let step: i32 = record.get("step");
        let is_correct: bool = record.get("is_correct");

        let step_key = (word_id, step);

        // 只处理每个步骤的第一次尝试
        if !word_step_seen.contains_key(&step_key) {
            word_step_seen.insert(step_key, true);

            word_results.entry(word_id).or_insert_with(Vec::new).push(is_correct);
            total_steps += 1;
            if is_correct {
                correct_steps += 1;
            }
        }
    }

    let total_words = word_results.len() as i32;
    let passed_words = word_results.values().filter(|steps| steps.len() == 3 && steps.iter().all(|&x| x)).count() as i32;

    let step_accuracy = if total_steps > 0 { (correct_steps as f64 / total_steps as f64) * 100.0 } else { 0.0 };
    let word_accuracy = if total_words > 0 { (passed_words as f64 / total_words as f64) * 100.0 } else { 0.0 };
    let average_time_per_word = if total_words > 0 { active_time / total_words as i64 } else { 0 };

    // 更新会话状态
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE practice_sessions SET completed = TRUE, end_time = ?, total_time = ?, active_time = ?, updated_at = ? WHERE id = ?"
    )
    .bind(&now)
    .bind(total_time)
    .bind(active_time)
    .bind(&now)
    .bind(&session_id)
    .execute(&mut *tx)
    .await?;

    // 更新单词完成状态到 study_plan_schedule_words 表
    // 获取所有通过的单词ID
    let passed_word_ids: Vec<i64> = word_results.iter()
        .filter(|(_, steps)| steps.len() == 3 && steps.iter().all(|&x| x))
        .map(|(word_id, _)| *word_id)
        .collect();

    // 批量更新通过的单词为已完成状态
    if !passed_word_ids.is_empty() {
        let placeholders = passed_word_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let update_completed_query = format!(
            "UPDATE study_plan_schedule_words SET completed = TRUE
             WHERE schedule_id = ? AND word_id IN ({})",
            placeholders
        );

        let mut query = sqlx::query(&update_completed_query).bind(schedule_id);
        for word_id in &passed_word_ids {
            query = query.bind(word_id);
        }

        if let Err(e) = query.execute(&mut *tx).await {
            logger.database_operation("UPDATE", "study_plan_schedule_words", false,
                Some(&format!("Failed to update word completion status: {}", e)));
        } else {
            logger.database_operation("UPDATE", "study_plan_schedule_words", true,
                Some(&format!("Updated {} words to completed status", passed_word_ids.len())));
        }
    }

    // 双轨制数据同步：创建对应的 study_sessions 记录
    let study_session_query = r#"
        INSERT INTO study_sessions (
            plan_id,
            started_at,
            finished_at,
            words_studied,
            correct_answers,
            total_time_seconds
        ) VALUES (?, ?, ?, ?, ?, ?)
    "#;

    // 获取会话开始时间
    let session_start_query = "SELECT start_time FROM practice_sessions WHERE id = ?";
    let start_time_row = sqlx::query(session_start_query)
        .bind(&session_id)
        .fetch_one(&mut *tx)
        .await?;
    let start_time: String = start_time_row.get("start_time");

    // 创建 study_sessions 记录
    if let Err(e) = sqlx::query(study_session_query)
        .bind(plan_id)
        .bind(&start_time)
        .bind(&now)
        .bind(total_words)
        .bind(passed_words)
        .bind(active_time / 1000) // 转换为秒
        .execute(&mut *tx)
        .await
    {
        logger.database_operation("INSERT", "study_sessions", false, Some(&format!("Failed to create study session: {}", e)));
        // 不要因为 study_sessions 创建失败而回滚整个事务，只记录错误
        logger.info("SYNC_WARNING", &format!("Practice session completed but study session sync failed: {}", e));
    } else {
        logger.database_operation("INSERT", "study_sessions", true, Some("Successfully synced practice session to study sessions"));
    }

    // 获取详细的单词练习状态（通过和未通过的单词）
    let word_states = get_word_practice_states(&session_id, &mut tx).await?;

    logger.info("COMPLETE_PRACTICE_DEBUG", &format!("获取到 {} 个单词状态", word_states.len()));

    // 分离通过和未通过的单词
    let mut passed_words_list = Vec::new();
    let mut difficult_words = Vec::new();

    for word_state in &word_states {
        logger.info("COMPLETE_PRACTICE_DEBUG", &format!(
            "单词: {}, 通过: {}, 步骤结果: {:?}",
            word_state.word_info.word,
            word_state.passed,
            word_state.step_results
        ));

        if word_state.passed {
            passed_words_list.push(word_state.clone());
        } else {
            difficult_words.push(word_state.clone());
        }
    }

    logger.info("COMPLETE_PRACTICE_DEBUG", &format!(
        "分离结果: 通过 {} 个单词, 困难 {} 个单词",
        passed_words_list.len(),
        difficult_words.len()
    ));

    // 提交事务
    tx.commit().await?;

    let result = crate::types::study::PracticeResult {
        session_id: session_id.clone(),
        plan_id,
        schedule_id,
        schedule_date,
        total_words,
        passed_words,
        total_steps,
        correct_steps,
        step_accuracy,
        word_accuracy,
        total_time,
        active_time,
        pause_count,
        average_time_per_word,
        difficult_words,
        passed_words_list,
        completed_at: now,
    };

    logger.api_response("complete_practice_session", true, Some(&format!("练习会话已完成，正确率: {:.1}%", word_accuracy)));
    Ok(result)
}

/// 获取未完成的练习会话
#[tauri::command]
pub async fn get_incomplete_practice_sessions(
    app: AppHandle,
) -> AppResult<Vec<crate::types::study::PracticeSession>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_incomplete_practice_sessions", None);

    // 先查询所有未完成的练习会话（不过滤学习计划状态）
    let all_sessions = sqlx::query(
        "SELECT COUNT(*) as total_count FROM practice_sessions WHERE completed = FALSE"
    )
    .fetch_one(pool.inner())
    .await?;

    let total_incomplete: i64 = all_sessions.get("total_count");
    logger.info("INCOMPLETE_SESSIONS_DEBUG", &format!("Total incomplete sessions: {}", total_incomplete));

    let sessions = sqlx::query(
        "SELECT DISTINCT ps.id, ps.plan_id, ps.schedule_id, ps.schedule_date, ps.start_time, ps.end_time,
                ps.total_time, ps.active_time, ps.pause_count, ps.completed, ps.created_at, ps.updated_at,
                sp.name as plan_name
         FROM practice_sessions ps
         JOIN study_plans sp ON ps.plan_id = sp.id
         WHERE ps.completed = FALSE
           AND sp.deleted_at IS NULL
           AND sp.status = 'normal'
           AND sp.unified_status IN ('Pending', 'Active')
         ORDER BY ps.created_at DESC"
    )
    .fetch_all(pool.inner())
    .await?;

    let mut result = Vec::new();
    for session_row in sessions {
        let session_id: String = session_row.get("id");

        let session = crate::types::study::PracticeSession {
            session_id: session_id.clone(),
            plan_id: session_row.get("plan_id"),
            plan_title: session_row.get("plan_name"),
            schedule_id: session_row.get("schedule_id"),
            schedule_date: session_row.get("schedule_date"),
            start_time: session_row.get("start_time"),
            end_time: session_row.get("end_time"),
            total_time: session_row.get("total_time"),
            active_time: session_row.get("active_time"),
            pause_count: session_row.get("pause_count"),
            word_states: Vec::new(), // 暂时为空，如需要可以单独查询
            completed: session_row.get("completed"),
            created_at: session_row.get("created_at"),
            updated_at: session_row.get("updated_at"),
        };
        result.push(session);
    }

    logger.api_response("get_incomplete_practice_sessions", true, Some(&format!("找到 {} 个未完成的练习会话（总共 {} 个，过滤了 {} 个非正常状态的学习计划）", result.len(), total_incomplete, total_incomplete as usize - result.len())));
    Ok(result)
}

/// 获取练习会话详情
#[tauri::command]
pub async fn get_practice_session_detail(
    app: AppHandle,
    session_id: String,
) -> AppResult<crate::types::study::PracticeSession> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_practice_session_detail", Some(&format!("session_id: {}", session_id)));

    match get_practice_session_by_id(&session_id, &pool, &logger).await {
        Ok(session) => {
            logger.api_response("get_practice_session_detail", true, Some(&format!("成功获取练习会话详情: {}", session_id)));
            Ok(session)
        }
        Err(e) => {
            logger.api_response("get_practice_session_detail", false, Some(&format!("获取练习会话详情失败: {}", e)));
            Err(e)
        }
    }
}

/// 取消练习会话
#[tauri::command]
pub async fn cancel_practice_session(
    app: AppHandle,
    session_id: String,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("cancel_practice_session", Some(&format!("session_id: {}", session_id)));

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 验证会话是否存在且未完成
    let session_exists = sqlx::query(
        "SELECT id FROM practice_sessions WHERE id = ? AND completed = FALSE"
    )
    .bind(&session_id)
    .fetch_optional(&mut *tx)
    .await?;

    if session_exists.is_none() {
        let _ = tx.rollback().await;
        return Err(AppError::ValidationError("练习会话不存在或已完成".to_string()));
    }

    // 删除相关的练习记录
    sqlx::query("DELETE FROM word_practice_records WHERE session_id = ?")
        .bind(&session_id)
        .execute(&mut *tx)
        .await?;

    // 删除暂停记录
    sqlx::query("DELETE FROM practice_pause_records WHERE session_id = ?")
        .bind(&session_id)
        .execute(&mut *tx)
        .await?;

    // 删除练习会话
    sqlx::query("DELETE FROM practice_sessions WHERE id = ?")
        .bind(&session_id)
        .execute(&mut *tx)
        .await?;

    // 提交事务
    tx.commit().await?;

    logger.api_response("cancel_practice_session", true, Some("练习会话已取消"));
    Ok(())
}

/// 获取学习计划的练习会话列表
#[tauri::command]
pub async fn get_plan_practice_sessions(
    app: AppHandle,
    plan_id: i64,
) -> AppResult<Vec<crate::types::study::PracticeSession>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_plan_practice_sessions", Some(&format!("plan_id: {}", plan_id)));

    let sessions = sqlx::query(
        "SELECT ps.id, ps.plan_id, ps.schedule_id, ps.schedule_date, ps.start_time, ps.end_time,
                ps.total_time, ps.active_time, ps.pause_count, ps.completed, ps.created_at, ps.updated_at,
                sp.name as plan_name
         FROM practice_sessions ps
         JOIN study_plans sp ON ps.plan_id = sp.id
         WHERE ps.plan_id = ?
         ORDER BY ps.created_at DESC"
    )
    .bind(plan_id)
    .fetch_all(pool.inner())
    .await?;

    let mut result = Vec::new();
    for row in sessions {
        let session = crate::types::study::PracticeSession {
            session_id: row.get("id"),
            plan_id: row.get("plan_id"),
            plan_title: Some(row.get("plan_name")),
            schedule_id: row.get("schedule_id"),
            schedule_date: row.get("schedule_date"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
            total_time: row.get("total_time"),
            active_time: row.get("active_time"),
            pause_count: row.get("pause_count"),
            completed: row.get("completed"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            word_states: Vec::new(), // 这里不需要加载单词详情
        };
        result.push(session);
    }

    logger.api_response("get_plan_practice_sessions", true, Some(&format!("找到 {} 个练习会话", result.len())));
    Ok(result)
}

/// 获取练习统计数据
#[tauri::command]
pub async fn get_practice_statistics(
    app: AppHandle,
    plan_id: i64,
) -> AppResult<crate::types::study::PracticeStatistics> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_practice_statistics", Some(&format!("plan_id: {}", plan_id)));

    // 获取总会话数和完成会话数
    let sessions_query = r#"
        SELECT
            COUNT(*) as total_sessions,
            COUNT(CASE WHEN completed = TRUE THEN 1 END) as completed_sessions,
            COALESCE(SUM(active_time), 0) as total_practice_time
        FROM practice_sessions
        WHERE plan_id = ?
    "#;

    let sessions_row = sqlx::query(sessions_query)
        .bind(plan_id)
        .fetch_one(pool.inner())
        .await?;

    let total_sessions: i64 = sessions_row.get("total_sessions");
    let completed_sessions: i64 = sessions_row.get("completed_sessions");
    let total_practice_time: i64 = sessions_row.get("total_practice_time");

    // 获取练习准确率统计
    let accuracy_query = r#"
        SELECT
            COUNT(*) as total_steps,
            COUNT(CASE WHEN is_correct = TRUE THEN 1 END) as correct_steps
        FROM word_practice_records wpr
        JOIN practice_sessions ps ON wpr.session_id = ps.id
        WHERE ps.plan_id = ? AND ps.completed = TRUE
    "#;

    let accuracy_row = sqlx::query(accuracy_query)
        .bind(plan_id)
        .fetch_one(pool.inner())
        .await?;

    let total_steps: i64 = accuracy_row.get("total_steps");
    let correct_steps: i64 = accuracy_row.get("correct_steps");
    let average_accuracy = if total_steps > 0 {
        (correct_steps as f64 / total_steps as f64) * 100.0
    } else {
        0.0
    };

    // 获取已学习的单词数（通过完成的练习记录统计）
    let words_learned_query = r#"
        SELECT COUNT(DISTINCT wpr.word_id) as words_learned
        FROM word_practice_records wpr
        JOIN practice_sessions ps ON wpr.session_id = ps.id
        WHERE ps.plan_id = ? AND ps.completed = TRUE
        AND wpr.word_id IN (
            SELECT word_id
            FROM word_practice_records wpr2
            JOIN practice_sessions ps2 ON wpr2.session_id = ps2.id
            WHERE ps2.plan_id = ? AND ps2.completed = TRUE
            GROUP BY wpr2.word_id, wpr2.session_id
            HAVING COUNT(*) = 3 AND SUM(CASE WHEN wpr2.is_correct THEN 1 ELSE 0 END) = 3
        )
    "#;

    let words_learned_row = sqlx::query(words_learned_query)
        .bind(plan_id)
        .bind(plan_id)
        .fetch_one(pool.inner())
        .await?;

    let words_learned: i64 = words_learned_row.get("words_learned");

    let result = crate::types::study::PracticeStatistics {
        total_sessions: total_sessions as i32,
        completed_sessions: completed_sessions as i32,
        average_accuracy,
        total_practice_time,
        words_learned: words_learned as i32,
    };

    logger.api_response("get_practice_statistics", true, Some(&format!(
        "统计完成: 总会话{}, 完成{}, 准确率{:.1}%",
        total_sessions, completed_sessions, average_accuracy
    )));

    Ok(result)
}

/// 获取学习计划的日程列表
#[tauri::command]
pub async fn get_study_plan_schedules(
    app: AppHandle,
    plan_id: i64,
) -> AppResult<Vec<serde_json::Value>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.info("PARAM_DEBUG", &format!("get_study_plan_schedules received plan_id: {}", plan_id));
    logger.api_request("get_study_plan_schedules", Some(&format!("plan_id: {}", plan_id)));

    // 验证学习计划是否存在
    let plan_exists = sqlx::query(
        "SELECT id FROM study_plans WHERE id = ?"
    )
    .bind(plan_id)
    .fetch_optional(pool.inner())
    .await?;

    if plan_exists.is_none() {
        return Err(AppError::ValidationError("学习计划不存在".to_string()));
    }

    // 先检查是否有基础的日程记录
    let basic_schedules = sqlx::query(
        "SELECT id, schedule_date FROM study_plan_schedules WHERE plan_id = ?"
    )
    .bind(plan_id)
    .fetch_all(pool.inner())
    .await?;

    logger.info("SCHEDULE_DEBUG", &format!("Found {} basic schedules for plan {}", basic_schedules.len(), plan_id));

    // 获取日程列表
    let schedules = sqlx::query(
        "SELECT sps.id, sps.schedule_date,
                COUNT(spsw.id) as word_count,
                CASE WHEN COUNT(ps.id) > 0 AND ps.completed = 1 THEN 1 ELSE 0 END as completed
         FROM study_plan_schedules sps
         LEFT JOIN study_plan_schedule_words spsw ON sps.id = spsw.schedule_id
         LEFT JOIN practice_sessions ps ON sps.id = ps.schedule_id AND ps.completed = 1
         WHERE sps.plan_id = ?
         GROUP BY sps.id, sps.schedule_date
         ORDER BY sps.schedule_date ASC"
    )
    .bind(plan_id)
    .fetch_all(pool.inner())
    .await?;

    let mut result = Vec::new();
    for schedule_row in schedules {
        let schedule_data = serde_json::json!({
            "id": schedule_row.get::<i64, _>("id"),
            "schedule_date": schedule_row.get::<String, _>("schedule_date"),
            "word_count": schedule_row.get::<i64, _>("word_count"),
            "completed": schedule_row.get::<i64, _>("completed") == 1
        });
        result.push(schedule_data);
    }

    logger.api_response("get_study_plan_schedules", true, Some(&format!("找到 {} 个日程", result.len())));
    Ok(result)
}

/// 获取学习计划的日历数据（用于StudyCalendar组件）
#[tauri::command]
pub async fn get_study_plan_calendar_data(
    app: AppHandle,
    plan_id: i64,
    year: i32,
    month: i32,
) -> AppResult<Vec<crate::types::study::CalendarDayData>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_study_plan_calendar_data", Some(&format!("plan_id: {}, year: {}, month: {}", plan_id, year, month)));

    // 验证学习计划是否存在
    let plan_exists = sqlx::query("SELECT id FROM study_plans WHERE id = ? AND deleted_at IS NULL")
        .bind(plan_id)
        .fetch_optional(pool.inner())
        .await?;

    if plan_exists.is_none() {
        return Err(AppError::ValidationError("学习计划不存在".to_string()));
    }

    // 计算月份的日期范围
    let start_date = chrono::NaiveDate::from_ymd_opt(year, month as u32, 1)
        .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?;

    let end_date = if month == 12 {
        chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        chrono::NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)
    }.ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
    .pred_opt()
    .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?;

    // 扩展到包含完整的日历视图（6周）
    let calendar_start = start_date - chrono::Duration::days(start_date.weekday().num_days_from_sunday() as i64);
    let calendar_end = calendar_start + chrono::Duration::days(41); // 6周 = 42天

    // 查询该学习计划在日期范围内的日程数据，使用预计算字段
    let schedules_query = r#"
        SELECT
            sps.schedule_date,
            sps.total_words_count as total_words,
            sps.new_words_count as new_words,
            sps.review_words_count as review_words,
            sps.completed_words_count as completed_words
        FROM study_plan_schedules sps
        WHERE sps.plan_id = ?
            AND sps.schedule_date BETWEEN ? AND ?
        ORDER BY sps.schedule_date
    "#;

    let schedule_rows = sqlx::query(schedules_query)
        .bind(plan_id)
        .bind(calendar_start.format("%Y-%m-%d").to_string())
        .bind(calendar_end.format("%Y-%m-%d").to_string())
        .fetch_all(pool.inner())
        .await?;

    // 创建日程数据映射
    let mut schedule_map = std::collections::HashMap::new();
    for row in schedule_rows {
        let date: String = row.get("schedule_date");
        let total_words: i32 = row.get("total_words");
        let new_words: i32 = row.get("new_words");
        let review_words: i32 = row.get("review_words");
        let completed_words: i32 = row.get("completed_words");

        schedule_map.insert(date, (total_words, new_words, review_words, completed_words));
    }

    // 生成完整的日历数据
    let mut calendar_data = Vec::new();
    let today = chrono::Local::now().date_naive();
    let mut current_date = calendar_start;

    while current_date <= calendar_end {
        let date_str = current_date.format("%Y-%m-%d").to_string();
        let is_today = current_date == today;
        let is_in_current_month = current_date.month() == month as u32;

        let (total_words, new_words, review_words, completed_words) =
            schedule_map.get(&date_str).copied().unwrap_or((0, 0, 0, 0));

        let is_in_plan = total_words > 0;

        let status = if !is_in_plan {
            "not-started"
        } else if completed_words >= total_words {
            "completed"
        } else if completed_words > 0 {
            "in-progress"
        } else if current_date < today {
            "overdue"
        } else {
            "not-started"
        };

        let progress_percentage = if total_words > 0 {
            (completed_words as f64 / total_words as f64 * 100.0).round() as i32
        } else {
            0
        };

        calendar_data.push(crate::types::study::CalendarDayData {
            date: date_str,
            is_today,
            is_in_plan, // 移除月份限制，让所有有计划的日期都显示
            status: status.to_string(),
            new_words_count: new_words,
            review_words_count: review_words,
            total_words_count: total_words,
            completed_words_count: completed_words,
            progress_percentage: progress_percentage as f64,
            study_plans: None, // 单个计划的日历不需要这个字段
            study_time_minutes: None, // TODO: 如果需要学习时间统计
            study_sessions: None, // 单个计划的日历不需要这个字段
        });

        current_date = current_date.succ_opt()
            .ok_or_else(|| AppError::InternalError("Date overflow".to_string()))?;
    }

    logger.api_response("get_study_plan_calendar_data", true, Some(&format!("Generated {} calendar days", calendar_data.len())));
    Ok(calendar_data)
}

/// 获取练习会话中所有单词的练习状态
async fn get_word_practice_states(
    session_id: &str,
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> AppResult<Vec<crate::types::study::WordPracticeState>> {
    // 获取会话信息
    let session_row = sqlx::query(
        "SELECT schedule_id FROM practice_sessions WHERE id = ?"
    )
    .bind(session_id)
    .fetch_one(&mut **tx)
    .await?;

    let schedule_id: i64 = session_row.get("schedule_id");

    // 获取该日程的所有单词
    let words = sqlx::query(
        "SELECT spsw.id as plan_word_id, spsw.word_id,
                w.word, w.meaning, w.description, w.ipa, w.syllables, w.phonics_segments, w.phonics_rule
         FROM study_plan_schedule_words spsw
         JOIN words w ON spsw.word_id = w.id
         WHERE spsw.schedule_id = ?
         ORDER BY spsw.id"
    )
    .bind(schedule_id)
    .fetch_all(&mut **tx)
    .await?;

    // 获取练习记录，按时间排序确保第一次尝试在前
    let completed_records = sqlx::query(
        "SELECT word_id, plan_word_id, step, is_correct, time_spent, attempts, created_at
         FROM word_practice_records
         WHERE session_id = ?
         ORDER BY word_id, step, created_at"
    )
    .bind(session_id)
    .fetch_all(&mut **tx)
    .await?;

    let start_time = chrono::Utc::now().to_rfc3339();
    let mut word_states = Vec::new();

    for word_row in words {
        let word_id: i64 = word_row.get("word_id");
        let plan_word_id: i64 = word_row.get("plan_word_id");

        // 分析该单词的练习记录
        let word_records: Vec<_> = completed_records.iter()
            .filter(|r| r.get::<i64, _>("word_id") == word_id)
            .collect();

        // 确定当前步骤和结果
        let mut current_step = crate::types::study::WordPracticeStep::Step1;
        let mut step_results = vec![false, false, false];
        let mut step_attempts = vec![0, 0, 0];
        let mut step_time_spent = vec![0i64, 0i64, 0i64];
        let mut completed = false;
        let mut passed = false;
        let mut max_completed_step = 0;

        // 按步骤分组处理记录，只记录第一次尝试的结果
        for step_num in 1..=3 {
            let step_records: Vec<_> = word_records.iter()
                .filter(|r| r.get::<i32, _>("step") == step_num)
                .collect();

            if !step_records.is_empty() {
                let step_index = (step_num - 1) as usize;
                max_completed_step = step_num;

                // 只取第一次尝试的结果（新逻辑：每步只允许一次尝试）
                let first_record = step_records.first().unwrap();
                let is_correct: bool = first_record.get("is_correct");
                let time_spent: i64 = first_record.get("time_spent");
                let attempts: i32 = first_record.get("attempts");

                step_results[step_index] = is_correct;
                step_attempts[step_index] = attempts;
                step_time_spent[step_index] = time_spent;

                // 更新当前步骤
                if is_correct && step_num < 3 {
                    current_step = match step_num {
                        1 => crate::types::study::WordPracticeStep::Step2,
                        2 => crate::types::study::WordPracticeStep::Step3,
                        _ => current_step,
                    };
                } else if step_num == 3 {
                    current_step = crate::types::study::WordPracticeStep::Step3;
                }
            }
        }

        // 判断是否完成和通过
        completed = max_completed_step == 3;
        if completed {
            passed = step_results.iter().all(|&r| r);
        }

        // 优先使用phonics_rule，如果没有则使用phonics_segments
        let phonics_rule: Option<String> = word_row.get("phonics_rule");
        let phonics_segments: Option<String> = word_row.get("phonics_segments");
        let final_phonics = phonics_rule.or(phonics_segments);

        let word_info = crate::types::study::PracticeWordInfo {
            word_id,
            word: word_row.get("word"),
            meaning: word_row.get("meaning"),
            description: word_row.get("description"),
            ipa: word_row.get("ipa"),
            syllables: word_row.get("syllables"),
            phonics_segments: final_phonics,
        };

        let word_state = crate::types::study::WordPracticeState {
            word_id,
            plan_word_id,
            word_info,
            current_step,
            step_results,
            step_attempts,
            step_time_spent,
            completed,
            passed,
            start_time: start_time.clone(),
            end_time: None,
        };

        word_states.push(word_state);
    }

    Ok(word_states)
}

/// 根据会话ID获取完整的练习会话信息
async fn get_practice_session_by_id(
    session_id: &str,
    pool: &sqlx::SqlitePool,
    logger: &Logger,
) -> AppResult<crate::types::study::PracticeSession> {
    logger.info("API", &format!("开始获取练习会话详情: {}", session_id));
    // 获取练习会话基本信息
    let session_row = match sqlx::query(
        "SELECT ps.id, ps.plan_id, ps.schedule_id, ps.schedule_date, ps.start_time, ps.end_time,
                ps.total_time, ps.active_time, ps.pause_count, ps.completed, ps.created_at, ps.updated_at,
                sp.name as plan_name
         FROM practice_sessions ps
         JOIN study_plans sp ON ps.plan_id = sp.id
         WHERE ps.id = ?"
    )
    .bind(session_id)
    .fetch_one(pool)
    .await {
        Ok(row) => {
            logger.info("API", &format!("成功获取会话基本信息: {}", session_id));
            row
        }
        Err(e) => {
            logger.info("API", &format!("获取会话基本信息失败: {}, 错误: {}", session_id, e));
            return Err(AppError::DatabaseError(format!("获取练习会话失败: {}", e)));
        }
    };

    // 从日程中获取单词信息（因为现有的数据库结构不支持复杂的练习状态）
    let schedule_id: i64 = session_row.get("schedule_id");
    logger.info("API", &format!("获取日程单词，schedule_id: {}", schedule_id));

    let words = sqlx::query(
        "SELECT spsw.id as plan_word_id, spsw.word_id,
                w.word, w.meaning, w.description, w.ipa, w.syllables, w.phonics_segments, w.phonics_rule
         FROM study_plan_schedule_words spsw
         JOIN words w ON spsw.word_id = w.id
         WHERE spsw.schedule_id = ?
         ORDER BY spsw.id"
    )
    .bind(schedule_id)
    .fetch_all(pool)
    .await?;

    logger.info("API", &format!("找到 {} 个单词", words.len()));

    let start_time: String = session_row.get("start_time");

    // 获取已完成的练习记录，用于确定当前进度
    logger.info("API", &format!("查询练习记录，session_id: {}", session_id));

    let completed_records = sqlx::query(
        "SELECT word_id, plan_word_id, step, is_correct
         FROM word_practice_records
         WHERE session_id = ?
         ORDER BY word_id, step"
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    logger.info("API", &format!("找到 {} 条练习记录", completed_records.len()));

    // 构建单词状态
    let mut word_states = Vec::new();
    for word_row in words {
        let word_id: i64 = word_row.get("word_id");
        let plan_word_id: i64 = word_row.get("plan_word_id");

        // 分析该单词的练习记录
        let word_records: Vec<_> = completed_records.iter()
            .filter(|r| r.get::<i64, _>("word_id") == word_id)
            .collect();

        // 确定当前步骤和结果
        let mut current_step = crate::types::study::WordPracticeStep::Step1;
        let mut step_results = vec![false, false, false];
        let mut step_attempts = vec![0, 0, 0];
        let step_time_spent = vec![0, 0, 0];
        let mut completed = false;
        let mut passed = false;

        for record in word_records {
            let step: i32 = record.get("step");
            let is_correct: bool = record.get("is_correct");

            if step >= 1 && step <= 3 {
                let step_index = (step - 1) as usize;
                step_results[step_index] = is_correct;
                step_attempts[step_index] += 1;

                // 更新当前步骤
                if step == 3 {
                    completed = true;
                    passed = step_results.iter().all(|&r| r);
                } else if is_correct {
                    current_step = match step {
                        1 => crate::types::study::WordPracticeStep::Step2,
                        2 => crate::types::study::WordPracticeStep::Step3,
                        _ => current_step,
                    };
                }
            }
        }

        // 优先使用phonics_rule，如果没有则使用phonics_segments
        let phonics_rule: Option<String> = word_row.get("phonics_rule");
        let phonics_segments: Option<String> = word_row.get("phonics_segments");
        let final_phonics = phonics_rule.or(phonics_segments);

        let word_info = crate::types::study::PracticeWordInfo {
            word_id,
            word: word_row.get("word"),
            meaning: word_row.get("meaning"),
            description: word_row.get("description"),
            ipa: word_row.get("ipa"),
            syllables: word_row.get("syllables"),
            phonics_segments: final_phonics,
        };

        let word_state = crate::types::study::WordPracticeState {
            word_id,
            plan_word_id,
            word_info,
            current_step,
            step_results,
            step_attempts,
            step_time_spent,
            completed,
            passed,
            start_time: start_time.clone(),
            end_time: None,
        };
        word_states.push(word_state);
    }



    logger.info("API", &format!("构建练习会话对象，单词状态数量: {}", word_states.len()));

    let session = crate::types::study::PracticeSession {
        session_id: session_row.get("id"),
        plan_id: session_row.get("plan_id"),
        plan_title: session_row.get("plan_name"),
        schedule_id: session_row.get("schedule_id"),
        schedule_date: session_row.get("schedule_date"),
        start_time: session_row.get("start_time"),
        end_time: session_row.get("end_time"),
        total_time: session_row.get("total_time"),
        active_time: session_row.get("active_time"),
        pause_count: session_row.get("pause_count"),
        word_states,
        completed: session_row.get("completed"),
        created_at: session_row.get("created_at"),
        updated_at: session_row.get("updated_at"),
    };

    logger.info("API", &format!("成功构建练习会话对象: {}", session_id));
    Ok(session)
}

/// 获取今日学习日程
#[tauri::command]
pub async fn get_today_study_schedules(app: AppHandle) -> AppResult<Vec<TodayStudySchedule>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_today_study_schedules", None);

    let today = chrono::Local::now().date_naive();
    let today_str = today.format("%Y-%m-%d").to_string();

    // 查询今日的学习日程，使用预计算的统计字段
    let query = r#"
        SELECT
            sp.id as plan_id,
            sp.name as plan_name,
            sp.status as plan_status,
            sp.unified_status,
            sps.id as schedule_id,
            sps.schedule_date,
            sps.new_words_count,
            sps.review_words_count,
            sps.total_words_count,
            sps.completed_words_count,
            sps.status as schedule_status,
            CASE
                WHEN sps.completed_words_count >= sps.total_words_count AND sps.total_words_count > 0 THEN 'completed'
                WHEN sps.completed_words_count > 0 THEN 'in-progress'
                ELSE 'not-started'
            END as actual_status
        FROM study_plans sp
        JOIN study_plan_schedules sps ON sp.id = sps.plan_id
        WHERE sps.schedule_date = ?
          AND sp.deleted_at IS NULL
          AND sp.unified_status IN ('Pending', 'Active', 'Paused')
        ORDER BY sp.created_at ASC
    "#;

    let rows = sqlx::query(query)
        .bind(&today_str)
        .fetch_all(pool.inner())
        .await?;

    // 添加调试信息
    logger.info("TODAY_SCHEDULES_DEBUG", &format!("Query executed for date: {}", today_str));
    logger.info("TODAY_SCHEDULES_DEBUG", &format!("Found {} raw rows", rows.len()));

    let schedules: Vec<TodayStudySchedule> = rows.into_iter().map(|row| {
        let total_words: i32 = row.get("total_words_count");
        let completed_words: i32 = row.get("completed_words_count");
        let new_words: i32 = row.get("new_words_count");
        let review_words: i32 = row.get("review_words_count");
        let plan_name: String = row.get("plan_name");
        let status: String = row.get("actual_status");

        let progress_percentage = if total_words > 0 {
            (completed_words as f64 / total_words as f64 * 100.0).round() as i32
        } else {
            0
        };

        logger.info("TODAY_SCHEDULES_DETAIL", &format!(
            "Schedule: plan_name={}, new_words={}, review_words={}, total_words={}, status={}",
            plan_name, new_words, review_words, total_words, status
        ));

        TodayStudySchedule {
            plan_id: row.get("plan_id"),
            plan_name,
            schedule_id: row.get("schedule_id"),
            schedule_date: row.get("schedule_date"),
            new_words_count: new_words,
            review_words_count: review_words,
            total_words_count: total_words,
            completed_words_count: completed_words,
            progress_percentage,
            status,
            can_start_practice: total_words > 0 && completed_words < total_words,
        }
    }).collect();

    // 如果没有找到日程，查询所有学习计划的状态
    if schedules.is_empty() {
        let debug_query = "SELECT id, name, status, unified_status FROM study_plans WHERE deleted_at IS NULL";
        let debug_rows = sqlx::query(debug_query)
            .fetch_all(pool.inner())
            .await
            .unwrap_or_default();

        for row in debug_rows {
            let plan_id: i64 = row.get("id");
            let plan_name: String = row.get("name");
            let status: String = row.get("status");
            let unified_status: Option<String> = row.get("unified_status");
            logger.info("PLAN_STATUS_DEBUG", &format!("Plan {} ({}): status={}, unified_status={:?}", plan_id, plan_name, status, unified_status));
        }

        // 检查是否有今日的日程记录
        let schedule_debug_query = "SELECT sps.id, sps.plan_id, sps.schedule_date, sp.name, sp.status, sp.unified_status FROM study_plan_schedules sps JOIN study_plans sp ON sps.plan_id = sp.id WHERE sps.schedule_date = ?";
        let schedule_debug_rows = sqlx::query(schedule_debug_query)
            .bind(&today_str)
            .fetch_all(pool.inner())
            .await
            .unwrap_or_default();

        logger.info("SCHEDULE_DEBUG", &format!("Found {} schedule records for today", schedule_debug_rows.len()));
        for row in schedule_debug_rows {
            let schedule_id: i64 = row.get("id");
            let plan_id: i64 = row.get("plan_id");
            let plan_name: String = row.get("name");
            let status: String = row.get("status");
            let unified_status: Option<String> = row.get("unified_status");
            logger.info("SCHEDULE_DEBUG", &format!("Schedule {} for plan {} ({}): status={}, unified_status={:?}", schedule_id, plan_id, plan_name, status, unified_status));
        }
    }

    logger.api_response("get_today_study_schedules", true, Some(&format!("Found {} today schedules", schedules.len())));
    Ok(schedules)
}

/// 诊断今日学习计划数据
#[tauri::command]
pub async fn diagnose_today_schedules(app: AppHandle) -> AppResult<String> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("diagnose_today_schedules", None);

    let today = chrono::Local::now().date_naive();
    let today_str = today.format("%Y-%m-%d").to_string();

    let mut diagnosis = Vec::new();
    diagnosis.push(format!("=== 今日学习计划诊断 (日期: {}) ===", today_str));

    // 1. 检查所有学习计划
    let plans_query = "SELECT id, name, status, unified_status, start_date, end_date FROM study_plans WHERE deleted_at IS NULL";
    let plans = sqlx::query(plans_query)
        .fetch_all(pool.inner())
        .await?;

    diagnosis.push(format!("\n1. 所有学习计划 ({} 个):", plans.len()));
    for plan in &plans {
        let id: i64 = plan.get("id");
        let name: String = plan.get("name");
        let status: String = plan.get("status");
        let unified_status: String = plan.get("unified_status");
        let start_date: Option<String> = plan.get("start_date");
        let end_date: Option<String> = plan.get("end_date");

        diagnosis.push(format!(
            "  - 计划 {} ({}): status={}, unified_status={}, start_date={:?}, end_date={:?}",
            id, name, status, unified_status, start_date, end_date
        ));
    }

    // 2. 检查今日的日程记录
    let schedules_query = "SELECT sps.id, sps.plan_id, sps.schedule_date, sp.name, sp.unified_status FROM study_plan_schedules sps JOIN study_plans sp ON sps.plan_id = sp.id WHERE sps.schedule_date = ?";
    let schedules = sqlx::query(schedules_query)
        .bind(&today_str)
        .fetch_all(pool.inner())
        .await?;

    diagnosis.push(format!("\n2. 今日日程记录 ({} 个):", schedules.len()));
    for schedule in &schedules {
        let schedule_id: i64 = schedule.get("id");
        let plan_id: i64 = schedule.get("plan_id");
        let plan_name: String = schedule.get("name");
        let unified_status: String = schedule.get("unified_status");

        diagnosis.push(format!(
            "  - 日程 {} (计划 {} - {}): unified_status={}",
            schedule_id, plan_id, plan_name, unified_status
        ));
    }

    // 3. 检查符合条件的学习计划
    let filtered_query = r#"
        SELECT sp.id, sp.name, sp.unified_status, COUNT(sps.id) as schedule_count
        FROM study_plans sp
        LEFT JOIN study_plan_schedules sps ON sp.id = sps.plan_id AND sps.schedule_date = ?
        WHERE sp.deleted_at IS NULL
        GROUP BY sp.id, sp.name, sp.unified_status
    "#;
    let filtered = sqlx::query(filtered_query)
        .bind(&today_str)
        .fetch_all(pool.inner())
        .await?;

    diagnosis.push(format!("\n3. 学习计划与今日日程匹配情况:"));
    for row in &filtered {
        let id: i64 = row.get("id");
        let name: String = row.get("name");
        let unified_status: String = row.get("unified_status");
        let schedule_count: i64 = row.get("schedule_count");

        let status_match = matches!(unified_status.as_str(), "Pending" | "Active" | "Paused");

        diagnosis.push(format!(
            "  - 计划 {} ({}): unified_status={}, 今日日程数={}, 状态匹配={}",
            id, name, unified_status, schedule_count, status_match
        ));
    }

    // 4. 检查"Issac 的第一个计划"的详细信息
    let isaac_query = r#"
        SELECT sp.*,
               COUNT(sps.id) as total_schedules,
               COUNT(CASE WHEN sps.schedule_date = ? THEN 1 END) as today_schedules
        FROM study_plans sp
        LEFT JOIN study_plan_schedules sps ON sp.id = sps.plan_id
        WHERE sp.name LIKE '%Issac%' AND sp.deleted_at IS NULL
        GROUP BY sp.id
    "#;
    let isaac_plans = sqlx::query(isaac_query)
        .bind(&today_str)
        .fetch_all(pool.inner())
        .await?;

    diagnosis.push(format!("\n4. Issac 计划详细信息:"));
    for plan in &isaac_plans {
        let id: i64 = plan.get("id");
        let name: String = plan.get("name");
        let status: String = plan.get("status");
        let unified_status: String = plan.get("unified_status");
        let start_date: Option<String> = plan.get("start_date");
        let total_schedules: i64 = plan.get("total_schedules");
        let today_schedules: i64 = plan.get("today_schedules");

        diagnosis.push(format!(
            "  - 计划 {} ({}): status={}, unified_status={}, start_date={:?}",
            id, name, status, unified_status, start_date
        ));
        diagnosis.push(format!(
            "    总日程数: {}, 今日日程数: {}",
            total_schedules, today_schedules
        ));
    }

    let result = diagnosis.join("\n");
    logger.info("DIAGNOSIS", &result);

    Ok(result)
}




/// 获取数据库统计信息
#[tauri::command]
pub async fn get_database_statistics(app: AppHandle) -> AppResult<DatabaseOverview> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_database_statistics", None);

    // 动态获取数据库中的所有表，排除系统表和迁移表
    let all_tables_query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations' ORDER BY name";
    let table_rows = sqlx::query(all_tables_query)
        .fetch_all(pool.inner())
        .await?;

    let mut tables = Vec::new();
    let mut total_records = 0i64;

    let total_tables_count = table_rows.len() as i32;

    // 遍历数据库中的所有表
    for table_row in table_rows {
        let table_name: String = table_row.get("name");

        // 简单分类表类型（保留类型信息但不分组）
        let table_type = classify_table_type(&table_name);

        // 查询表的记录数
        let count_query = format!("SELECT COUNT(*) as count FROM {}", table_name);
        let row = sqlx::query(&count_query)
            .fetch_one(pool.inner())
            .await;

        let record_count = match row {
            Ok(row) => row.get::<i64, _>("count"),
            Err(_) => {
                logger.info("TABLE_STATS_DEBUG", &format!("Table {} does not exist or query failed", table_name));
                0 // 表不存在或查询失败时返回0
            }
        };

        total_records += record_count;

        let table_stats = DatabaseTableStats {
            table_name: table_name.clone(),
            display_name: table_name.clone(), // 直接使用原始表名
            record_count,
            table_type: table_type.to_string(),
            description: format!("数据表: {}", table_name), // 简单描述
        };

        tables.push(table_stats);
    }

    let overview = DatabaseOverview {
        total_tables: total_tables_count,
        total_records,
        tables,
    };

    logger.api_response("get_database_statistics", true, Some(&format!("Found {} tables with {} total records", overview.total_tables, overview.total_records)));
    Ok(overview)
}

/// 重置用户数据（保留配置数据）
#[tauri::command]
pub async fn reset_user_data(app: AppHandle) -> AppResult<ResetResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("reset_user_data", None);

    // 定义需要清理的用户数据表（按依赖关系排序）
    let user_data_tables = vec![
        "word_practice_states",    // 单词练习状态
        "practice_sessions",       // 练习会话
        "study_plan_words",        // 学习计划单词关联
        "study_plan_schedules",    // 学习日程
        "study_plans",             // 学习计划
        "words",                   // 单词
        "word_books",              // 单词本
    ];

    let mut deleted_records = 0i64;
    let mut affected_tables = Vec::new();

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 按顺序删除各表数据
    for table_name in &user_data_tables {
        // 先查询记录数
        let count_query = format!("SELECT COUNT(*) as count FROM {}", table_name);
        let count_result = sqlx::query(&count_query)
            .fetch_one(&mut *tx)
            .await;

        let record_count = match count_result {
            Ok(row) => row.get::<i64, _>("count"),
            Err(_) => {
                logger.info("RESET_DEBUG", &format!("Table {} does not exist or is empty", table_name));
                continue;
            }
        };

        if record_count > 0 {
            // 删除表中所有数据
            let delete_query = format!("DELETE FROM {}", table_name);
            let delete_result = sqlx::query(&delete_query)
                .execute(&mut *tx)
                .await;

            match delete_result {
                Ok(result) => {
                    let rows_affected = result.rows_affected() as i64;
                    deleted_records += rows_affected;
                    affected_tables.push(table_name.to_string());
                    logger.info("RESET_DEBUG", &format!("Deleted {} records from {}", rows_affected, table_name));
                }
                Err(e) => {
                    // 回滚事务
                    let _ = tx.rollback().await;
                    return Ok(ResetResult {
                        success: false,
                        message: format!("Failed to delete data from {}: {}", table_name, e),
                        deleted_records: 0,
                        affected_tables: vec![],
                    });
                }
            }
        }
    }

    // 提交事务
    tx.commit().await?;

    let result = ResetResult {
        success: true,
        message: format!("Successfully reset user data. Deleted {} records from {} tables.", deleted_records, affected_tables.len()),
        deleted_records,
        affected_tables,
    };

    logger.api_response("reset_user_data", true, Some(&result.message));
    Ok(result)
}

/// 删除数据库文件并重启应用
#[tauri::command]
pub async fn delete_database_and_restart(app: AppHandle) -> AppResult<()> {
    let logger = app.state::<Logger>();

    logger.api_request("delete_database_and_restart", None);
    logger.info("DATABASE", "🗑️ Starting database deletion and app restart process");

    // 获取应用数据目录
    let app_data_dir = app.path()
        .app_data_dir()
        .map_err(|e| AppError::InternalError(format!("Failed to get app data directory: {}", e)))?;

    // 构建数据库文件路径
    let db_path = app_data_dir.join("vocabulary.db");
    let wal_path = app_data_dir.join("vocabulary.db-wal");
    let shm_path = app_data_dir.join("vocabulary.db-shm");

    logger.info("DATABASE", &format!("Database file path: {}", db_path.display()));
    logger.info("DATABASE", &format!("WAL file path: {}", wal_path.display()));
    logger.info("DATABASE", &format!("SHM file path: {}", shm_path.display()));

    // 检查数据库文件是否存在
    if !db_path.exists() {
        let error_msg = "数据库文件不存在";
        logger.api_response("delete_database_and_restart", false, Some(error_msg));
        return Err(AppError::NotFound(error_msg.to_string()));
    }

    // 获取数据库连接池并关闭所有连接
    let pool = app.state::<SqlitePool>();
    logger.info("DATABASE", "Closing database connections...");

    // 关闭连接池
    pool.close().await;
    logger.info("DATABASE", "✅ Database connections closed");

    // 等待一小段时间确保文件句柄被释放
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    logger.info("DATABASE", "Preparing to delete database file");

    // 尝试删除数据库文件，如果失败则重试几次
    let mut attempts = 0;
    let max_attempts = 5;

    loop {
        attempts += 1;
        logger.info("DATABASE", &format!("Delete attempt {} of {}", attempts, max_attempts));

        // 尝试删除主数据库文件
        match std::fs::remove_file(&db_path) {
            Ok(_) => {
                logger.info("DATABASE", "✅ Main database file deleted successfully");

                // 删除WAL文件（如果存在）
                if wal_path.exists() {
                    match std::fs::remove_file(&wal_path) {
                        Ok(_) => logger.info("DATABASE", "✅ WAL file deleted successfully"),
                        Err(e) => logger.info("DATABASE", &format!("⚠️ Failed to delete WAL file (non-critical): {}", e)),
                    }
                }

                // 删除SHM文件（如果存在）
                if shm_path.exists() {
                    match std::fs::remove_file(&shm_path) {
                        Ok(_) => logger.info("DATABASE", "✅ SHM file deleted successfully"),
                        Err(e) => logger.info("DATABASE", &format!("⚠️ Failed to delete SHM file (non-critical): {}", e)),
                    }
                }

                logger.api_response("delete_database_and_restart", true, Some("All database files deleted, restarting app"));

                // 重启应用程序
                app.restart();
                // 注意：restart() 会终止当前进程，所以这里不会返回
            }
            Err(e) => {
                if attempts >= max_attempts {
                    let error_msg = format!("删除数据库文件失败 (尝试{}次): {}", attempts, e);
                    logger.error("DATABASE", "Failed to delete database file after multiple attempts", Some(&error_msg));
                    logger.api_response("delete_database_and_restart", false, Some(&error_msg));
                    return Err(AppError::InternalError(error_msg));
                } else {
                    logger.info("DATABASE", &format!("Delete attempt {} failed, retrying in 200ms: {}", attempts, e));
                    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                }
            }
        }
    }
}

/// 选择性重置用户数据
#[tauri::command]
pub async fn reset_selected_tables(app: AppHandle, table_names: Vec<String>) -> AppResult<ResetResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("reset_selected_tables", Some(&format!("Tables: {:?}", table_names)));

    if table_names.is_empty() {
        return Ok(ResetResult {
            success: false,
            message: "No tables selected for reset".to_string(),
            deleted_records: 0,
            affected_tables: vec![],
        });
    }

    // 直接使用用户选择的表，不做限制
    let sorted_tables = table_names;

    let mut deleted_records = 0i64;
    let mut affected_tables = Vec::new();

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 按顺序删除选中的表数据
    for table_name in &sorted_tables {
        // 先查询记录数
        let count_query = format!("SELECT COUNT(*) as count FROM {}", table_name);
        let count_result = sqlx::query(&count_query)
            .fetch_one(&mut *tx)
            .await;

        let record_count = match count_result {
            Ok(row) => row.get::<i64, _>("count"),
            Err(_) => {
                logger.info("RESET_DEBUG", &format!("Table {} does not exist or is empty", table_name));
                continue;
            }
        };

        if record_count > 0 {
            // 删除表中所有数据
            let delete_query = format!("DELETE FROM {}", table_name);
            let delete_result = sqlx::query(&delete_query)
                .execute(&mut *tx)
                .await;

            match delete_result {
                Ok(result) => {
                    let rows_affected = result.rows_affected() as i64;
                    deleted_records += rows_affected;
                    affected_tables.push(table_name.to_string());
                    logger.info("RESET_DEBUG", &format!("Deleted {} records from {}", rows_affected, table_name));
                }
                Err(e) => {
                    // 回滚事务
                    let _ = tx.rollback().await;
                    return Ok(ResetResult {
                        success: false,
                        message: format!("Failed to delete data from {}: {}", table_name, e),
                        deleted_records: 0,
                        affected_tables: vec![],
                    });
                }
            }
        }
    }

    // 提交事务
    tx.commit().await?;

    let result = ResetResult {
        success: true,
        message: format!("Successfully reset {} tables. Deleted {} records.", affected_tables.len(), deleted_records),
        deleted_records,
        affected_tables,
    };

    logger.api_response("reset_selected_tables", true, Some(&result.message));
    Ok(result)
}
