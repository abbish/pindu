//! 提示词模板（唯一 owner）：所有 AI 任务的系统提示词、用户消息、按学习者档案选用的片段都是 `src/prompts/` 下的独立文件，
//! 编译时 `include_str!` 进二进制；这里负责选片段、填变量、渲染。
//!
//! 目录：
//! - `agent/*.md`：各任务的系统提示词模板（规则、格式、正确性约束固定；学习者与风格经变量注入）
//! - `messages/*.md`：发给模型的用户消息模板
//! - `fragments/<维度>/<取值>.md`：学习者、英语水平、讲解语言、讲解详略、记忆方法、答疑风格、术语、音标、提取模式等片段
//!
//! 模板语法（刻意保持很小）：
//! - `{{name}}` 替换为变量值；**某行里的变量为空时整行删除**（可选字段、可选要求都靠这一条）。
//! - `{{#name}}` … `{{/name}}`：变量非空才保留中间的行；`{{^name}}` … `{{/name}}`：变量为空才保留。块标记独占一行。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

// ==================== 渲染 ====================

/// 渲染模板：替换变量、删除含空变量的行、处理条件块
pub fn render(template: &str, vars: &[(&str, &str)]) -> String {
    let map: HashMap<&str, &str> = vars.iter().copied().collect();
    let value = |name: &str| map.get(name).copied().unwrap_or("");
    let mut out: Vec<String> = Vec::new();
    // 条件块栈：每层是否保留
    let mut keep: Vec<bool> = Vec::new();
    for line in template.lines() {
        let trimmed = line.trim();
        if let Some(name) = block_marker(trimmed, "{{#") {
            keep.push(!value(name).trim().is_empty());
            continue;
        }
        if let Some(name) = block_marker(trimmed, "{{^") {
            keep.push(value(name).trim().is_empty());
            continue;
        }
        if block_marker(trimmed, "{{/").is_some() {
            keep.pop();
            continue;
        }
        if keep.iter().any(|k| !k) {
            continue;
        }
        let names = placeholders(line);
        if names.iter().any(|n| value(n).trim().is_empty()) {
            continue; // 可选内容为空：整行不要
        }
        let mut rendered = line.to_string();
        for n in names {
            rendered = rendered.replace(&format!("{{{{{}}}}}", n), value(n).trim_end());
        }
        out.push(rendered);
    }
    collapse_blank_lines(&out.join("\n"))
}

fn block_marker<'a>(line: &'a str, open: &str) -> Option<&'a str> {
    line.strip_prefix(open)?.strip_suffix("}}")
}

/// 一行里出现的变量名（`{{name}}`，不含块标记）
fn placeholders(line: &str) -> Vec<&str> {
    let mut names = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else { break };
        let name = &after[..end];
        if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            names.push(name);
        }
        rest = &after[end + 2..];
    }
    names
}

/// 删除变量为空留下的连续空行（最多保留一个空行），去掉首尾空行
fn collapse_blank_lines(text: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() && out.last().is_some_and(|l| l.trim().is_empty()) {
            continue;
        }
        out.push(line);
    }
    while out.first().is_some_and(|l| l.trim().is_empty()) {
        out.remove(0);
    }
    while out.last().is_some_and(|l| l.trim().is_empty()) {
        out.pop();
    }
    out.join("\n")
}

/// 文本指纹（缓存失效判断用）：SHA-256 前 16 位十六进制
pub fn fingerprint(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest
        .iter()
        .take(8)
        .map(|b| format!("{:02x}", b))
        .collect()
}

// ==================== 学习者档案与风格 ====================

/// 学习者档案与各场景风格（设置页「AI 助手 → 学习者与风格」）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptProfile {
    /// primary 小学生 / junior 初中生 / senior 高中生 / adult 成人
    pub learner: String,
    /// auto（按学习者）/ a1 / a2 / b1 / b2
    pub level: String,
    /// zh 中文为主 / mixed 中英混合 / en 英文为主
    pub language: String,
    /// 兴趣场景（例句、讲解优先用这些场景）
    pub interests: Vec<String>,
    /// AI 讲解详略：brief / standard / detailed
    pub explain_length: String,
    /// 记忆方法偏好：auto / phonics / morphology / imagery
    pub memory_method: String,
    /// AI 老师的称呼（空 = “英语老师”）
    pub tutor_name: String,
    /// 答疑风格：gentle / concise / socratic
    pub tutor_style: String,
    /// 回答末尾可以出一个小问题
    pub tutor_quiz: bool,
    /// 音标：british / american
    pub ipa: String,
    /// 各任务的补充要求（任务 key → 文本）
    pub custom: HashMap<String, String>,
}

