//! 单词本管理命令处理器
//!
//! 包含所有与单词本相关的 Tauri 命令

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::services::wordbook::WordBookService;
use crate::types::wordbook::WordTypeDistribution;
use crate::types::*;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_word_books(
    app: AppHandle,
    include_deleted: Option<bool>,
    status: Option<String>,
) -> AppResult<Vec<WordBook>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    let include_deleted = include_deleted.unwrap_or(false);
    logger.api_request(
        "get_word_books",
        Some(&format!(
            "include_deleted: {}, status: {:?}",
            include_deleted, status
        )),
    );

    // 使用 Service 层处理业务逻辑
    let service = WordBookService::new(Arc::new(pool.inner().clone()), Arc::new(logger.inner().clone()));
    match service.get_word_books(include_deleted, status).await {
        Ok(word_books) => {
            logger.api_response(
                "get_word_books",
                true,
                Some(&format!("Returned {} word books", word_books.len())),
            );
            Ok(word_books)
        }
        Err(e) => {
            logger.api_response("get_word_books", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取单词本关联的学习计划
#[tauri::command]
pub async fn get_word_book_linked_plans(
    app: AppHandle,
    book_id: Id,
) -> AppResult<Vec<StudyPlanWithProgress>> {
    use crate::services::study_plan::StudyPlanService;

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_word_book_linked_plans",
        Some(&format!("book_id: {}", book_id)),
    );

    let service = StudyPlanService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_linked_plans_by_wordbook(book_id).await {
        Ok(plans) => {
            logger.api_response(
                "get_word_book_linked_plans",
                true,
                Some(&format!("Found {} linked plans", plans.len())),
            );
            Ok(plans)
        }
        Err(e) => {
            logger.api_response("get_word_book_linked_plans", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 根据ID获取单词本详情
#[tauri::command]
pub async fn get_word_book_detail(app: AppHandle, book_id: Id) -> AppResult<WordBook> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_word_book_detail",
        Some(&format!("book_id: {}", book_id)),
    );

    // 使用 Service 层处理业务逻辑
    let service = WordBookService::new(Arc::new(pool.inner().clone()), Arc::new(logger.inner().clone()));

    match service.get_word_book(book_id).await {
        Ok(word_book) => {
            logger.api_response(
                "get_word_book_detail",
                true,
                Some(&format!("Retrieved word book: {}", word_book.title)),
            );
            Ok(word_book)
        }
        Err(e) => {
            logger.api_response("get_word_book_detail", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取所有主题标签
#[tauri::command]
pub async fn get_theme_tags(app: AppHandle) -> AppResult<Vec<ThemeTag>> {
    use crate::services::theme_tag::ThemeTagService;

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_theme_tags", None);

    let service = ThemeTagService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_theme_tags().await {
        Ok(theme_tags) => {
            logger.api_response(
                "get_theme_tags",
                true,
                Some(&format!("Found {} theme tags", theme_tags.len())),
            );
            Ok(theme_tags)
        }
        Err(e) => {
            logger.api_response("get_theme_tags", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取单词本词性统计
#[tauri::command]
pub async fn get_word_book_statistics(
    app: AppHandle,
    book_id: Id,
) -> AppResult<WordTypeDistribution> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_word_book_statistics",
        Some(&format!("book_id: {}", book_id)),
    );

    // 使用 Service 层处理业务逻辑
    let service = WordBookService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_word_type_distribution(book_id).await {
        Ok(distribution) => {
            logger.api_response(
                "get_word_book_statistics",
                true,
                Some(&format!(
                    "Statistics: nouns={}, verbs={}, adjectives={}, others={}",
                    distribution.nouns, distribution.verbs, distribution.adjectives, distribution.others
                )),
            );
            Ok(distribution)
        }
        Err(e) => {
            logger.api_response("get_word_book_statistics", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取全局单词本统计
#[tauri::command]
pub async fn get_global_word_book_statistics(app: AppHandle) -> AppResult<WordBookStatistics> {
    use crate::services::statistics::StatisticsService;

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_global_word_book_statistics", None);

    let service = StatisticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_global_word_book_statistics().await {
        Ok(result) => {
            logger.api_response(
                "get_global_word_book_statistics",
                true,
                Some(&format!(
                    "Global stats: books={}, words={}",
                    result.total_books, result.total_words
                )),
            );
            Ok(result)
        }
        Err(e) => {
            logger.api_response("get_global_word_book_statistics", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 更新所有单词本的单词数量
#[tauri::command]
pub async fn update_all_word_book_counts(app: AppHandle) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("update_all_word_book_counts", None);

    let service = WordBookService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.update_all_counts().await {
        Ok(_) => {
            logger.api_response(
                "update_all_word_book_counts",
                true,
                Some("Updated all word book counts"),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("update_all_word_book_counts", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 创建单词本
#[tauri::command]
pub async fn create_word_book(app: AppHandle, request: CreateWordBookRequest) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "create_word_book",
        Some(&format!("title: {}", request.title)),
    );

    // 使用 Service 层处理业务逻辑
    let service = WordBookService::new(Arc::new(pool.inner().clone()), Arc::new(logger.inner().clone()));

    match service.create_word_book(request).await {
        Ok(book_id) => {
            logger.api_response(
                "create_word_book",
                true,
                Some(&format!("Created word book with id: {}", book_id)),
            );
            Ok(book_id)
        }
        Err(e) => {
            logger.api_response("create_word_book", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 更新单词本
#[tauri::command]
pub async fn update_word_book(
    app: AppHandle,
    book_id: Id,
    request: UpdateWordBookRequest,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "update_word_book",
        Some(&format!("book_id: {}", book_id)),
    );

    // 使用 Service 层处理业务逻辑
    let service = WordBookService::new(Arc::new(pool.inner().clone()), Arc::new(logger.inner().clone()));

    match service.update_word_book(book_id, request).await {
        Ok(_) => {
            logger.api_response(
                "update_word_book",
                true,
                Some(&format!("Updated word book {}", book_id)),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("update_word_book", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 删除单词本（软删除）
#[tauri::command]
pub async fn delete_word_book(app: AppHandle, book_id: Id) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("delete_word_book", Some(&format!("book_id: {}", book_id)));

    // 使用 Service 层处理业务逻辑
    let service = WordBookService::new(Arc::new(pool.inner().clone()), Arc::new(logger.inner().clone()));

    match service.delete_word_book(book_id).await {
        Ok(_) => {
            logger.api_response(
                "delete_word_book",
                true,
                Some(&format!("Deleted word book {}", book_id)),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("delete_word_book", false, Some(&e.to_string()));
            Err(e)
        }
    }
}
