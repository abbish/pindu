//! 单词管理命令处理器
//!
//! 包含所有与单词相关的 Tauri 命令

use crate::error::AppResult;
use crate::logger::Logger;
use crate::types::*;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_words_by_book(
    app: AppHandle,
    book_id: Id,
    page: Option<u32>,
    page_size: Option<u32>,
    search_term: Option<String>,
    part_of_speech: Option<String>,
) -> AppResult<PaginatedResponse<Word>> {
    use crate::services::word::WordService;

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    let page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(20);

    logger.api_request(
        "get_words_by_book",
        Some(&format!(
            "book_id: {}, page: {}, page_size: {}, search_term: {:?}, part_of_speech: {:?}",
            book_id, page, page_size, search_term, part_of_speech
        )),
    );

    let service = WordService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone())
    );

    match service.get_words_by_book(book_id, page, page_size, search_term, part_of_speech).await {
        Ok(result) => {
            logger.api_response(
                "get_words_by_book",
                true,
                Some(&format!("Found {} words, total: {}", result.data.len(), result.total)),
            );
            Ok(result)
        }
        Err(e) => {
            logger.api_response("get_words_by_book", false, Some(&e.to_string()));
            Err(e)
        }
    }
}


/// 添加单词到单词本
#[tauri::command]
pub async fn add_word_to_book(
    app: AppHandle,
    book_id: Id,
    word_data: CreateWordRequest,
) -> AppResult<Id> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "add_word_to_book",
        Some(&format!("book_id: {}, word: {}", book_id, word_data.word)),
    );

    let service = crate::services::WordService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.add_word_to_book(book_id, word_data).await {
        Ok(word_id) => {
            // 更新单词本的统计信息
            use crate::services::wordbook::WordBookService;
            let wordbook_service = WordBookService::new(
                Arc::new(pool.inner().clone()),
                Arc::new(logger.inner().clone())
            );
            if let Err(e) = wordbook_service.update_statistics(book_id).await {
                logger.info("WORD_BOOK_UPDATE", &format!("Failed to update word book stats: {}", e));
            }

            logger.api_response(
                "add_word_to_book",
                true,
                Some(&format!("Added word with ID: {}", word_id)),
            );
            Ok(word_id)
        }
        Err(e) => {
            logger.api_response("add_word_to_book", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 更新单词
#[tauri::command]
pub async fn update_word(
    app: AppHandle,
    word_id: Id,
    word_data: UpdateWordRequest,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "update_word",
        Some(&format!("word_id: {}", word_id)),
    );

    let service = crate::services::WordService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.update_word(word_id, word_data).await {
        Ok(_) => {
            logger.api_response(
                "update_word",
                true,
                Some(&format!("Updated word {}", word_id)),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("update_word", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 删除单词
#[tauri::command]
pub async fn delete_word(app: AppHandle, word_id: Id) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "delete_word",
        Some(&format!("word_id: {}", word_id)),
    );

    let service = crate::services::WordService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.delete_word(word_id).await {
        Ok(book_id) => {
            // 更新单词本的统计信息
            if let Some(book_id) = book_id {
                use crate::services::wordbook::WordBookService;
                let wordbook_service = WordBookService::new(
                    Arc::new(pool.inner().clone()),
                    Arc::new(logger.inner().clone())
                );
                if let Err(e) = wordbook_service.update_statistics(book_id).await {
                    logger.info("WORD_BOOK_UPDATE", &format!("Failed to update word book stats: {}", e));
                }
            }

            logger.api_response(
                "delete_word",
                true,
                Some(&format!("Deleted word {}", word_id)),
            );
            Ok(())
        }
        Err(e) => {
            logger.api_response("delete_word", false, Some(&e.to_string()));
            Err(e)
        }
    }
}
