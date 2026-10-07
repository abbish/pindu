//! 学习计划规划进度（前端 PlanningProgress 轮询 get_analysis_progress）：agent 规划任务写入，取消标志由 cancel_analysis 设置。

//! 全局 OnceLock 单例。批量单词分析使用 `crate::progress_manager::EnhancedProgressManager`（不同的前端契约）。

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// 分析进度状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanningProgressState {
    pub status: String,                // "analyzing", "completed", "error"
    pub current_step: String,          // 当前步骤描述
    pub chunks_received: u32,          // 已接收的chunk数量
    pub total_chars: usize,            // 已接收的总字符数
    pub elapsed_seconds: f64,          // 已用时间（秒）
    pub error_message: Option<String>, // 错误信息
}

/// 全局进度管理器
pub struct ProgressManager {
    progress: Arc<Mutex<Option<PlanningProgressState>>>,
    cancelled: Arc<Mutex<bool>>,
}

// 全局进度管理器实例
static GLOBAL_PROGRESS_MANAGER: std::sync::OnceLock<ProgressManager> = std::sync::OnceLock::new();

impl ProgressManager {
    pub fn new() -> Self {
        Self {
            progress: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(Mutex::new(false)),
        }
    }

    pub fn start_analysis(&self) {
        // 重置取消标志
        let mut cancelled = self.cancelled.lock().unwrap();
        *cancelled = false;
        drop(cancelled);

        let mut progress = self.progress.lock().unwrap();
        *progress = Some(PlanningProgressState {
            status: "analyzing".to_string(),
            current_step: "准备分析...".to_string(),
            chunks_received: 0,
            total_chars: 0,
            elapsed_seconds: 0.0,
            error_message: None,
        });
    }

    pub fn update_step(&self, step: &str, start_time: Instant) {
        if let Ok(mut progress) = self.progress.lock() {
            if let Some(ref mut p) = *progress {
                p.current_step = step.to_string();
                p.elapsed_seconds = start_time.elapsed().as_secs_f64();
            }
        }
    }

    pub fn update_chunk(&self, chunks: u32, total_chars: usize, start_time: Instant) {
        if let Ok(mut progress) = self.progress.lock() {
            if let Some(ref mut p) = *progress {
                p.chunks_received = chunks;
                p.total_chars = total_chars;
                p.elapsed_seconds = start_time.elapsed().as_secs_f64();
            }
        }
    }

    pub fn complete_analysis(&self) {
        if let Ok(mut progress) = self.progress.lock() {
            if let Some(ref mut p) = *progress {
                p.status = "completed".to_string();
                p.current_step = "分析完成".to_string();
            }
        }
    }

    pub fn error_analysis(&self, error: &str) {
        if let Ok(mut progress) = self.progress.lock() {
            if let Some(ref mut p) = *progress {
                p.status = "error".to_string();
                p.current_step = "分析失败".to_string();
                p.error_message = Some(error.to_string());
            }
        }
    }

    pub fn get_progress(&self) -> Option<PlanningProgressState> {
        self.progress.lock().ok()?.clone()
    }

    pub fn clear_progress(&self) {
        let mut progress = self.progress.lock().unwrap();
        *progress = None;
    }

    pub fn cancel_analysis(&self) {
        let mut cancelled = self.cancelled.lock().unwrap();
        *cancelled = true;
        drop(cancelled);

        // 更新进度状态为已取消
        if let Ok(mut progress) = self.progress.lock() {
            if let Some(ref mut p) = *progress {
                p.status = "cancelled".to_string();
                p.current_step = "分析已取消".to_string();
            }
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.lock().map(|guard| *guard).unwrap_or(false)
    }
}

/// 获取全局进度管理器
pub fn get_global_progress_manager() -> &'static ProgressManager {
    GLOBAL_PROGRESS_MANAGER.get_or_init(ProgressManager::new)
}
