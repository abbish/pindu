//! AI 分析相关命令处理器
//!
//! 包含所有与 AI 分析相关的 Tauri 命令

use crate::ai_service::AnalysisProgress;
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_system_logs(app: AppHandle) -> AppResult<Vec<String>> {
    let logger = app.state::<Logger>();

    logger.api_request("get_system_logs", None);

    // 获取应用数据目录
    let app_data_dir = app
        .path()
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

            logger.api_response(
                "get_system_logs",
                true,
                Some(&format!("Retrieved {} log lines", lines.len())),
            );
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
        Arc::new(logger.inner().clone())
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

/// 获取分析进度
#[tauri::command]
pub async fn get_analysis_progress(app: AppHandle) -> AppResult<Option<AnalysisProgress>> {
    use crate::ai_service::get_global_progress_manager;

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

/// 清除分析进度
#[tauri::command]
pub async fn clear_analysis_progress(app: AppHandle) -> AppResult<()> {
    use crate::ai_service::get_global_progress_manager;

    let logger = app.state::<Logger>();

    logger.api_request("clear_analysis_progress", None);

    // 设置取消标志并清除进度
    let progress_manager = get_global_progress_manager();
    progress_manager.cancel_analysis(); // 先取消分析
    progress_manager.clear_progress(); // 再清除进度

    logger.api_response(
        "clear_analysis_progress",
        true,
        Some("Progress cleared and analysis cancelled"),
    );

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
