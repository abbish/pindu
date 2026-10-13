//! 本机发音评估命令（pronunciation/）：模型状态、下载（后台任务）、删除，与评估一段录音。

use crate::error::{AppError, AppResult};
use crate::handlers::finish;
use crate::jobs::{JobSpec, Jobs, Lane};
use crate::logger::Logger;
use crate::pronunciation::{self, model, Assessment};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PronunciationStatus {
    /// 模型已下载，可以评估
    pub ready: bool,
    /// 模型大小（字节），给「需要下载约 71MB」用
    pub model_bytes: u64,
    /// 正在下载的任务
    pub download_job: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessPronunciationRequest {
    /// 要读的英文（一个词或一句话）
    pub text: String,
    /// 录音：16kHz 单声道 16 位小端 PCM，base64
    pub audio: String,
}

const DOWNLOAD_KIND: &str = "pronunciation_model";

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
pub async fn get_pronunciation_status(app: AppHandle) -> AppResult<PronunciationStatus> {
    let logger = app.state::<Logger>();
    logger.api_request("get_pronunciation_status", None);
    let status = PronunciationStatus {
        ready: model::ready(&data_dir(&app)),
        model_bytes: model::BYTES,
        download_job: running_download(&app),
    };
    finish(&logger, "get_pronunciation_status", Ok(status))
}

/// 下载发音模型（后台任务）；已经在下载时返回那个任务
#[tauri::command]
pub async fn start_pronunciation_model_download(app: AppHandle) -> AppResult<String> {
    let logger = app.state::<Logger>();
    logger.api_request("start_pronunciation_model_download", None);
    let id = running_download(&app).unwrap_or_else(|| {
        let dir = data_dir(&app);
        app.state::<Jobs>().spawn(
            JobSpec {
                kind: DOWNLOAD_KIND,
                module: None,
                title: "下载发音评估模型".to_string(),
                lane: Lane::Agent,
                detached: true,
                link: None,
            },
            move |ctx| async move {
                ctx.stage("正在下载发音评估模型");
                let progress = ctx.clone();
                let cancel = ctx.clone();
                model::ensure(
                    &dir,
                    move |p| progress.progress((p * 100.0) as u64, 100),
                    move || cancel.is_cancelled(),
                )
                .await?;
                Ok(serde_json::json!({ "ready": true }))
            },
        )
    });
    finish(&logger, "start_pronunciation_model_download", Ok(id))
}

#[tauri::command]
pub async fn delete_pronunciation_model(app: AppHandle) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("delete_pronunciation_model", None);
    let result = model::delete(&data_dir(&app));
    finish(&logger, "delete_pronunciation_model", result)
}

/// 评估一段录音读得准不准（全部在本机）。模型还没下载时返回 NOT_FOUND，界面据此先下载
#[tauri::command]
pub async fn assess_pronunciation(
    app: AppHandle,
    request: AssessPronunciationRequest,
) -> AppResult<Assessment> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "assess_pronunciation",
        Some(&format!(
            "text: {} chars, audio: {} chars",
            request.text.len(),
            request.audio.len()
        )),
    );
    let result = async {
        let dir = data_dir(&app);
        if !model::ready(&dir) {
            return Err(AppError::NotFound("发音评估模型还没有下载".to_string()));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(request.audio.as_bytes())
            .map_err(|_| AppError::ValidationError("录音格式不对".to_string()))?;
        let samples: Vec<f32> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
            .collect();
        if samples.len() < pronunciation::fbank::SAMPLE_RATE / 5 {
            return Err(AppError::ValidationError(
                "录音太短了，再读一遍".to_string(),
            ));
        }
        let path = model::path(&dir);
        let text = request.text;
        tokio::task::spawn_blocking(move || pronunciation::assess(&path, &text, &samples))
            .await
            .map_err(|e| AppError::InternalError(format!("发音评估中断：{e}")))?
    }
    .await;
    finish(&logger, "assess_pronunciation", result)
}
