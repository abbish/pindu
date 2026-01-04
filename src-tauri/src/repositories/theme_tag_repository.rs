//! 主题标签数据访问层
//!
//! 提供 Repository 模式的数据访问封装

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::wordbook::ThemeTag;
use crate::types::common::Id;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

/// 主题标签仓储
///
/// 负责主题标签的数据访问逻辑
pub struct ThemeTagRepository {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl ThemeTagRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 获取所有主题标签
    pub async fn find_all(&self) -> AppResult<Vec<ThemeTag>> {
        let query = r#"
            SELECT id, name, icon, color, created_at
            FROM theme_tags
            ORDER BY name
        "#;

        let rows = sqlx::query(query)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "theme_tags", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let theme_tags: Vec<ThemeTag> = rows
            .into_iter()
            .map(|row| ThemeTag {
                id: row.get("id"),
                name: row.get("name"),
                icon: row.get("icon"),
                color: row.get("color"),
                created_at: row.get("created_at"),
            })
            .collect();

        self.logger.database_operation(
            "SELECT",
            "theme_tags",
            true,
            Some(&format!("Found {} theme tags", theme_tags.len())),
        );

        Ok(theme_tags)
    }
}
