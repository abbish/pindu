//! 本机发音评估命令（pronunciation/）：模型状态、下载（后台任务）、删除，与评估一段录音；
//! 以及把一小段录音转成文字（`services/speech_input.rs`，复用字幕识别的模型）。

use crate::error::{AppError, AppResult};
use crate::handlers::finish;
use crate::jobs::{JobSpec, Jobs, Lane};
use crate::logger::Logger;
use crate::pronunciation::{self, model, Assessment};
use crate::services::pronunciation::{
    PronunciationContext, PronunciationOverview, PronunciationService,
};
use crate::services::pronunciation_settings::{
    PronunciationSettings, PronunciationSettingsService,
};
use crate::services::speech_input;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
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
    /// 开不开、多严格（「设置 → 学习者 → 发音」）
    pub settings: PronunciationSettings,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessPronunciationRequest {
    /// 要读的英文（一个词或一句话）
    pub text: String,
    /// 录音：16kHz 单声道 16 位小端 PCM，base64
    pub audio: String,
    /// 学习计划里的跟读：带上时保存结果（给计划的发音统计）
    pub context: Option<PronunciationContext>,
}

const DOWNLOAD_KIND: &str = "pronunciation_model";

/// 录音：base64 的 16kHz 单声道 16 位小端 PCM
fn decode_pcm(audio: &str) -> AppResult<Vec<i16>> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio.as_bytes())
        .map_err(|_| AppError::ValidationError("录音格式不对".to_string()))?;
    Ok(bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect())
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
pub async fn get_pronunciation_status(app: AppHandle) -> AppResult<PronunciationStatus> {
    let logger = app.state::<Logger>();
    logger.api_request("get_pronunciation_status", None);
    let result = PronunciationSettingsService::get(&app.state::<SqlitePool>())
        .await
        .map(|settings| PronunciationStatus {
            ready: model::ready(&data_dir(&app)),
            model_bytes: model::BYTES,
            download_job: running_download(&app),
            settings,
        });
    finish(&logger, "get_pronunciation_status", result)
}

/// 保存发音评估设置；返回保存的值
#[tauri::command]
pub async fn update_pronunciation_settings(
    app: AppHandle,
    request: PronunciationSettings,
) -> AppResult<PronunciationSettings> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "update_pronunciation_settings",
        Some(&format!(
            "enabled: {}, strictness: {}",
            request.enabled, request.strictness
        )),
    );
    let result = PronunciationSettingsService::save(&app.state::<SqlitePool>(), request).await;
    finish(&logger, "update_pronunciation_settings", result)
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
        let samples: Vec<f32> = decode_pcm(&request.audio)?
            .into_iter()
            .map(|v| v as f32 / 32768.0)
            .collect();
        if samples.len() < pronunciation::fbank::SAMPLE_RATE / 5 {
            return Err(AppError::ValidationError(
                "录音太短了，再读一遍".to_string(),
            ));
        }
        let path = model::path(&dir);
        let text = request.text.clone();
        let assessment =
            tokio::task::spawn_blocking(move || pronunciation::assess(&path, &text, &samples))
                .await
                .map_err(|e| AppError::InternalError(format!("发音评估中断：{e}")))??;
        if let Some(context) = &request.context {
            // 保存失败不影响这次的结果，只记一条警告
            if let Err(e) = PronunciationService::record(
                &app.state::<SqlitePool>(),
                &request.text,
                &assessment,
                context,
            )
            .await
            {
                logger.warn(
                    "PRONUNCIATION",
                    "保存发音评估结果失败",
                    Some(&e.to_string()),
                );
            }
        }
        Ok(assessment)
    }
    .await;
    finish(&logger, "assess_pronunciation", result)
}

/// 学习计划的发音统计：跟读次数、平均分、常错的音
#[tauri::command]
pub async fn get_pronunciation_overview(
    app: AppHandle,
    plan_id: i64,
) -> AppResult<PronunciationOverview> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_pronunciation_overview",
        Some(&format!("plan_id: {plan_id}")),
    );
    let result = PronunciationService::overview(&app.state::<SqlitePool>(), plan_id).await;
    finish(&logger, "get_pronunciation_overview", result)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationStatus {
    /// 有已下载的识别模型，可以说话代替打字
    pub ready: bool,
    /// 还没有时下载哪个（最小的）
    pub model_id: String,
    pub model_bytes: u64,
    /// 正在下载识别模型的任务
    pub download_job: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeSpeechRequest {
    /// 录音：16kHz 单声道 16 位小端 PCM，base64
    pub audio: String,
}

/// 说话转文字能不能用（识别模型下载了没有）
#[tauri::command]
pub async fn get_dictation_status(app: AppHandle) -> AppResult<DictationStatus> {
    let logger = app.state::<Logger>();
    logger.api_request("get_dictation_status", None);
    let dir = data_dir(&app);
    let first = crate::services::subtitle_recognition::find_model(speech_input::DOWNLOAD_FIRST)?;
    let status = DictationStatus {
        ready: speech_input::model_for_dictation(&dir).is_some(),
        model_id: first.id.to_string(),
        model_bytes: first.download_bytes(),
        download_job: app
            .state::<Jobs>()
            .list()
            .into_iter()
            .find(|j| j.kind == "speech_model_download" && j.status.is_active())
            .map(|j| j.id),
    };
    finish(&logger, "get_dictation_status", Ok(status))
}

/// 一小段录音转成文字（本机）；没说话时为空字符串，识别模型没下载时 NOT_FOUND
#[tauri::command]
pub async fn transcribe_speech(
    app: AppHandle,
    request: TranscribeSpeechRequest,
) -> AppResult<String> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "transcribe_speech",
        Some(&format!("audio: {} chars", request.audio.len())),
    );
    let result = async {
        let samples = decode_pcm(&request.audio)?;
        let dirs = crate::app_paths::dirs(&app);
        speech_input::transcribe(&dirs.data, &dirs.cache.join("speech"), &samples).await
    }
    .await;
    if let Ok(text) = &result {
        logger.debug(
            "SPEECH",
            &format!("转文字 {} 字", text.chars().count()),
            None,
        );
    }
    finish(&logger, "transcribe_speech", result)
}