impl Default for PromptProfile {
    /// 默认 = 小学生预设（与模板化之前的行为一致）
    fn default() -> Self {
        Self::preset("primary").unwrap()
    }
}

/// 补充要求的最大长度（字符）
pub const CUSTOM_MAX_CHARS: usize = 300;

impl PromptProfile {
    /// 预设：primary 小学生 / secondary 中学生 / adult 成人
    pub fn preset(name: &str) -> Option<Self> {
        let base = |learner: &str,
                    level: &str,
                    language: &str,
                    length: &str,
                    memory: &str,
                    style: &str| Self {
            learner: learner.into(),
            level: level.into(),
            language: language.into(),
            interests: Vec::new(),
            explain_length: length.into(),
            memory_method: memory.into(),
            tutor_name: String::new(),
            tutor_style: style.into(),
            tutor_quiz: true,
            ipa: "british".into(),
            custom: HashMap::new(),
        };
        match name {
            "primary" => Some(base(
                "primary", "auto", "zh", "standard", "phonics", "gentle",
            )),
            "secondary" => Some(base("junior", "auto", "zh", "standard", "auto", "gentle")),
            "adult" => Some(Self {
                tutor_quiz: false,
                ..base("adult", "auto", "mixed", "brief", "morphology", "concise")
            }),
            _ => None,
        }
    }

    /// 校验取值；非法值返回错误说明
    pub fn validate(&self) -> Result<(), String> {
        let check = |field: &str, value: &str, allowed: &[&str]| {
            if allowed.contains(&value) {
                Ok(())
            } else {
                Err(format!("{} 的取值不正确：{}", field, value))
            }
        };
        check(
            "学习者",
            &self.learner,
            &["primary", "junior", "senior", "adult"],
        )?;
        check("英语水平", &self.level, &["auto", "a1", "a2", "b1", "b2"])?;
        check("讲解语言", &self.language, &["zh", "mixed", "en"])?;
        check(
            "讲解详略",
            &self.explain_length,
            &["brief", "standard", "detailed"],
        )?;
        check(
            "记忆方法",
            &self.memory_method,
            &["auto", "phonics", "morphology", "imagery"],
        )?;
        check(
            "答疑风格",
            &self.tutor_style,
            &["gentle", "concise", "socratic"],
        )?;
        check("音标", &self.ipa, &["british", "american"])?;
        if self.tutor_name.chars().count() > 20 {
            return Err("老师称呼最多 20 个字".into());
        }
        if self.interests.len() > 8 || self.interests.iter().any(|i| i.chars().count() > 12) {
            return Err("兴趣场景最多 8 个，每个不超过 12 个字".into());
        }
        for (task, text) in &self.custom {
            if !PromptTask::ALL.iter().any(|t| t.key() == task) {
                return Err(format!("未知的任务：{}", task));
            }
            if text.chars().count() > CUSTOM_MAX_CHARS {
                return Err(format!("补充要求最多 {} 个字", CUSTOM_MAX_CHARS));
            }
        }
        Ok(())
    }

    /// 实际的英语水平：auto 按学习者推断
    pub fn effective_level(&self) -> &str {
        match (self.level.as_str(), self.learner.as_str()) {
            ("auto", "primary") => "a1",
            ("auto", "junior") => "a2",
            ("auto", "senior") => "b1",
            ("auto", _) => "a2",
            (level, _) => level,
        }
    }
}

// ==================== 片段 ====================

fn learner_fragment(v: &str) -> &'static str {
    match v {
        "junior" => include_str!("prompts/fragments/learner/junior.md"),
        "senior" => include_str!("prompts/fragments/learner/senior.md"),
        "adult" => include_str!("prompts/fragments/learner/adult.md"),
        _ => include_str!("prompts/fragments/learner/primary.md"),
    }
}

