use crate::types::wordbook::WordExample;
use serde::{Deserialize, Serialize};

/// 单词的自然拼读分析结果（agent `submit_phonics` 校正后的结构；字段为 snake_case 输出）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PhonicsWord {
    pub word: String,
    pub frequency: i32,
    pub chinese_translation: String,
    pub pos_abbreviation: String,
    pub pos_english: String,
    pub pos_chinese: String,
    pub ipa: String,
    pub syllables: String,
    pub phonics_rule: String,
    pub analysis_explanation: String,
    /// 例句（工具已校验：至少 5 条、每条包含该单词；第一句最简单）
    #[serde(default)]
    pub examples: Vec<WordExample>,
}

/// 提取的单词信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedWord {
    pub word: String,                   // 单词原文
    pub frequency: i32,                 // 出现频率
    pub part_of_speech: Option<String>, // 词性缩写（如 "n.", "v.", "adj." 等）
    pub meaning: Option<String>,        // 中文翻译
}

/// 单词提取结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordExtractionResult {
    pub words: Vec<ExtractedWord>,
    pub total_count: usize,
    pub unique_count: usize,
}

/// 「分析并加入单词本」任务的请求（start_word_analysis）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartWordAnalysisRequest {
    pub book_id: i64,
    pub words: Vec<String>,
    /// 生成 / 提取时定好的释义，与 words 一一对应（空字符串表示没有）
    pub meanings: Option<Vec<String>>,
    pub model_id: Option<i64>,
}

/// 单个单词的分析状态（任务 detail 与结果里用）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WordAnalysisStatus {
    pub word: String,
    /// pending / analyzing / completed / failed
    pub status: String,
    /// 失败原因
    pub error: Option<String>,
}

/// 任务运行中的细节（job.detail）：逐词状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordAnalysisDetail {
    pub words: Vec<WordAnalysisStatus>,
}

/// 任务结果（job.result）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordAnalysisOutcome {
    pub book_id: i64,
    pub added_count: i32,
    pub updated_count: i32,
    /// 没有分析成功的词（含停止时还没轮到的），可以再提交一次
    pub failed: Vec<WordAnalysisStatus>,
}

/// AI / 用户给出的词性（noun、N.、adj 等）归一为标准缩写；无法识别时为 `n.`（同前端 utils/partOfSpeech.ts）
pub fn standard_pos(raw: &str) -> &'static str {
    match raw.to_lowercase().replace('.', "").trim() {
        "v" | "verb" | "verbs" => "v.",
        "adj" | "adjective" | "adjectives" => "adj.",
        "adv" | "adverb" | "adverbs" => "adv.",
        "prep" | "preposition" | "prepositions" => "prep.",
        "conj" | "conjunction" | "conjunctions" => "conj.",
        "int" | "interjection" | "interjections" => "int.",
        "pron" | "pronoun" | "pronouns" => "pron.",
        "art" | "article" | "articles" => "art.",
        "det" | "determiner" | "determiners" => "det.",
        "num" | "numeral" | "numerals" | "number" => "num.",
        _ => "n.",
    }
}

impl PhonicsWord {
    /// 转成保存到单词本的形状（释义用分析结果；词性归一）
    pub fn to_analyzed(&self) -> crate::types::wordbook::AnalyzedWord {
        let pos = standard_pos(&self.pos_abbreviation).to_string();
        crate::types::wordbook::AnalyzedWord {
            word: self.word.clone(),
            meaning: self.chinese_translation.clone(),
            part_of_speech: Some(pos.clone()),
            ipa: Some(self.ipa.clone()),
            syllables: Some(self.syllables.clone()),
            pos_abbreviation: Some(pos),
            pos_english: Some(self.pos_english.clone()),
            pos_chinese: Some(self.pos_chinese.clone()),
            phonics_rule: Some(self.phonics_rule.clone()),
            analysis_explanation: Some(self.analysis_explanation.clone()),
            examples: Some(self.examples.clone()),
            word_frequency: Some(self.frequency),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_pos_normalizes_aliases() {
        assert_eq!(standard_pos("Noun"), "n.");
        assert_eq!(standard_pos("ADJ."), "adj.");
        assert_eq!(standard_pos("verbs"), "v.");
        assert_eq!(standard_pos("number"), "num.");
        assert_eq!(standard_pos(""), "n.");
        assert_eq!(standard_pos("whatever"), "n.");
    }
}
