//! AI 老师独立对话：对话的保存、恢复、命名、压缩都交给 pi 会话（`agent::chat`）；
//! 这里只负责启动参数（模型、学习者档案、提示词、工具与 skills、拼读 MCP 服务地址）、对话的资料夹（附件），
//! 对话列表与置顶 / 归档（pi 没有，存 app_settings）。

use crate::agent::chat::{ChatHub, ChatSession, Emit};
use crate::agent::config::{prepare_launch, SessionMode, TaskWorkspace};
use crate::agent::{tasks, AgentPaths};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::mcp::McpEndpoint;
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
/// 一次最多带几个文件
pub const MAX_FILES: usize = 5;
/// 标题最长（字符）
const MAX_TITLE_CHARS: usize = 60;

/// 对话的会话目录与工作目录（工作目录固定，pi 按它归类会话）
fn dirs(paths: &AgentPaths) -> (PathBuf, PathBuf) {
    let root = paths.root.join("tutor");
    (root.join("sessions"), root.join("cwd"))
}

/// 对话的资料夹：附件放这里，素材阅读工具只能读这里
fn files_dir(paths: &AgentPaths, id: &str) -> PathBuf {
    paths.root.join("tutor").join("files").join(id)
}

/// 会话 id 的写法与 pi 一致（字母数字开头结尾，中间可有 `._-`）；拼路径前校验，防止跳出目录
fn check_id(id: &str) -> AppResult<()> {
    let ok = !id.is_empty()
        && id.len() <= 100
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        && id.starts_with(|c: char| c.is_ascii_alphanumeric())
        && id.ends_with(|c: char| c.is_ascii_alphanumeric());
    if ok {
        Ok(())
    } else {
        Err(AppError::ValidationError("对话不存在".to_string()))
    }
}

/// 消息里附件的标记（最后一行）：前端据此显示文件，模型据此知道去资料夹里读
pub fn attachment_line(names: &[String]) -> String {
    format!("〔附件：{}〕", names.join("、"))
}

