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

/// 正文里没用上的词汇（单词按词形，went 算 go；词组连着出现、可变形）
#[derive(Debug, PartialEq)]
struct MissingWord {
    word: String,
    /// 写成了变形（came up）、正文里用的是同一个原形的另一种形式时，该写的原形（come up）
    base: Option<String>,
}

fn missing_vocabulary(text: &str, words: &[NewWord]) -> Vec<MissingWord> {
    use crate::services::passage_rules::text_uses;
    words
        .iter()
        .map(|w| crate::types::wordbook::normalize_vocab(w.word.trim()))
        .filter(|w| !w.is_empty())
        .filter(|w| !text_uses(text, &w.to_lowercase()))
        .map(|word| {
            // 逐个词换成它的原形，看正文里有没有用到。本身就是词典里的词时只认加词尾的规则变化
            // （reported → report、studied → study）：saw（锯子）、left（左边）不换成 see / leave，那是另一个词
            let tokens: Vec<String> = word
                .to_lowercase()
                .split_whitespace()
                .map(str::to_string)
                .collect();
            let base = tokens.iter().enumerate().find_map(|(i, token)| {
                let headword = crate::lemma::known(token);
                crate::lemma::lemmas(token)
                    .into_iter()
                    .filter(|l| l != token)
                    .filter(|l| {
                        let stem: String = l
                            .chars()
                            .take(l.chars().count().saturating_sub(1))
                            .collect();
                        !headword || token.starts_with(&stem)
                    })
                    .map(|l| {
                        let mut t = tokens.clone();
                        t[i] = l;
                        t.join(" ")
                    })
                    .find(|candidate| text_uses(text, candidate))
            });
            MissingWord { word, base }
        })
        .collect()
}

