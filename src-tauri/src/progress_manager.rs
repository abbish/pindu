use crate::types::word_analysis::{
    AnalysisProgress, BatchAnalysisProgress, ExtractionProgress, WordAnalysisStatus,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// 增强的进度管理器
pub struct EnhancedProgressManager {
    extraction_progress: Arc<Mutex<Option<ExtractionProgress>>>,
    analysis_progress: Arc<Mutex<Option<AnalysisProgress>>>,
    word_statuses: Arc<Mutex<HashMap<String, WordAnalysisStatus>>>,
    cancelled: Arc<Mutex<bool>>,
}

// 全局进度管理器实例
static GLOBAL_ENHANCED_PROGRESS_MANAGER: std::sync::OnceLock<EnhancedProgressManager> =
    std::sync::OnceLock::new();

impl EnhancedProgressManager {
    pub fn new() -> Self {
        Self {
            extraction_progress: Arc::new(Mutex::new(None)),
            analysis_progress: Arc::new(Mutex::new(None)),
            word_statuses: Arc::new(Mutex::new(HashMap::new())),
            cancelled: Arc::new(Mutex::new(false)),
        }
    }

    /// 开始批量分析
    pub fn start_batch_analysis(&self) {
        // 重置取消标志
        let mut cancelled = self.cancelled.lock().unwrap();
        *cancelled = false;
        drop(cancelled);

        // 清空之前的进度
        let mut extraction = self.extraction_progress.lock().unwrap();
        *extraction = None;
        drop(extraction);

        let mut analysis = self.analysis_progress.lock().unwrap();
        *analysis = None;
        drop(analysis);

        let mut word_statuses = self.word_statuses.lock().unwrap();
        word_statuses.clear();
        drop(word_statuses);
    }

    /// 更新提取进度
    pub fn update_extraction_progress(&self, progress: &ExtractionProgress) {
        let mut guard = self.extraction_progress.lock().unwrap();
        *guard = Some(progress.clone());
    }

    /// 更新分析进度
    pub fn update_analysis_progress(&self, progress: &AnalysisProgress) {
        let mut guard = self.analysis_progress.lock().unwrap();
        *guard = Some(progress.clone());
    }

    /// 更新单个单词状态
    pub fn update_word_status(&self, status: &WordAnalysisStatus) {
        let mut guard = self.word_statuses.lock().unwrap();
        guard.insert(status.word.clone(), status.clone());
    }

    /// 获取完整进度信息
    pub fn get_full_progress(&self) -> BatchAnalysisProgress {
        let extraction = self.extraction_progress.lock().unwrap().clone();
        let analysis = self.analysis_progress.lock().unwrap().clone();
        let word_statuses = self.word_statuses.lock().unwrap().clone();
        
        // 转换 word_statuses HashMap 到 Vec<WordAnalysisStatus>
        let word_statuses_vec: Vec<WordAnalysisStatus> = word_statuses
            .into_iter()
            .map(|(word, status)| WordAnalysisStatus {
                word,
                status: status.status.clone(),
                error: status.error.clone(),
                result: status.result.clone(),
            })
            .collect();
        
        BatchAnalysisProgress {
            status: if let Some(ref analysis) = analysis {
                if analysis.completed_words == analysis.total_words {
                    "completed".to_string()
                } else {
                    "analyzing".to_string()
                }
            } else if extraction.is_some() {
                "extracting".to_string()
            } else {
                "idle".to_string()
            },
            current_step: if let Some(ref analysis) = analysis {
                format!(
                    "分析批次 {}/{}",
                    analysis.batch_info.completed_batches + 1,
                    analysis.batch_info.total_batches
                )
            } else if let Some(ref extraction) = extraction {
                format!("提取单词 {}/{}", extraction.extracted_words, extraction.total_words)
            } else {
                "准备中".to_string()
            },
            extraction_progress: extraction,
            analysis_progress: analysis,
            word_statuses: Some(word_statuses_vec),
        }
    }

    /// 取消批量分析
    pub fn cancel_analysis(&self) {
        let mut cancelled = self.cancelled.lock().unwrap();
        *cancelled = true;
        drop(cancelled);
    }

    /// 检查是否已取消
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.lock().map(|guard| *guard).unwrap_or(false)
    }

    /// 清除进度
    pub fn clear_progress(&self) {
        let mut extraction = self.extraction_progress.lock().unwrap();
        *extraction = None;
        drop(extraction);

        let mut analysis = self.analysis_progress.lock().unwrap();
        *analysis = None;
        drop(analysis);

        let mut word_statuses = self.word_statuses.lock().unwrap();
        word_statuses.clear();
        drop(word_statuses);
    }
}

/// 获取全局增强进度管理器
pub fn get_enhanced_progress_manager() -> &'static EnhancedProgressManager {
    GLOBAL_ENHANCED_PROGRESS_MANAGER.get_or_init(|| EnhancedProgressManager::new())
}
