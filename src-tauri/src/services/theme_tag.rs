//! 主题标签业务逻辑服务
//!
//! 封装主题标签相关的业务逻辑

use crate::error::AppResult;
use crate::logger::Logger;
use crate::repositories::theme_tag_repository::ThemeTagRepository;
use crate::types::wordbook::ThemeTag;
use sqlx::SqlitePool;
use std::sync::Arc;

/// 主题标签服务
///
/// 负责主题标签的业务逻辑处理
pub struct ThemeTagService {
    repository: ThemeTagRepository,
}

impl ThemeTagService {
    /// 创建新的服务实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: ThemeTagRepository::new(pool, logger),
        }
    }

    /// 获取所有主题标签
    pub async fn get_theme_tags(&self) -> AppResult<Vec<ThemeTag>> {
        self.repository.find_all().await
    }
}
