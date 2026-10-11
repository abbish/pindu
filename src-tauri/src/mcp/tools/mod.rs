//! 拼读 MCP 工具：AI 老师查学习者的资料、往素材库里收东西。
//!
//! 约定：
//! - 只读的工具标 `read_only_hint`；写入的只新增（建词汇本、加词、存短文、写短文、出题），不改不删已有素材，
//!   也不碰学习计划与练习（`destructive_hint = false`）。
//! - 写入沿用应用里同一条路径（同名命令与后台任务），校验与规则一致；耗时的返回 jobId，进度在任务里看。
//! - 结果的 `structuredContent` = `{ data, redlark }`：`data` 给模型；`redlark.step` 是给用户看的一句话，
//!   `redlark.output` 是收进来的素材（界面上的卡片）。sidecar 扩展把 `redlark` 挪进 pi 工具结果的 details。

use crate::error::AppError;
use crate::logger::Logger;
use crate::repositories::tutor_repository;
use rmcp::handler::server::{router::tool::ToolRouter, wrapper::Parameters};
use rmcp::model::{CallToolResult, ContentBlock, ServerCapabilities, ServerConfig};
use rmcp::{schemars, tool, tool_handler, tool_router, ErrorData, ServerHandler};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

mod organize;
mod passages;
mod plans;
mod study;
mod videos;
mod words;

/// 没有出现在正文里的词汇（单词按词形，went 算 go；词组连着出现、可变形）
fn missing_vocabulary(text: &str, words: &[NewWord]) -> Vec<String> {
    let tokens: Vec<&str> = crate::services::passage_rules::words_of(text).collect();
    words
        .iter()
        .map(|w| crate::types::wordbook::normalize_vocab(w.word.trim()))
        .filter(|w| !w.is_empty())
        .filter(|w| {
            let key = w.to_lowercase();
            let found = if crate::services::passage_rules::is_phrase(&key) {
                !crate::lemma::phrase_spans(&tokens, &key, &[]).is_empty()
            } else {
                tokens.iter().any(|t| crate::lemma::is_form_of(t, &key))
            };
            !found
        })
        .collect()
}

/// 任务状态的说法（给 AI 老师转述）
fn job_status_text(status: crate::jobs::JobStatus) -> &'static str {
    use crate::jobs::JobStatus::*;
    match status {
        Queued => "排队中",
        Running => "进行中",
        Succeeded => "已完成",
        Failed => "没能完成",
        Cancelled => "已停止",
    }
}

/// 一次最多查 / 收多少个词
const MAX_WORDS: usize = 200;

#[derive(Clone)]
pub struct PinduTools {
    app: AppHandle,
    tool_router: ToolRouter<Self>,
}

/// 工具结果：给模型的数据 + 给用户的一句话（+ 收进来的素材）
pub fn done(data: Value, step: String, output: Option<Value>) -> Result<CallToolResult, ErrorData> {
    let mut redlark = json!({ "step": step });
    if let Some(output) = output {
        redlark["output"] = output;
    }
    let mut result = CallToolResult::structured(json!({ "data": data, "redlark": redlark }));
    // 模型只需要数据
    result.content = vec![ContentBlock::text(data.to_string())];
    Ok(result)
}

/// 失败：模型看到原因（用户能看懂的说法），可以换个做法
fn failed(step: &str, error: AppError) -> Result<CallToolResult, ErrorData> {
    let message = error.user_message();
    let mut result = CallToolResult::structured_error(json!({
        "data": { "error": message },
        "redlark": { "step": format!("{}：{}", step, message) },
    }));
    result.content = vec![ContentBlock::text(message)];
    Ok(result)
}

fn clean_words(words: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    words
        .iter()
        .map(|w| crate::types::wordbook::normalize_vocab(w.trim()))
        .filter(|w| !w.is_empty() && seen.insert(w.to_lowercase()))
        .take(MAX_WORDS)
        .collect()
}

fn preview(items: &[String], limit: usize) -> String {
    let mut text = items
        .iter()
        .take(limit)
        .cloned()
        .collect::<Vec<_>>()
        .join("、");
    if items.len() > limit {
        text.push_str(&format!(" 等 {} 个", items.len()));
    }
    text
}

