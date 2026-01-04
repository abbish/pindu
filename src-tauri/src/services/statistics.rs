//! 统计业务逻辑服务
//!
//! 封装统计相关的业务逻辑

use crate::error::AppResult;
use crate::logger::Logger;
use crate::repositories::statistics_repository::StatisticsRepository;
use crate::types::*;
use sqlx::SqlitePool;
use std::sync::Arc;

/// 统计服务
///
/// 负责统计的业务逻辑处理
pub struct StatisticsService {
    repository: StatisticsRepository,
    logger: Arc<Logger>,
}

impl StatisticsService {
    /// 创建新的服务实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: StatisticsRepository::new(pool, logger.clone()),
            logger,
        }
    }

    /// 获取学习统计
    pub async fn get_study_statistics(&self) -> AppResult<StudyStatistics> {
        self.repository.get_study_statistics().await
    }

    /// 获取数据库统计
    pub async fn get_database_statistics(&self) -> AppResult<DatabaseOverview> {
        self.repository.get_database_statistics().await
    }

    /// 重置用户数据
    pub async fn reset_user_data(&self) -> AppResult<ResetResult> {
        self.repository.reset_user_data().await
    }

    /// 重置选定的表
    pub async fn reset_selected_tables(&self, table_names: &[String]) -> AppResult<ResetResult> {
        self.repository.reset_selected_tables(table_names).await
    }

    /// 获取全局单词本统计
    pub async fn get_global_word_book_statistics(&self) -> AppResult<WordBookStatistics> {
        self.repository.get_global_word_book_statistics().await
    }

    /// 获取学习计划统计
    pub async fn get_study_plan_statistics(&self, plan_id: Id) -> AppResult<StudyPlanStatistics> {
        self.repository.get_study_plan_statistics(plan_id).await
    }
}
