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
    /// English text to save as a passage, exactly as it should be kept (one paragraph per line)
    pub text: String,
    /// Title (optional; generated when empty)
    #[serde(default)]
    pub title: Option<String>,
    /// Mark words of these word books in the passage as its vocabulary (optional)
    #[serde(default)]
    pub book_ids: Vec<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct WritePassageArgs {
    /// What to write, in Chinese: scene, story idea, characters, style
    pub instruction: String,
    /// Words that must be used (optional)
    #[serde(default)]
    pub words: Vec<NewWord>,
    /// Word books to pick more suitable words from (optional)
    #[serde(default)]
    pub book_ids: Vec<i64>,
    /// short / standard / long (default standard)
    #[serde(default)]
    pub length: Option<String>,
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
            tool_router: Self::tool_router(),
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
        Ok((new, skipped, Some(job)))
    }
}

#[tool_router]
impl PinduTools {
    #[tool(
        description = "List the learner's word books (词汇本) with id, title, scene description and word count.",
        annotations(read_only_hint = true)
    )]
    async fn list_word_books(&self) -> Result<CallToolResult, ErrorData> {
        match self.word_books().get_word_books(false, None).await {
            Ok(books) => {
                let data: Vec<Value> = books
                    .iter()
                    .map(|b| {
                        json!({ "id": b.id, "title": b.title, "description": b.description,
                                "words": b.total_words, "draft": b.status == "draft" })
                    })
                    .collect();
                let step = format!("看了你的词汇本：共 {} 本", books.len());
                done(json!(data), step, None)
            }
            Err(e) => failed("没能查看词汇本", e),
        }
    }

    #[tool(
        description = "Get the words in one word book (word, meaning). Up to 300 words.",
        annotations(read_only_hint = true)
    )]
    async fn get_word_book(
        &self,
        Parameters(args): Parameters<BookArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let book = match self.word_books().get_word_book(args.book_id).await {
            Ok(b) => b,
            Err(e) => return failed("没能打开这个词汇本", e),
        };
        let repo =
            crate::repositories::word_repository::WordRepository::new(self.pool(), self.logger());
        match repo.find_words_by_wordbook_ids(&[args.book_id]).await {
            Ok(words) => {
                let list: Vec<Value> = words
                    .iter()
                    .take(300)
                    .map(|(_, word, _, meaning)| json!({ "word": word, "meaning": meaning }))
                    .collect();
                let step = format!("看了《{}》里的 {} 个词", book.title, words.len());
                done(
                    json!({ "title": book.title, "description": book.description, "words": list }),
                    step,
                    None,
                )
            }
            Err(e) => failed("没能打开这个词汇本", e),
        }
    }

    #[tool(
        description = "Look up words in the learner's own word books: which books contain them, the saved meaning, and how well the learner knows each (memory level 0-5, wrong answers). Use before explaining a word or suggesting what to review.",
        annotations(read_only_hint = true)
    )]
    async fn lookup_words(
        &self,
        Parameters(args): Parameters<LookupWordsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let words = clean_words(&args.words);
        match tutor_repository::lookup_words(&self.pool(), &words).await {
            Ok(rows) => {
                let found: std::collections::HashSet<String> =
                    rows.iter().map(|r| r.word.to_lowercase()).collect();
                let missing: Vec<&String> = words
                    .iter()
                    .filter(|w| !found.contains(&w.to_lowercase()))
                    .collect();
                let data: Vec<Value> = rows
                    .iter()
                    .map(|r| {
                        json!({ "word": r.word, "meaning": r.meaning, "ipa": r.ipa, "book": r.book_title,
                                "bookId": r.book_id, "memoryLevel": r.srs_box, "wrongAnswers": r.wrong,
                                "answers": r.attempts })
                    })
                    .collect();
                let step = if rows.is_empty() {
                    format!("查了你的词汇本：没有{}", preview(&words, 3))
                } else if missing.is_empty() {
                    format!("查了你的词汇本：找到{}", preview(&words, 3))
                } else {
                    format!(
                        "查了你的词汇本：{} 个在本里，{} 个还没有",
                        words.len() - missing.len(),
                        missing.len()
                    )
                };
                done(json!({ "found": data, "notInBooks": missing }), step, None)
            }
            Err(e) => failed("没能查词汇本", e),
        }
    }

    #[tool(
        description = "The learner's current study plans with progress, and words they got wrong most in the last 30 days.",
        annotations(read_only_hint = true)
    )]
    async fn learning_overview(&self) -> Result<CallToolResult, ErrorData> {
        let plans = crate::services::study_plan::StudyPlanService::new(self.pool(), self.logger())
            .get_study_plans_with_progress(false)
            .await;
        let trouble =
            tutor_repository::trouble_words(&self.pool(), &crate::time::days_ago_utc(30), 20).await;
        match (plans, trouble) {
            (Ok(plans), Ok(trouble)) => {
                let plans: Vec<Value> = plans
                    .iter()
                    .filter(|p| {
                        matches!(p.unified_status.as_str(), "Active" | "Pending" | "Paused")
                    })
                    .map(|p| {
                        json!({ "name": p.name, "status": p.unified_status, "words": p.total_words,
                                "progress": format!("{:.0}%", p.progress_percentage) })
                    })
                    .collect();
                let words: Vec<Value> = trouble
                    .iter()
                    .map(|t| json!({ "word": t.word, "meaning": t.meaning, "book": t.book_title, "wrong": t.wrong, "answers": t.attempts }))
                    .collect();
                let step = format!(
                    "看了你的学习情况：{} 个在学的计划，最近容易错的 {} 个词",
                    plans.len(),
                    words.len()
                );
                done(json!({ "plans": plans, "troubleWords": words }), step, None)
            }
            (Err(e), _) | (_, Err(e)) => failed("没能查看学习情况", e),
        }
    }

    #[tool(
        description = "List the learner's passages (短文) with id, title, level and vocabulary.",
        annotations(read_only_hint = true)
    )]
    async fn list_passages(&self) -> Result<CallToolResult, ErrorData> {
        match self.passages().list(None, None, None).await {
            Ok(list) => {
                let data: Vec<Value> = list
                    .iter()
                    .map(|p| {
                        json!({ "id": p.id, "title": p.title, "level": p.level, "words": p.word_count,
                                "vocabulary": p.target_words.iter().map(|w| w.word.clone()).collect::<Vec<_>>() })
                    })
                    .collect();
                let step = format!("看了你的短文库：共 {} 篇", list.len());
                done(json!(data), step, None)
            }
            Err(e) => failed("没能查看短文库", e),
        }
    }

    #[tool(
        description = "Read one passage: sentences with Chinese translation, and its vocabulary.",
        annotations(read_only_hint = true)
    )]
    async fn get_passage(
        &self,
        Parameters(args): Parameters<PassageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match self.passages().get(args.passage_id).await {
            Ok(p) => {
                let sentences: Vec<Value> = p
                    .sentences
                    .iter()
                    .map(|s| json!({ "en": s.en, "zh": s.zh }))
                    .collect();
                let vocabulary: Vec<Value> = p
                    .target_words
                    .iter()
                    .map(|w| json!({ "word": w.word, "meaning": w.meaning }))
                    .collect();
                let step = format!("读了短文《{}》", p.title);
                done(
                    json!({ "id": p.id, "title": p.title, "level": p.level, "sentences": sentences, "vocabulary": vocabulary,
                            "questionSets": p.question_sets.len() }),
                    step,
                    None,
                )
            }
            Err(e) => failed("没能打开这篇短文", e),
        }
    }

    #[tool(
        description = "Create a new word book with the given words. Spelling analysis and example sentences are added in the background. Use when the learner wants to collect words into a new book.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn create_word_book(
        &self,
        Parameters(args): Parameters<CreateWordBookArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let title = args.title.trim().to_string();
        let book_id = match crate::handlers::create_word_book(
            self.app.clone(),
            crate::types::wordbook::CreateWordBookRequest {
                title: title.clone(),
                description: args.description.clone().unwrap_or_default(),
                icon: "book".to_string(),
                icon_color: "blue".to_string(),
                tag_ids: None,
            },
        )
        .await
        {
            Ok(id) => id,
            Err(e) => return failed("没能新建词汇本", e),
        };
        match self.add_to_book(book_id, &args.words).await {
            Ok((added, _, job)) => {
                let step = format!("新建词汇本《{}》，收进 {} 个词", title, added.len());
                let output = json!({ "kind": "wordbook", "id": book_id, "title": title,
                                     "meta": format!("{} 个词", added.len()), "jobId": job });
                done(
                    json!({ "bookId": book_id, "added": added, "note": "Words appear in the book after the background analysis finishes." }),
                    step,
                    Some(output),
                )
            }
            Err(e) => {
                let output = json!({ "kind": "wordbook", "id": book_id, "title": title, "meta": "还没有词" });
                let message = e.user_message();
                done(
                    json!({ "bookId": book_id, "added": [], "error": message }),
                    format!("新建了词汇本《{}》，但没能加词：{}", title, message),
                    Some(output),
                )
            }
        }
    }

    #[tool(
        description = "Add words to an existing word book (words already in the book are skipped). Spelling analysis and examples are added in the background.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn add_words(
        &self,
        Parameters(args): Parameters<AddWordsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let book = match self.word_books().get_word_book(args.book_id).await {
            Ok(b) => b,
            Err(e) => return failed("没能打开这个词汇本", e),
        };
        match self.add_to_book(args.book_id, &args.words).await {
            Ok((added, skipped, job)) => {
                let mut step = if added.is_empty() {
                    format!("这些词《{}》里都有了", book.title)
                } else {
                    format!("把 {} 加进了《{}》", preview(&added, 3), book.title)
                };
                if !added.is_empty() && !skipped.is_empty() {
                    step.push_str(&format!("（{} 个本里已有）", skipped.len()));
                }
                let output = (!added.is_empty()).then(|| {
                    json!({ "kind": "words", "id": args.book_id, "title": preview(&added, 3),
                            "meta": format!("加进《{}》", book.title), "jobId": job })
                });
                done(
                    json!({ "added": added, "alreadyInBook": skipped }),
                    step,
                    output,
                )
            }
            Err(e) => failed("没能加词", e),
        }
    }

    #[tool(
        description = "Save English text as a passage in the learner's library, keeping the text as given (e.g. a text the learner shared, or one you wrote together). Translation, title and key vocabulary are added in the background.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn save_passage(
        &self,
        Parameters(args): Parameters<SavePassageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let preview_result = crate::handlers::prepare_passage_import(
            self.app.clone(),
            serde_json::from_value(json!({ "text": args.text }))
                .map_err(|e| ErrorData::internal_error(e.to_string(), None))?,
        )
        .await;
        let preview = match preview_result {
            Ok(p) => p,
            Err(e) => return failed("没能存成短文", e),
        };
        let title = args
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string);
        let items: Vec<crate::types::passage::ImportPassageRequest> = preview
            .items
            .iter()
            .map(|item| crate::types::passage::ImportPassageRequest {
                title: title
                    .clone()
                    .or_else(|| (preview.items.len() > 1).then(|| item.title.clone())),
                sentences: item.sentences.clone(),
                source_label: "AI 老师".to_string(),
                book_ids: args.book_ids.clone(),
                ai_key_words: true,
                words: item.words.clone(),
            })
            .collect();
        let count = items.len();
        match crate::handlers::start_passage_import(
            self.app.clone(),
            crate::types::passage::ImportPassagesRequest { items },
        )
        .await
        {
            Ok(job) => {
                let name = title.clone().unwrap_or_else(|| "新短文".to_string());
                let step = if count > 1 {
                    format!("存成了 {} 篇短文，正在翻译", count)
                } else {
                    format!("存成短文《{}》，正在翻译", name)
                };
                let output = json!({ "kind": "passage", "title": name, "meta": format!("约 {} 词", preview.total_words), "jobId": job });
                done(
                    json!({ "passages": count, "words": preview.total_words, "note": "Saved; translation runs in the background." }),
                    step,
                    Some(output),
                )
            }
            Err(e) => failed("没能存成短文", e),
        }
    }

    #[tool(
        description = "Write a new reading passage with the app's passage writer (it checks that every required word is used and saves it to the library). Use when the learner wants a story or article to practise words. Runs in the background.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn write_passage(
        &self,
        Parameters(args): Parameters<WritePassageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let words: Vec<Value> = args
            .words
            .iter()
            .filter(|w| !w.word.trim().is_empty())
            .take(30)
            .map(|w| json!({ "wordId": null, "word": w.word.trim(), "required": true, "meaning": w.meaning }))
            .collect();
        let length = args
            .length
            .clone()
            .unwrap_or_else(|| "standard".to_string());
        let request = json!({
            "base": {
                "bookIds": args.book_ids,
                "extraWords": args.words.iter().map(|w| w.word.trim().to_string()).collect::<Vec<_>>(),
                "aiPick": 0,
                "instruction": args.instruction,
                "length": length,
            },
            "items": [{ "title": "", "idea": args.instruction, "words": words, "length": length }],
        });
        let request = match serde_json::from_value(request) {
            Ok(r) => r,
            Err(e) => return Err(ErrorData::internal_error(e.to_string(), None)),
        };
        match crate::handlers::start_passage_generation(self.app.clone(), request).await {
            Ok(job) => {
                let output =
                    json!({ "kind": "passage", "title": "新短文", "jobId": job });
                done(
                    json!({ "note": "The passage is being written in the background and will appear in the library." }),
                    "开始写一篇短文（后台进行）".to_string(),
                    Some(output),
                )
            }
            Err(e) => failed("没能开始写短文", e),
        }
    }

    #[tool(
        description = "Generate a question set (reading comprehension or listening) for a passage in the library. Runs in the background.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn create_question_set(
        &self,
        Parameters(args): Parameters<QuestionSetArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let passage = match self.passages().get(args.passage_id).await {
            Ok(p) => p,
            Err(e) => return failed("没能打开这篇短文", e),
        };
        let mode = match args.mode.as_deref() {
            Some("listening") => "listening",
            _ => "reading",
        };
        let spec = json!({
            "cloze": args.cloze.unwrap_or(0), "choice": args.choice.unwrap_or(3),
            "trueFalse": args.true_false.unwrap_or(2), "open": args.open.unwrap_or(0),
            "difficulty": args.difficulty.clone().unwrap_or_else(|| "standard".to_string()),
        });
        let request = match serde_json::from_value(
            json!({ "passageId": args.passage_id, "mode": mode, "name": null, "spec": spec }),
        ) {
            Ok(r) => r,
            Err(e) => return Err(ErrorData::internal_error(e.to_string(), None)),
        };
        let label = if mode == "listening" {
            "听力"
        } else {
            "阅读理解"
        };
        match crate::handlers::start_question_set_generation(self.app.clone(), request).await {
            Ok(job) => {
                let output = json!({ "kind": "questions", "id": passage.id, "title": format!("{}题", label),
                                     "meta": format!("《{}》", passage.title), "jobId": job });
                done(
                    json!({ "note": "Generating in the background." }),
                    format!("开始为《{}》出{}题", passage.title, label),
                    Some(output),
                )
            }
            Err(e) => failed("没能开始出题", e),
        }
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
                .map(super::reason::with_reason)
                .collect(),
        ))
    }

    async fn call_tool(
        &self,
        mut request: rmcp::model::CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::CallToolResponse, ErrorData> {
        super::reason::take_reason(&mut request);
        let call = rmcp::handler::server::tool::ToolCallContext::new(self, request, context);
        self.tool_router.call(call).await
    }

    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build()).with_instructions(
            "拼读（Pindu.app）：学习者的词汇本、短文与学习记录；可以把对话里的内容收进素材库（只新增，不修改、不删除已有素材）。",
        )
    }
}
