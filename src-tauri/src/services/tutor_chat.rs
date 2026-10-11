//! AI 老师独立对话：对话的保存、恢复、命名、压缩都交给 pi 会话（`agent::chat`）；
//! 这里只负责启动参数（模型、学习者档案、提示词）、对话列表与置顶 / 归档（pi 没有，存 app_settings）。

use crate::agent::chat::{ChatHub, ChatSession, Emit};
use crate::agent::config::{prepare_launch, SessionMode, TaskWorkspace};
use crate::agent::{tasks, AgentPaths};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::settings_repository::SettingsRepository;
use crate::types::tutor::{
    TutorConversation, TutorFlags, TutorOpened, TutorSendRequest, TutorUiAnswer,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

/// 置顶 / 归档（会话 id → 标记）
const FLAGS_KEY: &str = "tutor.conversations";
/// 一条消息的长度上限（字符）
pub const MAX_MESSAGE_CHARS: usize = 20_000;
/// 一次最多带几张图片
pub const MAX_IMAGES: usize = 8;
/// 标题最长（字符）
const MAX_TITLE_CHARS: usize = 60;

/// 对话的会话目录与工作目录（工作目录固定，pi 按它归类会话）
fn dirs(paths: &AgentPaths) -> (PathBuf, PathBuf) {
    let root = paths.root.join("tutor");
    (root.join("sessions"), root.join("cwd"))
}

/// 解析符号链接后的路径（pi 记录的工作目录是真实路径，如 macOS 的 /var → /private/var）
fn real_path(path: PathBuf) -> PathBuf {
    std::fs::canonicalize(&path).unwrap_or(path)
}

/// pi 按工作目录列出会话：工作目录要用真实路径才对得上
async fn list_sessions(
    paths: &AgentPaths,
    session_dir: &std::path::Path,
    cwd: &std::path::Path,
) -> AppResult<Vec<crate::agent::chat::SessionSummary>> {
    crate::agent::chat::list_sessions(paths, session_dir, &real_path(cwd.to_path_buf())).await
}

pub struct TutorChatService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl TutorChatService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    async fn flags(&self) -> HashMap<String, TutorFlags> {
        match SettingsRepository::get(&self.pool, FLAGS_KEY).await {
            Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_default(),
            Ok(None) => HashMap::new(),
            Err(e) => {
                self.logger.warn(
                    "TUTOR",
                    "读取对话置顶 / 归档失败，按未设置处理",
                    Some(&e.to_string()),
                );
                HashMap::new()
            }
        }
    }

    async fn save_flags(&self, flags: &HashMap<String, TutorFlags>) -> AppResult<()> {
        let json = serde_json::to_string(flags)
            .map_err(|e| AppError::InternalError(format!("保存对话标记失败：{}", e)))?;
        let mut conn = self.pool.acquire().await?;
        SettingsRepository::set(&mut conn, FLAGS_KEY, Some(&json)).await
    }

    /// 对话列表（pi 列出会话），新的在前
    pub async fn list(
        &self,
        paths: &AgentPaths,
        hub: &ChatHub,
    ) -> AppResult<Vec<TutorConversation>> {
        let (session_dir, cwd) = dirs(paths);
        if !session_dir.exists() {
            return Ok(Vec::new());
        }
        let sessions = list_sessions(paths, &session_dir, &cwd).await?;
        let flags = self.flags().await;
        let running = hub.running_ids().await;
        let mut list: Vec<TutorConversation> = sessions
            .into_iter()
            .filter(|s| s.message_count > 0)
            .map(|s| {
                let flag = flags.get(&s.id).cloned().unwrap_or_default();
                let title = s
                    .name
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or(s.first_message);
                TutorConversation {
                    running: running.contains(&s.id),
                    title: title.trim().chars().take(MAX_TITLE_CHARS).collect(),
                    id: s.id,
                    created: s.created,
                    modified: s.modified,
                    message_count: s.message_count,
                    pinned: flag.pinned,
                    archived: flag.archived,
                }
            })
            .collect();
        list.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(list)
    }

    /// 已有的对话进程，或按会话 id 启动（id 为空 = 新对话）
    async fn session(
        &self,
        paths: &AgentPaths,
        hub: &ChatHub,
        id: Option<&str>,
        emit: Emit,
    ) -> AppResult<Arc<ChatSession>> {
        if let Some(id) = id {
            if let Some(session) = hub.get(id).await {
                return Ok(session);
            }
        }
        let model = crate::services::agent_settings::AgentSettingsService::new(
            self.pool.clone(),
            self.logger.clone(),
        )
        .model_for(crate::services::agent_settings::AgentTaskKind::Tutor, None)
        .await?;
        let profile =
            crate::services::prompt_profile::PromptProfileService::load(&self.pool).await?;
        let (session_dir, cwd) = dirs(paths);
        std::fs::create_dir_all(&session_dir)
            .map_err(|e| AppError::InternalError(format!("准备对话目录失败：{}", e)))?;
        let launch = prepare_launch(
            paths,
            &tasks::tutor_chat_task(&profile),
            &model,
            SessionMode::Persistent {
                dir: session_dir,
                session: id.map(str::to_string),
            },
            Some(&TaskWorkspace {
                dir: cwd,
                ..Default::default()
            }),
        )?;
        let session = hub.start(launch, emit).await?;
        self.logger.info(
            "TUTOR",
            &format!(
                "AI 老师对话已启动：{}（{}，model={}）",
                session.id,
                if id.is_some() {
                    "接着聊"
                } else {
                    "新对话"
                },
                model.model_id
            ),
        );
        Ok(session)
    }

    /// 打开对话：pi 的消息
    pub async fn open(
        &self,
        paths: &AgentPaths,
        hub: &ChatHub,
        id: &str,
        emit: Emit,
    ) -> AppResult<TutorOpened> {
        let session = self.session(paths, hub, Some(id), emit).await?;
        let data = session.request("get_messages", Value::Null).await?;
        Ok(TutorOpened {
            id: session.id.clone(),
            messages: data.get("messages").cloned().unwrap_or(json!([])),
            running: session.is_running(),
        })
    }

    /// 发一条消息（没有对话 id 时开新对话），返回对话 id；回答经事件推送
    pub async fn send(
        &self,
        paths: &AgentPaths,
        hub: &ChatHub,
        request: &TutorSendRequest,
        emit: Emit,
    ) -> AppResult<String> {
        let message = request.message.trim();
        if message.is_empty() && request.images.is_empty() {
            return Err(AppError::ValidationError("说点什么吧".to_string()));
        }
        if message.chars().count() > MAX_MESSAGE_CHARS {
            return Err(AppError::ValidationError(format!(
                "内容太长了，请控制在 {} 个字以内，或者作为文件发给我",
                MAX_MESSAGE_CHARS
            )));
        }
        if request.images.len() > MAX_IMAGES {
            return Err(AppError::ValidationError(format!(
                "一次最多发 {} 张图片",
                MAX_IMAGES
            )));
        }
        let session = self
            .session(paths, hub, request.conversation_id.as_deref(), emit)
            .await?;
        let images = request
            .images
            .iter()
            .map(|i| json!({ "type": "image", "data": i.data, "mimeType": i.mime_type }))
            .collect();
        session.send(message, images).await?;
        Ok(session.id.clone())
    }

    pub async fn abort(&self, hub: &ChatHub, id: &str) -> AppResult<()> {
        match hub.get(id).await {
            Some(session) => session.abort().await,
            None => Ok(()),
        }
    }

    /// 回答工具向用户的提问
    pub async fn answer(&self, hub: &ChatHub, answer: &TutorUiAnswer) -> AppResult<()> {
        let session = hub
            .get(&answer.conversation_id)
            .await
            .ok_or_else(|| AppError::ValidationError("这个对话已经结束，请重新提问".to_string()))?;
        let mut response = json!({ "type": "extension_ui_response", "id": answer.request_id });
        if answer.cancelled {
            response["cancelled"] = json!(true);
        } else if let Some(confirmed) = answer.confirmed {
            response["confirmed"] = json!(confirmed);
        } else {
            response["value"] = json!(answer.value.clone().unwrap_or_default());
        }
        session.respond_ui(response).await
    }

    /// 改名（pi 的会话名）
    pub async fn rename(
        &self,
        paths: &AgentPaths,
        hub: &ChatHub,
        id: &str,
        name: &str,
        emit: Emit,
    ) -> AppResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::ValidationError("名称不能为空".to_string()));
        }
        let name: String = name.chars().take(MAX_TITLE_CHARS).collect();
        let session = self.session(paths, hub, Some(id), emit).await?;
        session
            .request("set_session_name", json!({ "name": name }))
            .await
            .map(|_| ())
    }

    pub async fn set_flags(&self, id: &str, flags: TutorFlags) -> AppResult<()> {
        let mut all = self.flags().await;
        if flags.pinned || flags.archived {
            all.insert(id.to_string(), flags);
        } else {
            all.remove(id);
        }
        self.save_flags(&all).await
    }

    /// 删除对话：关掉进程，删除 pi 的会话文件
    pub async fn delete(&self, paths: &AgentPaths, hub: &ChatHub, id: &str) -> AppResult<()> {
        hub.close(id).await;
        let (session_dir, cwd) = dirs(paths);
        let sessions = list_sessions(paths, &session_dir, &cwd).await?;
        if let Some(session) = sessions.iter().find(|s| s.id == id) {
            let path = real_path(PathBuf::from(&session.path));
            // 只删会话目录里的文件
            if path.starts_with(real_path(session_dir)) {
                std::fs::remove_file(&path)
                    .map_err(|e| AppError::InternalError(format!("删除对话失败：{}", e)))?;
            }
        }
        let mut all = self.flags().await;
        if all.remove(id).is_some() {
            self.save_flags(&all).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::time::Duration;

    /// 真实调用：新对话 → 流式回答 → 接着聊 → 列表 → 打开 → 改名 → 删除。
    /// `REDLARK_E2E_DB=<数据库副本> REDLARK_AGENT_BIN=<sidecar> cargo test real_tutor_chat -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn real_tutor_chat_round_trip() {
        let db = std::env::var("REDLARK_E2E_DB").expect("REDLARK_E2E_DB");
        let pool = Arc::new(
            crate::database::connect(std::path::Path::new(&db))
                .await
                .unwrap(),
        );
        let root = std::env::temp_dir().join(format!("tutor-e2e-{}", uuid::Uuid::new_v4()));
        let paths = AgentPaths {
            program: std::env::var("REDLARK_AGENT_BIN")
                .expect("REDLARK_AGENT_BIN")
                .into(),
            root: root.join("agent"),
        };
        let service = TutorChatService::new(pool, crate::test_support::test_logger());
        let hub = ChatHub::new();
        let events: Arc<Mutex<Vec<Value>>> = Arc::default();
        let sink = events.clone();
        let emit: Emit = Arc::new(move |_, e| sink.lock().unwrap().push(e));
        let settled = |events: &Arc<Mutex<Vec<Value>>>| {
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|e| e["type"] == "agent_settled")
                .count()
        };
        let wait = |n: usize| {
            let events = events.clone();
            async move {
                for _ in 0..600 {
                    if settled(&events) >= n {
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                panic!("没有等到第 {} 轮结束", n);
            }
        };

        let request = |id: Option<String>, message: &str| TutorSendRequest {
            conversation_id: id,
            message: message.to_string(),
            images: vec![],
        };
        let id = service
            .send(
                &paths,
                &hub,
                &request(None, "itinerary 是什么意思？一句话回答。"),
                emit.clone(),
            )
            .await
            .unwrap();
        wait(1).await;
        let deltas = events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "message_update")
            .count();
        assert!(deltas > 0, "应有流式增量");

        service
            .send(
                &paths,
                &hub,
                &request(Some(id.clone()), "再给一个例句。"),
                emit.clone(),
            )
            .await
            .unwrap();
        wait(2).await;

        let list = service.list(&paths, &hub).await.unwrap();
        let item = list.iter().find(|c| c.id == id).expect("列表里有这个对话");
        assert!(item.message_count >= 4, "{:?}", item);
        println!("列表：{:?}", item);

        // 关掉进程后再打开：pi 从会话文件恢复
        hub.close(&id).await;
        let opened = service.open(&paths, &hub, &id, emit.clone()).await.unwrap();
        let roles: Vec<&str> = opened
            .messages
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|m| m["role"].as_str())
            .collect();
        println!("消息角色：{:?}", roles);
        assert_eq!(roles.iter().filter(|r| **r == "user").count(), 2);

        service
            .rename(&paths, &hub, &id, "itinerary 查词", emit.clone())
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        let list = service.list(&paths, &hub).await.unwrap();
        assert_eq!(
            list.iter().find(|c| c.id == id).unwrap().title,
            "itinerary 查词"
        );

        service.delete(&paths, &hub, &id).await.unwrap();
        assert!(service
            .list(&paths, &hub)
            .await
            .unwrap()
            .iter()
            .all(|c| c.id != id));
        let _ = std::fs::remove_dir_all(root);
    }
}
