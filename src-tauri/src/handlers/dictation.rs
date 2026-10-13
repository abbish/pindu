//! 语音输入命令（`dictation.rs`）：模型状态、下载（后台任务）、删除，与把一小段录音转成文字。

use crate::dictation::{self, Language};
use crate::error::{AppError, AppResult};
use crate::handlers::finish;
use crate::handlers::pronunciation::{decode_pcm, max_audio_chars};
use crate::jobs::{JobSpec, Jobs, Lane};
use crate::logger::Logger;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const DOWNLOAD_KIND: &str = "dictation_model";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationStatus {
    /// 模型已下载，可以说话输入
    pub ready: bool,
    /// 模型大小（字节）
    pub model_bytes: u64,
    /// 正在下载的任务
    pub download_job: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeSpeechRequest {
    /// 录音：16kHz 单声道 16 位小端 PCM，base64
    pub audio: String,
    /// zh 中文为主（夹着英文单词也认，AI 老师）/ en 英文（开放题）
    pub language: String,
}

fn data_dir(app: &AppHandle) -> std::path::PathBuf {
    crate::app_paths::dirs(app).data
}

fn running_download(app: &AppHandle) -> Option<String> {
    app.state::<Jobs>()
        .list()
        .into_iter()
        .find(|j| j.kind == DOWNLOAD_KIND && j.status.is_active())
        .map(|j| j.id)
}

#[tauri::command]
pub async fn get_dictation_status(app: AppHandle) -> AppResult<DictationStatus> {
    let logger = app.state::<Logger>();
    logger.api_request("get_dictation_status", None);
    let status = DictationStatus {
        ready: dictation::ready(&data_dir(&app)),
        model_bytes: dictation::BYTES,
        download_job: running_download(&app),
    };
    finish(&logger, "get_dictation_status", Ok(status))
}

/// 下载语音输入模型（后台任务）；已经在下载时返回那个任务
#[tauri::command]
pub async fn start_dictation_model_download(app: AppHandle) -> AppResult<String> {
    let logger = app.state::<Logger>();
    logger.api_request("start_dictation_model_download", None);
    let dir = data_dir(&app);
    let id = app.state::<Jobs>().spawn_unique(
        JobSpec {
            kind: DOWNLOAD_KIND,
            module: None,
            title: "下载语音输入模型".to_string(),
            lane: Lane::Download,
            detached: true,
            link: None,
        },
        move |ctx| async move {
            ctx.stage("正在下载语音输入模型");
            let progress = ctx.clone();
            let cancel = ctx.clone();
            dictation::ensure(
                &dir,
                move |p| progress.progress((p * 100.0) as u64, 100),
                move || cancel.is_cancelled(),
            )
            .await?;
            Ok(serde_json::json!({ "ready": true }))
        },
    );
    finish(&logger, "start_dictation_model_download", Ok(id))
}

#[tauri::command]
pub async fn delete_dictation_model(app: AppHandle) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("delete_dictation_model", None);
    let result = if running_download(&app).is_some() {
        Err(AppError::ValidationError(
            "语音输入模型正在下载，先停止下载再删除".to_string(),
        ))
    } else {
        let dir = data_dir(&app);
        tokio::task::spawn_blocking(move || dictation::delete(&dir))
            .await
            .map_err(|e| AppError::InternalError(format!("删除语音输入模型中断：{e}")))
            .and_then(|r| r)
    };
    finish(&logger, "delete_dictation_model", result)
}

/// 一小段录音转成文字（本机）；没说话时为空字符串，模型没下载时 NOT_FOUND
#[tauri::command]
pub async fn transcribe_speech(
    app: AppHandle,
    request: TranscribeSpeechRequest,
) -> AppResult<String> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "transcribe_speech",
        Some(&format!(
            "language: {}, audio: {} chars",
            request.language,
            request.audio.len()
        )),
    );
    let result = async {
        if request.audio.len() > max_audio_chars(dictation::MAX_SECONDS) {
            return Err(AppError::ValidationError(format!(
                "一次最多说 {} 秒",
                dictation::MAX_SECONDS
            )));
        }
        let language = match request.language.as_str() {
            "en" => Language::En,
            "zh" => Language::Zh,
            other => return Err(AppError::ValidationError(format!("不支持的语言：{other}"))),
        };
        let samples: Vec<f32> = decode_pcm(&request.audio)?
            .into_iter()
            .map(|v| v as f32 / 32768.0)
            .collect();
        let dir = data_dir(&app);
        // 空闲一阵后卸载模型（释放内存）
        tauri::async_runtime::spawn(async {
            tokio::time::sleep(dictation::IDLE_UNLOAD + std::time::Duration::from_secs(1)).await;
            dictation::unload_if_idle();
        });
        tokio::task::spawn_blocking(move || dictation::transcribe(&dir, &samples, language))
            .await
            .map_err(|e| AppError::InternalError(format!("语音输入中断：{e}")))?
    }
    .await;
    if let Ok(text) = &result {
        logger.debug(
            "DICTATION",
            &format!("转文字 {} 字", text.chars().count()),
            None,
        );
    }
    finish(&logger, "transcribe_speech", result)
}
