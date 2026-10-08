//! agent 任务：提示词 + 工具白名单 + 结果解析（docs/agent-harness/DESIGN.md §5）。
//!
//! 原则（DECISIONS D05）：确定性部分由代码完成，模型只做判断与标注；结构化结果经 `submit_*` 工具交付。

use super::config::{prepare_launch, AgentPaths, AgentTask, SessionMode};
use super::follow_up;
use super::protocol::AgentEvent;
use super::run_log::RunLog;
use super::session::AgentProcess;
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::prompts::{self, MessageTemplate, PromptProfile, PromptTask};
use crate::services::passage_rules::{self, GeneratedPassage, GeneratedQuestionSet};
use crate::services::study_planning::{PlanWord, WordAssessment};
use crate::types::ai_model::AIModelConfig;
use crate::types::passage::{PassagePlan, PassageSentence, PassageTargetWord, QuestionSetSpec};
use crate::types::word_analysis::{ExtractedWord, PhonicsWord, WordExtractionResult};
use crate::types::wordbook::{ChatTurn, Word, WordExample};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::time::{Duration, Instant};

/// 提词任务允许的最长时间（含模型思考）
const EXTRACT_TIMEOUT: Duration = Duration::from_secs(300);

/// 重点模式排除的基础功能词（与旧提示词的过滤清单一致）
pub const FOCUS_STOPWORDS: &[&str] = &[
    "a", "an", "the", "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
    "them", "am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have",
    "has", "had", "will", "would", "can", "could", "should", "shall", "may", "might", "must", "in",
    "on", "at", "to", "for", "of", "with", "by", "from", "up", "out", "off", "over", "under",
    "and", "or", "but", "so", "if", "when", "then", "than", "as", "not", "no", "yes", "very",
    "too", "also", "only", "just", "now", "here", "there", "one", "two", "three", "four", "five",
    "six", "seven", "eight", "nine", "ten",
];

/// 确定性分词计数（与 agent/src/tools/tokenize.ts 同规则：小写、仅字母、长度 2–20、丢弃与数字粘连的片段）
pub fn tokenize_words(text: &str) -> BTreeMap<String, i32> {
    let mut counts = BTreeMap::new();
    let lower = text.to_lowercase();
    for raw in lower.split(|c: char| !c.is_ascii_alphanumeric()) {
        if raw.is_empty()
            || raw.chars().any(|c| c.is_ascii_digit())
            || raw.len() < 2
            || raw.len() > 20
        {
            continue;
        }
        *counts.entry(raw.to_string()).or_insert(0) += 1;
    }
    counts
}

pub fn extract_words_task(profile: &PromptProfile, mode: &str) -> AgentTask {
    let rules = prompts::extract_mode_rules(mode, FOCUS_STOPWORDS);
    AgentTask {
        name: "extract-words",
        system_prompt: prompts::system_prompt(
            PromptTask::Extract,
            profile,
            &[("mode_rules", &rules)],
        ),
        tools: &["tokenize_text", "submit_words"],
        default_thinking: "low",
    }
}

/// 把 `submit_words` 的参数转成结果：只保留原文中真实出现的词，频率以确定性分词为准，重点模式再次过滤功能词
pub fn words_from_submission(details: &Value, text: &str, mode: &str) -> Vec<ExtractedWord> {
    let counts = tokenize_words(text);
    // 原文中以全小写出现过的词（用于判断模型给出的首字母大写是否可信）
    let lowercase_in_text: HashSet<String> = text
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase()))
        .map(str::to_string)
        .collect();
    let mut seen = HashSet::new();
    let mut words = Vec::new();
    for item in details
        .get("words")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(word) = item.get("word").and_then(Value::as_str) else {
            continue;
        };
        let key = word.trim().to_lowercase();
        let Some(&frequency) = counts.get(&key) else {
            continue; // 原文中不存在：丢弃（防止模型编造）
        };
        if mode == "focus" && FOCUS_STOPWORDS.contains(&key.as_str()) {
            continue;
        }
        if !seen.insert(key.clone()) {
            continue;
        }
        let text_field = |name: &str| {
            item.get(name)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        words.push(ExtractedWord {
            word: display_form(word.trim(), &key, &lowercase_in_text),
            frequency,
            part_of_speech: text_field("pos"),
            meaning: text_field("translation"),
        });
    }
    words
}

/// 展示形式：模型给出首字母大写（专有名词，如 Tom、Sunday），且原文中从未以小写出现时保留；其余一律小写
fn display_form(submitted: &str, key: &str, lowercase_in_text: &HashSet<String>) -> String {
    let mut chars = submitted.chars();
    let capitalized = matches!(chars.next(), Some(c) if c.is_ascii_uppercase())
        && chars.all(|c| c.is_ascii_lowercase());
    if capitalized && submitted.to_lowercase() == key && !lowercase_in_text.contains(key) {
        submitted.to_string()
    } else {
        key.to_string()
    }
}

/// 一次性任务的运行结果：本轮汇总 + 用量统计（`get_session_stats` 的 data）
pub struct TaskRun {
    pub outcome: super::protocol::RunOutcome,
    pub stats: Value,
    pub elapsed: Duration,
}

/// 启动一次性 sidecar → 发送一条消息 → 等本轮结束 → 取用量 → 关闭并清理。
/// `on_event` 收到每个事件（用于进度）；模型以错误结束时返回 `ExternalServiceError`。
pub async fn run_task(
    paths: &AgentPaths,
    task: &AgentTask,
    model: &AIModelConfig,
    message: &str,
    timeout: Duration,
    logger: &Logger,
    on_event: impl FnMut(&super::protocol::AgentEvent),
) -> AppResult<TaskRun> {
    run_task_cancellable(
        paths,
        task,
        model,
        message,
        timeout,
        logger,
        || false,
        on_event,
    )
    .await
}

/// 同 `run_task`，可由 `cancelled()` 中止（如规划页的“取消”）
#[allow(clippy::too_many_arguments)]
pub async fn run_task_cancellable(
    paths: &AgentPaths,
    task: &AgentTask,
    model: &AIModelConfig,
    message: &str,
    timeout: Duration,
    logger: &Logger,
    cancelled: impl Fn() -> bool,
    mut on_event: impl FnMut(&super::protocol::AgentEvent),
) -> AppResult<TaskRun> {
    let started = Instant::now();
    let log = RunLog::start(logger, task, model, message);
    let launch = prepare_launch(paths, task, model, SessionMode::Ephemeral)
        .inspect_err(|e| log.failed(e, ""))?;
    let mut process = match AgentProcess::spawn(launch).await {
        Ok(p) => p,
        Err(e) => {
            log.failed(&e, "");
            return Err(e);
        }
    };
    let run = process
        .connection
        .prompt_cancellable(message, timeout, cancelled, |event| {
            log.event(event);
            on_event(event);
        })
        .await;
    let stats = process
        .connection
        .request("get_session_stats", Value::Null)
        .await
        .unwrap_or(Value::Null);
    let stderr = process.stderr_tail();
    process.shutdown().await;

    let outcome = run.inspect_err(|e| log.failed(e, &stderr))?;
    log.finished(&outcome, &stats);
    if let Some(error) = &outcome.error {
        return Err(AppError::ExternalServiceError(format!(
            "模型返回错误：{}",
            error
        )));
    }
    Ok(TaskRun {
        outcome,
        stats,
        elapsed: started.elapsed(),
    })
}

/// 通过 agent 提词
pub async fn extract_words(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    scene: &str,
    text: &str,
    mode: &str,
    logger: &Logger,
) -> AppResult<WordExtractionResult> {
    let TaskRun {
        outcome,
        stats,
        elapsed,
    } = run_task(
        paths,
        &extract_words_task(profile, mode),
        model,
        &prompts::message(
            MessageTemplate::ExtractWords,
            &[("scene", scene), ("text", text)],
        ),
        EXTRACT_TIMEOUT,
        logger,
        |_| {},
    )
    .await?;
    let submission = outcome
        .last_successful_call("submit_words")
        .ok_or_else(|| AppError::ExternalServiceError("模型没有提交单词列表".to_string()))?;

    let words = words_from_submission(&submission.details, text, mode);
    logger.info(
        "AGENT",
        &format!(
            "extract-words 完成：model={} mode={} words={} 用时 {:.1}s tokens={} cost={} retries={}",
            model.model_id,
            mode,
            words.len(),
            elapsed.as_secs_f64(),
            stats["tokens"]["total"],
            stats["cost"],
            outcome.retries
        ),
    );
    let count = words.len();
    Ok(WordExtractionResult {
        words,
        total_count: count,
        unique_count: count,
    })
}

pub fn generate_words_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "generate-words",
        system_prompt: prompts::system_prompt(PromptTask::Generate, profile, &[]),
        tools: &["submit_generated_words"],
        default_thinking: "low",
    }
}

/// 按意图生成单词允许的数量范围
pub const GENERATE_COUNT_RANGE: std::ops::RangeInclusive<usize> = 5..=100;

/// `submit_generated_words` 参数 → 候选单词：只接受单个英文单词（字母，可含连字符 / 撇号，2–30 字），
/// 忽略大小写去重、跳过已有单词，最多 `limit` 个；频率记为 1（不是从原文统计的）。
pub fn generated_from_submission(
    details: &Value,
    existing: &HashSet<String>,
    limit: usize,
) -> Vec<ExtractedWord> {
    let mut seen = HashSet::new();
    let mut words = Vec::new();
    for item in details
        .get("words")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if words.len() >= limit {
            break;
        }
        let Some(word) = item.get("word").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        let valid = (2..=30).contains(&word.chars().count())
            && word.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
            && word
                .chars()
                .all(|c| c.is_ascii_alphabetic() || c == '-' || c == '\'');
        let key = word.to_lowercase();
        if !valid || existing.contains(&key) || !seen.insert(key) {
            continue;
        }
        let text_field = |name: &str| {
            item.get(name)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        words.push(ExtractedWord {
            word: word.to_string(),
            frequency: 1,
            part_of_speech: text_field("pos"),
            meaning: text_field("translation"),
        });
    }
    words
}

