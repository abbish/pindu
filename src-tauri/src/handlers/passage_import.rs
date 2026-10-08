//! 导入材料：读取材料文件、预处理预览、逐篇导入（AI 翻译）与取消、生词加进单词本

use super::{agent_paths, finish};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::services::passage_import;
use crate::services::passage_import_service::PassageImportService;
use crate::types::passage::{
    AddPassageWordsRequest, ImportPreview, MaterialText, PassageNewWord, PrepareImportRequest,
    ReadMaterialRequest,
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

/// 导入几篇材料（后台任务）：逐篇 AI 翻译、起标题、估水平、挑重点词（原文不改）后保存；
/// 逐篇状态在 job.detail.items，导入好的 id 在 job.result.passageIds。一篇失败不影响其余
#[tauri::command]
pub async fn start_passage_import(
    app: AppHandle,
    request: crate::types::passage::ImportPassagesRequest,
) -> AppResult<String> {
    use crate::jobs::{JobLink, JobSpec, Jobs, Lane};
    use crate::types::passage::PassageItemStatus;
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_passage_import",
        Some(&format!("items: {}", request.items.len())),
    );
    let result = async {
        if request.items.is_empty() || request.items.len() > 20 {
            return Err(AppError::ValidationError("一次导入 1–20 篇".to_string()));
        }
        let paths = agent_paths(&app)?;
        let svc = service(&app);
        let count = request.items.len();
        let label = request.items[0].source_label.clone();
        let spec = JobSpec {
            kind: "passage_import",
            title: if count == 1 {
                format!("导入材料 · {label}")
            } else {
                format!("导入 {count} 篇材料 · {label}")
            },
            lane: Lane::Agent,
            detached: true,
            link: Some(JobLink::new("passages", serde_json::Value::Null)),
        };
        Ok(app.state::<Jobs>().spawn(spec, move |ctx| async move {
            let mut items: Vec<PassageItemStatus> = (0..count)
                .map(|_| PassageItemStatus {
                    state: "waiting".into(),
                    passage_id: None,
                    title: None,
                    error: None,
                })
                .collect();
            let publish = |items: &[PassageItemStatus]| {
                let done = items
                    .iter()
                    .filter(|i| i.state == "done" || i.state == "failed")
                    .count();
                ctx.progress(done as u64, count as u64);
                ctx.detail(serde_json::json!({ "items": items }));
            };
            publish(&items);
            let mut ids = Vec::new();
            let cancelled = || ctx.is_cancelled();
            for (i, item) in request.items.iter().enumerate() {
                if ctx.is_cancelled() {
                    break;
                }
                ctx.stage(format!("第 {}/{} 篇 · 翻译", i + 1, count));
                items[i].state = "running".into();
                publish(&items);
                match svc.import(item, &paths, &cancelled).await {
                    Ok(passage) => {
                        items[i].state = "done".into();
                        items[i].passage_id = Some(passage.id);
                        items[i].title = Some(passage.title.clone());
                        ids.push(passage.id);
                    }
                    Err(e) => {
                        items[i].state = "failed".into();
                        items[i].error = Some(e.to_string());
                    }
                }
                publish(&items);
            }
            if ids.len() == 1 {
                ctx.set_link(JobLink::new(
                    "passage-detail",
                    serde_json::json!({ "passageId": ids[0] }),
                ));
            }
            if ids.is_empty() && !ctx.is_cancelled() {
                let reason = items
                    .iter()
                    .find_map(|i| i.error.clone())
                    .unwrap_or_else(|| "请再试一次".to_string());
                return Err(AppError::ExternalServiceError(format!(
                    "没有导入成功：{reason}"
                )));
            }
            Ok(serde_json::json!({ "passageIds": ids }))
        }))
    }
    .await;
    finish(&logger, "start_passage_import", result)
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
