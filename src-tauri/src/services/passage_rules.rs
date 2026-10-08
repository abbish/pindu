//! 短文库的确定性规则（纯函数）：篇幅、题组参数、模型提交的二次校验、选词填空与判分、计划选词范围。
//! 模型只负责写短文和出题；用了哪些词、空位是否在原文里、答案对不对都在这里判定（DECISIONS D05 / D23）。

use crate::types::passage::{
    ClozeResult, PassagePlan, PassagePlanItem, PassageQuestion, PassageSentence, PassageTargetWord,
    QuestionSetSpec,
};
use chrono::{Duration, NaiveDate};
use serde_json::Value;
use std::collections::HashSet;

/// 开放题满分
pub const OPEN_MAX_SCORE: i64 = 4;
/// 一篇短文至少要有几个目标词（必用词 + AI 挑选）；不设上限：内容质量优先，词多就把故事写丰富（D26）
pub const MIN_TARGET_WORDS: usize = 1;
/// AI 从来源里最多再挑几个词（超过一篇装得下的数量时，内容规划会拆成几篇）
pub const MAX_AI_PICK: i64 = 20;
/// 导入材料时最多标出几个重点词
pub const MAX_KEY_WORDS: usize = 12;
/// 交给 AI 挑选的候选词最多多少个
pub const MAX_POOL: usize = 120;

/// 篇幅（英文词数范围）：按英语水平，short / long 在标准上下浮动
pub fn length_range(level: &str, length: &str) -> (usize, usize) {
    let (min, max) = match level {
        "a1" => (60, 100),
        "a2" => (100, 160),
        "b1" => (160, 240),
        _ => (220, 320),
    };
    match length {
        "short" => (min * 2 / 3, min),
        "long" => (max, max * 3 / 2),
        _ => (min, max),
    }
}

/// 题组参数是否合法；不合法返回原因
pub fn validate_spec(spec: &QuestionSetSpec) -> Result<(), String> {
    let check = |name: &str, n: i64, max: i64| {
        if (0..=max).contains(&n) {
            Ok(())
        } else {
            Err(format!("{} 的数量应在 0–{} 之间", name, max))
        }
    };
    check("选词填空", spec.cloze, 10)?;
    check("选择题", spec.choice, 8)?;
    check("判断题", spec.true_false, 8)?;
    check("开放题", spec.open, 3)?;
    if spec.cloze + spec.choice + spec.true_false + spec.open == 0 {
        return Err("至少要有一道题".into());
    }
    if !matches!(spec.difficulty.as_str(), "basic" | "standard" | "advanced") {
        return Err(format!(
            "难度应为 basic / standard / advanced，收到 {}",
            spec.difficulty
        ));
    }
    Ok(())
}

/// `token` 是否是 `word` 本身或它的常见屈折形式（-s / -es / -ed / -ing / -er / -est、去 e、y 变 i、双写辅音）
pub fn inflection_matches(token: &str, word: &str) -> bool {
    let t = token.trim().to_lowercase();
    let w = word.trim().to_lowercase();
    if t.is_empty() || w.is_empty() {
        return false;
    }
    if t == w {
        return true;
    }
    const SUFFIXES: [&str; 7] = ["s", "es", "ed", "d", "ing", "er", "est"];
    if SUFFIXES.iter().any(|s| t == format!("{w}{s}")) {
        return true;
    }
    if let Some(stem) = w.strip_suffix('e') {
        if ["ing", "ed", "er", "est"]
            .iter()
            .any(|s| t == format!("{stem}{s}"))
        {
            return true;
        }
    }
    if let Some(stem) = w.strip_suffix('y') {
        if ["ies", "ied", "ier", "iest"]
            .iter()
            .any(|s| t == format!("{stem}{s}"))
        {
            return true;
        }
    }
    // 双写结尾辅音（stop → stopped、big → bigger）
    w.chars().last().is_some_and(|last| {
        !"aeiouwxy".contains(last)
            && ["ing", "ed", "er", "est"]
                .iter()
                .any(|s| t == format!("{w}{last}{s}"))
    })
}

/// 一段英文里的单词（字母与撇号）
pub fn words_of(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| !c.is_ascii_alphabetic() && c != '\'')
        .map(|w| w.trim_matches('\''))
        .filter(|w| !w.is_empty())
}

/// 英文词数
pub fn english_word_count(sentences: &[PassageSentence]) -> usize {
    sentences.iter().map(|s| words_of(&s.en).count()).sum()
}

/// 文本里是否出现了某个词（含屈折形式）
pub fn text_uses(text: &str, word: &str) -> bool {
    words_of(text).any(|t| inflection_matches(t, word))
}

/// 选词填空词库：答案（去重）+ 干扰词（不与答案重复，最多 3 个），按 `seed` 确定性打乱
pub fn cloze_bank(answers: &[String], distractors: &[String], seed: i64) -> Vec<String> {
    let mut bank: Vec<String> = Vec::new();
    for w in answers.iter().chain(distractors.iter().take(3)) {
        let w = w.trim();
        if !w.is_empty() && !bank.iter().any(|b| b.eq_ignore_ascii_case(w)) {
            bank.push(w.to_string());
        }
    }
    // 线性同余打乱：同一套题每次打开顺序一致
    let mut state = (seed as u64)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    for i in (1..bank.len()).rev() {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let j = ((state >> 33) as usize) % (i + 1);
        bank.swap(i, j);
    }
    bank
}

