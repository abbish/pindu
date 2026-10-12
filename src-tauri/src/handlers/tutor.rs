//! AI 老师独立对话命令。回答、步骤、提问都以 pi 的原始事件经 `tutor-event` 推送（按 conversationId 区分，带递增序号 seq）。

use crate::agent::chat::{ChatHub, Emit};
use crate::error::AppResult;
use crate::handlers::{agent_paths, finish};
use crate::logger::Logger;
use crate::services::tutor_chat::{ChatEnv, TutorChatService};
use crate::types::tutor::{
    TutorActivity, TutorConversation, TutorFlags, TutorOpened, TutorSearchHit, TutorSendRequest,
    TutorUiAnswer,
};
use serde_json::json;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

fn service(app: &AppHandle) -> TutorChatService {
    TutorChatService::new(
        Arc::new(app.state::<SqlitePool>().inner().clone()),
        Arc::new(app.state::<Logger>().inner().clone()),
    )
}

fn hub(app: &AppHandle) -> ChatHub {
    app.state::<ChatHub>().inner().clone()
}

fn emitter(app: &AppHandle) -> Emit {
    let app = app.clone();
    Arc::new(move |id, seq, event| {
        let _ = app.emit(
            "tutor-event",
            json!({ "conversationId": id, "seq": seq, "event": event }),
        );
    })
}

#[tauri::command]
pub async fn get_tutor_conversations(app: AppHandle) -> AppResult<Vec<TutorConversation>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_tutor_conversations", None);
    let result = async {
        // 对话很多时 pi 分批读：读好一批就推给界面（`tutor-conversations-partial`），不用等全部读完
        let emitter = app.clone();
        service(&app)
            .list(&agent_paths(&app)?, &hub(&app), move |partial| {
                let _ = emitter.emit("tutor-conversations-partial", partial);
            })
            .await
    }
    .await;
    finish(&logger, "get_tutor_conversations", result)
}

/// 搜索对话：标题或对话内容
#[tauri::command]
pub async fn search_tutor_conversations(
    app: AppHandle,
    query: String,
) -> AppResult<Vec<TutorSearchHit>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "search_tutor_conversations",
        Some(&format!("query: {} 字", query.chars().count())),
    );
    let result = async {
        service(&app)
            .search(&agent_paths(&app)?, &hub(&app), &query)
            .await
    }
    .await;
    finish(&logger, "search_tutor_conversations", result)
}

/// 从某条学习者消息重新问：这条之前的对话另开成新对话，返回新对话 id（这条之前还没有回答时为空，界面直接开新对话）
#[tauri::command]
pub async fn fork_tutor_conversation(
    app: AppHandle,
    conversation_id: String,
    timestamp: i64,
) -> AppResult<Option<String>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "fork_tutor_conversation",
        Some(&format!("{conversation_id} @ {timestamp}")),
    );
    let result = async {
        service(&app)
            .fork(&agent_paths(&app)?, &hub(&app), &conversation_id, timestamp)
            .await
    }
    .await;
    finish(&logger, "fork_tutor_conversation", result)
}

#[tauri::command]
pub async fn open_tutor_conversation(
    app: AppHandle,
    conversation_id: String,
) -> AppResult<TutorOpened> {
    let logger = app.state::<Logger>();
    logger.api_request("open_tutor_conversation", Some(&conversation_id));
    let result = async {
        let (paths, hub, mcp) = (
            agent_paths(&app)?,
            hub(&app),
            crate::mcp::endpoint(&app).await?,
        );
        let env = ChatEnv {
            paths: &paths,
            hub: &hub,
            mcp: &mcp,
            emit: emitter(&app),
        };
        service(&app).open(&env, &conversation_id).await
    }
    .await;
    finish(&logger, "open_tutor_conversation", result)
}

