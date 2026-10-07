//! AI 分析相关命令处理器
//!
//! 包含所有与 AI 分析相关的 Tauri 命令

use crate::error::AppResult;
use crate::logger::Logger;
use crate::planning_progress::{get_global_progress_manager, PlanningProgressState};
use crate::types::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

// 移除了传统词汇分析的命令处理器，只保留自然拼读分析

/// 从分析结果创建单词本
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

/// 获取单次拼读分析的进度
#[tauri::command]
pub async fn get_analysis_progress(app: AppHandle) -> AppResult<Option<PlanningProgressState>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_analysis_progress", None);

    let progress = get_global_progress_manager().get_progress();

    logger.api_response(
        "get_analysis_progress",
        true,
        Some(&format!("Progress: {:?}", progress.is_some())),
    );
    Ok(progress)
}

/// 取消并清除单次分析进度
#[tauri::command]
pub async fn clear_analysis_progress(app: AppHandle) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("clear_analysis_progress", None);

    // 先取消再清除
    let progress_manager = get_global_progress_manager();
    progress_manager.cancel_analysis();
    progress_manager.clear_progress();

    logger.api_response(
        "clear_analysis_progress",
        true,
        Some("Progress cleared and analysis cancelled"),
    );
    Ok(())
}

/// 取消单次分析
#[tauri::command]
pub async fn cancel_analysis(app: AppHandle) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("cancel_analysis", None);

    get_global_progress_manager().cancel_analysis();

    logger.api_response("cancel_analysis", true, Some("Analysis cancelled"));
    Ok(())
}