fn level_fragment(v: &str) -> &'static str {
    match v {
        "a2" => include_str!("prompts/fragments/level/a2.md"),
        "b1" => include_str!("prompts/fragments/level/b1.md"),
        "b2" => include_str!("prompts/fragments/level/b2.md"),
        _ => include_str!("prompts/fragments/level/a1.md"),
    }
}

fn language_fragment(v: &str) -> &'static str {
    match v {
        "mixed" => include_str!("prompts/fragments/language/mixed.md"),
        "en" => include_str!("prompts/fragments/language/en.md"),
        _ => include_str!("prompts/fragments/language/zh.md"),
    }
}

fn explain_length_fragment(v: &str) -> &'static str {
    match v {
        "brief" => include_str!("prompts/fragments/explain_length/brief.md"),
        "detailed" => include_str!("prompts/fragments/explain_length/detailed.md"),
        _ => include_str!("prompts/fragments/explain_length/standard.md"),
    }
}

fn memory_fragment(v: &str) -> &'static str {
    match v {
        "phonics" => include_str!("prompts/fragments/memory/phonics.md"),
        "morphology" => include_str!("prompts/fragments/memory/morphology.md"),
        "imagery" => include_str!("prompts/fragments/memory/imagery.md"),
        _ => include_str!("prompts/fragments/memory/auto.md"),
    }
}

fn tutor_style_fragment(v: &str) -> &'static str {
    match v {
        "concise" => include_str!("prompts/fragments/tutor_style/concise.md"),
        "socratic" => include_str!("prompts/fragments/tutor_style/socratic.md"),
        _ => include_str!("prompts/fragments/tutor_style/gentle.md"),
    }
}

fn ipa_fragment(v: &str) -> &'static str {
    match v {
        "american" => include_str!("prompts/fragments/ipa/american.md"),
        _ => include_str!("prompts/fragments/ipa/british.md"),
    }
}

/// 拼读术语：小学、初中用通俗说法；高中、成人可以用规范术语
fn phonics_terms_fragment(learner: &str) -> &'static str {
    match learner {
        "senior" | "adult" => include_str!("prompts/fragments/phonics_terms/technical.md"),
        _ => include_str!("prompts/fragments/phonics_terms/plain.md"),
    }
}

/// 模型连通性测试的系统提示词
pub fn model_test_system() -> &'static str {
    include_str!("prompts/fragments/system/model_test.md")
}

// ==================== 任务模板 ====================

/// 使用提示词的 AI 任务（key 与「设置 → AI 助手」的任务一致）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptTask {
    Extract,
    Generate,
    Phonics,
    Examples,
    Plan,
    Explain,
    Tutor,
    PassagePlan,
    Passage,
    PassageQuestions,
    PassageGrade,
    PassageTranslate,
    VideoPlan,
}

impl PromptTask {
    pub const ALL: [PromptTask; 13] = [
        PromptTask::Extract,
        PromptTask::Generate,
        PromptTask::Phonics,
        PromptTask::Examples,
        PromptTask::Plan,
        PromptTask::Explain,
        PromptTask::Tutor,
        PromptTask::PassagePlan,
        PromptTask::Passage,
        PromptTask::PassageQuestions,
        PromptTask::PassageGrade,
        PromptTask::PassageTranslate,
        PromptTask::VideoPlan,
    ];

