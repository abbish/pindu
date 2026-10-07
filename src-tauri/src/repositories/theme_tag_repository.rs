//! 主题标签数据访问层
//!
//! 提供 Repository 模式的数据访问封装

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::wordbook::ThemeTag;
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
            ORDER BY id
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

    /// 按名称查找（忽略大小写与首尾空格）
    pub async fn find_by_name(&self, name: &str) -> AppResult<Option<ThemeTag>> {
        let row = sqlx::query(
            "SELECT id, name, icon, color, created_at FROM theme_tags WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))",
        )
        .bind(name)
        .fetch_optional(self.pool.as_ref())
        .await?;
        Ok(row.map(|row| ThemeTag {
            id: row.get("id"),
            name: row.get("name"),
            icon: row.get("icon"),
            color: row.get("color"),
            created_at: row.get("created_at"),
        }))
    }

    /// 新建主题标签（颜色列为旧字段，界面不再使用，写 primary）
    pub async fn create(&self, name: &str, icon: &str) -> AppResult<ThemeTag> {
        sqlx::query(
            "INSERT INTO theme_tags (name, icon, color, created_at)
             VALUES (?, ?, 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(name)
        .bind(icon)
        .execute(self.pool.as_ref())
        .await?;
        self.find_by_name(name)
            .await?
            .ok_or_else(|| AppError::DatabaseError("新建主题后读取失败".to_string()))
    }
}
