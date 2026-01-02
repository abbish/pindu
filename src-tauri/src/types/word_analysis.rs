use serde::{Deserialize, Serialize};
use crate::ai_service::PhonicsWord;

/// 提取的单词信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedWord {
    pub word: String,           // 单词原文
    pub frequency: i32,         // 出现频率
}

/// 单词提取结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordExtractionResult {
    pub words: Vec<ExtractedWord>,
    pub total_count: usize,
    pub unique_count: usize,
}

/// 批量分析进度
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAnalysisProgress {
    pub status: String,                    // "extracting", "analyzing", "completed", "error"
    pub current_step: String,                // 当前步骤描述
    pub extraction_progress: Option<ExtractionProgress>,
    pub analysis_progress: Option<AnalysisProgress>,
    pub word_statuses: Option<Vec<WordAnalysisStatus>>,  // 单词状态列表
}

/// 提取进度
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionProgress {
    pub total_words: usize,                 // 总单词数
    pub extracted_words: usize,              // 已提取单词数
    pub elapsed_seconds: f64,                // 已用时间
}

/// 分析进度（细化）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProgress {
    pub total_words: usize,                 // 总单词数
    pub completed_words: usize,              // 已完成单词数
    pub failed_words: usize,                 // 失败单词数
    pub current_word: Option<String>,          // 当前正在分析的单词
    pub batch_info: BatchInfo,               // 批次信息
    pub elapsed_seconds: f64,                // 已用时间
}

/// 批次信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchInfo {
    pub total_batches: usize,                 // 总批次数
    pub completed_batches: usize,              // 已完成批次数
    pub current_batch: usize,                 // 当前批次（从 0 开始）
    pub batch_size: usize,                   // 每批单词数
}

/// 单词分析状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordAnalysisStatus {
    pub word: String,                       // 单词
    pub status: String,                      // "pending", "analyzing", "completed", "failed"
    pub error: Option<String>,               // 错误信息（如果失败）
    pub result: Option<PhonicsWord>,        // 分析结果（如果完成）
}

/// 批量分析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAnalysisResult {
    pub words: Vec<PhonicsWord>,
    pub total_words: usize,
    pub completed_words: usize,
    pub failed_words: usize,
    pub elapsed_seconds: f64,
}

/// 批量分析配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAnalysisConfig {
    pub batch_size: usize,              // 每批单词数（默认 10，范围 5-20）
    pub max_concurrent_batches: usize,    // 最大并发批次数（默认 3，范围 1-5）
    pub retry_failed_words: bool,         // 是否重试失败的单词（默认 true）
    pub max_retries: usize,              // 最大重试次数（默认 2）
    pub timeout_per_batch: u64,           // 每批超时时间（默认 60 秒）
}

impl Default for BatchAnalysisConfig {
    fn default() -> Self {
        Self {
            batch_size: 10,
            max_concurrent_batches:3,
            retry_failed_words: true,
            max_retries: 2,
            timeout_per_batch: 60,
        }
    }
}

/// 批次开始事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStartEvent {
    pub batch_index: usize,
    pub total_batches: usize,
    pub words: Vec<String>,
}

/// 单词状态更新事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordStatusUpdateEvent {
    pub word: String,
    pub status: String,
    pub error: Option<String>,
}

/// 批次完成事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCompleteEvent {
    pub batch_index: usize,
    pub completed_words: usize,
    pub failed_words: usize,
}

/// 分析完成事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisCompleteEvent {
    pub total_words: usize,
    pub completed_words: usize,
    pub failed_words: usize,
    pub elapsed_seconds: f64,
}

/// 分析错误事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisErrorEvent {
    pub message: String,
}