    pub fn key(self) -> &'static str {
        match self {
            PromptTask::Extract => "extract",
            PromptTask::Generate => "generate",
            PromptTask::Phonics => "phonics",
            PromptTask::Examples => "examples",
            PromptTask::Plan => "plan",
            PromptTask::Explain => "explain",
            PromptTask::Tutor => "tutor",
            PromptTask::PassagePlan => "passage_plan",
            PromptTask::Passage => "passage",
            PromptTask::PassageQuestions => "passage_questions",
            PromptTask::PassageGrade => "passage_grade",
            PromptTask::PassageTranslate => "passage_translate",
            PromptTask::VideoPlan => "video_plan",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            PromptTask::Extract => "提取单词",
            PromptTask::Generate => "按意图生成单词",
            PromptTask::Phonics => "拼读分析",
            PromptTask::Examples => "例句补充",
            PromptTask::Plan => "学习计划排序",
            PromptTask::Explain => "AI 讲解",
            PromptTask::Tutor => "AI 老师答疑",
            PromptTask::PassagePlan => "短文：内容规划",
            PromptTask::Passage => "短文：写短文",
            PromptTask::PassageQuestions => "短文：出阅读理解题",
            PromptTask::PassageGrade => "短文：开放题评分",
            PromptTask::PassageTranslate => "短文：导入材料翻译",
            PromptTask::VideoPlan => "视频：规划场景切分",
        }
    }

    fn template(self) -> &'static str {
        match self {
            PromptTask::Extract => include_str!("prompts/agent/extract_words.md"),
            PromptTask::Generate => include_str!("prompts/agent/generate_words.md"),
            PromptTask::Phonics => include_str!("prompts/agent/phonics_batch.md"),
            PromptTask::Examples => include_str!("prompts/agent/word_examples.md"),
            PromptTask::Plan => include_str!("prompts/agent/study_plan_order.md"),
            PromptTask::Explain => include_str!("prompts/agent/word_explain.md"),
            PromptTask::Tutor => include_str!("prompts/agent/word_tutor.md"),
            PromptTask::PassagePlan => include_str!("prompts/agent/passage_plan.md"),
            PromptTask::Passage => include_str!("prompts/agent/passage_generate.md"),
            PromptTask::PassageQuestions => include_str!("prompts/agent/passage_questions.md"),
            PromptTask::PassageGrade => include_str!("prompts/agent/passage_grade.md"),
            PromptTask::PassageTranslate => include_str!("prompts/agent/passage_translate.md"),
            PromptTask::VideoPlan => include_str!("prompts/agent/video_plan.md"),
        }
    }
}

/// 某个任务的系统提示词。`extra` 为任务自己的变量（如提取模式规则）
pub fn system_prompt(task: PromptTask, profile: &PromptProfile, extra: &[(&str, &str)]) -> String {
    let interests = if profile.interests.is_empty() {
        String::new()
    } else {
        format!(
            "学习者感兴趣的场景：{}。举例时优先用这些场景（不必每条都用，保持场景多样）。",
            profile.interests.join("、")
        )
    };
    let custom = profile
        .custom
        .get(task.key())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|text| {
            format!(
                "## 用户的补充要求\n\n以下是用户的个性化要求；与上文的输出格式、工具调用和正确性要求冲突时，以上文为准。\n\n{}",
                text
            )
        })
        .unwrap_or_default();
    let tutor_persona = if profile.tutor_name.trim().is_empty() {
        "一位耐心、专业的英语老师".to_string()
    } else {
        format!(
            "「{}」，一位耐心、专业的英语老师",
            profile.tutor_name.trim()
        )
    };
    let tutor_quiz = if profile.tutor_quiz {
        "可以在回答末尾反问一个小问题，鼓励学习者自己说一说、用一用（不是每次都要）。"
    } else {
        ""
    };
    let mut vars: Vec<(&str, &str)> = vec![
        ("learner", learner_fragment(&profile.learner)),
        ("level", level_fragment(profile.effective_level())),
        ("language", language_fragment(&profile.language)),
        ("interests", &interests),
        (
            "explain_length",
            explain_length_fragment(&profile.explain_length),
        ),
        ("memory", memory_fragment(&profile.memory_method)),
        ("tutor_persona", &tutor_persona),
        ("tutor_style", tutor_style_fragment(&profile.tutor_style)),
        ("tutor_quiz", tutor_quiz),
        ("ipa", ipa_fragment(&profile.ipa)),
        ("phonics_terms", phonics_terms_fragment(&profile.learner)),
        ("custom", &custom),
    ];
    vars.extend_from_slice(extra);
    render(task.template(), &vars)
}

/// 提取模式规则（focus：列出不提交的功能词）
pub fn extract_mode_rules(mode: &str, stopwords: &[&str]) -> String {
    if mode == "focus" {
        render(
            include_str!("prompts/fragments/extract_mode/focus.md"),
            &[("stopwords", &stopwords.join(", "))],
        )
    } else {
        include_str!("prompts/fragments/extract_mode/all.md")
            .trim()
            .to_string()
    }
}

