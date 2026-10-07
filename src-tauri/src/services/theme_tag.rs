//! 主题标签业务逻辑服务
//!
//! 封装主题标签相关的业务逻辑

use crate::error::{AppError, AppResult};
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

    /// 新建主题标签：名称 1–10 个字；同名（忽略大小写）已存在时直接返回已有的；图标为空时用 🏷️
    pub async fn create_theme_tag(&self, name: &str, icon: Option<&str>) -> AppResult<ThemeTag> {
        let name = name.trim();
        let len = name.chars().count();
        if len == 0 || len > 10 {
            return Err(AppError::ValidationError(
                "主题名称需要 1–10 个字".to_string(),
            ));
        }
        if let Some(existing) = self.repository.find_by_name(name).await? {
            return Ok(existing);
        }
        let icon = icon
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.chars().count() <= 4)
            .unwrap_or("🏷️");
        self.repository.create(name, icon).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, test_logger};

    #[tokio::test]
    async fn creating_theme_tags_validates_and_reuses_same_name() {
        let pool = memory_pool().await;
        let service = ThemeTagService::new(pool.clone(), test_logger());
        assert!(service.create_theme_tag("  ", None).await.is_err());
        assert!(service
            .create_theme_tag("一二三四五六七八九十一", None)
            .await
            .is_err());

        let tag = service
            .create_theme_tag(" 演讲 ", Some("🎤"))
            .await
            .unwrap();
        assert_eq!((tag.name.as_str(), tag.icon.as_str()), ("演讲", "🎤"));
        let again = service.create_theme_tag("演讲", None).await.unwrap();
        assert_eq!(again.id, tag.id);
        let default_icon = service.create_theme_tag("TED", None).await.unwrap();
        assert_eq!(default_icon.icon, "🏷️");
        assert_eq!(
            service.create_theme_tag("ted", None).await.unwrap().id,
            default_icon.id
        );

        // 内置在前、新建的按创建顺序排在后面
        let all = service.get_theme_tags().await.unwrap();
        assert_eq!(all.last().unwrap().id, default_icon.id);
        crate::time::assert_instants_canonical(&pool).await;
    }
}