/// 选词填空判分（忽略大小写与首尾空白）
pub fn grade_cloze(answer: &str, given: &str) -> bool {
    !given.trim().is_empty() && given.trim().eq_ignore_ascii_case(answer.trim())
}

/// 客观题是否答对（开放题返回 None；选词填空单独判）
pub fn grade_objective(question: &PassageQuestion, given: &str) -> Option<bool> {
    match question.kind.as_str() {
        "choice" | "true_false" | "cloze" => Some(
            question
                .answer
                .as_deref()
                .is_some_and(|a| grade_cloze(a, given)),
        ),
        _ => None,
    }
}

/// 计划的取词策略（可多选，取并集）
pub const PLAN_SCOPES: [&str; 6] = ["wrong", "weak", "recent", "upcoming", "mastered", "learned"];
/// 「最近学的」：最近几天第一次学
const RECENT_DAYS: i64 = 7;
/// 「快到复习」：接下来几天内到期（含已过期未复习）
const UPCOMING_DAYS: i64 = 3;

/// 计划里一个已学词的学习情况标签：
/// wrong 练习中答错过 / weak 记忆等级 1–2 / recent 最近 7 天第一次学 / upcoming 3 天内要复习 / mastered 记忆等级 ≥ 4
pub fn word_tags(
    srs_box: i64,
    wrong: i64,
    first_learned: Option<NaiveDate>,
    due: Option<NaiveDate>,
    today: NaiveDate,
) -> Vec<String> {
    let mut tags = Vec::new();
    if wrong > 0 {
        tags.push("wrong");
    }
    if (1..=2).contains(&srs_box) {
        tags.push("weak");
    }
    if first_learned.is_some_and(|d| d > today - Duration::days(RECENT_DAYS)) {
        tags.push("recent");
    }
    if due.is_some_and(|d| d <= today + Duration::days(UPCOMING_DAYS)) {
        tags.push("upcoming");
    }
    if srs_box >= 4 {
        tags.push("mastered");
    }
    tags.into_iter().map(String::from).collect()
}

/// 计划里的词是否落在所选取词策略内（并集；learned = 全部学过的）
pub fn in_plan_scopes(scopes: &[String], tags: &[String]) -> bool {
    scopes.is_empty()
        || scopes
            .iter()
            .any(|s| s == "learned" || tags.iter().any(|t| t == s))
}

/// AI 挑词的学习情况筛选（可多选，取并集；空 = 不限）：
/// new 没学过 / learning 学过未掌握 / wrong 常错 / mastered 已掌握
pub const PICK_STATUSES: [&str; 4] = ["new", "learning", "wrong", "mastered"];
/// AI 挑词的单词难度（相对学习者水平；空 = 不限）
pub const PICK_DIFFICULTIES: [&str; 3] = ["easy", "medium", "hard"];
/// AI 挑词的常用程度（空 = 不限）：common 日常常用 / advanced 也要书面、少见的
pub const PICK_FREQUENCIES: [&str; 2] = ["common", "advanced"];

/// 一个词的学习情况：`level` 是记忆等级（单词本里的词取它在各计划里最高的，没进过计划为 0），`wrong` 是答错次数
pub fn learning_statuses(level: i64, wrong: i64) -> Vec<String> {
    let mut statuses = vec![match level {
        l if l >= 4 => "mastered",
        l if l >= 1 => "learning",
        _ => "new",
    }];
    if wrong > 0 {
        statuses.push("wrong");
    }
    statuses.into_iter().map(String::from).collect()
}

/// 词的学习情况是否落在筛选内（并集；空 = 不限）
pub fn in_pick_statuses(filter: &[String], statuses: &[String]) -> bool {
    filter.is_empty() || filter.iter().any(|f| statuses.contains(f))
}

/// 挑词偏好（难度、常用程度）→ 给模型的一行要求；都不限时为空
pub fn pick_preferences(difficulty: Option<&str>, frequency: Option<&str>) -> String {
    let mut parts = Vec::new();
    match difficulty {
        Some("easy") => parts.push("挑对这位学习者来说偏简单的词"),
        Some("medium") => parts.push("挑难度适中、贴合这位学习者水平的词"),
        Some("hard") => parts.push("挑偏难、略高于这位学习者水平的词"),
        _ => {}
    }
    match frequency {
        Some("common") => parts.push("优先日常生活中常用的高频词"),
        Some("advanced") => parts.push("也要挑一些书面、较少见的词"),
        _ => {}
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("挑词偏好：{}。", parts.join("；"))
    }
}

/// 手动输入的单词：单个英文单词（字母，可含连字符 / 撇号，2–30 字）
pub fn valid_extra_word(word: &str) -> bool {
    let w = word.trim();
    (2..=30).contains(&w.chars().count())
        && w.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && w.chars()
            .all(|c| c.is_ascii_alphabetic() || c == '-' || c == '\'')
}

// ==================== 模型提交的二次校验 ====================