/// 启动 / 找到对话进程所需的环境
pub struct ChatEnv<'a> {
    pub paths: &'a AgentPaths,
    pub hub: &'a ChatHub,
    pub mcp: &'a McpEndpoint,
    pub emit: Emit,
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
        let sessions = match hub.cached_list() {
            Some(cached) => cached,
            None => {
                let listed = list_sessions(paths, &session_dir, &cwd).await?;
                hub.cache_list(listed.clone());
                listed
            }
        };
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

    /// 已有的对话进程，或按会话 id 启动（id 为空 = 新对话，由这里生成 id）
    async fn session(&self, env: &ChatEnv<'_>, id: Option<&str>) -> AppResult<Arc<ChatSession>> {
        if let Some(id) = id {
            check_id(id)?;
            if let Some(session) = env.hub.get(id).await {
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
        let (session_dir, cwd) = dirs(env.paths);
        std::fs::create_dir_all(&session_dir)
            .map_err(|e| AppError::InternalError(format!("准备对话目录失败：{}", e)))?;
        let conversation = id
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let files = files_dir(env.paths, &conversation);
        std::fs::create_dir_all(&files)
            .map_err(|e| AppError::InternalError(format!("准备对话目录失败：{}", e)))?;
        let images = crate::services::material_read::model_sees_images(env.paths, &model).await;
        let skills = crate::services::tutor_skills::write(&env.paths.root)?;
        let launch = prepare_launch(
            env.paths,
            &tasks::tutor_chat_task(&profile),
            &model,
            SessionMode::Persistent {
                dir: session_dir,
                id: conversation.clone(),
                resume: id.is_some(),
            },
            Some(&TaskWorkspace {
                dir: cwd,
                skills,
                env: vec![
                    (
                        "REDLARK_MATERIAL_DIR".to_string(),
                        files.to_string_lossy().into_owned(),
                    ),
                    (
                        "REDLARK_MODEL_IMAGES".to_string(),
                        if images { "1" } else { "0" }.to_string(),
                    ),
                    ("REDLARK_MCP_URL".to_string(), env.mcp.url.clone()),
                    ("REDLARK_MCP_TOKEN".to_string(), env.mcp.token.clone()),
                    ("REDLARK_CONVERSATION_ID".to_string(), conversation.clone()),
                ],
            }),
        )?;
        let session = env.hub.start(launch, env.emit.clone()).await?;
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
    pub async fn open(&self, env: &ChatEnv<'_>, id: &str) -> AppResult<TutorOpened> {
        let session = self.session(env, Some(id)).await?;
        let data = session.request("get_messages", Value::Null).await?;
        Ok(TutorOpened {
            id: session.id.clone(),
            messages: data.get("messages").cloned().unwrap_or(json!([])),
            running: session.is_running(),
            pending_asks: session.pending_ui(),
        })
    }

    /// 发一条消息（没有对话 id 时开新对话），返回对话 id；回答经事件推送
    pub async fn send(&self, env: &ChatEnv<'_>, request: &TutorSendRequest) -> AppResult<String> {
        let message = request.message.trim();
        if message.is_empty() && request.images.is_empty() && request.files.is_empty() {
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
        if request.files.len() > MAX_FILES {
            return Err(AppError::ValidationError(format!(
                "一次最多发 {} 个文件",
                MAX_FILES
            )));
        }
        let has_image = !request.images.is_empty()
            || request
                .files
                .iter()
                .any(|f| crate::services::material_read::is_image(&f.name));
        if has_image {
            let model = crate::services::agent_settings::AgentSettingsService::new(
                self.pool.clone(),
                self.logger.clone(),
            )
            .model_for(crate::services::agent_settings::AgentTaskKind::Tutor, None)
            .await?;
            crate::services::material_read::check_can_read(
                env.paths,
                &model,
                "截图.png",
                "AI 老师",
            )
            .await?;
        }
        let session = self
            .session(env, request.conversation_id.as_deref())
            .await?;
        let mut text = message.to_string();
        if !request.files.is_empty() {
            let dir = files_dir(env.paths, &session.id);
            let mut names = Vec::new();
            for file in &request.files {
                names.extend(crate::services::material_read::add_to_folder(
                    &dir, &file.name, &file.data,
                )?);
            }
            if !text.is_empty() {
                text.push_str("\n\n");
            }
            text.push_str(&attachment_line(&names));
        }
        let images = request
            .images
            .iter()
            .map(|i| json!({ "type": "image", "data": i.data, "mimeType": i.mime_type }))
            .collect();
        session.send(&text, images).await?;
        Ok(session.id.clone())
    }

    /// 停止，返回被清掉的排队消息
    pub async fn abort(&self, hub: &ChatHub, id: &str) -> AppResult<Vec<String>> {
        match hub.get(id).await {
            Some(session) => session.abort().await,
            None => Ok(Vec::new()),
        }
    }

    /// 改排队的消息（删掉 / 拿回输入框编辑后剩下的，按顺序）
    pub async fn set_queue(&self, hub: &ChatHub, id: &str, messages: &[String]) -> AppResult<()> {
        if messages.len() > 20
            || messages
                .iter()
                .any(|m| m.chars().count() > MAX_MESSAGE_CHARS)
        {
            return Err(AppError::ValidationError(
                "排队的消息太多或太长".to_string(),
            ));
        }
        let session = hub
            .get(id)
            .await
            .ok_or_else(|| AppError::ValidationError("这个对话已经结束，请重新提问".to_string()))?;
        session.replace_queue(messages).await
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
    pub async fn rename(&self, env: &ChatEnv<'_>, id: &str, name: &str) -> AppResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::ValidationError("名称不能为空".to_string()));
        }
        let name: String = name.chars().take(MAX_TITLE_CHARS).collect();
        let session = self.session(env, Some(id)).await?;
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
        check_id(id)?;
        hub.close(id).await;
        hub.invalidate_list();
        let _ = std::fs::remove_dir_all(files_dir(paths, id));
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
    use rmcp::handler::server::{router::tool::ToolRouter, wrapper::Parameters};
    use rmcp::model::CallToolResult;
    use rmcp::{schemars, tool, tool_handler, tool_router, ErrorData};
    use std::sync::Mutex;
    use std::time::Duration;

    #[test]
    fn conversation_ids_cannot_leave_the_folder() {
        assert!(check_id("01a129d6-e8fe-767a-a15d-d1eff7a0905d").is_ok());
        for bad in ["", "..", "../x", "a/b", ".hidden", "a..", "x\\y"] {
            assert!(check_id(bad).is_err(), "{bad}");
        }
        assert_eq!(
            attachment_line(&["讲义.pdf".into(), "a.txt".into()]),
            "〔附件：讲义.pdf、a.txt〕"
        );
    }

    /// 测试用的 MCP 服务：和拼读工具同样的结果形状
    #[derive(Clone)]
    struct FakePindu {
        tool_router: ToolRouter<Self>,
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct Words {
        words: Vec<String>,
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    #[allow(dead_code)] // 只用来声明参数
    struct DeleteWords {
        book_id: i64,
        word_ids: Vec<i64>,
    }

    /// 测试用的删除工具被真正调用的次数（确认被取消时应为 0）
    static DELETED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    #[tool_router]
    impl FakePindu {
        #[tool(
            description = "Deletes words from a word book. The learner is asked to confirm.",
            annotations(read_only_hint = false, destructive_hint = true)
        )]
        async fn delete_words(
            &self,
            Parameters(_args): Parameters<DeleteWords>,
        ) -> Result<CallToolResult, ErrorData> {
            DELETED.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            crate::mcp::tool_result(json!({ "deleted": 1 }), "删除了 1 个词".to_string(), None)
        }

        #[tool(
            description = "Check background jobs (writing / saving passages, generating questions, spelling analysis of new words): status, progress and current stage. Running jobs and those finished in the last hour; `fromThisConversation` marks the ones you started here. Use it whenever the learner asks about progress, and before saying something you started is ready.",
            annotations(read_only_hint = true)
        )]
        async fn background_jobs(&self) -> Result<CallToolResult, ErrorData> {
            crate::mcp::tool_result(
                json!([{ "title": "分析 12 个单词 · 旅行", "status": "进行中", "progress": "2/12",
                         "stage": "正在分析拼读、音标和例句", "fromThisConversation": true }]),
                "看了后台任务：1 个进行中，0 个刚结束".to_string(),
                None,
            )
        }

        #[tool(
            description = "Look up words in the learner's own word books.",
            annotations(read_only_hint = true)
        )]
        async fn lookup_words(
            &self,
            Parameters(args): Parameters<Words>,
        ) -> Result<CallToolResult, ErrorData> {
            crate::mcp::tool_result(
                json!({ "found": [], "notInBooks": args.words }),
                "查了你的词汇本：没有 itinerary".to_string(),
                None,
            )
        }
    }

    /// 和拼读的服务一样：工具清单加 reason，调用前拿掉
    #[tool_handler(router = self.tool_router)]
    impl rmcp::ServerHandler for FakePindu {
        async fn list_tools(
            &self,
            _request: Option<rmcp::model::PaginatedRequestParams>,
            _context: rmcp::service::RequestContext<rmcp::RoleServer>,
        ) -> Result<rmcp::model::ListToolsResult, ErrorData> {
            Ok(rmcp::model::ListToolsResult::with_all_items(
                self.tool_router
                    .list_all()
                    .into_iter()
                    .map(crate::mcp::reason::with_reason)
                    .collect(),
            ))
        }

        async fn call_tool(
            &self,
            mut request: rmcp::model::CallToolRequestParams,
            context: rmcp::service::RequestContext<rmcp::RoleServer>,
        ) -> Result<rmcp::model::CallToolResponse, ErrorData> {
            assert!(
                crate::mcp::reason::take_reason(&mut request).is_some(),
                "模型应写 reason"
            );
            let call = rmcp::handler::server::tool::ToolCallContext::new(self, request, context);
            self.tool_router.call(call).await
        }
    }

    /// 真实调用：新对话 → 调用拼读的 MCP 工具（步骤说明进 details）→ 接着聊（ask_user 经扩展 UI 回答）
    /// → 列表 → 关掉进程后打开 → 改名 → 删除。
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
        let mcp = crate::mcp::serve(|| {
            Ok(FakePindu {
                tool_router: FakePindu::tool_router(),
            })
        })
        .await
        .unwrap();
        let service = TutorChatService::new(pool, crate::test_support::test_logger());
        let hub = ChatHub::new();
        let events: Arc<Mutex<Vec<Value>>> = Arc::default();
        let sink = events.clone();
        let emit: Emit = Arc::new(move |_, e| sink.lock().unwrap().push(e));
        let env = ChatEnv {
            paths: &paths,
            hub: &hub,
            mcp: &mcp,
            emit,
        };
        let count = |kind: &str| {
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|e| e["type"] == kind)
                .count()
        };
        let wait = |n: usize| {
            let events = events.clone();
            async move {
                for _ in 0..900 {
                    let settled = events
                        .lock()
                        .unwrap()
                        .iter()
                        .filter(|e| e["type"] == "agent_settled")
                        .count();
                    if settled >= n {
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
            files: vec![],
        };

        let id = service
            .send(
                &env,
                &request(
                    None,
                    "查一下我的词汇本里有没有 itinerary，然后一句话告诉我。",
                ),
            )
            .await
            .unwrap();
        // 运行中补一句：进 pi 的队列（queue_update）；删掉后队列变空
        service
            .send(&env, &request(Some(id.clone()), "顺便告诉我它的词性。"))
            .await
            .unwrap();
        let queued = |text: &str| {
            let text = text.to_string();
            let events = events.clone();
            async move {
                for _ in 0..50 {
                    let last = events
                        .lock()
                        .unwrap()
                        .iter()
                        .rev()
                        .find(|e| e["type"] == "queue_update")
                        .cloned();
                    if let Some(e) = last {
                        let has = e["steering"]
                            .as_array()
                            .is_some_and(|q| q.iter().any(|m| m == &json!(text)));
                        if has == !text.is_empty() {
                            return true;
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                false
            }
        };
        if queued("顺便告诉我它的词性。").await {
            service.set_queue(&hub, &id, &[]).await.unwrap();
            assert!(queued("").await, "删掉后队列应为空");
            println!("队列：补充进了队列，删掉后清空");
        } else {
            println!("队列：补充送到时这一轮已经结束（没有排队）");
        }
        wait(1).await;
        let step = events
            .lock()
            .unwrap()
            .iter()
            .find(|e| {
                e["type"] == "tool_execution_end" && e["toolName"] == "mcp__pindu__lookup_words"
            })
            .map(|e| e["result"]["details"]["redlark"]["step"].clone());
        assert_eq!(
            step,
            Some(json!("查了你的词汇本：没有 itinerary")),
            "应调用拼读的 MCP 工具"
        );
        assert!(count("message_update") > 0, "应有流式增量");
        let calls: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "tool_execution_end")
            .map(|e| {
                format!(
                    "{}{}",
                    e["toolName"].as_str().unwrap_or(""),
                    if e["isError"] == true {
                        "（失败）"
                    } else {
                        ""
                    }
                )
            })
            .collect();
        println!("工具调用：{:?}", calls);
        let reasons: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "message_end" && e["message"]["role"] == "assistant")
            .flat_map(|e| {
                e["message"]["content"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
            })
            .filter(|b| b["type"] == "toolCall")
            .map(|b| {
                format!(
                    "{}：{}",
                    b["name"].as_str().unwrap_or(""),
                    b["arguments"]["reason"].as_str().unwrap_or("（没写）")
                )
            })
            .collect();
        println!("工具意图：{:?}", reasons);

        // ask_user：等提问出现后回答
        service
            .send(
                &env,
                &request(
                    Some(id.clone()),
                    "用 ask_user 问我要把它放进「旅行」还是「工作」，然后告诉我我选了什么。",
                ),
            )
            .await
            .unwrap();
        let mut asked = None;
        for _ in 0..600 {
            asked = events
                .lock()
                .unwrap()
                .iter()
                .find(|e| e["type"] == "extension_ui_request" && e["method"] == "select")
                .cloned();
            if asked.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let asked = asked.expect("应通过 ask_user 提问");
        // 提问还在等时重新打开对话：提问随消息一起交回界面
        let reopened = service.open(&env, &id).await.unwrap();
        assert_eq!(reopened.pending_asks.len(), 1, "还没回答的提问应能拿回来");
        assert_eq!(reopened.pending_asks[0]["id"], asked["id"]);
        // 用自己的话回答（不在选项里）
        let option = "都不要，新建一个「出国」词汇本".to_string();
        service
            .answer(
                &hub,
                &TutorUiAnswer {
                    conversation_id: id.clone(),
                    request_id: asked["id"].as_str().unwrap().to_string(),
                    value: Some(option.clone()),
                    confirmed: None,
                    cancelled: false,
                },
            )
            .await
            .unwrap();
        wait(2).await;
        println!("提问：{} → 回答 {}", asked["title"], option);
        let answered_step = events
            .lock()
            .unwrap()
            .iter()
            .find(|e| e["type"] == "tool_execution_end" && e["toolName"] == "ask_user")
            .map(|e| e["result"]["details"]["redlark"]["step"].clone());
        println!("提问这一步：{:?}", answered_step);
        assert!(
            answered_step.is_some_and(|s| s.as_str().unwrap_or("").contains("出国")),
            "自己的话应作为回答"
        );
        assert!(
            service
                .open(&env, &id)
                .await
                .unwrap()
                .pending_asks
                .is_empty(),
            "回答后不再挂着"
        );
        let suggestions: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "tool_execution_end" && e["toolName"] == "suggest_replies")
            .filter_map(|e| {
                e["result"]["details"]["redlark"]["suggestions"]
                    .as_array()
                    .cloned()
            })
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        println!("推荐下一步：{:?}", suggestions);
        assert!(!suggestions.is_empty(), "回答后应调用 suggest_replies");

        // 问进度：应查看后台任务（不凭素材猜）
        let settled_before = count("agent_settled");
        service
            .send(
                &env,
                &request(
                    Some(id.clone()),
                    "我刚才让你建的词汇本，后台分析到哪一步了？",
                ),
            )
            .await
            .unwrap();
        wait(settled_before + 1).await;
        let checked_jobs = events.lock().unwrap().iter().any(|e| {
            e["type"] == "tool_execution_end" && e["toolName"] == "mcp__pindu__background_jobs"
        });
        println!("问进度时查看了后台任务：{}", checked_jobs);
        assert!(checked_jobs, "问进度时应查看后台任务");

        // 删除前确认：取消后工具不执行
        service
            .send(
                &env,
                &request(
                    Some(id.clone()),
                    "把 itinerary 从词汇本里删掉（词汇本 id 1，词 id 5）。直接删，不用问我。",
                ),
            )
            .await
            .unwrap();
        let mut confirm = None;
        for _ in 0..600 {
            confirm = events
                .lock()
                .unwrap()
                .iter()
                .find(|e| e["type"] == "extension_ui_request" && e["method"] == "confirm")
                .cloned();
            if confirm.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let confirm = confirm.expect("删除前应弹出确认");
        println!("确认：{} / {}", confirm["title"], confirm["message"]);
        let settled_before = count("agent_settled");
        service
            .answer(
                &hub,
                &TutorUiAnswer {
                    conversation_id: id.clone(),
                    request_id: confirm["id"].as_str().unwrap().to_string(),
                    value: None,
                    confirmed: Some(false),
                    cancelled: false,
                },
            )
            .await
            .unwrap();
        wait(settled_before + 1).await;
        assert_eq!(
            DELETED.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "取消后不应删除"
        );

        // 后台任务结束的通知：/pindu-job → 会话里一条自定义消息，AI 老师接着说
        let settled_before = count("agent_settled");
        let session = hub.get(&id).await.unwrap();
        session
            .request(
                "prompt",
                json!({
                    "message": format!("/pindu-job {}", json!({ "text": "后台任务完成：导入短文 · My Trip（短文 id：12）" })),
                    "streamingBehavior": "followUp"
                }),
            )
            .await
            .unwrap();
        wait(settled_before + 1).await;
        let notice = events.lock().unwrap().iter().any(|e| {
            e["type"] == "message_end"
                && e["message"]["role"] == "custom"
                && e["message"]["customType"] == "pindu-job"
        });
        assert!(notice, "会话里应有后台任务的通知");
        let reply = events
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|e| e["type"] == "message_end" && e["message"]["role"] == "assistant")
            .map(|e| {
                e["message"]["content"]
                    .to_string()
                    .chars()
                    .take(160)
                    .collect::<String>()
            });
        println!("通知后 AI 老师说：{:?}", reply);

        let list = service.list(&paths, &hub).await.unwrap();
        let item = list.iter().find(|c| c.id == id).expect("列表里有这个对话");
        println!("列表：{:?}", item);

        // 关掉进程后再打开：pi 从会话文件恢复
        hub.close(&id).await;
        let opened = service.open(&env, &id).await.unwrap();
        let roles: Vec<&str> = opened
            .messages
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|m| m["role"].as_str())
            .collect();
        println!("消息角色：{:?}", roles);
        assert_eq!(roles.iter().filter(|r| **r == "user").count(), 4);
        // 按需加载：一开始只声明直接可用的拼读工具，删词（deferred）由 tool_search 加载
        let first_tools: Vec<String> = opened.messages[0]["toolsAdded"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|t| t["name"].as_str().map(str::to_string))
            .filter(|n| n.starts_with("mcp__") || n == "tool_search")
            .collect();
        println!("一开始声明的拼读工具：{:?}", first_tools);
        assert!(first_tools.iter().any(|n| n == "mcp__pindu__lookup_words"));
        assert!(
            !first_tools.iter().any(|n| n == "mcp__pindu__delete_words"),
            "删词应按需加载"
        );
        let searched = opened.messages.as_array().unwrap().iter().any(|m| {
            m["role"] == "assistant"
                && m["content"]
                    .as_array()
                    .is_some_and(|c| c.iter().any(|b| b["name"] == "tool_search"))
        });
        println!("用过 tool_search：{}", searched);
        // skills 写进了系统提示词（pi 只在 read 可用时才写）
        let system = opened.messages[0].to_string();
        assert!(
            system.contains("tutor-vocabulary") && system.contains("available_skills"),
            "系统提示词应列出 skills"
        );
        let saved_step = opened.messages.as_array().unwrap().iter().find_map(|m| {
            (m["role"] == "toolResult" && m["toolName"] == "mcp__pindu__lookup_words")
                .then(|| m["details"]["redlark"]["step"].clone())
        });
        assert_eq!(
            saved_step,
            Some(json!("查了你的词汇本：没有 itinerary")),
            "步骤说明应存进会话"
        );

        service.rename(&env, &id, "itinerary 查词").await.unwrap();
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
