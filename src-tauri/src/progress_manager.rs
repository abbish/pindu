//! 批量单词分析进度（前端约 500ms 轮询 `get_batch_analysis_progress`）。
//!
//! 计数与用时在读取时由逐词状态和开始时间推导，而不是由管线各处写入的快照：
//! 批次并发执行时，快照会互相覆盖（完成数回退、失败数清零），用时也只在批次结束时才更新。
//! 单词按登记顺序返回，避免前端列表每次轮询都重新排序。

use crate::types::word_analysis::{
    AnalysisProgress, BatchAnalysisProgress, ExtractionProgress, WordAnalysisStatus,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// 逐词状态：保留登记顺序
#[derive(Default)]
struct WordStatuses {
    order: Vec<String>,
    by_word: HashMap<String, WordAnalysisStatus>,
}

impl WordStatuses {
    fn upsert(&mut self, status: WordAnalysisStatus) {
        if !self.by_word.contains_key(&status.word) {
            self.order.push(status.word.clone());
        }
        self.by_word.insert(status.word.clone(), status);
    }

    fn ordered(&self) -> Vec<WordAnalysisStatus> {
        self.order
            .iter()
            .filter_map(|w| self.by_word.get(w).cloned())
            .collect()
    }

    fn count(&self, status: &str) -> usize {
        self.by_word.values().filter(|s| s.status == status).count()
    }
}

/// 增强的进度管理器
pub struct EnhancedProgressManager {
    extraction_progress: Arc<Mutex<Option<ExtractionProgress>>>,
    analysis_progress: Arc<Mutex<Option<AnalysisProgress>>>,
    word_statuses: Arc<Mutex<WordStatuses>>,
    started_at: Arc<Mutex<Option<Instant>>>,
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
            word_statuses: Arc::new(Mutex::new(WordStatuses::default())),
            started_at: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(Mutex::new(false)),
        }
    }

    /// 开始批量分析：清空上一次的进度并开始计时
    pub fn start_batch_analysis(&self) {
        *self.cancelled.lock().unwrap() = false;
        *self.extraction_progress.lock().unwrap() = None;
        *self.analysis_progress.lock().unwrap() = None;
        *self.word_statuses.lock().unwrap() = WordStatuses::default();
        *self.started_at.lock().unwrap() = Some(Instant::now());
    }

    /// 登记全部待分析单词（状态 pending），列表从一开始就完整、顺序固定
    pub fn register_words(&self, words: &[String]) {
        let mut statuses = self.word_statuses.lock().unwrap();
        for word in words {
            if !statuses.by_word.contains_key(word) {
                statuses.upsert(WordAnalysisStatus {
                    word: word.clone(),
                    status: "pending".to_string(),
                    error: None,
                    result: None,
                });
            }
        }
    }

    /// 更新分析进度（总数与批次信息；完成 / 失败数与用时在读取时重新计算）
    pub fn update_analysis_progress(&self, progress: &AnalysisProgress) {
        *self.analysis_progress.lock().unwrap() = Some(progress.clone());
    }

    /// 更新单个单词状态
    pub fn update_word_status(&self, status: &WordAnalysisStatus) {
        self.word_statuses.lock().unwrap().upsert(status.clone());
    }

    /// 获取完整进度信息
    pub fn get_full_progress(&self) -> BatchAnalysisProgress {
        let extraction = self.extraction_progress.lock().unwrap().clone();
        let mut analysis = self.analysis_progress.lock().unwrap().clone();
        let (word_statuses, completed, failed) = {
            let statuses = self.word_statuses.lock().unwrap();
            (
                statuses.ordered(),
                statuses.count("completed"),
                statuses.count("failed"),
            )
        };
        let elapsed = self
            .started_at
            .lock()
            .unwrap()
            .map(|t| t.elapsed().as_secs_f64());

        if let Some(analysis) = analysis.as_mut() {
            analysis.completed_words = completed;
            analysis.failed_words = failed;
            if let Some(elapsed) = elapsed {
                analysis.elapsed_seconds = elapsed;
            }
        }

        let status = match &analysis {
            Some(a) if a.total_words > 0 && a.completed_words + a.failed_words >= a.total_words => {
                "completed"
            }
            Some(_) => "analyzing",
            None if extraction.is_some() => "extracting",
            None => "idle",
        };
        let current_step = match (&analysis, &extraction) {
            (Some(a), _) => format!(
                "分析单词 {}/{}",
                a.completed_words + a.failed_words,
                a.total_words
            ),
            (None, Some(e)) => format!("提取单词 {}/{}", e.extracted_words, e.total_words),
            (None, None) => "准备中".to_string(),
        };

        BatchAnalysisProgress {
            status: status.to_string(),
            current_step,
            extraction_progress: extraction,
            analysis_progress: analysis,
            word_statuses: Some(word_statuses),
        }
    }

    /// 取消批量分析
    pub fn cancel_analysis(&self) {
        *self.cancelled.lock().unwrap() = true;
    }

    /// 检查是否已取消
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.lock().map(|guard| *guard).unwrap_or(false)
    }
}

