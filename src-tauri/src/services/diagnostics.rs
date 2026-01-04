//! 诊断业务逻辑服务
//!
//! 封装诊断相关的业务逻辑

use crate::error::AppResult;
use crate::logger::Logger;
use crate::repositories::diagnostics_repository::DiagnosticsRepository;
use sqlx::SqlitePool;
use std::sync::Arc;

/// 诊断服务
///
/// 负责诊断的业务逻辑处理
pub struct DiagnosticsService {
    repository: DiagnosticsRepository,
    logger: Arc<Logger>,
}

impl DiagnosticsService {
    /// 创建新的服务实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: DiagnosticsRepository::new(pool, logger.clone()),
            logger,
        }
    }

    /// 诊断今日学习计划
    pub async fn diagnose_today_schedules(&self) -> AppResult<String> {
        self.repository.diagnose_today_schedules().await
    }
}
