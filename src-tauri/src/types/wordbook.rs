use serde::{Deserialize, Serialize};
use super::{Id, Timestamp};

/// 主题标签
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeTag {
    pub id: Id,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub created_at: Timestamp,
}

/// 单词本
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
    pub theme_tags: Option<Vec<ThemeTag>>,
}

/// 创建单词本请求
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWordBookRequest {
    pub title: String,
    pub description: String,
    pub icon: String,
    pub icon_color: String,
    pub theme_tag_ids: Option<Vec<Id>>,
}

/// 更新单词本请求
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateWordBookRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub icon_color: Option<String>,
    pub status: Option<String>,
    pub theme_tag_ids: Option<Vec<Id>>,
}

/// 单词本查询参数
#[derive(Debug, Serialize, Deserialize)]
pub struct WordBookQuery {
    pub keyword: Option<String>,
    pub icon_color: Option<String>,
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
}

/// 更新单词请求
#[derive(Debug, Serialize, Deserialize)]
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
}

/// 单词查询参数
#[derive(Debug, Serialize, Deserialize)]
pub struct WordQuery {
    pub keyword: Option<String>,
    pub difficulty_level: Option<i32>,
    pub category_id: Option<Id>,
    pub part_of_speech: Option<String>,
}

/// 单词分类
#[derive(Debug, Serialize, Deserialize)]
pub struct Category {
    pub id: Id,
    pub name: String,
    pub description: Option<String>,
    pub color: String,
    pub icon: String,
    pub word_count: i32,
    pub created_at: Timestamp,
}

/// 单词本统计
#[derive(Debug, Serialize, Deserialize)]
pub struct WordBookStatistics {
    pub total_books: i32,
    pub total_words: i32,
    pub word_types: WordTypeDistribution,
}

/// 单词类型分布
#[derive(Debug, Serialize, Deserialize)]
pub struct WordTypeDistribution {
    pub nouns: i32,
    pub verbs: i32,
    pub adjectives: i32,
    pub others: i32,
}

/// 批量导入单词请求
#[derive(Debug, Serialize, Deserialize)]
pub struct ImportWordsRequest {
    pub book_id: Id,
    pub words: Vec<CreateWordRequest>,
    pub overwrite_existing: bool,
}

/// AI分析的单词信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnalyzedWord {
    pub word: String,
    pub meaning: String,
    pub part_of_speech: Option<String>,
    pub example_sentence: Option<String>,
    // 新增自然拼读分析字段
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    pub pos_abbreviation: Option<String>,
    pub pos_english: Option<String>,
    pub pos_chinese: Option<String>,
    pub phonics_rule: Option<String>,
    pub analysis_explanation: Option<String>,
    pub word_frequency: Option<i32>,
}

/// 从分析结果创建单词本的请求
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWordBookFromAnalysisRequest {
    pub title: String,
    pub description: String,
    pub icon: Option<String>,
    pub icon_color: Option<String>,
    pub words: Vec<AnalyzedWord>,
    pub status: Option<String>,
    pub book_id: Option<Id>, // 如果提供，则向现有单词本添加单词；否则创建新单词本
    pub theme_tag_ids: Option<Vec<Id>>, // 主题标签ID列表
}