/// 获取全局增强进度管理器
pub fn get_enhanced_progress_manager() -> &'static EnhancedProgressManager {
    GLOBAL_ENHANCED_PROGRESS_MANAGER.get_or_init(EnhancedProgressManager::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::word_analysis::BatchInfo;

    fn status(word: &str, status: &str) -> WordAnalysisStatus {
        WordAnalysisStatus {
            word: word.to_string(),
            status: status.to_string(),
            error: None,
            result: None,
        }
    }

    fn analysis(total: usize) -> AnalysisProgress {
        AnalysisProgress {
            total_words: total,
            // 故意写入错误的快照值：读取时应以逐词状态为准
            completed_words: 99,
            failed_words: 99,
            current_word: None,
            batch_info: BatchInfo {
                total_batches: 2,
                completed_batches: 0,
                current_batch: 0,
                batch_size: 2,
            },
            elapsed_seconds: 0.0,
        }
    }

    #[test]
    fn counts_come_from_word_statuses_and_order_is_stable() {
        let pm = EnhancedProgressManager::new();
        pm.start_batch_analysis();
        let words: Vec<String> = ["cat", "dog", "sun", "red"].map(String::from).to_vec();
        pm.register_words(&words);
        pm.update_analysis_progress(&analysis(4));

        let p = pm.get_full_progress();
        assert_eq!(p.status, "analyzing");
        let order: Vec<_> = p
            .word_statuses
            .unwrap()
            .into_iter()
            .map(|s| s.word)
            .collect();
        assert_eq!(order, words);
        let a = p.analysis_progress.unwrap();
        assert_eq!((a.completed_words, a.failed_words), (0, 0));

        // 并发批次乱序完成，顺序不变、计数准确
        pm.update_word_status(&status("sun", "analyzing"));
        pm.update_word_status(&status("red", "completed"));
        pm.update_word_status(&status("cat", "failed"));
        let p = pm.get_full_progress();
        let statuses = p.word_statuses.unwrap();
        assert_eq!(statuses[0].word, "cat");
        assert_eq!(statuses[2].status, "analyzing");
        let a = p.analysis_progress.unwrap();
        assert_eq!((a.completed_words, a.failed_words), (1, 1));
        assert_eq!(p.current_step, "分析单词 2/4");

        // 有失败也能结束
        pm.update_word_status(&status("dog", "completed"));
        pm.update_word_status(&status("sun", "completed"));
        assert_eq!(pm.get_full_progress().status, "completed");
    }

    #[test]
    fn restart_clears_previous_run() {
        let pm = EnhancedProgressManager::new();
        pm.start_batch_analysis();
        pm.register_words(&["cat".to_string()]);
        pm.cancel_analysis();
        pm.start_batch_analysis();
        let p = pm.get_full_progress();
        assert_eq!(p.status, "idle");
        assert!(p.word_statuses.unwrap().is_empty());
        assert!(!pm.is_cancelled());
    }
}