/// 发一条消息，返回对话 id（新对话时是新建的）
#[tauri::command]
pub async fn send_tutor_message(app: AppHandle, request: TutorSendRequest) -> AppResult<String> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "send_tutor_message",
        Some(&format!(
            "conversation: {:?}, {} chars, {} images, {} files",
            request.conversation_id,
            request.message.chars().count(),
            request.images.len(),
            request.files.len()
        )),
    );
    let result = async {
        let (paths, hub, mcp) = (
            agent_paths(&app)?,
            hub(&app),
            crate::mcp::endpoint(&app).await?,
        );
        let env = ChatEnv {
            paths: &paths,
            hub: &hub,
            mcp: &mcp,
            emit: emitter(&app),
        };
        service(&app).send(&env, &request).await
    }
    .await;
    finish(&logger, "send_tutor_message", result)
}

/// 停止本轮，返回被清掉的排队消息（前端放回输入框）
#[tauri::command]
pub async fn stop_tutor_conversation(
    app: AppHandle,
    conversation_id: String,
) -> AppResult<Vec<String>> {
    let logger = app.state::<Logger>();
    logger.api_request("stop_tutor_conversation", Some(&conversation_id));
    let result = service(&app).abort(&hub(&app), &conversation_id).await;
    finish(&logger, "stop_tutor_conversation", result)
}

/// 改排队的消息（pi 的队列：删掉、拿回输入框编辑后剩下的，按顺序）
#[tauri::command]
pub async fn set_tutor_queue(
    app: AppHandle,
    conversation_id: String,
    messages: Vec<String>,
) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "set_tutor_queue",
        Some(&format!("{} messages: {}", conversation_id, messages.len())),
    );
    let result = service(&app)
        .set_queue(&hub(&app), &conversation_id, &messages)
        .await;
    finish(&logger, "set_tutor_queue", result)
}

#[tauri::command]
pub async fn answer_tutor_question(app: AppHandle, request: TutorUiAnswer) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("answer_tutor_question", Some(&request.conversation_id));
    let result = service(&app).answer(&hub(&app), &request).await;
    finish(&logger, "answer_tutor_question", result)
}

#[tauri::command]
pub async fn rename_tutor_conversation(
    app: AppHandle,
    conversation_id: String,
    name: String,
) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("rename_tutor_conversation", Some(&conversation_id));
    let result = async {
        let (paths, hub, mcp) = (
            agent_paths(&app)?,
            hub(&app),
            crate::mcp::endpoint(&app).await?,
        );
        let env = ChatEnv {
            paths: &paths,
            hub: &hub,
            mcp: &mcp,
            emit: emitter(&app),
        };
        service(&app).rename(&env, &conversation_id, &name).await
    }
    .await;
    finish(&logger, "rename_tutor_conversation", result)
}

#[tauri::command]
pub async fn set_tutor_conversation_flags(
    app: AppHandle,
    conversation_id: String,
    pinned: bool,
    archived: bool,
) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "set_tutor_conversation_flags",
        Some(&format!(
            "{} pinned={} archived={}",
            conversation_id, pinned, archived
        )),
    );
    let result = service(&app)
        .set_flags(&conversation_id, TutorFlags { pinned, archived })
        .await;
    finish(&logger, "set_tutor_conversation_flags", result)
}

#[tauri::command]
pub async fn delete_tutor_conversation(app: AppHandle, conversation_id: String) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("delete_tutor_conversation", Some(&conversation_id));
    let result = async {
        service(&app)
            .delete(&agent_paths(&app)?, &hub(&app), &conversation_id)
            .await
    }
    .await;
    finish(&logger, "delete_tutor_conversation", result)
}

/// 在回答或在等学习者回答的对话（侧边栏「AI 老师」的标记；之后的变化经 `redlark_activity` 事件推送）
#[tauri::command]
pub async fn get_tutor_activity(app: AppHandle) -> AppResult<Vec<TutorActivity>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_tutor_activity", None);
    let activity = hub(&app)
        .activity()
        .await
        .into_iter()
        .map(|(conversation_id, running, asking)| TutorActivity {
            conversation_id,
            running,
            asking,
        })
        .collect();
    finish(&logger, "get_tutor_activity", Ok(activity))
}