fn text(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn opt_text(v: &Value, key: &str) -> Option<String> {
    Some(text(v, key)).filter(|s| !s.is_empty())
}

fn strings(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 校验后的短文（尚未入库）
#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedPassage {
    pub title: String,
    pub sentences: Vec<PassageSentence>,
    /// 必用词 + AI 实际挑选并用到的词
    pub target_words: Vec<PassageTargetWord>,
    pub word_count: usize,
}

/// `submit_passage` 的参数 → 合格的短文。必用词都要出现；AI 挑的词只接受候选池里、且确实用在正文里的，最多 `ai_pick` 个
pub fn passage_from_submission(
    details: &Value,
    required: &[PassageTargetWord],
    pool: &[PassageTargetWord],
    ai_pick: usize,
) -> Result<GeneratedPassage, String> {
    let title = text(details, "title");
    if title.is_empty() {
        return Err("缺少标题".into());
    }
    let sentences: Vec<PassageSentence> = details
        .get("sentences")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|s| PassageSentence {
            en: text(s, "en").replace("[[", "").replace("]]", ""),
            zh: text(s, "zh"),
            paragraph: false,
            start_ms: None,
            end_ms: None,
        })
        .filter(|s| !s.en.is_empty())
        .collect();
    if sentences.len() < 3 {
        return Err("短文少于 3 句".into());
    }
    if sentences.iter().any(|s| s.zh.is_empty()) {
        return Err("有句子缺少中文翻译".into());
    }
    let plain = sentences
        .iter()
        .map(|s| s.en.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let missing: Vec<&str> = required
        .iter()
        .filter(|w| !text_uses(&plain, &w.word))
        .map(|w| w.word.as_str())
        .collect();
    if !missing.is_empty() {
        return Err(format!("正文没有用到必用词：{}", missing.join(", ")));
    }
    let word_count = english_word_count(&sentences);
    if word_count < 30 {
        return Err("短文太短".into());
    }

    let mut targets: Vec<PassageTargetWord> = required
        .iter()
        .map(|w| PassageTargetWord {
            required: true,
            ..w.clone()
        })
        .collect();
    let mut seen: HashSet<String> = targets.iter().map(|w| w.word.to_lowercase()).collect();
    let mut picked = 0;
    for chosen in strings(details, "chosen_words") {
        if picked >= ai_pick {
            break;
        }
        let Some(word) = pool.iter().find(|w| w.word.eq_ignore_ascii_case(&chosen)) else {
            continue;
        };
        if text_uses(&plain, &word.word) && seen.insert(word.word.to_lowercase()) {
            targets.push(PassageTargetWord {
                required: false,
                ..word.clone()
            });
            picked += 1;
        }
    }
    Ok(GeneratedPassage {
        title,
        sentences,
        target_words: targets,
        word_count,
    })
}

/// 内容规划最多几篇
pub const MAX_PLAN_ITEMS: usize = 4;

/// 构思的四个部分（提交里的键 → 给用户看的标签）
const OUTLINE_PARTS: [(&str, &str); 4] = [
    ("goal", "主角与目标"),
    ("problem", "麻烦或意外"),
    ("turn", "发展与解决"),
    ("ending", "结尾"),
];

/// `submit_passage_plan` 的参数 → 内容规划。
/// 词只接受必用词与候选池里的词（AI 挑的合计不超过 `ai_pick`），每个词只归一篇；漏掉的必用词补进词最少的那篇；没有词的篇目丢弃
pub fn plan_from_submission(
    details: &Value,
    required: &[PassageTargetWord],
    pool: &[PassageTargetWord],
    ai_pick: usize,
) -> Result<PassagePlan, String> {
    let mut used: HashSet<String> = HashSet::new();
    let mut picked = 0;
    let mut items: Vec<PassagePlanItem> = Vec::new();
    let passages = details
        .get("passages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for p in passages.iter().take(MAX_PLAN_ITEMS) {
        let outline = p.get("outline").cloned().unwrap_or(Value::Null);
        let idea = OUTLINE_PARTS
            .iter()
            .filter_map(|(key, label)| {
                Some(text(&outline, key))
                    .filter(|t| !t.is_empty())
                    .map(|t| format!("{}：{}", label, t))
            })
            .collect::<Vec<_>>()
            .join("\n");
        let mut words = Vec::new();
        for w in strings(p, "words") {
            let key = w.to_lowercase();
            if used.contains(&key) {
                continue;
            }
            if let Some(r) = required.iter().find(|r| r.word.eq_ignore_ascii_case(&w)) {
                used.insert(key);
                words.push(PassageTargetWord {
                    required: true,
                    ..r.clone()
                });
            } else if picked < ai_pick {
                if let Some(c) = pool.iter().find(|c| c.word.eq_ignore_ascii_case(&w)) {
                    used.insert(key);
                    picked += 1;
                    words.push(PassageTargetWord {
                        required: false,
                        ..c.clone()
                    });
                }
            }
        }
        let length = match text(p, "length").as_str() {
            l @ ("short" | "long") => l.to_string(),
            _ => "standard".to_string(),
        };
        items.push(PassagePlanItem {
            title: text(p, "title"),
            idea,
            words,
            length,
        });
    }
    // 没有构思或没有词的篇目先丢掉，再把漏掉的必用词补进词最少的那篇
    items.retain(|i| !i.words.is_empty() && !i.idea.is_empty());
    if items.is_empty() {
        return Err("规划里没有可写的短文".into());
    }
    for r in required {
        if used.insert(r.word.to_lowercase()) {
            if let Some(item) = items.iter_mut().min_by_key(|i| i.words.len()) {
                item.words.push(PassageTargetWord {
                    required: true,
                    ..r.clone()
                });
            }
        }
    }
    Ok(PassagePlan {
        items,
        note: text(details, "note"),
    })
}

/// 校验后的新题目（尚未入库）
#[derive(Debug, Clone, PartialEq)]
pub struct NewQuestion {
    pub kind: String,
    pub stem: String,
    pub options: Vec<String>,
    pub answer: Option<String>,
    pub explanation: Option<String>,
    pub reference_answer: Option<String>,
    pub rubric: Vec<String>,
    pub sentence_index: Option<i64>,
}

/// 校验后的题组（尚未入库）
#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedQuestionSet {
    pub questions: Vec<NewQuestion>,
    pub cloze_distractors: Vec<String>,
}