/// 用户消息模板
#[derive(Debug, Clone, Copy)]
pub enum MessageTemplate {
    BookScene,
    TopicScene,
    WordFacts,
    ExplainWord,
    WordTutor,
    WordExamples,
    PhonicsBatch,
    PlanOrder,
    ExtractWords,
    GenerateWords,
    PassagePlan,
    PassageGenerate,
    PassageQuestions,
    PassageGrade,
    PassageTranslate,
    VideoPlan,
}

pub fn message(template: MessageTemplate, vars: &[(&str, &str)]) -> String {
    let text = match template {
        MessageTemplate::BookScene => include_str!("prompts/messages/book_scene.md"),
        MessageTemplate::TopicScene => include_str!("prompts/messages/topic_scene.md"),
        MessageTemplate::WordFacts => include_str!("prompts/messages/word_facts.md"),
        MessageTemplate::ExplainWord => include_str!("prompts/messages/explain_word.md"),
        MessageTemplate::WordTutor => include_str!("prompts/messages/word_tutor.md"),
        MessageTemplate::WordExamples => include_str!("prompts/messages/word_examples.md"),
        MessageTemplate::PhonicsBatch => include_str!("prompts/messages/phonics_batch.md"),
        MessageTemplate::PlanOrder => include_str!("prompts/messages/plan_order.md"),
        MessageTemplate::ExtractWords => include_str!("prompts/messages/extract_words.md"),
        MessageTemplate::GenerateWords => include_str!("prompts/messages/generate_words.md"),
        MessageTemplate::PassagePlan => include_str!("prompts/messages/passage_plan.md"),
        MessageTemplate::PassageGenerate => include_str!("prompts/messages/passage_generate.md"),
        MessageTemplate::PassageQuestions => include_str!("prompts/messages/passage_questions.md"),
        MessageTemplate::PassageGrade => include_str!("prompts/messages/passage_grade.md"),
        MessageTemplate::PassageTranslate => include_str!("prompts/messages/passage_translate.md"),
        MessageTemplate::VideoPlan => include_str!("prompts/messages/video_plan.md"),
    };
    render(text, vars)
}

/// 单词本场景（标题 + 描述 + 主题标签）：作为生成、分析、例句、讲解、答疑的共同背景放进用户消息
pub fn book_scene(title: &str, description: &str, tags: &[String]) -> String {
    let title = title.trim();
    let description = description.trim();
    if title.is_empty() && description.is_empty() && tags.is_empty() {
        return String::new();
    }
    message(
        MessageTemplate::BookScene,
        &[
            ("title", title),
            ("description", description),
            ("tags", &tags.join("、")),
        ],
    )
}

