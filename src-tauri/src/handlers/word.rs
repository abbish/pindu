//! 单词管理命令处理器
//!
//! 包含所有与单词相关的 Tauri 命令

use crate::error::AppResult;
use crate::logger::Logger;
use crate::types::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_words_by_book(
    app: AppHandle,
    book_id: Id,
    page: Option<u32>,
    page_size: Option<u32>,
    search_term: Option<String>,
    part_of_speech: Option<String>,
    sort_by: Option<String>,
    kind: Option<String>,
) -> AppResult<PaginatedResponse<Word>> {
    use crate::services::word::WordService;

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    let page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(20);

    logger.api_request(
        "get_words_by_book",
        Some(&format!(
            "book_id: {}, page: {}, page_size: {}, search_term: {:?}, part_of_speech: {:?}, sort_by: {:?}",
            book_id, page, page_size, search_term, part_of_speech, sort_by
        )),
    );

    let service = WordService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service
        .get_words_by_book(
            book_id,
            page,
            page_size,
            search_term,
            part_of_speech,
            sort_by.as_deref(),
            kind.as_deref(),
        )
        .await
    {
        Ok(result) => {
            logger.api_response(
                "get_words_by_book",
                true,
                Some(&format!(
                    "Found {} words, total: {}",
                    result.data.len(),
                    result.total
                )),
            );
            Ok(result)
        }
        Err(e) => {
            logger.api_response("get_words_by_book", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 添加单词到词汇本
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
            // 更新词汇本的统计信息
            use crate::services::wordbook::WordBookService;
            let wordbook_service = WordBookService::new(
                Arc::new(pool.inner().clone()),
                Arc::new(logger.inner().clone()),
            );
            if let Err(e) = wordbook_service.update_statistics(book_id).await {
                logger.warn(
                    "WORD_BOOK_UPDATE",
                    "更新词汇本统计失败",
                    Some(&e.to_string()),
                );
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

    logger.api_request("update_word", Some(&format!("word_id: {}", word_id)));

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

/// 这些单词里哪些已经在词汇本中（忽略大小写），返回小写形式；用于导入时标记“已存在”
#[tauri::command]
pub async fn find_existing_words(
    app: AppHandle,
    book_id: Id,
    words: Vec<String>,
) -> AppResult<Vec<String>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "find_existing_words",
        Some(&format!("book_id: {}, count: {}", book_id, words.len())),
    );
    let repository = crate::repositories::word_repository::WordRepository::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );
    let mut found: Vec<String> = repository
        .find_existing_words_by_book(book_id, &words)
        .await?
        .into_keys()
        .collect();
    found.sort();
    logger.api_response(
        "find_existing_words",
        true,
        Some(&format!("{} existing", found.len())),
    );
    Ok(found)
}

/// 批量删除单词（同一个词汇本内的多选删除），单事务；返回实际删除数
#[tauri::command]
pub async fn delete_words(app: AppHandle, book_id: Id, word_ids: Vec<Id>) -> AppResult<usize> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "delete_words",
        Some(&format!("book_id: {}, count: {}", book_id, word_ids.len())),
    );

    let service = crate::services::WordService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.delete_words(&word_ids).await {
        Ok(deleted) => {
            use crate::services::wordbook::WordBookService;
            let wordbook_service = WordBookService::new(
                Arc::new(pool.inner().clone()),
                Arc::new(logger.inner().clone()),
            );
            if let Err(e) = wordbook_service.update_statistics(book_id).await {
                logger.warn(
                    "WORD_BOOK_UPDATE",
                    "更新词汇本统计失败",
                    Some(&e.to_string()),
                );
            }
            logger.api_response(
                "delete_words",
                true,
                Some(&format!("Deleted {} words", deleted)),
            );
            Ok(deleted)
        }
        Err(e) => {
            logger.api_response("delete_words", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// AI 补充（mode = "append"）或重新生成（mode = "replace"）单词例句，返回最新的全部例句
#[tauri::command]
pub async fn generate_word_examples(
    app: AppHandle,
    word_id: Id,
    mode: String,
    model_id: Option<Id>,
) -> AppResult<Vec<crate::types::wordbook::WordExample>> {
    use crate::services::word_examples::{parse_mode, WordExampleService};
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "generate_word_examples",
        Some(&format!(
            "word_id: {}, mode: {}, model_id: {:?}",
            word_id, mode, model_id
        )),
    );
    let result = async {
        let mode = parse_mode(&mode)?;
        let app_data_dir = crate::app_paths::dirs(&app).data;
        let paths = crate::agent::AgentPaths::resolve(&app_data_dir)?;
        WordExampleService::new(
            Arc::new(pool.inner().clone()),
            Arc::new(logger.inner().clone()),
        )
        .generate(word_id, mode, model_id, &paths)
        .await
    }
    .await;
    match &result {
        Ok(examples) => logger.api_response(
            "generate_word_examples",
            true,
            Some(&format!("{} examples", examples.len())),
        ),
        Err(e) => logger.api_response("generate_word_examples", false, Some(&e.to_string())),
    }
    result
}