/// 词汇核对没通过：给模型的修改要求（英文以外的说法与其他工具一致）+ 给学习者看的一句话
fn vocabulary_revision(missing: &[MissingWord]) -> (String, String) {
    let absent: Vec<&str> = missing
        .iter()
        .filter(|m| m.base.is_none())
        .map(|m| m.word.as_str())
        .collect();
    let inflected: Vec<String> = missing
        .iter()
        .filter_map(|m| m.base.as_ref().map(|b| format!("{} → {}", m.word, b)))
        .collect();
    let mut model = Vec::new();
    let mut user = Vec::new();
    if !absent.is_empty() {
        model.push(format!(
            "这些词没有出现在正文里：{}。请改写正文让它们自然出现，或者从词汇里去掉",
            absent.join("、")
        ));
        user.push(format!("{} 还没写进正文", absent.join("、")));
    }
    if !inflected.is_empty() {
        model.push(format!(
            "词汇要写原形（正文里用的是它的另一种形式，不用改正文）：{}",
            inflected.join("；")
        ));
        user.push(format!("词汇改成原形 {}", inflected.join("；")));
    }
    (
        model.join("。"),
        format!("核对词汇：{}，重新整理", user.join("；")),
    )
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

/// 交给后台前的核对没通过：模型看到要改什么，改好再交；界面显示成「核对后重新整理」的一步，不算出错（`redlark.check`）
fn needs_revision(model_message: String, step: String) -> Result<CallToolResult, ErrorData> {
    let mut result = CallToolResult::structured_error(json!({
        "data": { "error": model_message },
        "redlark": { "step": step, "check": true },
    }));
    result.content = vec![ContentBlock::text(model_message)];
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
pub struct ExampleText {
    /// English sentence using the word
    pub en: String,
    /// Chinese translation
    pub zh: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SaveExamplesArgs {
    pub word_id: i64,
    pub examples: Vec<ExampleText>,
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
    /// Title (optional; generated when empty). If the learner named it, use their title exactly, in their language
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
    /// Exactly "reading" (default) or "listening"; any other value is rejected
    #[serde(default)]
    pub mode: Option<String>,
    /// Number of multiple-choice questions. Give a count for each type you want; types left out get 0 (with no counts at all: 3 choice + 2 true/false)
    #[serde(default)]
    pub choice: Option<i64>,
    /// Number of true/false questions (0 if left out)
    #[serde(default)]
    pub true_false: Option<i64>,
    /// Number of cloze blanks (0 if left out)
    #[serde(default)]
    pub cloze: Option<i64>,
    /// Number of open questions (0 if left out)
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
            tool_router: Self::router(),
        }
    }

    fn router() -> ToolRouter<Self> {
        Self::words_router()
            + Self::passages_router()
            + Self::study_router()
            + Self::plans_router()
            + Self::videos_router()
            + Self::organize_router()
    }

    /// 给模型的工具清单：展开嵌套 schema 的引用，加上 `reason`
    fn listed(router: &ToolRouter<Self>) -> Vec<rmcp::model::Tool> {
        router
            .list_all()
            .into_iter()
            .map(crate::mcp::schema::inline_refs)
            .map(crate::mcp::reason::with_reason)
            .collect()
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
        // 词在分析完成后才进词汇本：结束时通知对话，AI 老师才能接着做等着这些词的事（如建计划）
        crate::mcp::job_notice::track(&job, true);
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
        Ok(rmcp::model::ListToolsResult::with_all_items(Self::listed(
            &self.tool_router,
        )))
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

    /// 所有工具的参数里都没有 `$ref`：嵌套的 id（计划里的短文等）能被 pi 从字符串转回数字
    #[test]
    fn listed_tools_have_inlined_schemas() {
        let tools = PinduTools::listed(&PinduTools::router());
        for tool in &tools {
            let text = serde_json::to_string(&*tool.input_schema).unwrap();
            assert!(
                !text.contains("$ref") && !text.contains("$defs"),
                "{}: {text}",
                tool.name
            );
        }
        let plan = tools.iter().find(|t| t.name == "create_plan").unwrap();
        let item = &plan.input_schema["properties"]["passages"]["items"];
        assert_eq!(item["properties"]["passage_id"]["type"], "integer");
        assert!(item["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r == "passage_id"));
    }

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
        let missing = missing_vocabulary(text, &words(&["boarding pass", "luggage", ""]));
        let names: Vec<&str> = missing.iter().map(|m| m.word.as_str()).collect();
        assert_eq!(names, ["boarding pass", "luggage"]);
        assert!(missing.iter().all(|m| m.base.is_none()));
    }

    #[test]
    fn inflected_vocabulary_is_pointed_to_its_base_form() {
        let text = "I hope these issues will not come up again. I wanted to report the problem.";
        let words = |list: &[&str]| -> Vec<NewWord> {
            list.iter()
                .map(|w| NewWord {
                    word: w.to_string(),
                    meaning: None,
                })
                .collect()
        };
        // 词汇写成过去式、正文用的是原形：指出该写的原形；正文里确实没有的照常说没出现
        let missing = missing_vocabulary(text, &words(&["came up", "reported", "got through"]));
        assert_eq!(
            missing,
            [
                MissingWord {
                    word: "came up".into(),
                    base: Some("come up".into())
                },
                MissingWord {
                    word: "reported".into(),
                    base: Some("report".into())
                },
                MissingWord {
                    word: "got through".into(),
                    base: None
                },
            ]
        );
        // 本身就是词典里的词（saw 锯子）：不提示换成 see，照常说没出现
        let saw = missing_vocabulary("I can see the tree.", &words(&["saw"]));
        assert_eq!(
            saw,
            [MissingWord {
                word: "saw".into(),
                base: None
            }]
        );
        let (model, step) = vocabulary_revision(&missing);
        assert!(model.contains("没有出现在正文里：got through"), "{model}");
        assert!(model.contains("came up → come up"), "{model}");
        assert_eq!(step, "核对词汇：got through 还没写进正文；词汇改成原形 came up → come up；reported → report，重新整理");
    }
}