/// 通过 agent 按意图生成单词（`existing` 为单词本里已有的词，小写）
#[allow(clippy::too_many_arguments)]
pub async fn generate_words(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    scene: &str,
    intent: &str,
    count: usize,
    existing: &HashSet<String>,
    logger: &Logger,
) -> AppResult<WordExtractionResult> {
    let mut list: Vec<&str> = existing.iter().map(String::as_str).collect();
    list.sort_unstable();
    let message = prompts::message(
        MessageTemplate::GenerateWords,
        &[
            ("scene", scene),
            ("intent", intent.trim()),
            ("count", &count.to_string()),
            ("existing", &list.join(", ")),
        ],
    );
    let TaskRun {
        outcome,
        stats,
        elapsed,
    } = run_task(
        paths,
        &generate_words_task(profile),
        model,
        &message,
        EXTRACT_TIMEOUT,
        logger,
        |_| {},
    )
    .await?;
    let submission = outcome
        .last_successful_call("submit_generated_words")
        .ok_or_else(|| AppError::ExternalServiceError("模型没有提交单词列表".to_string()))?;
    let words = generated_from_submission(&submission.details, existing, count);
    logger.info(
        "AGENT",
        &format!(
            "generate-words 完成：model={} requested={} words={} 用时 {:.1}s tokens={} cost={} retries={}",
            model.model_id,
            count,
            words.len(),
            elapsed.as_secs_f64(),
            stats["tokens"]["total"],
            stats["cost"],
            outcome.retries
        ),
    );
    if words.is_empty() {
        return Err(AppError::ExternalServiceError(
            "没有生成可用的单词，请把描述写得更具体一些再试".to_string(),
        ));
    }
    let count = words.len();
    Ok(WordExtractionResult {
        words,
        total_count: count,
        unique_count: count,
    })
}

/// 单批拼读分析允许的最长时间（含校验失败后的重交）
const PHONICS_TIMEOUT: Duration = Duration::from_secs(300);

pub fn phonics_batch_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "phonics-batch",
        system_prompt: prompts::system_prompt(PromptTask::Phonics, profile, &[]),
        tools: &["submit_phonics"],
        default_thinking: "low",
    }
}

/// 一批拼读分析的结果：成功的条目与模型没有返回的单词
#[derive(Debug, Default)]
pub struct PhonicsBatchOutcome {
    pub analyzed: Vec<PhonicsWord>,
    pub missing: Vec<String>,
}

/// `submit_phonics` 参数 → 结果：只接受请求中的单词（忽略大小写、去重），返回未覆盖的单词
pub fn phonics_from_submission(details: &Value, requested: &[String]) -> PhonicsBatchOutcome {
    let mut remaining: Vec<&String> = requested.iter().collect();
    let mut analyzed = Vec::new();
    for item in details
        .get("words")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let field = |name: &str| {
            item.get(name)
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .to_string()
        };
        let word = field("word");
        let Some(pos) = remaining
            .iter()
            .position(|r| r.trim().eq_ignore_ascii_case(&word))
        else {
            continue; // 不是本批请求的词，或重复提交
        };
        let requested_word = remaining.remove(pos);
        analyzed.push(PhonicsWord {
            word: requested_word.trim().to_string(),
            frequency: 1,
            chinese_translation: field("chinese_translation"),
            pos_abbreviation: field("pos_abbreviation"),
            pos_english: field("pos_english"),
            pos_chinese: field("pos_chinese"),
            ipa: field("ipa"),
            syllables: field("syllables"),
            phonics_rule: field("phonics_rule"),
            analysis_explanation: field("analysis_explanation"),
            examples: item
                .get("examples")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|e| {
                    let text = |k: &str| e.get(k).and_then(Value::as_str).map(str::trim);
                    let (sentence, translation) = (text("sentence")?, text("translation")?);
                    (!sentence.is_empty() && !translation.is_empty()).then(|| WordExample {
                        sentence: sentence.to_string(),
                        translation: translation.to_string(),
                    })
                })
                .collect(),
        });
    }
    PhonicsBatchOutcome {
        analyzed,
        missing: remaining.into_iter().cloned().collect(),
    }
}

/// 拼读分析的上下文：单词本场景 + 生成 / 提取时已确定的中文释义（小写单词 → 释义）
#[derive(Debug, Clone, Default)]
pub struct PhonicsContext {
    pub scene: String,
    pub meanings: std::collections::HashMap<String, String>,
}

impl PhonicsContext {
    /// 这一批里有已确定释义的单词，每行 “单词：释义”
    pub fn hint_lines(&self, words: &[String]) -> String {
        words
            .iter()
            .filter_map(|w| {
                let meaning = self.meanings.get(&w.to_lowercase())?.trim();
                (!meaning.is_empty()).then(|| format!("{}：{}", w, meaning))
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// 通过 agent 分析一批单词（submit_phonics 自带校验，模型可修正后重交）
pub async fn analyze_phonics_batch(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    context: &PhonicsContext,
    words: &[String],
    logger: &Logger,
) -> AppResult<PhonicsBatchOutcome> {
    let TaskRun {
        outcome,
        stats,
        elapsed,
    } = run_task(
        paths,
        &phonics_batch_task(profile),
        model,
        &prompts::message(
            MessageTemplate::PhonicsBatch,
            &[
                ("scene", &context.scene),
                ("count", &words.len().to_string()),
                ("words", &words.join(", ")),
                ("hints", &context.hint_lines(words)),
            ],
        ),
        PHONICS_TIMEOUT,
        logger,
        |_| {},
    )
    .await?;
    let rejected = outcome
        .tool_calls
        .iter()
        .filter(|c| c.tool_name == "submit_phonics" && c.is_error)
        .count();
    let submission = outcome
        .last_successful_call("submit_phonics")
        .ok_or_else(|| {
            let last_problem = outcome
                .tool_calls
                .iter()
                .rev()
                .find(|c| c.is_error)
                .map(|c| c.content_text.chars().take(300).collect::<String>())
                .unwrap_or_else(|| "模型没有提交结果".to_string());
            AppError::ExternalServiceError(format!("拼读分析未通过校验：{}", last_problem))
        })?;

    let result = phonics_from_submission(&submission.details, words);
    logger.info(
        "AGENT",
        &format!(
            "phonics-batch 完成：model={} 请求 {} 词，成功 {}，缺失 {}，校验退回 {} 次，用时 {:.1}s tokens={} cost={}",
            model.model_id,
            words.len(),
            result.analyzed.len(),
            result.missing.len(),
            rejected,
            elapsed.as_secs_f64(),
            stats["tokens"]["total"],
            stats["cost"],
        ),
    );
    Ok(result)
}

/// 规划排序允许的最长时间（大词表时输出较长）
const PLAN_TIMEOUT: Duration = Duration::from_secs(600);

pub fn plan_order_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "plan-word-order",
        system_prompt: prompts::system_prompt(PromptTask::Plan, profile, &[]),
        tools: &["submit_learning_order"],
        default_thinking: "low",
    }
}

/// `submit_learning_order` 参数 → 判断列表（保持模型给出的顺序；字段缺失的条目跳过，交由 normalize_order 补齐）
pub fn assessments_from_submission(details: &Value) -> Vec<WordAssessment> {
    details
        .get("order")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(WordAssessment {
                word_id: item.get("id")?.as_i64()?,
                difficulty: item.get("difficulty").and_then(Value::as_i64).unwrap_or(3) as i32,
                priority: item
                    .get("priority")
                    .and_then(Value::as_str)
                    .unwrap_or("medium")
                    .to_string(),
            })
        })
        .collect()
}

/// 给出全部单词的学习顺序与难度 / 优先级（日程由 services::study_planning 计算）。
/// `on_progress(收到的事件数)` 用于更新规划进度；`cancelled()` 为真时中止。
pub async fn plan_word_order(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    words: &[PlanWord],
    logger: &Logger,
    cancelled: impl Fn() -> bool,
    mut on_progress: impl FnMut(u32),
) -> AppResult<Vec<WordAssessment>> {
    let lines: Vec<String> = words
        .iter()
        .map(|w| {
            format!(
                "{}｜{}｜{}",
                w.word_id,
                w.word,
                w.meaning.as_deref().unwrap_or("").trim()
            )
        })
        .collect();
    let message = prompts::message(
        MessageTemplate::PlanOrder,
        &[
            ("count", &words.len().to_string()),
            ("lines", &lines.join("\n")),
        ],
    );
    let mut events = 0u32;
    let run = run_task_cancellable(
        paths,
        &plan_order_task(profile),
        model,
        &message,
        PLAN_TIMEOUT,
        logger,
        cancelled,
        |_| {
            events += 1;
            on_progress(events);
        },
    )
    .await?;
    let submission = run
        .outcome
        .last_successful_call("submit_learning_order")
        .ok_or_else(|| AppError::ExternalServiceError("模型没有提交学习顺序".to_string()))?;
    let assessed = assessments_from_submission(&submission.details);
    logger.info(
        "AGENT",
        &format!(
            "plan-word-order 完成：model={} 单词 {}，模型给出 {}，用时 {:.1}s tokens={} cost={}",
            model.model_id,
            words.len(),
            assessed.len(),
            run.elapsed.as_secs_f64(),
            run.stats["tokens"]["total"],
            run.stats["cost"],
        ),
    );
    Ok(assessed)
}

