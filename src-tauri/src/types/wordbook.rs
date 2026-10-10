use super::material::Tag;
use super::{Id, Timestamp};
use serde::{Deserialize, Serialize};

/// 词汇本
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WordBook {
    pub id: Id,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub icon_color: String,
    pub total_words: i32,
    pub linked_plans: i32,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub last_used: Timestamp,
    pub deleted_at: Option<Timestamp>,
    pub status: String,
    /// 标签（迁移 060 起由「主题」改为素材共用标签）
    #[serde(default)]
    pub tags: Vec<Tag>,
    /// 词性分布（词汇本列表一次查询带出，免得前端逐本请求统计）
    #[serde(default)]
    pub word_types: Option<WordTypeDistribution>,
}

/// 创建词汇本请求
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWordBookRequest {
    pub title: String,
    pub description: String,
    pub icon: String,
    pub icon_color: String,
    pub tag_ids: Option<Vec<Id>>,
}

/// 更新词汇本请求
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateWordBookRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub icon_color: Option<String>,
    pub status: Option<String>,
    pub tag_ids: Option<Vec<Id>>,
}

/// 单词例句
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct WordExample {
    /// 英文例句
    pub sentence: String,
    /// 中文翻译
    pub translation: String,
}

/// AI 老师对话中的一条消息
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ChatTurn {
    /// student / teacher
    pub role: String,
    pub content: String,
}

/// 向 AI 老师提问（命令参数）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordTutorRequest {
    pub word_id: Id,
    /// 之前的对话（按时间顺序）
    #[serde(default)]
    pub history: Vec<ChatTurn>,
    /// 本次问题
    pub question: String,
    /// 流式增量事件用于区分请求
    pub request_id: String,
    #[serde(default)]
    pub model_id: Option<Id>,
    /// 学习者正在看的讲解（讲解不落库，由前端带上）
    #[serde(default)]
    pub explanation: Option<String>,
    /// 不在词汇本的目标词：按单词卡答疑（此时 word_id 为 0）
    #[serde(default)]
    pub card_word: Option<String>,
    /// 围绕短文里的一句答疑（此时 word_id 为 0、card_word 为空）
    #[serde(default)]
    pub sentence: Option<crate::types::passage::SentenceRef>,
}

/// 单词讲解（agent 实时生成的 Markdown，不落库）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WordExplanation {
    pub word_id: Id,
    /// Markdown 正文
    pub content: String,
    /// 推荐追问（模型没给时为空）
    pub follow_ups: Vec<String>,
    /// 生成所用模型
    pub model_name: Option<String>,
    /// 生成时间
    pub generated_at: String,
}

/// AI 老师的回答
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TutorReply {
    /// Markdown 正文
    pub content: String,
    /// 结合这次对话推荐的追问（模型没给时为空）
    pub follow_ups: Vec<String>,
}

/// 词汇条目的类型：带空格的是词组（phrase），其余是单词（word）
pub fn vocab_kind(text: &str) -> &'static str {
    if text.trim().contains(char::is_whitespace) {
        "phrase"
    } else {
        "word"
    }
}