/// 句子里与 `word` 写法一致（忽略大小写）的那个词；没有返回 None
fn token_in_sentence<'a>(sentence: &'a str, word: &str) -> Option<&'a str> {
    words_of(sentence).find(|t| t.eq_ignore_ascii_case(word.trim()))
}

/// `submit_questions` 的参数 → 合格的题组。不合格的题目丢弃；各题型最多取 `spec` 的数量；一道都不剩时报错
pub fn questions_from_submission(
    details: &Value,
    sentences: &[PassageSentence],
    spec: &QuestionSetSpec,
) -> Result<GeneratedQuestionSet, String> {
    let list = |key: &str| -> Vec<Value> {
        details
            .get(key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let mut questions = Vec::new();

    // 选词填空：空位必须是该句里真实出现的词，同一个词只挖一次，同一句最多两个空
    let mut used_words: HashSet<String> = HashSet::new();
    let mut per_sentence: std::collections::HashMap<i64, usize> = Default::default();
    let mut cloze = Vec::new();
    for item in list("cloze") {
        if cloze.len() as i64 >= spec.cloze {
            break;
        }
        let Some(index) = item.get("sentence").and_then(Value::as_i64).map(|n| n - 1) else {
            continue;
        };
        let Some(sentence) = usize::try_from(index).ok().and_then(|i| sentences.get(i)) else {
            continue;
        };
        let Some(token) = token_in_sentence(&sentence.en, &text(&item, "word")) else {
            continue;
        };
        let count = per_sentence.entry(index).or_insert(0);
        if *count >= 2 || !used_words.insert(token.to_lowercase()) {
            continue;
        }
        *count += 1;
        cloze.push(NewQuestion {
            kind: "cloze".into(),
            stem: token.to_string(),
            options: Vec::new(),
            answer: Some(token.to_string()),
            explanation: opt_text(&item, "hint"),
            reference_answer: None,
            rubric: Vec::new(),
            sentence_index: Some(index),
        });
    }
    // 按原文顺序排列空位
    cloze.sort_by_key(|q| q.sentence_index);
    questions.extend(cloze);

    for q in list("choice").into_iter().take(spec.choice.max(0) as usize) {
        let options = strings(&q, "options");
        let distinct: HashSet<String> = options.iter().map(|o| o.to_lowercase()).collect();
        let answer = q.get("answer").and_then(Value::as_i64);
        let stem = text(&q, "stem");
        let valid = !stem.is_empty()
            && (3..=4).contains(&options.len())
            && distinct.len() == options.len()
            && answer.is_some_and(|a| a >= 0 && (a as usize) < options.len());
        if valid {
            questions.push(NewQuestion {
                kind: "choice".into(),
                stem,
                options,
                answer: answer.map(|a| a.to_string()),
                explanation: opt_text(&q, "explanation"),
                reference_answer: None,
                rubric: Vec::new(),
                sentence_index: None,
            });
        }
    }
    for q in list("true_false")
        .into_iter()
        .take(spec.true_false.max(0) as usize)
    {
        let stem = text(&q, "statement");
        if let (false, Some(answer)) = (stem.is_empty(), q.get("answer").and_then(Value::as_bool)) {
            questions.push(NewQuestion {
                kind: "true_false".into(),
                stem,
                options: Vec::new(),
                answer: Some(answer.to_string()),
                explanation: opt_text(&q, "explanation"),
                reference_answer: None,
                rubric: Vec::new(),
                sentence_index: None,
            });
        }
    }
    for q in list("open").into_iter().take(spec.open.max(0) as usize) {
        let stem = text(&q, "question");
        let rubric: Vec<String> = strings(&q, "rubric").into_iter().take(4).collect();
        let reference = opt_text(&q, "reference_answer");
        if !stem.is_empty() && reference.is_some() && !rubric.is_empty() {
            questions.push(NewQuestion {
                kind: "open".into(),
                stem,
                options: Vec::new(),
                answer: None,
                explanation: None,
                reference_answer: reference,
                rubric,
                sentence_index: None,
            });
        }
    }
    if questions.is_empty() {
        return Err("没有合格的题目".into());
    }
    let answers: HashSet<String> = used_words;
    let cloze_distractors = strings(details, "cloze_distractors")
        .into_iter()
        .filter(|d| !answers.contains(&d.to_lowercase()) && valid_extra_word(d))
        .take(3)
        .collect();
    Ok(GeneratedQuestionSet {
        questions,
        cloze_distractors,
    })
}

/// `submit_grade` 的参数 → 每道开放题的（得分, 评语, 改进示例），按题目顺序；缺的题为 None
pub fn grades_from_submission(
    details: &Value,
    count: usize,
) -> Vec<Option<(i64, String, Option<String>)>> {
    let grades = details
        .get("grades")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    (0..count)
        .map(|i| {
            let g = grades
                .iter()
                .find(|g| g.get("index").and_then(Value::as_i64) == Some(i as i64 + 1))?;
            let score = g
                .get("score")
                .and_then(Value::as_i64)?
                .clamp(0, OPEN_MAX_SCORE);
            let feedback = text(g, "feedback");
            (!feedback.is_empty()).then(|| (score, feedback, opt_text(g, "suggestion")))
        })
        .collect()
}

/// 选词填空的结果（按题目顺序）
pub fn grade_cloze_questions(
    questions: &[PassageQuestion],
    given: &dyn Fn(i64) -> String,
) -> Vec<ClozeResult> {
    questions
        .iter()
        .filter(|q| q.kind == "cloze")
        .map(|q| {
            let answer = q.answer.clone().unwrap_or_default();
            let value = given(q.id).trim().to_string();
            ClozeResult {
                question_id: q.id,
                correct: grade_cloze(&answer, &value),
                answer,
                given: value,
            }
        })
        .collect()
}

/// 常见不规则动词的变化形式（原形 → 过去式 / 过去分词），导入材料的重点词按原形给出时用来核对
const IRREGULAR_VERBS: &[(&str, &[&str])] = &[
    ("be", &["am", "is", "are", "was", "were", "been"]),
    ("become", &["became"]),
    ("begin", &["began", "begun"]),
    ("break", &["broke", "broken"]),
    ("bring", &["brought"]),
    ("build", &["built"]),
    ("buy", &["bought"]),
    ("catch", &["caught"]),
    ("choose", &["chose", "chosen"]),
    ("come", &["came"]),
    ("dig", &["dug"]),
    ("do", &["did", "done", "does"]),
    ("draw", &["drew", "drawn"]),
    ("drink", &["drank", "drunk"]),
    ("drive", &["drove", "driven"]),
    ("eat", &["ate", "eaten"]),
    ("fall", &["fell", "fallen"]),
    ("feed", &["fed"]),
    ("feel", &["felt"]),
    ("fight", &["fought"]),
    ("find", &["found"]),
    ("fly", &["flew", "flown", "flies"]),
    ("forget", &["forgot", "forgotten"]),
    ("freeze", &["froze", "frozen"]),
    ("get", &["got", "gotten"]),
    ("give", &["gave", "given"]),
    ("go", &["went", "gone", "goes"]),
    ("grow", &["grew", "grown"]),
    ("hang", &["hung"]),
    ("have", &["has", "had"]),
    ("hear", &["heard"]),
    ("hide", &["hid", "hidden"]),
    ("hold", &["held"]),
    ("keep", &["kept"]),
    ("know", &["knew", "known"]),
    ("lead", &["led"]),
    ("leave", &["left"]),
    ("lend", &["lent"]),
    ("lie", &["lay", "lain"]),
    ("lose", &["lost"]),
    ("make", &["made"]),
    ("mean", &["meant"]),
    ("meet", &["met"]),
    ("pay", &["paid"]),
    ("ride", &["rode", "ridden"]),
    ("ring", &["rang", "rung"]),
    ("rise", &["rose", "risen"]),
    ("run", &["ran"]),
    ("say", &["said"]),
    ("see", &["saw", "seen"]),
    ("sell", &["sold"]),
    ("send", &["sent"]),
    ("shake", &["shook", "shaken"]),
    ("shine", &["shone"]),
    ("shoot", &["shot"]),
    ("sing", &["sang", "sung"]),
    ("sink", &["sank", "sunk"]),
    ("sit", &["sat"]),
    ("sleep", &["slept"]),
    ("slide", &["slid"]),
    ("speak", &["spoke", "spoken"]),
    ("spend", &["spent"]),
    ("stand", &["stood"]),
    ("steal", &["stole", "stolen"]),
    ("stick", &["stuck"]),
    ("sting", &["stung"]),
    ("swim", &["swam", "swum"]),
    ("swing", &["swung"]),
    ("take", &["took", "taken"]),
    ("teach", &["taught"]),
    ("tear", &["tore", "torn"]),
    ("tell", &["told"]),
    ("think", &["thought"]),
    ("throw", &["threw", "thrown"]),
    ("understand", &["understood"]),
    ("wake", &["woke", "woken"]),
    ("wear", &["wore", "worn"]),
    ("weep", &["wept"]),
    ("win", &["won"]),
    ("write", &["wrote", "written"]),
];

/// 文本里是否出现了某个词：含规则屈折形式与常见不规则动词变化
fn text_uses_any_form(text: &str, word: &str) -> bool {
    if text_uses(text, word) {
        return true;
    }
    let lower = word.to_lowercase();
    IRREGULAR_VERBS
        .iter()
        .find(|(base, _)| *base == lower)
        .is_some_and(|(_, forms)| {
            words_of(text).any(|t| forms.iter().any(|f| t.eq_ignore_ascii_case(f)))
        })
}

/// 导入材料的翻译结果（英文原文不经模型，以导入请求的句子为准）
#[derive(Debug, Clone, PartialEq)]
pub struct Translation {
    /// 与原文逐句对应
    pub zh: Vec<String>,
    pub title: String,
    pub level: String,
    /// （原形, 中文意思）：在原文里出现过、去重，最多 MAX_KEY_WORDS 个
    pub key_words: Vec<(String, String)>,
}

/// `submit_translation` 的参数 → 校正后的翻译：每句都要有译文；水平夹到 a1–b2；
/// 重点词只留原文里真的出现的（含屈折形式），去重
pub fn translation_from_submission(
    details: &Value,
    sentences: &[String],
    key_words: bool,
) -> Result<Translation, String> {
    let mut zh = vec![String::new(); sentences.len()];
    for item in details
        .get("translations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let index = item.get("index").and_then(Value::as_i64).unwrap_or(0);
        if index >= 1 && (index as usize) <= sentences.len() {
            zh[index as usize - 1] = text(item, "zh");
        }
    }
    if let Some(missing) = zh.iter().position(|t| t.is_empty()) {
        return Err(format!("第 {} 句没有译文", missing + 1));
    }
    let level = text(details, "level").to_lowercase();
    let level = if ["a1", "a2", "b1", "b2"].contains(&level.as_str()) {
        level
    } else {
        "b2".to_string()
    };
    let full = sentences.join(" ");
    let mut words: Vec<(String, String)> = Vec::new();
    if key_words {
        for item in details
            .get("key_words")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let word = text(item, "word");
            let meaning = text(item, "meaning");
            let valid = !word.is_empty()
                && word
                    .chars()
                    .all(|c| c.is_ascii_alphabetic() || c == '\'' || c == '-')
                && text_uses_any_form(&full, &word)
                && !words.iter().any(|(w, _)| w.eq_ignore_ascii_case(&word));
            if valid && words.len() < MAX_KEY_WORDS {
                words.push((word, meaning));
            }
        }
    }
    Ok(Translation {
        zh,
        title: text(details, "title"),
        level,
        key_words: words,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::common::Id;
    use serde_json::json;

    #[test]
    fn translation_keeps_order_clamps_level_and_filters_key_words() {
        let sentences = vec![
            "Tom ran home.".to_string(),
            "His cat was hungry.".to_string(),
        ];
        let details = json!({
            "translations": [{"index": 2, "zh": "他的猫饿了。"}, {"index": 1, "zh": "汤姆跑回家。"}],
            "title": "Tom",
            "level": "C1",
            "key_words": [
                {"word": "run", "meaning": "跑"},
                {"word": "hungry", "meaning": "饿的"},
                {"word": "Hungry", "meaning": "重复"},
                {"word": "dog", "meaning": "不在原文"}
            ]
        });
        let t = translation_from_submission(&details, &sentences, true).unwrap();
        assert_eq!(t.zh, vec!["汤姆跑回家。", "他的猫饿了。"]);
        assert_eq!(t.level, "b2");
        assert_eq!(
            t.key_words
                .iter()
                .map(|(w, _)| w.as_str())
                .collect::<Vec<_>>(),
            ["run", "hungry"]
        );
        // 不要求重点词时忽略
        assert!(translation_from_submission(&details, &sentences, false)
            .unwrap()
            .key_words
            .is_empty());
        // 缺一句：不合格
        let missing = json!({"translations": [{"index": 1, "zh": "汤姆跑回家。"}], "title": "T", "level": "a1"});
        assert!(translation_from_submission(&missing, &sentences, false).is_err());
    }

    fn target(id: Id, word: &str) -> PassageTargetWord {
        PassageTargetWord {
            word_id: Some(id),
            word: word.into(),
            required: false,
            meaning: None,
        }
    }

    fn spec(cloze: i64, choice: i64, true_false: i64, open: i64) -> QuestionSetSpec {
        QuestionSetSpec {
            cloze,
            choice,
            true_false,
            open,
            difficulty: "standard".into(),
        }
    }

    fn sentences() -> Vec<PassageSentence> {
        [
            "Tom has his passport and two tickets.",
            "He walks to customs with his luggage.",
            "The officer looks at his passport and smiles at him.",
            "Then Tom finds his gate and waits for the plane with his family.",
        ]
        .iter()
        .map(|en| PassageSentence {
            en: en.to_string(),
            zh: "中文".into(),
            paragraph: false,
            start_ms: None,
            end_ms: None,
        })
        .collect()
    }

    #[test]
    fn inflections_match_common_forms_only() {
        for (t, w) in [
            ("tickets", "ticket"),
            ("boxes", "box"),
            ("making", "make"),
            ("carried", "carry"),
            ("stopped", "stop"),
            ("Passport", "passport"),
            ("bigger", "big"),
        ] {
            assert!(inflection_matches(t, w), "{t} ~ {w}");
        }
        for (t, w) in [
            ("cat", "car"),
            ("gates", "gatekeeper"),
            ("pass", "passport"),
        ] {
            assert!(!inflection_matches(t, w), "{t} !~ {w}");
        }
    }

    #[test]
    fn spec_validation() {
        assert!(validate_spec(&spec(5, 3, 2, 1)).is_ok());
        assert!(validate_spec(&spec(0, 0, 0, 0)).is_err());
        assert!(validate_spec(&spec(11, 0, 0, 0)).is_err());
        let mut s = spec(1, 0, 0, 0);
        s.difficulty = "hard".into();
        assert!(validate_spec(&s).is_err());
    }

    #[test]
    fn cloze_bank_is_answers_plus_distractors_and_stable() {
        let answers = vec!["passport".to_string(), "gate".to_string()];
        let bank = cloze_bank(&answers, &["Gate".into(), "visa".into()], 7);
        assert_eq!(bank.len(), 3);
        assert!(bank.contains(&"visa".to_string()));
        assert_eq!(
            bank,
            cloze_bank(&answers, &["Gate".into(), "visa".into()], 7)
        );
    }

    #[test]
    fn grading_is_case_insensitive() {
        assert!(grade_cloze("Passport", " passport "));
        assert!(!grade_cloze("gate", ""));
        let q = PassageQuestion {
            id: 1,
            kind: "true_false".into(),
            stem: "s".into(),
            options: vec![],
            answer: Some("false".into()),
            explanation: None,
            reference_answer: None,
            rubric: vec![],
            sentence_index: None,
        };
        assert_eq!(grade_objective(&q, "False"), Some(true));
        assert_eq!(grade_objective(&q, "true"), Some(false));
        let open = PassageQuestion {
            kind: "open".into(),
            ..q
        };
        assert_eq!(grade_objective(&open, "anything"), None);
    }

    #[test]
    fn pick_statuses_and_preferences() {
        let st = |level, wrong| learning_statuses(level, wrong);
        assert_eq!(st(0, 0), vec!["new"]);
        assert_eq!(st(2, 1), vec!["learning", "wrong"]);
        assert_eq!(st(5, 0), vec!["mastered"]);
        let filter = |f: &[&str]| f.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(in_pick_statuses(&[], &st(0, 0)));
        assert!(in_pick_statuses(&filter(&["wrong", "new"]), &st(3, 2)));
        assert!(!in_pick_statuses(&filter(&["learning"]), &st(4, 0)));
        assert_eq!(pick_preferences(None, None), "");
        assert_eq!(
            pick_preferences(Some("easy"), Some("common")),
            "挑词偏好：挑对这位学习者来说偏简单的词；优先日常生活中常用的高频词。"
        );
    }

    #[test]
    fn plan_word_tags_and_scopes() {
        let d = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        let today = d("2026-10-07");
        let tags = |srs_box, wrong, first: Option<&str>, due: Option<&str>| {
            word_tags(srs_box, wrong, first.map(d), due.map(d), today)
        };
        assert_eq!(
            tags(1, 1, Some("2026-10-07"), Some("2026-10-08")),
            vec!["wrong", "weak", "recent", "upcoming"]
        );
        assert_eq!(
            tags(3, 0, Some("2026-09-30"), Some("2026-10-11")),
            Vec::<String>::new()
        );
        assert_eq!(
            tags(3, 0, Some("2026-10-01"), Some("2026-10-10")),
            vec!["recent", "upcoming"]
        );
        assert_eq!(
            tags(5, 0, None, Some("2026-10-02")),
            vec!["upcoming", "mastered"]
        );
        let scopes = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let t = scopes(&["weak"]);
        assert!(in_plan_scopes(&scopes(&["wrong", "weak"]), &t));
        assert!(!in_plan_scopes(&scopes(&["wrong", "mastered"]), &t));
        assert!(in_plan_scopes(&scopes(&["learned"]), &[]));
        assert!(in_plan_scopes(&[], &[]));
    }

    #[test]
    fn extra_words_are_single_english_words() {
        assert!(
            valid_extra_word("check-in") && valid_extra_word("don't") && valid_extra_word(" Visa ")
        );
        assert!(
            !valid_extra_word("a") && !valid_extra_word("海关") && !valid_extra_word("two words")
        );
    }

    fn passage_submission() -> Value {
        json!({
            "title": "At the Airport",
            "sentences": sentences().iter().map(|s| json!({"en": s.en, "zh": s.zh})).collect::<Vec<_>>(),
            "chosen_words": ["gate", "luggage", "visa", "Gate", "customs"]
        })
    }

    #[test]
    fn passage_requires_all_required_words_and_keeps_only_used_pool_picks() {
        let required = vec![target(1, "passport"), target(2, "ticket")];
        let pool = vec![
            target(3, "gate"),
            target(4, "luggage"),
            target(5, "visa"),
            target(6, "customs"),
        ];
        let p = passage_from_submission(&passage_submission(), &required, &pool, 2).unwrap();
        let words: Vec<(&str, bool)> = p
            .target_words
            .iter()
            .map(|w| (w.word.as_str(), w.required))
            .collect();
        // visa 不在正文里；Gate 重复；最多挑 2 个
        assert_eq!(
            words,
            vec![
                ("passport", true),
                ("ticket", true),
                ("gate", false),
                ("luggage", false)
            ]
        );
        assert!(p.word_count >= 30);

        let missing = vec![target(1, "passport"), target(9, "hotel")];
        assert!(
            passage_from_submission(&passage_submission(), &missing, &pool, 2)
                .unwrap_err()
                .contains("hotel")
        );
        let mut no_title = passage_submission();
        no_title["title"] = json!("");
        assert!(passage_from_submission(&no_title, &required, &pool, 2).is_err());
    }

    #[test]
    fn questions_keep_valid_cloze_in_text_order_and_cap_counts() {
        let details = json!({
            "cloze": [
                {"sentence": 2, "word": "customs", "hint": "海关"},
                {"sentence": 1, "word": "passport"},
                {"sentence": 3, "word": "passport"},
                {"sentence": 1, "word": "hotel"},
                {"sentence": 9, "word": "gate"},
                {"sentence": 4, "word": "gate"}
            ],
            "cloze_distractors": ["visa", "customs", "two words", "hotel"],
            "choice": [
                {"stem": "What does Tom show?", "options": ["his ticket", "his passport", "his bag"], "answer": 1, "explanation": "第三句"},
                {"stem": "Bad", "options": ["a", "a", "b"], "answer": 0},
                {"stem": "Extra", "options": ["a", "b", "c"], "answer": 0}
            ],
            "true_false": [{"statement": "Tom has three tickets.", "answer": false, "explanation": "两张"}],
            "open": [{"question": "Where would you like to fly?", "reference_answer": "I want to fly to Paris.", "rubric": ["说出地点"]}]
        });
        let set = questions_from_submission(&details, &sentences(), &spec(3, 2, 2, 1)).unwrap();
        let cloze: Vec<(String, Option<i64>)> = set
            .questions
            .iter()
            .filter(|q| q.kind == "cloze")
            .map(|q| (q.stem.clone(), q.sentence_index))
            .collect();
        // 同词只挖一次、不在句中的词与越界句子丢弃、按原文顺序
        assert_eq!(
            cloze,
            vec![
                ("passport".to_string(), Some(0)),
                ("customs".to_string(), Some(1)),
                ("gate".to_string(), Some(3))
            ]
        );
        assert_eq!(
            set.questions.iter().filter(|q| q.kind == "choice").count(),
            1
        );
        assert_eq!(
            set.questions
                .iter()
                .filter(|q| q.kind == "true_false")
                .count(),
            1
        );
        assert_eq!(set.questions.iter().filter(|q| q.kind == "open").count(), 1);
        assert_eq!(set.cloze_distractors, vec!["visa", "hotel"]);
        assert!(questions_from_submission(&json!({}), &sentences(), &spec(3, 0, 0, 0)).is_err());
    }

    #[test]
    fn plan_keeps_known_words_once_and_fills_missing_required() {
        let mut required = vec![
            target(1, "passport"),
            target(2, "customs"),
            target(3, "hotel"),
        ];
        for r in &mut required {
            r.required = true;
        }
        let pool = vec![target(10, "gate"), target(11, "map"), target(12, "menu")];
        let details = json!({
            "note": "两个场景，拆成两篇更自然",
            "passages": [
                {"title": "At the Airport", "length": "short",
                 "outline": {"goal": "Tom 去机场", "problem": "护照找不到", "turn": "妈妈找到了", "ending": "顺利登机"},
                 "words": ["passport", "customs", "gate", "apple", "Passport"]},
                {"title": "The Hotel", "length": "weird",
                 "outline": {"goal": "入住酒店", "problem": "房间搞错了", "turn": "前台换房", "ending": "睡个好觉"},
                 "words": ["map", "menu"]},
                {"title": "Empty", "outline": {"goal": "x"}, "words": []}
            ]
        });
        let plan = plan_from_submission(&details, &required, &pool, 2).unwrap();
        assert_eq!(plan.note, "两个场景，拆成两篇更自然");
        assert_eq!(plan.items.len(), 2);
        let words = |i: usize| {
            plan.items[i]
                .words
                .iter()
                .map(|w| (w.word.as_str(), w.required))
                .collect::<Vec<_>>()
        };
        // apple 不在来源里；Passport 重复；AI 最多挑 2 个（gate、map），menu 被丢弃；漏掉的 hotel 补进词最少的第 2 篇
        assert_eq!(
            words(0),
            vec![("passport", true), ("customs", true), ("gate", false)]
        );
        assert_eq!(words(1), vec![("map", false), ("hotel", true)]);
        assert_eq!(plan.items[0].length, "short");
        assert_eq!(plan.items[1].length, "standard");
        assert!(plan.items[0]
            .idea
            .starts_with("主角与目标：Tom 去机场\n麻烦或意外：护照找不到"));
        assert!(plan_from_submission(&json!({"passages": []}), &required, &pool, 0).is_err());
    }

    #[test]
    fn grades_are_matched_by_index_and_clamped() {
        let details = json!({"grades": [
            {"index": 2, "score": 9, "feedback": "很好", "suggestion": "Try ..."},
            {"index": 1, "score": 2, "feedback": "说出了地点"}
        ]});
        let grades = grades_from_submission(&details, 3);
        assert_eq!(grades[0], Some((2, "说出了地点".into(), None)));
        assert_eq!(grades[1], Some((4, "很好".into(), Some("Try ...".into()))));
        assert_eq!(grades[2], None);
    }
}