// ==================== 例句补充 / 重新生成 ====================

const EXAMPLES_TIMEOUT: Duration = Duration::from_secs(180);

/// 例句生成方式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExampleMode {
    /// 在已有例句之后补充新的例句
    Append,
    /// 用新的例句替换全部已有例句
    Replace,
}

pub fn word_examples_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "word-examples",
        system_prompt: prompts::system_prompt(PromptTask::Examples, profile, &[]),
        tools: &["submit_examples"],
        default_thinking: "low",
    }
}

pub fn word_examples_message(word: &Word, mode: ExampleMode, scene: &str) -> String {
    let examples = numbered_examples(&word.examples);
    prompts::message(
        MessageTemplate::WordExamples,
        &[
            ("scene", scene),
            ("word", word.word.trim()),
            ("meaning", word.meaning.trim()),
            ("pos", word_pos(word).unwrap_or("")),
            ("examples", &examples),
            ("append", if mode == ExampleMode::Append { "1" } else { "" }),
            (
                "replace",
                if mode == ExampleMode::Replace {
                    "1"
                } else {
                    ""
                },
            ),
        ],
    )
}

fn trimmed(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// 词性：优先中文词性
fn word_pos(word: &Word) -> Option<&str> {
    trimmed(&word.pos_chinese).or(trimmed(&word.part_of_speech))
}

/// 已有例句，按 “1. 英文 —— 中文” 逐行编号
fn numbered_examples(examples: &[WordExample]) -> String {
    examples
        .iter()
        .enumerate()
        .map(|(i, e)| format!("{}. {} —— {}", i + 1, e.sentence, e.translation))
        .collect::<Vec<_>>()
        .join(
            "
",
        )
}

/// 单词资料（讲解、答疑共用）
fn word_facts(word: &Word) -> String {
    prompts::message(
        MessageTemplate::WordFacts,
        &[
            ("word", word.word.trim()),
            ("meaning", word.meaning.trim()),
            ("pos", word_pos(word).unwrap_or("")),
            ("ipa", trimmed(&word.ipa).unwrap_or("")),
            ("syllables", trimmed(&word.syllables).unwrap_or("")),
            ("phonics_rule", trimmed(&word.phonics_rule).unwrap_or("")),
            (
                "phonics_explanation",
                trimmed(&word.analysis_explanation).unwrap_or(""),
            ),
            ("examples", &numbered_examples(&word.examples)),
        ],
    )
}

/// 例句的词集合（小写、只取字母词、忽略冠词），用于判断“只改了一两个词”的近似重复
fn sentence_words(sentence: &str) -> HashSet<String> {
    sentence
        .split(|c: char| !c.is_ascii_alphabetic() && c != '\'')
        .map(|w| w.trim_matches('\'').to_ascii_lowercase())
        .filter(|w| !w.is_empty() && !matches!(w.as_str(), "a" | "an" | "the"))
        .collect()
}

/// 近似重复：两句的词集合重合度（Jaccard）≥ 0.8，如
/// "All the students are in class." 与 "All students are in the class!"
pub fn is_near_duplicate(a: &str, b: &str) -> bool {
    let (x, y) = (sentence_words(a), sentence_words(b));
    if x.is_empty() || y.is_empty() {
        return a.trim().eq_ignore_ascii_case(b.trim());
    }
    let shared = x.intersection(&y).count() as f64;
    let union = x.union(&y).count() as f64;
    shared / union >= 0.8
}

/// `submit_examples` 参数 → 例句：去空白，丢弃不完整的条目，以及与已有例句或本次前面的例句
/// 相同 / 近似重复（只改了一两个词）的句子
pub fn examples_from_submission(details: &Value, existing: &[WordExample]) -> Vec<WordExample> {
    let mut kept: Vec<String> = existing.iter().map(|e| e.sentence.clone()).collect();
    let mut result = Vec::new();
    for e in details
        .get("examples")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let text = |k: &str| e.get(k).and_then(Value::as_str).map(str::trim);
        let (Some(sentence), Some(translation)) = (text("sentence"), text("translation")) else {
            continue;
        };
        if sentence.is_empty()
            || translation.is_empty()
            || kept.iter().any(|k| is_near_duplicate(k, sentence))
        {
            continue;
        }
        kept.push(sentence.to_string());
        result.push(WordExample {
            sentence: sentence.to_string(),
            translation: translation.to_string(),
        });
    }
    result
}

/// 生成新例句（只返回本次新写的；补充时已排除与已有例句重复的句子）
pub async fn generate_examples(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    scene: &str,
    word: &Word,
    mode: ExampleMode,
    logger: &Logger,
) -> AppResult<Vec<WordExample>> {
    let run = run_task(
        paths,
        &word_examples_task(profile),
        model,
        &word_examples_message(word, mode, scene),
        EXAMPLES_TIMEOUT,
        logger,
        |_| {},
    )
    .await?;
    let details = run
        .outcome
        .last_successful_call("submit_examples")
        .ok_or_else(|| AppError::ExternalServiceError("模型没有提交例句".to_string()))?;
    let existing: &[WordExample] = match mode {
        ExampleMode::Append => &word.examples,
        ExampleMode::Replace => &[],
    };
    let examples = examples_from_submission(&details.details, existing);
    if examples.is_empty() {
        return Err(AppError::ExternalServiceError(
            "模型没有给出新的例句，请再试一次".to_string(),
        ));
    }
    logger.info(
        "WORD_EXAMPLES",
        &format!(
            "「{}」{}例句 {} 条，用时 {:.1}s",
            word.word,
            if mode == ExampleMode::Append {
                "补充"
            } else {
                "重新生成"
            },
            examples.len(),
            run.elapsed.as_secs_f64()
        ),
    );
    Ok(examples)
}

// ==================== AI 老师答疑 ====================

const TUTOR_TIMEOUT: Duration = Duration::from_secs(120);
/// 带入上下文的最近对话轮数（学生 + 老师各算一条）
pub const TUTOR_HISTORY_LIMIT: usize = 12;

/// AI 老师答疑：无工具，直接输出简短回答（流式）
pub fn word_tutor_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "word-tutor",
        system_prompt: prompts::system_prompt(PromptTask::Tutor, profile, &[]),
        tools: &[],
        default_thinking: "low",
    }
}

/// 答疑请求：单词资料 + 已有讲解 + 最近对话 + 本次问题
pub fn word_tutor_message(
    word: &Word,
    scene: &str,
    explanation: Option<&str>,
    history: &[ChatTurn],
    question: &str,
) -> String {
    let recent = &history[history.len().saturating_sub(TUTOR_HISTORY_LIMIT)..];
    let history: Vec<String> = recent
        .iter()
        .map(|t| {
            let who = if t.role == "teacher" {
                "老师"
            } else {
                "学生"
            };
            format!("{}：{}", who, t.content.trim())
        })
        .collect();
    prompts::message(
        MessageTemplate::WordTutor,
        &[
            ("scene", scene),
            ("facts", &word_facts(word)),
            ("explanation", explanation.map(str::trim).unwrap_or("")),
            ("history", &history.join("\n")),
            ("question", question.trim()),
        ],
    )
}

/// 讲解 / 答疑的结果：正文 + 推荐追问（模型没给时为空，界面用固定建议）
#[derive(Debug, Clone, PartialEq)]
pub struct AiReply {
    pub content: String,
    pub follow_ups: Vec<String>,
}

impl AiReply {
    fn from_output(text: &str, asked: &[&str]) -> Self {
        let (content, follow_ups) = follow_up::split(&clean_markdown(text), asked);
        Self {
            content: clean_markdown(&content),
            follow_ups,
        }
    }
}

/// 回答学生的问题；`on_delta` 收到流式文本增量（追问部分不推送）；`asked` 为已问过的问题，不再推荐
pub async fn ask_tutor(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    message: &str,
    logger: &Logger,
    asked: &[&str],
    mut on_delta: impl FnMut(&str),
) -> AppResult<AiReply> {
    let mut gate = follow_up::StreamGate::default();
    let run = run_task(
        paths,
        &word_tutor_task(profile),
        model,
        message,
        TUTOR_TIMEOUT,
        logger,
        |event| {
            if let AgentEvent::TextDelta(delta) = event {
                let visible = gate.push(delta);
                if !visible.is_empty() {
                    on_delta(&visible);
                }
            }
        },
    )
    .await?;
    let reply = AiReply::from_output(&run.outcome.text, asked);
    if reply.content.is_empty() {
        return Err(AppError::ExternalServiceError(
            "AI 老师没有给出回答，请再问一次".to_string(),
        ));
    }
    Ok(reply)
}

// ==================== 单词讲解 ====================

const EXPLAIN_TIMEOUT: Duration = Duration::from_secs(180);

/// 单词深度讲解任务：无工具，直接输出 Markdown（展示用的长文本，不是结构化数据）
pub fn explain_word_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "word-explain",
        system_prompt: prompts::system_prompt(PromptTask::Explain, profile, &[]),
        tools: &[],
        // 正确性优先于速度（low 档在易混词、读音断言上出错较多，见 D17）
        default_thinking: "medium",
    }
}

/// 讲解请求：把已有的单词资料（释义、拼读、例句）交给模型，讲解与练习页保持一致
pub fn explain_word_message(word: &Word, scene: &str) -> String {
    prompts::message(
        MessageTemplate::ExplainWord,
        &[("scene", scene), ("facts", &word_facts(word))],
    )
}

