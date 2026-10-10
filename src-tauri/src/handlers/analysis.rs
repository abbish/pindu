//! AI 分析相关命令处理器
//!
//! 包含所有与 AI 分析相关的 Tauri 命令

use crate::error::AppResult;
use crate::logger::Logger;
use crate::types::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

// 移除了传统词汇分析的命令处理器，只保留自然拼读分析

/// 从分析结果创建词汇本
#[tauri::command]
pub async fn create_word_book_from_analysis(
    app: AppHandle,
    request: CreateWordBookFromAnalysisRequest,
) -> AppResult<WordSaveResult> {
    use crate::services::wordbook::WordBookService;

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "create_word_book_from_analysis",
        Some(&format!(
            "title: {}, words: {}",
            request.title,
            request.words.len()
        )),
    );

    let service = WordBookService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.create_word_book_from_analysis(request).await {
        Ok(result) => {
            logger.api_response(
                "create_word_book_from_analysis",
                true,
                Some(&format!(
                    "Processed words for book ID: {} (added: {}, updated: {})",
                    result.book_id, result.added_count, result.updated_count
                )),
            );
            Ok(result)
        }
        Err(e) => {
            let error_msg = e.to_string();
            logger.api_response("create_word_book_from_analysis", false, Some(&error_msg));
            Err(e)
        }
    }
}
