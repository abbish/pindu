//! AI 分析业务逻辑服务
//!
//! 封装 AI 分析相关的业务逻辑

use crate::ai_service::{get_global_progress_manager, AnalysisProgress};
use crate::error::AppResult;
use crate::logger::Logger;
use sqlx::SqlitePool;
use std::sync::Arc;

/// AI 分析服务
///
/// 负责 AI 分析的业务逻辑处理
pub struct AnalysisService {
    logger: Arc<Logger>,
}

impl AnalysisService {
    /// 创建新的服务实例
    pub fn new(logger: Arc<Logger>) -> Self {
        Self { logger }
    }

    /// 获取分析进度
    pub async fn get_analysis_progress(&self) -> AppResult<Option<AnalysisProgress>> {
        let progress = get_global_progress_manager().get_progress();
        Ok(progress)
    }

    /// 清除分析进度
    pub async fn clear_analysis_progress(&self) -> AppResult<()> {
        let progress_manager = get_global_progress_manager();
        progress_manager.cancel_analysis(); // 先取消分析
        progress_manager.clear_progress(); // 再清除进度
        Ok(())
    }

    /// 取消分析
    pub async fn cancel_analysis(&self) -> AppResult<()> {
        get_global_progress_manager().cancel_analysis();
        Ok(())
    }
}