/// 去掉模型偶尔包在整段外面的 ```markdown 代码块
pub fn clean_markdown(text: &str) -> String {
    let trimmed = text.trim();
    let inner = trimmed
        .strip_prefix("```markdown")
        .or_else(|| trimmed.strip_prefix("```md"))
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|rest| rest.trim_end().strip_suffix("```"));
    inner.unwrap_or(trimmed).trim().to_string()
}

/// 生成单词讲解；`on_delta` 收到流式文本增量（用于前端实时显示，追问部分不推送）
pub async fn explain_word(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    scene: &str,
    word: &Word,
    logger: &Logger,
    mut on_delta: impl FnMut(&str),
) -> AppResult<AiReply> {
    let mut gate = follow_up::StreamGate::default();
    let run = run_task(
        paths,
        &explain_word_task(profile),
        model,
        &explain_word_message(word, scene),
        EXPLAIN_TIMEOUT,
        logger,
        |event| {
            if let AgentEvent::TextDelta(delta) = event {
                let visible = gate.push(delta);
                if !visible.is_empty() {
                    on_delta(&visible);
                }
            }
        },
    )
    .await?;
    let reply = AiReply::from_output(&run.outcome.text, &[]);
    let content = &reply.content;
    if content.chars().count() < 50 {
        return Err(AppError::ExternalServiceError(
            "模型没有返回有效的讲解内容".to_string(),
        ));
    }
    logger.info(
        "WORD_EXPLAIN",
        &format!(
            "「{}」讲解已生成：{} 字，{} 个追问，用时 {:.1}s",
            word.word,
            content.chars().count(),
            reply.follow_ups.len(),
            run.elapsed.as_secs_f64()
        ),
    );
    Ok(reply)
}

// ==================== 短文库 ====================

/// 写短文允许的最长时间（含校验失败后的重交）
const PASSAGE_TIMEOUT: Duration = Duration::from_secs(420);
const PASSAGE_QUESTIONS_TIMEOUT: Duration = Duration::from_secs(300);
const PASSAGE_GRADE_TIMEOUT: Duration = Duration::from_secs(120);
const PASSAGE_TRANSLATE_TIMEOUT: Duration = Duration::from_secs(300);

/// 写短文：结构化结果经 submit_passage 交付
pub fn passage_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "passage-generate",
        system_prompt: prompts::system_prompt(PromptTask::Passage, profile, &[]),
        tools: &["submit_passage"],
        // 创作类任务：先构思再写，内容质量优先（D26）
        default_thinking: "medium",
    }
}

/// 出一套阅读理解题：结构化结果经 submit_questions 交付
pub fn passage_questions_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "passage-questions",
        system_prompt: prompts::system_prompt(PromptTask::PassageQuestions, profile, &[]),
        tools: &["submit_questions"],
        default_thinking: "low",
    }
}

/// 开放题评分：结构化结果经 submit_grade 交付
pub fn passage_grade_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "passage-grade",
        system_prompt: prompts::system_prompt(PromptTask::PassageGrade, profile, &[]),
        tools: &["submit_grade"],
        default_thinking: "low",
    }
}

/// 一篇短文的要求：场景、必用词、候选词（AI 从中挑 `ai_pick` 个）、篇幅；按内容规划写时带标题与构思
pub struct PassageSpec<'a> {
    pub scene: &'a str,
    /// 已确认的构思（空 = 自由构思）
    pub outline: &'a str,
    pub title: &'a str,
    pub required: &'a [PassageTargetWord],
    pub pool: &'a [PassageTargetWord],
    pub ai_pick: usize,
    /// 挑词偏好（难度、常用程度；空 = 不限）
    pub pick_prefs: &'a str,
    pub min_words: usize,
    pub max_words: usize,
}

pub fn passage_message(spec: &PassageSpec) -> String {
    let join = |words: &[PassageTargetWord]| {
        words
            .iter()
            .map(|w| w.word.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    };
    let pool = if spec.ai_pick > 0 {
        join(spec.pool)
    } else {
        String::new()
    };
    prompts::message(
        MessageTemplate::PassageGenerate,
        &[
            ("scene", spec.scene),
            ("outline", spec.outline),
            ("title", spec.title),
            ("required_count", &spec.required.len().to_string()),
            ("required", &join(spec.required)),
            ("pool", &pool),
            ("ai_pick", &spec.ai_pick.to_string()),
            ("pick_prefs", spec.pick_prefs),
            ("min_words", &spec.min_words.to_string()),
            ("max_words", &spec.max_words.to_string()),
        ],
    )
}

/// 内容规划：先决定写几篇、每篇的构思和用词，交给用户确认
pub fn passage_plan_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "passage-plan",
        system_prompt: prompts::system_prompt(PromptTask::PassagePlan, profile, &[]),
        tools: &["submit_passage_plan"],
        default_thinking: "medium",
    }
}

/// 内容规划的输入
pub struct PlanSpec<'a> {
    pub scene: &'a str,
    pub required: &'a [PassageTargetWord],
    pub pool: &'a [PassageTargetWord],
    pub ai_pick: usize,
    /// 挑词偏好（难度、常用程度；空 = 不限）
    pub pick_prefs: &'a str,
    /// 用户偏好的篇幅：short / standard / long
    pub length: &'a str,
    /// 各篇幅的英文词数参考（short / standard / long）
    pub ranges: [(usize, usize); 3],
    /// 对上一版规划的调整意见
    pub feedback: &'a str,
}

pub fn passage_plan_message(spec: &PlanSpec) -> String {
    let join = |words: &[PassageTargetWord]| {
        words
            .iter()
            .map(|w| w.word.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    };
    let range = |(min, max): (usize, usize)| format!("{}–{}", min, max);
    let pool = if spec.ai_pick > 0 {
        join(spec.pool)
    } else {
        String::new()
    };
    prompts::message(
        MessageTemplate::PassagePlan,
        &[
            ("scene", spec.scene),
            ("required_count", &spec.required.len().to_string()),
            ("required", &join(spec.required)),
            ("pool", &pool),
            ("ai_pick", &spec.ai_pick.to_string()),
            ("pick_prefs", spec.pick_prefs),
            ("length", spec.length),
            ("short", &range(spec.ranges[0])),
            ("standard", &range(spec.ranges[1])),
            ("long", &range(spec.ranges[2])),
            ("feedback", spec.feedback),
        ],
    )
}

/// 规划写几篇短文（Rust 再校验：词只来自必用词与候选池、每词只归一篇、漏掉的必用词补齐）
pub async fn plan_passages(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    spec: &PlanSpec<'_>,
    logger: &Logger,
) -> AppResult<PassagePlan> {
    let run = run_task(
        paths,
        &passage_plan_task(profile),
        model,
        &passage_plan_message(spec),
        PASSAGE_QUESTIONS_TIMEOUT,
        logger,
        |_| {},
    )
    .await?;
    let submission = run
        .outcome
        .last_successful_call("submit_passage_plan")
        .ok_or_else(|| AppError::ExternalServiceError("模型没有提交规划".to_string()))?;
    let plan = passage_rules::plan_from_submission(
        &submission.details,
        spec.required,
        spec.pool,
        spec.ai_pick,
    )
    .map_err(|e| AppError::ExternalServiceError(format!("内容规划不合格：{}，请再试一次", e)))?;
    logger.info(
        "PASSAGE",
        &format!(
            "passage-plan 完成：model={} 必用 {} 篇数 {} 用时 {:.1}s",
            model.model_id,
            spec.required.len(),
            plan.items.len(),
            run.elapsed.as_secs_f64()
        ),
    );
    Ok(plan)
}

/// 写一篇短文（Rust 按请求再校验：必用词都在、AI 挑的词来自候选池且用在正文里）
pub async fn generate_passage(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    spec: &PassageSpec<'_>,
    logger: &Logger,
) -> AppResult<GeneratedPassage> {
    let run = run_task(
        paths,
        &passage_task(profile),
        model,
        &passage_message(spec),
        PASSAGE_TIMEOUT,
        logger,
        |_| {},
    )
    .await?;
    let submission = run
        .outcome
        .last_successful_call("submit_passage")
        .ok_or_else(|| AppError::ExternalServiceError("模型没有提交短文".to_string()))?;
    let passage = passage_rules::passage_from_submission(
        &submission.details,
        spec.required,
        spec.pool,
        spec.ai_pick,
    )
    .map_err(|e| AppError::ExternalServiceError(format!("生成的短文不合格：{}，请再试一次", e)))?;
    logger.info(
        "PASSAGE",
        &format!(
            "passage-generate 完成：model={} 必用 {} 挑选 {}/{} 词数 {} 用时 {:.1}s tokens={} retries={}",
            model.model_id,
            spec.required.len(),
            passage.target_words.len() - spec.required.len(),
            spec.ai_pick,
            passage.word_count,
            run.elapsed.as_secs_f64(),
            run.stats["tokens"]["total"],
            run.outcome.retries
        ),
    );
    Ok(passage)
}

/// 一套阅读理解题的要求
pub struct QuestionsSpec<'a> {
    pub title: &'a str,
    pub sentences: &'a [PassageSentence],
    pub targets: &'a [PassageTargetWord],
    pub spec: &'a QuestionSetSpec,
}

pub fn passage_questions_message(q: &QuestionsSpec) -> String {
    let sentences: Vec<String> = q
        .sentences
        .iter()
        .enumerate()
        .map(|(i, s)| format!("{}. {}", i + 1, s.en))
        .collect();
    let targets: Vec<&str> = q.targets.iter().map(|t| t.word.as_str()).collect();
    let difficulty = match q.spec.difficulty.as_str() {
        "basic" => "basic（基础）",
        "advanced" => "advanced（提高）",
        _ => "standard（标准）",
    };
    prompts::message(
        MessageTemplate::PassageQuestions,
        &[
            ("title", q.title),
            ("sentences", &sentences.join("\n")),
            ("targets", &targets.join(", ")),
            ("cloze", &q.spec.cloze.to_string()),
            ("choice", &q.spec.choice.to_string()),
            ("true_false", &q.spec.true_false.to_string()),
            ("open", &q.spec.open.to_string()),
            ("difficulty", difficulty),
        ],
    )
}