/// 词汇文本归一：去首尾空白、连续空白合成一个空格（"give  up" 与 "give up" 是同一条）
pub fn normalize_vocab(text: &str) -> String {
    text.replace(['\u{2019}', '\u{2018}'], "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn default_vocab_kind() -> String {
    "word".to_string()
}

/// 单词
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Word {
    pub id: Id,
    pub word: String,
    pub meaning: String,
    pub description: Option<String>,
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    pub phonics_segments: Option<String>,
    pub image_path: Option<String>,
    pub audio_path: Option<String>,
    pub part_of_speech: Option<String>,
    pub category_id: Option<Id>,
    pub word_book_id: Option<Id>,
    // 新增自然拼读分析字段
    pub pos_abbreviation: Option<String>,
    pub pos_english: Option<String>,
    pub pos_chinese: Option<String>,
    pub phonics_rule: Option<String>,
    pub analysis_explanation: Option<String>,
    /// 例句（按顺序，第一句最简单；拼读分析时生成，可朗读）
    #[serde(default)]
    pub examples: Vec<WordExample>,
    /// word 单词 / phrase 词组（带空格的是词组，写入时由内容决定，D45）
    #[serde(default = "default_vocab_kind")]
    pub kind: String,
    /// 词组类型：phrasal_verb / collocation / idiom / fixed（AI 分析给出；单词为空）
    #[serde(default)]
    pub phrase_type: Option<String>,
    /// 短语动词能否拆开用（pick it up）
    #[serde(default)]
    pub separable: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// 创建单词请求
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWordRequest {
    pub word: String,
    pub meaning: String,
    pub description: Option<String>,
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    pub phonics_segments: Option<String>,
    pub part_of_speech: Option<String>,
    pub category_id: Option<Id>,
    // 新增自然拼读分析字段
    pub pos_abbreviation: Option<String>,
    pub pos_english: Option<String>,
    pub pos_chinese: Option<String>,
    pub phonics_rule: Option<String>,
    pub analysis_explanation: Option<String>,
    /// 例句（None = 不修改）
    pub examples: Option<Vec<WordExample>>,
    /// 词组类型：phrasal_verb / collocation / idiom / fixed（单词忽略）
    #[serde(default)]
    pub phrase_type: Option<String>,
    /// 短语动词能否拆开用（单词忽略）
    #[serde(default)]
    pub separable: Option<bool>,
}

/// 更新单词请求
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct UpdateWordRequest {
    pub word: Option<String>,
    pub meaning: Option<String>,
    pub description: Option<String>,
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    pub phonics_segments: Option<String>,
    pub part_of_speech: Option<String>,
    pub category_id: Option<Id>,
    // 新增自然拼读分析字段
    pub pos_abbreviation: Option<String>,
    pub pos_english: Option<String>,
    pub pos_chinese: Option<String>,
    pub phonics_rule: Option<String>,
    pub analysis_explanation: Option<String>,
    /// 例句（None = 不修改；传入则整体替换）
    pub examples: Option<Vec<WordExample>>,
    /// 词组类型（None = 不修改；空字符串清除）；改成单词时自动清除
    #[serde(default)]
    pub phrase_type: Option<String>,
    /// 短语动词能否拆开用（None = 不修改）
    #[serde(default)]
    pub separable: Option<bool>,
}

/// 词汇本统计
#[derive(Debug, Serialize, Deserialize)]
pub struct WordBookStatistics {
    pub total_books: i32,
    pub total_words: i32,
    pub word_types: WordTypeDistribution,
}

/// 单词类型分布
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct WordTypeDistribution {
    pub nouns: i32,
    pub verbs: i32,
    pub adjectives: i32,
    pub others: i32,
}

impl WordTypeDistribution {
    /// 按词性累加（所有词性统计共用这一套归类）。
    /// 取第一个词性（如 "n./v." 记为名词），去掉末尾的点后精确匹配：
    /// n / noun → 名词；v / vt / vi / verb → 动词；adj / a / adjective → 形容词；其余（adv、prep、num 等）及空值 → 其他。
    pub fn add(&mut self, pos: Option<&str>, count: i32) {
        let first = pos
            .unwrap_or("")
            .trim()
            .to_lowercase()
            .split(|c: char| c == '/' || c == ',' || c == ';' || c == '&' || c.is_whitespace())
            .find(|t| !t.is_empty())
            .unwrap_or("")
            .trim_end_matches('.')
            .to_string();
        match first.as_str() {
            "n" | "noun" | "nouns" | "名词" => self.nouns += count,
            "v" | "vt" | "vi" | "verb" | "verbs" | "动词" => self.verbs += count,
            "adj" | "a" | "adjective" | "adjectives" | "形容词" => self.adjectives += count,
            _ => self.others += count,
        }
    }
}

/// AI分析的单词信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnalyzedWord {
    pub word: String,
    pub meaning: String,
    pub part_of_speech: Option<String>,
    // 新增自然拼读分析字段
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    pub pos_abbreviation: Option<String>,
    pub pos_english: Option<String>,
    pub pos_chinese: Option<String>,
    pub phonics_rule: Option<String>,
    pub analysis_explanation: Option<String>,
    /// 例句（分析结果，至少 5 条）
    pub examples: Option<Vec<WordExample>>,
    pub word_frequency: Option<i32>,
    /// 词组类型（单词为空）
    #[serde(default)]
    pub phrase_type: Option<String>,
    /// 短语动词能否拆开用
    #[serde(default)]
    pub separable: bool,
}

/// 从分析结果创建词汇本的请求
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWordBookFromAnalysisRequest {
    pub title: String,
    pub description: String,
    pub icon: Option<String>,
    pub icon_color: Option<String>,
    pub words: Vec<AnalyzedWord>,
    pub status: Option<String>,
    pub book_id: Option<Id>, // 如果提供，则向现有词汇本添加单词；否则创建新词汇本
    pub tag_ids: Option<Vec<Id>>,
}

#[cfg(test)]
mod vocab_tests {
    use super::*;

    #[test]
    fn phrases_are_detected_and_normalized() {
        assert_eq!(vocab_kind("apple"), "word");
        assert_eq!(vocab_kind(" give  up "), "phrase");
        assert_eq!(normalize_vocab("  give \t up "), "give up");
        assert_eq!(normalize_vocab("well-known"), "well-known");
    }
}