/// 用户自定的短文主题 / 场景
pub fn topic_scene(topic: &str) -> String {
    let topic = topic.trim();
    if topic.is_empty() {
        return String::new();
    }
    message(MessageTemplate::TopicScene, &[("topic", topic)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_substitutes_drops_empty_lines_and_handles_blocks() {
        let t =
            "A：{{a}}\nB：{{b}}\n{{#c}}\n有 C：\n{{c}}\n{{/c}}\n{{^c}}\n没有 C\n{{/c}}\n\n\n结尾";
        assert_eq!(render(t, &[("a", "1"), ("b", "")]), "A：1\n没有 C\n\n结尾");
        assert_eq!(
            render(t, &[("a", "1"), ("c", "x\ny")]),
            "A：1\n有 C：\nx\ny\n\n结尾"
        );
    }

    /// 每个任务、每个预设渲染后都不能残留占位符，并且学习者描述随预设变化
    #[test]
    fn every_task_renders_completely_for_every_preset() {
        for preset in ["primary", "secondary", "adult"] {
            let mut profile = PromptProfile::preset(preset).unwrap();
            profile.interests = vec!["足球".into(), "旅行".into()];
            profile
                .custom
                .insert("explain".into(), "多讲一点常见搭配".into());
            profile.validate().unwrap();
            for task in PromptTask::ALL {
                let text = system_prompt(task, &profile, &[("mode_rules", "## 模式")]);
                assert!(!text.contains("{{"), "{preset}/{}: 残留占位符", task.key());
                assert!(
                    !text.contains("小学生") || preset == "primary",
                    "{preset}/{}: 仍写死小学生",
                    task.key()
                );
            }
        }
        let adult = system_prompt(
            PromptTask::Explain,
            &PromptProfile::preset("adult").unwrap(),
            &[],
        );
        assert!(
            adult.contains("成年人")
                && adult.contains("250–400")
                && adult.contains("规范的语音术语")
        );
        assert!(adult.contains("构词") && adult.contains("中英混合"));
        let kid = system_prompt(PromptTask::Explain, &PromptProfile::default(), &[]);
        assert!(kid.contains("小学生") && kid.contains("500–800") && kid.contains("不用 CVC"));
        assert!(!kid.contains("用户的补充要求"));
    }

    #[test]
    fn tutor_persona_style_and_custom_requirements_are_injected() {
        let mut p = PromptProfile::preset("primary").unwrap();
        p.tutor_name = "Lark 老师".into();
        p.tutor_style = "socratic".into();
        p.tutor_quiz = false;
        p.custom.insert("tutor".into(), "回答时多用英文例句".into());
        let text = system_prompt(PromptTask::Tutor, &p, &[]);
        assert!(text.contains("「Lark 老师」"));
        assert!(text.contains("引导式"));
        assert!(!text.contains("反问一个小问题"));
        assert!(text.contains("## 用户的补充要求") && text.contains("回答时多用英文例句"));
        // 补充要求只进对应任务
        assert!(!system_prompt(PromptTask::Explain, &p, &[]).contains("回答时多用英文例句"));
    }

    #[test]
    fn validation_rejects_unknown_values_and_long_text() {
        let mut p = PromptProfile::preset("primary").unwrap();
        p.learner = "baby".into();
        assert!(p.validate().is_err());
        let mut p = PromptProfile::preset("primary").unwrap();
        p.custom
            .insert("explain".into(), "长".repeat(CUSTOM_MAX_CHARS + 1));
        assert!(p.validate().is_err());
        let mut p = PromptProfile::preset("primary").unwrap();
        p.custom.insert("nope".into(), "x".into());
        assert!(p.validate().is_err());
        assert!(PromptProfile::preset("nope").is_none());
    }

    #[test]
    fn extract_mode_rules_keep_stopword_list() {
        let focus = extract_mode_rules("focus", &["the", "is"]);
        assert!(focus.contains("重点模式") && focus.contains("the, is"));
        assert!(extract_mode_rules("all", &[]).contains("全部模式"));
    }

    /// 把各预设渲染后的系统提示词写到 `agent/eval/rendered/<预设>/`，供 `agent/eval/*.mjs` 评测读取：
    /// `cargo test prompts::tests::render_eval_prompts -- --ignored`
    #[test]
    #[ignore]
    fn render_eval_prompts() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../agent/eval/rendered");
        let files = [
            (PromptTask::Generate, "generate_words.md"),
            (PromptTask::Phonics, "phonics_batch.md"),
            (PromptTask::Examples, "word_examples.md"),
            (PromptTask::Plan, "study_plan_order.md"),
            (PromptTask::Explain, "word_explain.md"),
            (PromptTask::Tutor, "word_tutor.md"),
            (PromptTask::PassagePlan, "passage_plan.md"),
            (PromptTask::Passage, "passage_generate.md"),
            (PromptTask::PassageQuestions, "passage_questions.md"),
            (PromptTask::PassageGrade, "passage_grade.md"),
            (PromptTask::PassageTranslate, "passage_translate.md"),
            (PromptTask::VideoPlan, "video_plan.md"),
        ];
        let stopwords = crate::agent::tasks::FOCUS_STOPWORDS;
        for preset in ["primary", "secondary", "adult"] {
            let profile = PromptProfile::preset(preset).unwrap();
            let dir = root.join(preset);
            std::fs::create_dir_all(&dir).unwrap();
            for (task, file) in files {
                std::fs::write(dir.join(file), system_prompt(task, &profile, &[])).unwrap();
            }
            for mode in ["focus", "all"] {
                let rules = extract_mode_rules(mode, stopwords);
                let text = system_prompt(PromptTask::Extract, &profile, &[("mode_rules", &rules)]);
                std::fs::write(dir.join(format!("extract_words.{}.md", mode)), text).unwrap();
            }
        }
    }

    #[test]
    fn fingerprint_is_stable_and_sensitive() {
        assert_eq!(fingerprint("a"), fingerprint("a"));
        assert_ne!(fingerprint("a"), fingerprint("b"));
        assert_eq!(fingerprint("a").len(), 16);
    }
}