/// 出一套阅读理解题（Rust 再校验：空位必须是原文里的词，各题型不超过请求数量）
pub async fn generate_questions(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    q: &QuestionsSpec<'_>,
    logger: &Logger,
) -> AppResult<GeneratedQuestionSet> {
    let run = run_task(
        paths,
        &passage_questions_task(profile),
        model,
        &passage_questions_message(q),
        PASSAGE_QUESTIONS_TIMEOUT,
        logger,
        |_| {},
    )
    .await?;
    let submission = run
        .outcome
        .last_successful_call("submit_questions")
        .ok_or_else(|| AppError::ExternalServiceError("模型没有提交题目".to_string()))?;
    let set = passage_rules::questions_from_submission(&submission.details, q.sentences, q.spec)
        .map_err(|e| {
            AppError::ExternalServiceError(format!("生成的题目不合格：{}，请再试一次", e))
        })?;
    logger.info(
        "PASSAGE",
        &format!(
            "passage-questions 完成：model={} 题目 {} 用时 {:.1}s tokens={} retries={}",
            model.model_id,
            set.questions.len(),
            run.elapsed.as_secs_f64(),
            run.stats["tokens"]["total"],
            run.outcome.retries
        ),
    );
    Ok(set)
}

/// 一道开放题的作答（评分请求用）
pub struct OpenAnswer<'a> {
    pub question: &'a str,
    pub reference_answer: &'a str,
    pub rubric: &'a [String],
    pub answer: &'a str,
}

pub fn passage_grade_message(passage_text: &str, answers: &[OpenAnswer]) -> String {
    let blocks: Vec<String> = answers
        .iter()
        .enumerate()
        .map(|(i, a)| {
            format!(
                "第 {} 题：{}\n参考答案：{}\n评分要点：{}\n学生的回答：{}",
                i + 1,
                a.question,
                a.reference_answer,
                a.rubric.join("；"),
                if a.answer.trim().is_empty() {
                    "（空白）"
                } else {
                    a.answer.trim()
                }
            )
        })
        .collect();
    prompts::message(
        MessageTemplate::PassageGrade,
        &[("passage", passage_text), ("answers", &blocks.join("\n\n"))],
    )
}

/// 开放题评分：按题目顺序返回（得分, 评语, 改进示例），模型漏评的题为 None
pub async fn grade_open_answers(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    passage_text: &str,
    answers: &[OpenAnswer<'_>],
    logger: &Logger,
) -> AppResult<Vec<Option<(i64, String, Option<String>)>>> {
    let run = run_task(
        paths,
        &passage_grade_task(profile),
        model,
        &passage_grade_message(passage_text, answers),
        PASSAGE_GRADE_TIMEOUT,
        logger,
        |_| {},
    )
    .await?;
    let submission = run
        .outcome
        .last_successful_call("submit_grade")
        .ok_or_else(|| AppError::ExternalServiceError("模型没有提交评分".to_string()))?;
    Ok(passage_rules::grades_from_submission(
        &submission.details,
        answers.len(),
    ))
}

/// 导入材料的逐句翻译：结构化结果经 submit_translation 交付（只回传译文，原文不经模型）
pub fn passage_translate_task(profile: &PromptProfile) -> AgentTask {
    AgentTask {
        name: "passage-translate",
        system_prompt: prompts::system_prompt(PromptTask::PassageTranslate, profile, &[]),
        tools: &["submit_translation"],
        default_thinking: "low",
    }
}

/// 一篇导入材料的翻译请求
pub struct TranslateSpec<'a> {
    /// 用户给的标题；为空时让模型起
    pub title: Option<&'a str>,
    pub sentences: &'a [String],
    /// 要不要挑重点词
    pub key_words: bool,
}

pub fn passage_translate_message(spec: &TranslateSpec) -> String {
    let (title, sentences, key_words) = (spec.title, spec.sentences, spec.key_words);
    let numbered: Vec<String> = sentences
        .iter()
        .enumerate()
        .map(|(i, s)| format!("{}. {}", i + 1, s))
        .collect();
    prompts::message(
        MessageTemplate::PassageTranslate,
        &[
            ("count", &sentences.len().to_string()),
            ("title", title.unwrap_or("").trim()),
            ("key_words", if key_words { "yes" } else { "" }),
            ("sentences", &numbered.join("\n")),
        ],
    )
}

/// 翻译一篇导入的材料（可取消）；Rust 再校验每句都有译文、重点词在原文里
pub async fn translate_passage(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    spec: &TranslateSpec<'_>,
    logger: &Logger,
    cancelled: impl Fn() -> bool,
) -> AppResult<passage_rules::Translation> {
    let (sentences, key_words) = (spec.sentences, spec.key_words);
    let run = run_task_cancellable(
        paths,
        &passage_translate_task(profile),
        model,
        &passage_translate_message(spec),
        PASSAGE_TRANSLATE_TIMEOUT,
        logger,
        cancelled,
        |_| {},
    )
    .await?;
    let submission = run
        .outcome
        .last_successful_call("submit_translation")
        .ok_or_else(|| AppError::ExternalServiceError("翻译没有完成，请再试一次".to_string()))?;
    let translation =
        passage_rules::translation_from_submission(&submission.details, sentences, key_words)
            .map_err(|e| {
                AppError::ExternalServiceError(format!("翻译不完整：{}，请再试一次", e))
            })?;
    logger.info(
        "PASSAGE",
        &format!(
            "passage-translate 完成：model={} 句子 {} 重点词 {} 用时 {:.1}s tokens={} retries={}",
            model.model_id,
            sentences.len(),
            translation.key_words.len(),
            run.elapsed.as_secs_f64(),
            run.stats["tokens"]["total"],
            run.outcome.retries
        ),
    );
    Ok(translation)
}

/// 设置页「测试」：经 agent 走真实调用链（含思考档 / 额外参数），返回模型回复与用量
pub async fn test_model(
    paths: &AgentPaths,
    model: &AIModelConfig,
    text: &str,
    logger: &Logger,
) -> AppResult<(String, Value)> {
    let task = AgentTask {
        name: "model-test",
        system_prompt: prompts::model_test_system().trim().to_string(),
        tools: &[],
        default_thinking: "low",
    };
    let run = run_task(
        paths,
        &task,
        model,
        text,
        Duration::from_secs(120),
        logger,
        |_| {},
    )
    .await?;
    let reply = run.outcome.text.trim().to_string();
    if reply.is_empty() {
        return Err(AppError::ExternalServiceError(
            "模型没有返回文本".to_string(),
        ));
    }
    Ok((reply, run.stats))
}

#[cfg(test)]
mod tests {
    #[test]
    fn generated_words_keep_single_new_words_only() {
        let details = serde_json::json!({ "words": [
            { "word": "climate", "pos": "n.", "translation": "气候" },
            { "word": "Climate", "pos": "n.", "translation": "气候" },
            { "word": "climate change", "pos": "n.", "translation": "气候变化" },
            { "word": "recycle", "pos": "v.", "translation": "回收" },
            { "word": "CO2", "pos": "n.", "translation": "二氧化碳" },
            { "word": "eco-friendly", "pos": "adj.", "translation": "环保的" },
            { "word": "Earth", "pos": "n.", "translation": "地球" },
            { "word": "carbon", "pos": "n.", "translation": "碳" }
        ]});
        let existing: HashSet<String> = ["recycle".to_string()].into_iter().collect();
        let words = generated_from_submission(&details, &existing, 3);
        let got: Vec<&str> = words.iter().map(|w| w.word.as_str()).collect();
        assert_eq!(got, vec!["climate", "eco-friendly", "Earth"]);
        assert!(words.iter().all(|w| w.frequency == 1));
        assert_eq!(words[0].meaning.as_deref(), Some("气候"));
    }

    use super::*;
    use serde_json::json;