// ---- 参数 ----

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct LookupWordsArgs {
    /// English words or phrases to look up (base forms)
    pub words: Vec<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct BookWordsArgs {
    pub book_id: i64,
    /// Page number, 1-based (100 words per page)
    #[serde(default)]
    pub page: Option<u32>,
    /// Filter by word or meaning
    #[serde(default)]
    pub search: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateBookArgs {
    pub book_id: i64,
    #[serde(default)]
    pub title: Option<String>,
    /// Scene description in Chinese
    #[serde(default)]
    pub description: Option<String>,
    /// Tag names (replaces all tags of the book)
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// true = draft (not usable in study plans), false = normal
    #[serde(default)]
    pub draft: Option<bool>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateWordArgs {
    pub word_id: i64,
    /// New spelling (only to fix a typo)
    #[serde(default)]
    pub word: Option<String>,
    /// Chinese meaning
    #[serde(default)]
    pub meaning: Option<String>,
    /// e.g. n. / v. / adj.
    #[serde(default)]
    pub part_of_speech: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteWordsArgs {
    pub book_id: i64,
    pub word_ids: Vec<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ExamplesArgs {
    pub word_id: i64,
    /// append (default) or replace
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct WordArgs {
    /// English word or phrase
    pub word: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdatePassageArgs {
    pub passage_id: i64,
    #[serde(default)]
    pub title: Option<String>,
    /// a1 / a2 / b1 / b2
    #[serde(default)]
    pub level: Option<String>,
    /// Scene description in Chinese
    #[serde(default)]
    pub scene: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TranslationArgs {
    pub passage_id: i64,
    /// Sentence index, 0-based (order in get_passage)
    pub index: i64,
    /// New Chinese translation
    pub zh: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PassageVocabularyArgs {
    pub passage_id: i64,
    /// Words / phrases to add (base forms, must appear in the text)
    #[serde(default)]
    pub add: Vec<String>,
    /// Words / phrases to remove
    #[serde(default)]
    pub remove: Vec<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct QuestionSetIdArgs {
    pub set_id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RenameSetArgs {
    pub set_id: i64,
    pub name: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct BookArgs {
    /// Word book id (from list_word_books)
    pub book_id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PassageArgs {
    /// Passage id (from list_passages)
    pub passage_id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct NewWord {
    /// English word or phrase, base form (e.g. "check in")
    pub word: String,
    /// Chinese meaning for this context (optional; filled in automatically when empty)
    #[serde(default)]
    pub meaning: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateWordBookArgs {
    /// Title in Chinese, short (e.g. "机场英语")
    pub title: String,
    /// Scene description in Chinese: who learns it, for what situation
    #[serde(default)]
    pub description: Option<String>,
    /// Words to put in the book
    pub words: Vec<NewWord>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddWordsArgs {
    /// Existing word book id
    pub book_id: i64,
    pub words: Vec<NewWord>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SavePassageArgs {
    /// English text to save as a passage, exactly as it should be kept (one paragraph per line). Write it yourself using what you and the learner discussed.
    pub text: String,
    /// English title (optional; generated when empty)
    #[serde(default)]
    pub title: Option<String>,
    /// The words / phrases this passage is for (base forms, with Chinese meaning). Each must appear in the text (any inflected form).
    #[serde(default)]
    pub vocabulary: Vec<NewWord>,
    /// Also mark words of these word books that appear in the text (optional)
    #[serde(default)]
    pub book_ids: Vec<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct QuestionSetArgs {
    pub passage_id: i64,
    /// reading (default) or listening
    #[serde(default)]
    pub mode: Option<String>,
    /// Number of multiple-choice questions (default 3)
    #[serde(default)]
    pub choice: Option<i64>,
    /// Number of true/false questions (default 2)
    #[serde(default)]
    pub true_false: Option<i64>,
    /// Number of cloze blanks (default 0)
    #[serde(default)]
    pub cloze: Option<i64>,
    /// Number of open questions (default 0)
    #[serde(default)]
    pub open: Option<i64>,
    /// basic / standard / advanced (default standard)
    #[serde(default)]
    pub difficulty: Option<String>,
}

impl PinduTools {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            tool_router: Self::words_router()
                + Self::passages_router()
                + Self::study_router()
                + Self::plans_router()
                + Self::videos_router()
                + Self::organize_router(),
        }
    }

    fn pool(&self) -> Arc<SqlitePool> {
        Arc::new(self.app.state::<SqlitePool>().inner().clone())
    }

    fn logger(&self) -> Arc<Logger> {
        Arc::new(self.app.state::<Logger>().inner().clone())
    }

    fn word_books(&self) -> crate::services::wordbook::WordBookService {
        crate::services::wordbook::WordBookService::new(self.pool(), self.logger())
    }

    fn passages(&self) -> crate::services::passage::PassageService {
        crate::services::passage::PassageService::new(self.pool(), self.logger())
    }

    /// 标签名 → id（同名的复用，没有的新建；与界面上加标签同一条路径）
    async fn tag_ids(&self, names: &[String]) -> Result<Vec<i64>, AppError> {
        let mut ids = Vec::new();
        for name in names.iter().map(|n| n.trim()).filter(|n| !n.is_empty()) {
            let tag = crate::handlers::create_tag(self.app.clone(), name.to_string()).await?;
            if !ids.contains(&tag.id) {
                ids.push(tag.id);
            }
        }
        Ok(ids)
    }

    /// 词加进词汇本：跳过本里已有的，后台做拼读分析后入本（与「添加单词」同一条路径）
    async fn add_to_book(
        &self,
        book_id: i64,
        words: &[NewWord],
    ) -> Result<(Vec<String>, Vec<String>, Option<String>), AppError> {
        let texts = clean_words(&words.iter().map(|w| w.word.clone()).collect::<Vec<_>>());
        if texts.is_empty() {
            return Err(AppError::ValidationError("没有要加的词".to_string()));
        }
        let existing: std::collections::HashSet<String> =
            crate::handlers::find_existing_words(self.app.clone(), book_id, texts.clone())
                .await?
                .into_iter()
                .map(|w| w.to_lowercase())
                .collect();
        let (new, skipped): (Vec<String>, Vec<String>) = texts
            .into_iter()
            .partition(|w| !existing.contains(&w.to_lowercase()));
        if new.is_empty() {
            return Ok((new, skipped, None));
        }
        let meanings = new
            .iter()
            .map(|w| {
                words
                    .iter()
                    .find(|n| n.word.trim().eq_ignore_ascii_case(w))
                    .and_then(|n| n.meaning.clone())
                    .unwrap_or_default()
            })
            .collect();
        let job = crate::handlers::start_word_analysis(
            self.app.clone(),
            crate::types::word_analysis::StartWordAnalysisRequest {
                book_id,
                words: new.clone(),
                meanings: Some(meanings),
                model_id: None,
                tags: None,
            },
        )
        .await?;
        // 拼读分析只影响词什么时候出现在词汇本里：记下来源，不用结束时通知
        crate::mcp::job_notice::track(&job, false);
        Ok((new, skipped, Some(job)))
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for PinduTools {
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
        crate::mcp::reason::take_reason(&mut request);
        // 调用来自哪个对话（sidecar 连接时带的请求头）：工具提交的后台任务结束时通知回去
        let conversation = context
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|p| p.headers.get("x-pindu-conversation"))
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.is_empty())
            .map(str::to_string);
        let call = rmcp::handler::server::tool::ToolCallContext::new(self, request, context);
        crate::mcp::job_notice::CONVERSATION
            .scope(conversation, self.tool_router.call(call))
            .await
    }

    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build()).with_instructions(
            "拼读（Pindu.app）：学习者的词汇本、短文与学习记录；可以把对话里的内容收进素材库（只新增，不修改、不删除已有素材）。",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_must_appear_in_the_text_in_any_form() {
        let text = "Tom checked in early. His itinerary was long, and he went to the gate.";
        let words = |list: &[&str]| -> Vec<NewWord> {
            list.iter()
                .map(|w| NewWord {
                    word: w.to_string(),
                    meaning: None,
                })
                .collect()
        };
        // 词形（went → go）与可变形的词组（checked in → check in）都算出现
        assert!(
            missing_vocabulary(text, &words(&["itinerary", "go", "check in", "Gate"])).is_empty()
        );
        assert_eq!(
            missing_vocabulary(text, &words(&["boarding pass", "luggage", ""])),
            ["boarding pass", "luggage"]
        );
    }
}
