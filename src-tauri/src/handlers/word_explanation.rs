//! 单词讲解命令：实时生成（流式增量经 `word-explanation-delta` 事件推送给前端，不落库）与 AI 老师答疑

use crate::agent::AgentPaths;
use crate::error::AppResult;
use crate::logger::Logger;
use crate::services::word_explanation::WordExplanationService;
use crate::types::common::Id;
use crate::types::wordbook::{TutorReply, WordExplanation, WordTutorRequest};
use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// 流式增量事件：前端按 requestId 过滤（换词 / 重新生成后旧请求的增量被忽略）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExplanationDelta {
    request_id: String,
    word_id: Id,
    delta: String,
}

fn service(app: &AppHandle) -> WordExplanationService {
    WordExplanationService::new(
        Arc::new(app.state::<SqlitePool>().inner().clone()),
        Arc::new(app.state::<Logger>().inner().clone()),
    )
}

/// 生成单词讲解与推荐追问；生成过程中推送 `word-explanation-delta` 事件
#[tauri::command]
pub async fn generate_word_explanation(
    app: AppHandle,
    word_id: Id,
    card_word: Option<String>,
    model_id: Option<Id>,
    request_id: String,
) -> AppResult<WordExplanation> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "generate_word_explanation",
        Some(&format!("word_id: {}, model_id: {:?}", word_id, model_id)),
    );
    let result = async {
        let app_data_dir = crate::app_paths::dirs(&app).data;
        let paths = AgentPaths::resolve(&app_data_dir)?;
        let emitter = app.clone();
        service(&app)
            .generate(word_id, card_word.as_deref(), model_id, &paths, |delta| {
                let _ = emitter.emit(
                    "word-explanation-delta",
                    ExplanationDelta {
                        request_id: request_id.clone(),
                        word_id,
                        delta: delta.to_string(),
                    },
                );
            })
            .await
    }
    .await;
    match &result {
        Ok(e) => logger.api_response(
            "generate_word_explanation",
            true,
            Some(&format!(
                "{} chars, {} follow-ups",
                e.content.chars().count(),
                e.follow_ups.len()
            )),
        ),
        Err(e) => logger.api_response("generate_word_explanation", false, Some(&e.to_string())),
    }
    result
}

/// 流式增量事件（AI 老师答疑）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TutorDelta {
    request_id: String,
    word_id: Id,
    delta: String,
}

/// 向 AI 老师提问；回答过程中推送 `word-tutor-delta` 事件，返回完整回答与推荐追问
#[tauri::command]
pub async fn ask_word_tutor(app: AppHandle, request: WordTutorRequest) -> AppResult<TutorReply> {
    use crate::services::word_tutor::WordTutorService;
    let logger = app.state::<Logger>();
    logger.api_request(
        "ask_word_tutor",
        Some(&format!(
            "word_id: {}, history: {}, question_chars: {}",
            request.word_id,
            request.history.len(),
            request.question.chars().count()
        )),
    );
    let result = async {
        let app_data_dir = crate::app_paths::dirs(&app).data;
        let paths = AgentPaths::resolve(&app_data_dir)?;
        let emitter = app.clone();
        let (request_id, word_id) = (request.request_id.clone(), request.word_id);
        WordTutorService::new(
            Arc::new(app.state::<SqlitePool>().inner().clone()),
            Arc::new(logger.inner().clone()),
        )
        .ask(&request, &paths, |delta| {
            let _ = emitter.emit(
                "word-tutor-delta",
                TutorDelta {
                    request_id: request_id.clone(),
                    word_id,
                    delta: delta.to_string(),
                },
            );
        })
        .await
    }
    .await;
    match &result {
        Ok(reply) => logger.api_response(
            "ask_word_tutor",
            true,
            Some(&format!(
                "{} chars, {} follow-ups",
                reply.content.chars().count(),
                reply.follow_ups.len()
            )),
        ),
        Err(e) => logger.api_response("ask_word_tutor", false, Some(&e.to_string())),
    }
    result
}