    #[test]
    fn tokenizer_matches_sidecar_rules() {
        let counts = tokenize_words("Tom has a kite. TOM runs on May 12th at 9:00, don't stop!");
        let expected: BTreeMap<String, i32> = [
            ("tom", 2),
            ("has", 1),
            ("kite", 1),
            ("runs", 1),
            ("on", 1),
            ("may", 1),
            ("at", 1),
            ("don", 1),
            ("stop", 1),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
        assert_eq!(counts, expected);
    }

    #[test]
    fn submission_is_grounded_in_text_and_frequencies_are_deterministic() {
        let text = "The cat sat on the mat. The cat is happy.";
        let details = json!({ "words": [
            { "word": "Cat", "frequency": 5, "pos": "n.", "translation": "猫" },
            { "word": "cat", "frequency": 2, "pos": "n.", "translation": "猫" },
            { "word": "the", "frequency": 3, "pos": "art.", "translation": "这" },
            { "word": "dog", "frequency": 1, "pos": "n.", "translation": "狗" },
            { "word": "happy", "frequency": 1, "pos": "adj.", "translation": " " }
        ]});
        let words = words_from_submission(&details, text, "focus");
        let summary: Vec<(String, i32, Option<String>)> = words
            .iter()
            .map(|w| (w.word.clone(), w.frequency, w.meaning.clone()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("cat".to_string(), 2, Some("猫".to_string())),
                ("happy".to_string(), 1, None),
            ]
        );
        // 专有名词保留首字母大写，其它大小写形式归一为小写
        let names = words_from_submission(
            &json!({ "words": [
                { "word": "Lily", "pos": "n.", "translation": "莉莉" },
                { "word": "HAPPY", "pos": "adj.", "translation": "快乐的" }
            ]}),
            "Lily is happy. LILY!",
            "focus",
        );
        let forms: Vec<(&str, i32)> = names
            .iter()
            .map(|w| (w.word.as_str(), w.frequency))
            .collect();
        assert_eq!(forms, vec![("Lily", 2), ("happy", 1)]);
        // 全部模式保留功能词
        assert!(words_from_submission(&details, text, "all")
            .iter()
            .any(|w| w.word == "the" && w.frequency == 3));
    }

    #[test]
    fn task_prompt_contains_mode_rules_and_tools() {
        let focus = extract_words_task(&PromptProfile::default(), "focus");
        assert!(focus.system_prompt.contains("重点模式"));
        assert!(focus.system_prompt.contains("tokenize_text"));
        assert!(!focus.system_prompt.contains("{{"));
        assert_eq!(focus.tools, &["tokenize_text", "submit_words"]);
        assert!(extract_words_task(&PromptProfile::default(), "all")
            .system_prompt
            .contains("全部模式"));
    }

    /// 真实调用（花费 token，默认不跑）：
    /// `REDLARK_E2E_MOONSHOT_KEY=<key> cargo test agent::tasks::tests::real_extraction -- --ignored --nocapture`
    /// sidecar 默认取 target/debug/redlark-agent（cargo build 时由 tauri-build 复制），可用 REDLARK_AGENT_BIN 覆盖。
    #[tokio::test]
    #[ignore]
    async fn real_extraction_with_kimi_k3() {
        let key = std::env::var("REDLARK_E2E_MOONSHOT_KEY").expect("需要 REDLARK_E2E_MOONSHOT_KEY");
        let model: AIModelConfig = serde_json::from_value(json!({
            "id": 1, "name": "kimi-k3", "displayName": "Kimi K3", "modelId": "kimi-k3",
            "description": null, "maxTokens": 32000, "temperature": 1.0,
            "isActive": true, "isDefault": true, "createdAt": "", "updatedAt": "",
            "provider": { "id": 2, "name": "moonshot", "displayName": "月之暗面", "baseUrl": "https://api.moonshot.cn/v1",
                "apiKey": key, "description": null, "piProvider": "moonshotai-cn", "api": "openai-completions",
                "isActive": true, "createdAt": "", "updatedAt": "" }
        }))
        .unwrap();
        let program = std::env::var_os("REDLARK_AGENT_BIN")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("target/debug/redlark-agent")
            });
        let root = std::env::temp_dir().join(format!("redlark-agent-e2e-{}", uuid::Uuid::new_v4()));
        let paths = AgentPaths {
            program,
            root: root.clone(),
        };
        let logger = crate::test_support::test_logger();
        let text =
            "Tom has a little red kite. Every Sunday he runs to the park with his sister Lily. \
                    The wind is strong, so the kite flies high above the trees.";
        let started = Instant::now();
        let result = extract_words(
            &paths,
            &model,
            &PromptProfile::default(),
            "",
            text,
            "focus",
            &logger,
        )
        .await
        .unwrap();
        let words: Vec<_> = result
            .words
            .iter()
            .map(|w| (w.word.as_str(), w.frequency))
            .collect();
        println!("{:.1}s {:?}", started.elapsed().as_secs_f64(), words);
        assert!(words.contains(&("kite", 2)));
        assert!(words.contains(&("Lily", 1)) && words.contains(&("Sunday", 1)));
        assert!(!words.iter().any(|(w, _)| *w == "the" || *w == "is"));
        assert!(result.words.iter().all(|w| w.meaning.is_some()));
        // 运行目录在进程结束后已清理
        assert!(
            std::fs::read_dir(root.join("runs"))
                .map(|d| d.count())
                .unwrap_or(0)
                == 0
        );
        let _ = std::fs::remove_dir_all(root);
    }

    /// 真实调用（花费 token，默认不跑）：
    fn sample_word() -> Word {
        Word {
            id: 1,
            word: "cake".into(),
            meaning: "蛋糕".into(),
            description: None,
            ipa: Some("/keɪk/".into()),
            syllables: Some("cake".into()),
            phonics_segments: None,
            image_path: None,
            audio_path: None,
            part_of_speech: Some("n.".into()),
            category_id: None,
            word_book_id: Some(1),
            pos_abbreviation: Some("n.".into()),
            pos_english: Some("Noun".into()),
            pos_chinese: Some("名词".into()),
            phonics_rule: Some("VCE Pattern | 魔法e规则".into()),
            analysis_explanation: Some("结尾的 e 不发音，让 a 读长音 /eɪ/。".into()),
            examples: vec![
                WordExample {
                    sentence: "I like cake.".into(),
                    translation: "我喜欢蛋糕。".into(),
                },
                WordExample {
                    sentence: "We eat cake on my birthday.".into(),
                    translation: "我们在我生日那天吃蛋糕。".into(),
                },
            ],
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn explain_message_carries_word_facts_and_examples() {
        let message = explain_word_message(&sample_word(), "");
        for needle in [
            "单词：cake",
            "中文释义：蛋糕",
            "词性：名词",
            "音标：/keɪk/",
            "拼读规则：VCE",
            "1. I like cake. —— 我喜欢蛋糕。",
        ] {
            assert!(message.contains(needle), "缺少 {needle}：{message}");
        }
        let mut bare = sample_word();
        bare.ipa = Some("  ".into());
        bare.examples.clear();
        let message = explain_word_message(&bare, "");
        assert!(!message.contains("音标") && !message.contains("已有例句"));
        let task = explain_word_task(&PromptProfile::default());
        assert!(task.tools.is_empty());
        assert!(task.system_prompt.contains("读懂例句") && task.system_prompt.contains("想一想"));
    }

    /// 单词本场景放在用户消息最前面；没有场景时消息与原来一致
    #[test]
    fn book_scene_leads_every_word_message() {
        let scene = crate::prompts::book_scene(
            "出国旅行",
            "出国旅行常用词：机场、海关、酒店、问路",
            &["旅行".to_string()],
        );
        assert!(scene.starts_with("【单词本场景】\n单词本：出国旅行\n场景说明：出国旅行常用词"));
        assert!(scene.contains("主题标签：旅行") && scene.contains("一词多义时选这个场景里的意思"));
        assert!(crate::prompts::book_scene("", " ", &[]).is_empty());
        // 没有描述和标签时只写标题
        let title_only = crate::prompts::book_scene("出国旅行", "", &[]);
        assert!(!title_only.contains("场景说明") && !title_only.contains("主题标签"));

        let word = sample_word();
        let explain = explain_word_message(&word, &scene);
        assert!(explain.starts_with(&scene));
        assert!(explain.contains("请为下面这个单词写一份讲解：\n单词：cake"));
        assert!(explain_word_message(&word, "").starts_with("请为下面这个单词写一份讲解："));
        assert!(word_tutor_message(&word, &scene, None, &[], "hi").starts_with(&scene));
        assert!(word_examples_message(&word, ExampleMode::Append, &scene).starts_with(&scene));

        let extract = prompts::message(
            MessageTemplate::ExtractWords,
            &[("scene", &scene), ("text", "Show your passport.")],
        );
        assert!(extract.starts_with(&scene) && extract.ends_with("文本：\nShow your passport."));
        let generate = prompts::message(
            MessageTemplate::GenerateWords,
            &[
                ("scene", &scene),
                ("intent", "海关"),
                ("count", "10"),
                ("existing", ""),
            ],
        );
        assert!(generate.contains("子话题") && generate.contains("学习意图：海关"));
        assert!(!generate.contains("已有单词"));
        let plain = prompts::message(
            MessageTemplate::GenerateWords,
            &[("intent", "海关"), ("count", "10"), ("existing", "")],
        );
        assert!(plain.starts_with("学习意图：海关"));
    }

    /// 生成 / 提取时定好的释义随单词传给拼读分析（大小写不敏感，只列这一批里的词）
    #[test]
    fn phonics_message_carries_scene_and_confirmed_meanings() {
        let context = PhonicsContext {
            scene: crate::prompts::book_scene("出国旅行", "机场与海关", &[]),
            meanings: [("customs".to_string(), "海关".to_string())]
                .into_iter()
                .collect(),
        };
        let words = vec!["Customs".to_string(), "passport".to_string()];
        assert_eq!(context.hint_lines(&words), "Customs：海关");
        let message = prompts::message(
            MessageTemplate::PhonicsBatch,
            &[
                ("scene", &context.scene),
                ("count", "2"),
                ("words", &words.join(", ")),
                ("hints", &context.hint_lines(&words)),
            ],
        );
        assert!(message.starts_with("【单词本场景】"));
        assert!(message.contains("请分析以下 2 个单词：\nCustoms, passport"));
        assert!(message.ends_with("例句也用这个意思）：\nCustoms：海关"));
        let plain = prompts::message(
            MessageTemplate::PhonicsBatch,
            &[("count", "1"), ("words", "cake"), ("hints", "")],
        );
        assert_eq!(plain, "请分析以下 1 个单词：\ncake");
    }

    #[test]
    fn markdown_wrapper_fences_are_removed() {
        assert_eq!(
            clean_markdown("```markdown\n## 标题\n内容\n```"),
            "## 标题\n内容"
        );
        assert_eq!(clean_markdown("```\n## A\n```\n"), "## A");
        // 正文中间的代码块保留
        let body = "## A\n```\ncode\n```\n结尾";
        assert_eq!(clean_markdown(body), body);
    }

    /// `REDLARK_E2E_MOONSHOT_KEY=<key> cargo test agent::tasks::tests::real_explain -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn real_explain_word_with_kimi_k3() {
        let key = std::env::var("REDLARK_E2E_MOONSHOT_KEY").expect("需要 REDLARK_E2E_MOONSHOT_KEY");
        let model: AIModelConfig = serde_json::from_value(json!({
            "id": 1, "name": "kimi-k3", "displayName": "Kimi K3", "modelId": "kimi-k3",
            "description": null, "maxTokens": 32000, "temperature": 1.0,
            "isActive": true, "isDefault": true, "createdAt": "", "updatedAt": "",
            "provider": { "id": 2, "name": "moonshot", "displayName": "月之暗面", "baseUrl": "https://api.moonshot.cn/v1",
                "apiKey": key, "description": null, "piProvider": "moonshotai-cn", "api": "openai-completions",
                "isActive": true, "createdAt": "", "updatedAt": "" }
        }))
        .unwrap();
        let program = std::env::var_os("REDLARK_AGENT_BIN")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("target/debug/redlark-agent")
            });
        let root = std::env::temp_dir().join(format!("redlark-agent-e2e-{}", uuid::Uuid::new_v4()));
        let paths = AgentPaths {
            program,
            root: root.clone(),
        };
        let logger = crate::test_support::test_logger();
        let started = Instant::now();
        let mut streamed = String::new();
        let reply = explain_word(
            &paths,
            &model,
            &PromptProfile::default(),
            "",
            &sample_word(),
            &logger,
            |d| streamed.push_str(d),
        )
        .await
        .unwrap();
        println!(
            "{:.1}s chars={} follow_ups={:?}\n{}",
            started.elapsed().as_secs_f64(),
            reply.content.chars().count(),
            reply.follow_ups,
            reply.content
        );
        assert!(streamed.len() > 1, "应收到流式增量");
        assert!(reply.content.contains("## "));
        assert!(
            !streamed.contains(follow_up::FOLLOW_UP_MARKER) && !reply.content.contains("追问>>>")
        );
        assert!(!reply.follow_ups.is_empty(), "应给出推荐追问");

        // 答疑：带上讲解与对话，回答后推荐的追问不重复已问过的问题
        let question = "为什么 cake 结尾的 e 不发音？";
        let message = word_tutor_message(&sample_word(), "", Some(&reply.content), &[], question);
        let mut tutor_streamed = String::new();
        let answer = ask_tutor(
            &paths,
            &model,
            &PromptProfile::default(),
            &message,
            &logger,
            &[question],
            |d| tutor_streamed.push_str(d),
        )
        .await
        .unwrap();
        println!(
            "tutor: {}\nfollow_ups={:?}",
            answer.content, answer.follow_ups
        );
        assert!(!tutor_streamed.contains(follow_up::FOLLOW_UP_MARKER));
        assert!(!answer.follow_ups.is_empty(), "答疑应给出推荐追问");
        let _ = std::fs::remove_dir_all(root);
    }

    /// `REDLARK_E2E_MOONSHOT_KEY=<key> cargo test agent::tasks::tests::real_passage -- --ignored --nocapture`
    /// 真实调用：导入材料逐句翻译（REDLARK_E2E_MOONSHOT_KEY；REDLARK_AGENT_BIN 指向已编译的 sidecar）
    #[tokio::test]
    #[ignore]
    async fn real_passage_translate_with_kimi_k3() {
        let key = std::env::var("REDLARK_E2E_MOONSHOT_KEY").expect("需要 REDLARK_E2E_MOONSHOT_KEY");
        let model: AIModelConfig = serde_json::from_value(json!({
            "id": 1, "name": "kimi-k3", "displayName": "Kimi K3", "modelId": "kimi-k3",
            "description": null, "maxTokens": 32000, "temperature": 1.0,
            "isActive": true, "isDefault": true, "createdAt": "", "updatedAt": "",
            "provider": { "id": 2, "name": "moonshot", "displayName": "月之暗面", "baseUrl": "https://api.moonshot.cn/v1",
                "apiKey": key, "description": null, "piProvider": "moonshotai-cn", "api": "openai-completions",
                "isActive": true, "createdAt": "", "updatedAt": "" }
        }))
        .unwrap();
        let program = std::env::var_os("REDLARK_AGENT_BIN")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("target/debug/redlark-agent")
            });
        let root = std::env::temp_dir().join(format!("redlark-agent-e2e-{}", uuid::Uuid::new_v4()));
        let paths = AgentPaths {
            program,
            root: root.clone(),
        };
        let logger = crate::test_support::test_logger();
        let sentences: Vec<String> = [
            "The Lost Kite",
            "Mia had a bright red kite.",
            "One windy afternoon, the string slipped from her hand.",
            "The kite flew over the river and got stuck in an old oak tree.",
            "Her grandfather fetched a long ladder, and together they rescued it.",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let profile = PromptProfile::default();
        let t = translate_passage(
            &paths,
            &model,
            &profile,
            &TranslateSpec {
                title: None,
                sentences: &sentences,
                key_words: true,
            },
            &logger,
            || false,
        )
        .await
        .expect("翻译");
        let _ = std::fs::remove_dir_all(&root);
        println!(
            "title={} level={} key_words={:?}",
            t.title, t.level, t.key_words
        );
        for (en, zh) in sentences.iter().zip(&t.zh) {
            println!("{} => {}", en, zh);
        }
        assert_eq!(t.zh.len(), sentences.len());
        assert!(t.zh.iter().all(|z| !z.trim().is_empty()));
        assert!(!t.title.is_empty());
        assert!(["a1", "a2", "b1", "b2"].contains(&t.level.as_str()));
        assert!(!t.key_words.is_empty());
    }

    #[tokio::test]
    #[ignore]
    async fn real_passage_generate_questions_and_grade_with_kimi_k3() {
        let key = std::env::var("REDLARK_E2E_MOONSHOT_KEY").expect("需要 REDLARK_E2E_MOONSHOT_KEY");
        let model: AIModelConfig = serde_json::from_value(json!({
            "id": 1, "name": "kimi-k3", "displayName": "Kimi K3", "modelId": "kimi-k3",
            "description": null, "maxTokens": 32000, "temperature": 1.0,
            "isActive": true, "isDefault": true, "createdAt": "", "updatedAt": "",
            "provider": { "id": 2, "name": "moonshot", "displayName": "月之暗面", "baseUrl": "https://api.moonshot.cn/v1",
                "apiKey": key, "description": null, "piProvider": "moonshotai-cn", "api": "openai-completions",
                "isActive": true, "createdAt": "", "updatedAt": "" }
        }))
        .unwrap();
        let program = std::env::var_os("REDLARK_AGENT_BIN")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("target/debug/redlark-agent")
            });
        let root = std::env::temp_dir().join(format!("redlark-agent-e2e-{}", uuid::Uuid::new_v4()));
        let paths = AgentPaths {
            program,
            root: root.clone(),
        };
        let logger = crate::test_support::test_logger();
        let word = |i: usize, w: &str| PassageTargetWord {
            word_id: Some(i as i64 + 1),
            word: w.to_string(),
            required: false,
            meaning: None,
        };
        let required: Vec<PassageTargetWord> = ["passport", "customs", "luggage"]
            .iter()
            .enumerate()
            .map(|(i, w)| word(i, w))
            .collect();
        let pool: Vec<PassageTargetWord> = [
            "gate", "ticket", "hotel", "map", "menu", "delay", "apple", "homework",
        ]
        .iter()
        .enumerate()
        .map(|(i, w)| word(i + 10, w))
        .collect();
        let scene = prompts::book_scene(
            "出国旅行",
            "出国旅行常用词：机场、海关、酒店、问路、点餐",
            &[],
        );
        let started = Instant::now();
        let passage = generate_passage(
            &paths,
            &model,
            &PromptProfile::default(),
            &PassageSpec {
                scene: &scene,
                outline: "",
                title: "",
                required: &required,
                pool: &pool,
                ai_pick: 3,
                pick_prefs: "挑词偏好：优先日常生活中常用的高频词。",
                min_words: 60,
                max_words: 100,
            },
            &logger,
        )
        .await
        .unwrap();
        println!(
            "{:.1}s「{}」{} 词，目标词 {:?}",
            started.elapsed().as_secs_f64(),
            passage.title,
            passage.word_count,
            passage
                .target_words
                .iter()
                .map(|w| (&w.word, w.required))
                .collect::<Vec<_>>()
        );
        for s in &passage.sentences {
            println!("  {}  /  {}", s.en, s.zh);
        }
        assert!(passage.target_words.iter().filter(|w| w.required).count() == 3);

        let spec = QuestionSetSpec {
            cloze: 4,
            choice: 2,
            true_false: 2,
            open: 1,
            difficulty: "standard".into(),
        };
        let started = Instant::now();
        let set = generate_questions(
            &paths,
            &model,
            &PromptProfile::default(),
            &QuestionsSpec {
                title: &passage.title,
                sentences: &passage.sentences,
                targets: &passage.target_words,
                spec: &spec,
            },
            &logger,
        )
        .await
        .unwrap();
        println!("出题 {:.1}s：", started.elapsed().as_secs_f64());
        for q in &set.questions {
            println!("  [{}] {} {:?} → {:?}", q.kind, q.stem, q.options, q.answer);
        }
        assert!(set.questions.iter().filter(|q| q.kind == "cloze").count() >= 3);

        let open = set
            .questions
            .iter()
            .find(|q| q.kind == "open")
            .expect("应有开放题");
        let reference = open.reference_answer.as_deref().unwrap_or("");
        let answers = [
            OpenAnswer {
                question: &open.stem,
                reference_answer: reference,
                rubric: &open.rubric,
                answer: reference,
            },
            OpenAnswer {
                question: &open.stem,
                reference_answer: reference,
                rubric: &open.rubric,
                answer: "yes",
            },
        ];
        let text: String = passage
            .sentences
            .iter()
            .map(|s| s.en.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let grades = grade_open_answers(
            &paths,
            &model,
            &PromptProfile::default(),
            &text,
            &answers,
            &logger,
        )
        .await
        .unwrap();
        println!("评分：{:?}", grades);
        let (good, bad) = (grades[0].as_ref().unwrap().0, grades[1].as_ref().unwrap().0);
        assert!(good > bad, "参考答案应比 yes 得分高");
        let _ = std::fs::remove_dir_all(root);
    }

    /// `REDLARK_E2E_MOONSHOT_KEY=<key> cargo test agent::tasks::tests::real_phonics -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn real_phonics_batch_with_kimi_k3() {
        let key = std::env::var("REDLARK_E2E_MOONSHOT_KEY").expect("需要 REDLARK_E2E_MOONSHOT_KEY");
        let model: AIModelConfig = serde_json::from_value(json!({
            "id": 1, "name": "kimi-k3", "displayName": "Kimi K3", "modelId": "kimi-k3",
            "description": null, "maxTokens": 32000, "temperature": 1.0,
            "isActive": true, "isDefault": true, "createdAt": "", "updatedAt": "",
            "provider": { "id": 2, "name": "moonshot", "displayName": "月之暗面", "baseUrl": "https://api.moonshot.cn/v1",
                "apiKey": key, "description": null, "piProvider": "moonshotai-cn", "api": "openai-completions",
                "isActive": true, "createdAt": "", "updatedAt": "" }
        }))
        .unwrap();
        let program = std::env::var_os("REDLARK_AGENT_BIN")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("target/debug/redlark-agent")
            });
        let root = std::env::temp_dir().join(format!("redlark-agent-e2e-{}", uuid::Uuid::new_v4()));
        let paths = AgentPaths {
            program,
            root: root.clone(),
        };
        let logger = crate::test_support::test_logger();
        let words: Vec<String> = ["elephant", "kite", "Sunday", "night", "table"]
            .iter()
            .map(|w| w.to_string())
            .collect();
        let started = Instant::now();
        let outcome = analyze_phonics_batch(
            &paths,
            &model,
            &PromptProfile::default(),
            &PhonicsContext::default(),
            &words,
            &logger,
        )
        .await
        .unwrap();
        println!(
            "{:.1}s missing={:?}",
            started.elapsed().as_secs_f64(),
            outcome.missing
        );
        for w in &outcome.analyzed {
            println!(
                "{} {} {} | {} | {}",
                w.word, w.ipa, w.syllables, w.phonics_rule, w.chinese_translation
            );
            assert_eq!(
                w.syllables.replace('-', "").to_lowercase(),
                w.word.to_lowercase()
            );
        }
        assert_eq!(outcome.analyzed.len(), 5);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn phonics_submission_is_limited_to_requested_words() {
        let requested = vec!["Baking".to_string(), "car".to_string(), "kite".to_string()];
        let details = json!({ "words": [
            { "word": "baking", "chinese_translation": "烘烤", "pos_abbreviation": "v.", "pos_english": "Verb",
              "pos_chinese": "动词", "ipa": "/ˈbeɪkɪŋ/", "syllables": "ba-king",
              "phonics_rule": "VCE Pattern | 魔法e规则", "analysis_explanation": "魔法 e",
              "examples": [
                  { "sentence": " Mom is baking a cake. ", "translation": "妈妈在烤蛋糕。" },
                  { "sentence": "We like baking bread.", "translation": "" },
                  { "sentence": "Dad is baking cookies.", "translation": "爸爸在烤饼干。" }
              ] },
            { "word": "CAR", "chinese_translation": "汽车", "ipa": "/kɑːr/", "syllables": "car" },
            { "word": "car", "chinese_translation": "重复" },
            { "word": "dog", "chinese_translation": "狗" }
        ]});
        let outcome = phonics_from_submission(&details, &requested);
        let words: Vec<(&str, &str)> = outcome
            .analyzed
            .iter()
            .map(|w| (w.word.as_str(), w.chinese_translation.as_str()))
            .collect();
        assert_eq!(words, vec![("Baking", "烘烤"), ("car", "汽车")]);
        assert_eq!(outcome.analyzed[0].phonics_rule, "VCE Pattern | 魔法e规则");
        // 例句：去空白，缺翻译的丢弃，顺序保留
        let examples: Vec<&str> = outcome.analyzed[0]
            .examples
            .iter()
            .map(|e| e.sentence.as_str())
            .collect();
        assert_eq!(
            examples,
            vec!["Mom is baking a cake.", "Dad is baking cookies."]
        );
        assert!(outcome.analyzed[1].examples.is_empty());
        assert_eq!(outcome.missing, vec!["kite".to_string()]);
    }

    #[test]
    fn phonics_task_exposes_only_submit_tool() {
        let task = phonics_batch_task(&PromptProfile::default());
        assert_eq!(task.tools, &["submit_phonics"]);
        assert!(task.system_prompt.contains("submit_phonics"));
        assert!(task.system_prompt.contains("Irregular | 不规则拼读"));
        assert!(!task.system_prompt.contains("CSV"));
    }

    /// 真实调用（花费 token，默认不跑）：
    /// `REDLARK_E2E_MOONSHOT_KEY=<key> cargo test agent::tasks::tests::real_plan -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn real_plan_order_with_kimi_k3() {
        use crate::services::study_planning::{build_schedule, normalize_order, PlanParams};
        let key = std::env::var("REDLARK_E2E_MOONSHOT_KEY").expect("需要 REDLARK_E2E_MOONSHOT_KEY");
        let model: AIModelConfig = serde_json::from_value(json!({
            "id": 1, "name": "kimi-k3", "displayName": "Kimi K3", "modelId": "kimi-k3",
            "description": null, "maxTokens": 32000, "temperature": 1.0,
            "isActive": true, "isDefault": true, "createdAt": "", "updatedAt": "",
            "provider": { "id": 2, "name": "moonshot", "displayName": "月之暗面", "baseUrl": "https://api.moonshot.cn/v1",
                "apiKey": key, "description": null, "piProvider": "moonshotai-cn", "api": "openai-completions",
                "isActive": true, "createdAt": "", "updatedAt": "" }
        }))
        .unwrap();
        let program = std::env::var_os("REDLARK_AGENT_BIN")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("target/debug/redlark-agent")
            });
        let root = std::env::temp_dir().join(format!("redlark-agent-e2e-{}", uuid::Uuid::new_v4()));
        let paths = AgentPaths {
            program,
            root: root.clone(),
        };
        let logger = crate::test_support::test_logger();
        let raw = [
            ("elephant", "大象"),
            ("cat", "猫"),
            ("night", "夜晚"),
            ("cake", "蛋糕"),
            ("giraffe", "长颈鹿"),
            ("light", "光"),
            ("make", "做"),
            ("dog", "狗"),
            ("beautiful", "美丽的"),
            ("ship", "船"),
            ("right", "正确的"),
            ("lake", "湖"),
            ("fish", "鱼"),
            ("Tom", "汤姆"),
            ("sun", "太阳"),
            ("environment", "环境"),
            ("rain", "雨"),
            ("shop", "商店"),
            ("train", "火车"),
            ("red", "红色"),
        ];
        let words: Vec<PlanWord> = raw
            .iter()
            .enumerate()
            .map(|(i, (w, m))| PlanWord {
                word_id: 100 + i as i64,
                word: w.to_string(),
                wordbook_id: 1,
                meaning: Some(m.to_string()),
            })
            .collect();
        let started = Instant::now();
        let assessed = plan_word_order(
            &paths,
            &model,
            &PromptProfile::default(),
            &words,
            &logger,
            || false,
            |_| {},
        )
        .await
        .unwrap();
        let ordered = normalize_order(&words, &assessed);
        println!(
            "{:.1}s 模型给出 {} / {}",
            started.elapsed().as_secs_f64(),
            assessed.len(),
            words.len()
        );
        for (w, a) in &ordered {
            println!("{:<12} 难度{} {}", w.word, a.difficulty, a.priority);
        }
        let plan = build_schedule(
            &PlanParams {
                daily_new_words: 10,
                start_date: "2026-10-07".into(),
            },
            &ordered,
        )
        .unwrap();
        for d in &plan.daily_plans {
            let new: Vec<&str> = d
                .words
                .iter()
                .filter(|w| !w.is_review)
                .map(|w| w.word.as_str())
                .collect();
            println!(
                "第{}天 {} 新{:?} 复习{}",
                d.day,
                d.date,
                new,
                d.words.len() - new.len()
            );
        }
        assert_eq!(assessed.len(), words.len());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn learning_order_submission_keeps_model_order() {
        let details = json!({ "order": [
            { "id": 7, "difficulty": 1, "priority": "high" },
            { "id": "x", "difficulty": 2 },
            { "id": 3 }
        ]});
        let assessed = assessments_from_submission(&details);
        let summary: Vec<(i64, i32, &str)> = assessed
            .iter()
            .map(|a| (a.word_id, a.difficulty, a.priority.as_str()))
            .collect();
        assert_eq!(summary, vec![(7, 1, "high"), (3, 3, "medium")]);
        let task = plan_order_task(&PromptProfile::default());
        assert_eq!(task.tools, &["submit_learning_order"]);
        assert!(task.system_prompt.contains("小学生"));
    }
}
