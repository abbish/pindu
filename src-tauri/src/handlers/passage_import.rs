//! 导入材料：读取材料文件、预处理预览、逐篇导入（AI 翻译）与取消、生词加进单词本

use super::{agent_paths, finish};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::services::passage_import;
use crate::services::passage_import_service::PassageImportService;
use crate::types::passage::{
    AddPassageWordsRequest, ImportPassageRequest, ImportPreview, MaterialText, Passage,
    PassageNewWord, PrepareImportRequest, ReadMaterialRequest,
};
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

fn service(app: &AppHandle) -> PassageImportService {
    PassageImportService::new(
        Arc::new(app.state::<SqlitePool>().inner().clone()),
        Arc::new(app.state::<Logger>().inner().clone()),
    )
}

/// 读取一个材料文件（txt / md / srt / vtt / docx / pdf）为清理后的纯文本；单词本提取与短文导入共用
#[tauri::command]
pub async fn read_material_file(
    app: AppHandle,
    request: ReadMaterialRequest,
) -> AppResult<MaterialText> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "read_material_file",
        Some(&format!(
            "file: {}, base64 chars: {}",
            request.file_name,
            request.file_base64.len()
        )),
    );
    // 解析 PDF / docx 可能较慢：放到阻塞线程
    let result = tauri::async_runtime::spawn_blocking(move || {
        passage_import::read_material(&request.file_name, &request.file_base64)
    })
    .await
    .map_err(|e| AppError::InternalError(e.to_string()))
    .and_then(|r| r);
    finish(&logger, "read_material_file", result)
}

/// 导入材料预处理：清理、分句、拆篇（不写库、不用 AI）
#[tauri::command]
pub async fn prepare_passage_import(
    app: AppHandle,
    request: PrepareImportRequest,
) -> AppResult<ImportPreview> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "prepare_passage_import",
        Some(&format!(
            "file: {:?}, text chars: {}, base64 chars: {}, target_words: {:?}",
            request.file_name,
            request.text.as_deref().map(str::len).unwrap_or(0),
            request.file_base64.as_deref().map(str::len).unwrap_or(0),
            request.target_words
        )),
    );
    let service = service(&app);
    let result = tauri::async_runtime::spawn_blocking(move || service.prepare(&request))
        .await
        .map_err(|e| AppError::InternalError(e.to_string()))
        .and_then(|r| r);
    finish(&logger, "prepare_passage_import", result)
}

/// 导入一篇（AI 翻译、起标题、估水平、挑重点词；原文不改）
#[tauri::command]
pub async fn import_passage(app: AppHandle, request: ImportPassageRequest) -> AppResult<Passage> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "import_passage",
        Some(&format!(
            "request_id: {}, sentences: {}, books: {:?}, ai_key_words: {}",
            request.request_id,
            request.sentences.len(),
            request.book_ids,
            request.ai_key_words
        )),
    );
    let result = match agent_paths(&app) {
        Ok(paths) => service(&app).import(&request, &paths).await,
        Err(e) => Err(e),
    };
    finish(&logger, "import_passage", result)
}

/// 取消某篇导入
#[tauri::command]
pub async fn cancel_passage_import(app: AppHandle, request_id: String) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "cancel_passage_import",
        Some(&format!("request_id: {}", request_id)),
    );
    PassageImportService::cancel(&request_id);
    finish(&logger, "cancel_passage_import", Ok(()))
}

/// 短文里还不在单词本的词（AI 挑的重点词）
#[tauri::command]
pub async fn get_passage_new_words(
    app: AppHandle,
    passage_id: i64,
) -> AppResult<Vec<PassageNewWord>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passage_new_words",
        Some(&format!("passage_id: {}", passage_id)),
    );
    let result = service(&app).new_words(passage_id).await;
    finish(&logger, "get_passage_new_words", result)
}

/// 生词加进单词本（拼读分析补全音标、音节与例句），返回这些词在本里的 id
#[tauri::command]
pub async fn add_passage_words_to_book(
    app: AppHandle,
    request: AddPassageWordsRequest,
) -> AppResult<Vec<i64>> {
    let logger = app.state::<Logger>();
    logger.api_request("add_passage_words_to_book", Some(&format!("{:?}", request)));
    let result = match agent_paths(&app) {
        Ok(paths) => service(&app).add_words_to_book(&request, &paths).await,
        Err(e) => Err(e),
    };
    finish(&logger, "add_passage_words_to_book", result)
}
