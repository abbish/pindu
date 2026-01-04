//! 单词本数据访问层
//!
//! 提供 Repository 模式的数据访问封装
//!
//! # 注意
//! 此模块当前独立实现,未来将集成到 Service 层



use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::{common::Id, wordbook::*};
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

/// 单词本查询过滤器
#[derive(Debug, Clone, Default)]
pub struct WordBookFilters {
    pub status: Option<String>,
}

/// 单词本仓储
///
/// 负责单词本的数据访问逻辑,封装所有数据库操作
pub struct WordBookRepository {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl WordBookRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 获取 pool 引用（用于跨 Repository 操作）
    pub fn get_pool(&self) -> Arc<SqlitePool> {
        self.pool.clone()
    }

    /// 获取 logger 引用（用于跨 Repository 操作）
    pub fn get_logger(&self) -> Arc<Logger> {
        self.logger.clone()
    }

    /// 查询单个单词本（包含主题标签）
    pub async fn find_by_id(&self, id: Id) -> AppResult<Option<WordBook>> {
        let query = r#"
            SELECT
                wb.id, wb.title, wb.description, wb.icon, wb.icon_color,
                wb.total_words, wb.linked_plans, wb.created_at, wb.updated_at,
                wb.last_used, wb.status
            FROM word_books wb
            WHERE wb.id = ? AND wb.deleted_at IS NULL
        "#;

        let row = sqlx::query(query)
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "word_books", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        match row {
            Some(row) => {
                self.logger.database_operation(
                    "SELECT",
                    "word_books",
                    true,
                    Some(&format!("Found word book {}", id)),
                );

                // 获取主题标签
                let tags = self.get_theme_tags(id).await?;

                Ok(Some(self.row_to_entity(row, tags)?))
            }
            None => Ok(None),
        }
    }

    /// 查询所有单词本（支持过滤）
    pub async fn find_all(&self, filters: WordBookFilters) -> AppResult<Vec<WordBook>> {
        let mut sql = String::from(
            r#"
            SELECT
                wb.id, wb.title, wb.description, wb.icon, wb.icon_color,
                wb.total_words, wb.linked_plans, wb.created_at, wb.updated_at,
                wb.last_used, wb.status
            FROM word_books wb
            WHERE wb.deleted_at IS NULL
        "#,
        );

        // 添加过滤条件
        if filters.status.is_some() {
            sql.push_str(" AND wb.status = ?");
        }

        sql.push_str(" ORDER BY wb.updated_at DESC");

        let mut query = sqlx::query(&sql);

        // 绑定参数
        if let Some(status) = &filters.status {
            query = query.bind(status);
        }

        let rows = query.fetch_all(self.pool.as_ref()).await.map_err(|e| {
            self.logger
                .database_operation("SELECT", "word_books", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        })?;

        self.logger.database_operation(
            "SELECT",
            "word_books",
            true,
            Some(&format!("Found {} word books", rows.len())),
        );

        // 批量获取主题标签
        let all_tags: std::collections::HashMap<Id, Vec<crate::types::wordbook::ThemeTag>> =
            self.get_all_theme_tags().await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let id: Id = row.get("id");
                let tags = all_tags.get(&id).cloned().unwrap_or_default();
                self.row_to_entity(row, tags)
            })
            .collect::<AppResult<Vec<WordBook>>>()?)
    }

    /// 创建单词本
    pub async fn create(&self, request: CreateWordBookRequest) -> AppResult<Id> {
        let query = r#"
            INSERT INTO word_books (title, description, icon, icon_color, status)
            VALUES (?, ?, ?, ?, 'normal')
        "#;

        sqlx::query(query)
            .bind(&request.title)
            .bind(&request.description)
            .bind(&request.icon)
            .bind(&request.icon_color)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("INSERT", "word_books", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let row = sqlx::query("SELECT last_insert_rowid() as id")
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "word_books", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let id: Id = row.get("id");

        self.logger.database_operation(
            "INSERT",
            "word_books",
            true,
            Some(&format!("Created word book {}", id)),
        );

        // 插入主题标签关联
        if let Some(tag_ids) = &request.theme_tag_ids {
            for tag_id in tag_ids {
                if let Err(e) = self.add_theme_tag(id, *tag_id).await {
                    self.logger.error(
                        "WORDBOOK_REPOSITORY",
                        &format!("Failed to add theme tag {} to word book {}", tag_id, id),
                        Some(&e.to_string()),
                    );
                }
            }
        }

        Ok(id)
    }

    /// 更新单词本
    pub async fn update(&self, id: Id, request: UpdateWordBookRequest) -> AppResult<()> {
        // 构建动态更新查询
        let mut set_clauses = Vec::new();
        let mut update_values: Vec<String> = Vec::new();

        if let Some(title) = request.title.as_ref() {
            set_clauses.push("title = ?");
            update_values.push(String::from(title));
        }

        if let Some(description) = request.description.as_ref() {
            set_clauses.push("description = ?");
            update_values.push(String::from(description));
        }

        if let Some(icon) = request.icon.as_ref() {
            set_clauses.push("icon = ?");
            update_values.push(String::from(icon));
        }

        if let Some(icon_color) = request.icon_color.as_ref() {
            set_clauses.push("icon_color = ?");
            update_values.push(String::from(icon_color));
        }

        if let Some(status) = request.status.as_ref() {
            set_clauses.push("status = ?");
            update_values.push(String::from(status));
        }

        if set_clauses.is_empty() {
            return Err(AppError::ValidationError("至少需要提供一个要更新的字段".to_string()));
        }

        set_clauses.push("updated_at = CURRENT_TIMESTAMP");

        let query = format!(
            "UPDATE word_books SET {} WHERE id = ? AND deleted_at IS NULL",
            set_clauses.join(", ")
        );

        let mut query_builder = sqlx::query(&query);
        for value in &update_values {
            query_builder = query_builder.bind(value);
        }
        query_builder = query_builder.bind(id);

        let rows_affected = query_builder
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "word_books", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?
            .rows_affected();

        if rows_affected == 0 {
            return Err(AppError::NotFound(format!("单词本 {} 不存在", id)));
        }

        self.logger.database_operation(
            "UPDATE",
            "word_books",
            true,
            Some(&format!("Updated word book {}", id)),
        );

        // 更新主题标签
        if let Some(tag_ids) = &request.theme_tag_ids {
            // 先删除旧的关联
            self.remove_all_theme_tags(id).await?;

            // 添加新的关联
            for tag_id in tag_ids {
                self.add_theme_tag(id, *tag_id).await?;
            }
        }

        Ok(())
    }

    /// 软删除单词本
    pub async fn delete(&self, id: Id) -> AppResult<()> {
        let query = r#"
            UPDATE word_books
            SET deleted_at = CURRENT_TIMESTAMP,
                status = 'deleted'
            WHERE id = ? AND deleted_at IS NULL
        "#;

        let rows_affected = sqlx::query(query)
            .bind(id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "word_books", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?
            .rows_affected();

        if rows_affected == 0 {
            return Err(AppError::NotFound(format!("单词本 {} 不存在", id)));
        }

        self.logger.database_operation(
            "UPDATE",
            "word_books",
            true,
            Some(&format!("Deleted word book {}", id)),
        );

        Ok(())
    }

    /// 获取单词本统计信息
    pub async fn get_statistics(&self, id: Id) -> AppResult<WordBookStatistics> {
        // 获取单词总数
        // 注意: words 表没有 deleted_at 字段，不需要过滤
        let word_count_query = r#"
            SELECT COUNT(*) as count
            FROM words
            WHERE word_book_id = ?
        "#;

        let row = sqlx::query(word_count_query)
            .bind(id)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let total_words: i64 = row.get("count");

        // 获取词性分布
        // 注意: words 表没有 deleted_at 字段
        // 使用 pos_english 字段进行统计，因为 part_of_speech 字段可能为空
        let pos_query = r#"
            SELECT 
                COALESCE(part_of_speech, pos_english, pos_abbreviation) as pos,
                COUNT(*) as count
            FROM words
            WHERE word_book_id = ? 
              AND (part_of_speech IS NOT NULL OR pos_english IS NOT NULL OR pos_abbreviation IS NOT NULL)
            GROUP BY COALESCE(part_of_speech, pos_english, pos_abbreviation)
        "#;

        let rows = sqlx::query(pos_query)
            .bind(id)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        // 转换为 WordTypeDistribution
        let mut word_types = WordTypeDistribution {
            nouns: 0,
            verbs: 0,
            adjectives: 0,
            others: 0,
        };

        for row in rows {
            let pos: Option<String> = row.get("pos");
            let count: i64 = row.get("count");

            if let Some(pos_str) = pos {
                let pos_lower = pos_str.to_lowercase();
                // 匹配多种词性格式：n/n./noun/nouns, v/v./verb/verbs, adj/adj./adjective/adjectives
                if pos_lower.starts_with("n") || pos_lower == "noun" || pos_lower == "nouns" || pos_lower == "名词" {
                    word_types.nouns += count as i32;
                } else if pos_lower.starts_with("v") || pos_lower == "verb" || pos_lower == "verbs" || pos_lower == "动词" {
                    word_types.verbs += count as i32;
                } else if pos_lower.starts_with("adj") || pos_lower == "adjective" || pos_lower == "adjectives" || pos_lower == "形容词" {
                    word_types.adjectives += count as i32;
                } else {
                    word_types.others += count as i32;
                }
            } else {
                word_types.others += count as i32;
            }
        }

        Ok(WordBookStatistics {
            total_books: 1, // 当前查询单个单词本
            total_words: total_words as i32,
            word_types,
        })
    }

    /// 更新所有单词本的统计信息
    pub async fn update_all_counts(&self) -> AppResult<()> {
        let update_query = r#"
            UPDATE word_books
            SET total_words = (
                SELECT COUNT(*)
                FROM words
                WHERE words.word_book_id = word_books.id
            ),
            linked_plans = (
                SELECT COUNT(DISTINCT sp.id)
                FROM study_plans sp
                JOIN study_plan_words spw ON sp.id = spw.plan_id
                JOIN words w ON spw.word_id = w.id
                WHERE w.word_book_id = word_books.id
                AND sp.deleted_at IS NULL
                AND sp.status = 'normal'
            )
        "#;

        sqlx::query(update_query)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "word_books", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        self.logger.database_operation(
            "UPDATE",
            "word_books",
            true,
            Some("Updated all word book counts"),
        );

        Ok(())
    }

    /// 更新单词本的统计信息（单词数量、最后使用时间等）
    pub async fn update_statistics(&self, id: Id) -> AppResult<()> {
        let update_query = r#"
            UPDATE word_books
            SET total_words = (SELECT COUNT(*) FROM words WHERE word_book_id = ?),
                last_used = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
        "#;

        sqlx::query(update_query)
            .bind(id)
            .bind(id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "word_books", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        self.logger.database_operation(
            "UPDATE",
            "word_books",
            true,
            Some(&format!("Updated statistics for word book {}", id)),
        );

        Ok(())
    }

    // ===== 辅助方法 =====

    /// 将数据库行转换为实体
    fn row_to_entity(
        &self,
        row: sqlx::sqlite::SqliteRow,
        tags: Vec<ThemeTag>,
    ) -> AppResult<WordBook> {
        Ok(WordBook {
            id: row.get("id"),
            title: row.get("title"),
            description: row.get("description"),
            icon: row.get("icon"),
            icon_color: row.get("icon_color"),
            total_words: row.get("total_words"),
            linked_plans: row.get("linked_plans"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            last_used: row.get("last_used"),
            deleted_at: None, // 已通过 WHERE deleted_at IS NULL 过滤
            status: row.get("status"),
            theme_tags: if tags.is_empty() { None } else { Some(tags) },
        })
    }

    /// 获取单词本的主题标签
    async fn get_theme_tags(&self, word_book_id: Id) -> AppResult<Vec<ThemeTag>> {
        let query = r#"
            SELECT tt.id, tt.name, tt.icon, tt.color, tt.created_at
            FROM theme_tags tt
            JOIN word_book_theme_tags wbtt ON tt.id = wbtt.theme_tag_id
            WHERE wbtt.word_book_id = ?
            ORDER BY tt.name
        "#;

        let rows = sqlx::query(query)
            .bind(word_book_id)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "theme_tags", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        Ok(rows
            .iter()
            .map(|row| ThemeTag {
                id: row.get("id"),
                name: row.get("name"),
                icon: row.get("icon"),
                color: row.get("color"),
                created_at: row.get("created_at"),
            })
            .collect())
    }

    /// 批量获取所有单词本的主题标签
    async fn get_all_theme_tags(&self) -> AppResult<std::collections::HashMap<Id, Vec<ThemeTag>>> {
        let query = r#"
            SELECT
                wbtt.word_book_id,
                tt.id, tt.name, tt.icon, tt.color, tt.created_at
            FROM word_book_theme_tags wbtt
            JOIN theme_tags tt ON wbtt.theme_tag_id = tt.id
            ORDER BY wbtt.word_book_id, tt.name
        "#;

        let rows = sqlx::query(query)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "word_book_theme_tags",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        let mut result: std::collections::HashMap<Id, Vec<ThemeTag>> =
            std::collections::HashMap::new();

        for row in rows {
            let word_book_id: Id = row.get("word_book_id");
            let tag = ThemeTag {
                id: row.get("id"),
                name: row.get("name"),
                icon: row.get("icon"),
                color: row.get("color"),
                created_at: row.get("created_at"),
            };

            result.entry(word_book_id).or_default().push(tag);
        }

        Ok(result)
    }

    /// 添加主题标签关联
    async fn add_theme_tag(&self, word_book_id: Id, tag_id: Id) -> AppResult<()> {
        let query = r#"
            INSERT INTO word_book_theme_tags (word_book_id, theme_tag_id)
            VALUES (?, ?)
        "#;

        sqlx::query(query)
            .bind(word_book_id)
            .bind(tag_id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "INSERT",
                    "word_book_theme_tags",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        Ok(())
    }

    /// 删除单词本的所有主题标签关联
    async fn remove_all_theme_tags(&self, word_book_id: Id) -> AppResult<()> {
        let query = r#"
            DELETE FROM word_book_theme_tags
            WHERE word_book_id = ?
        "#;

        sqlx::query(query)
            .bind(word_book_id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "DELETE",
                    "word_book_theme_tags",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logger::Logger;
    use std::path::PathBuf;

    async fn create_test_repository() -> WordBookRepository {
        let pool = SqlitePool::connect(":memory:")
            .await
            .expect("Failed to create test database");

        // 运行迁移
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("Failed to run migrations");

        let logger = Logger::new(&PathBuf::from(".")).expect("Failed to create logger");

        WordBookRepository::new(Arc::new(pool), Arc::new(logger))
    }

    #[tokio::test]
    async fn test_create_word_book() {
        let repo = create_test_repository().await;

        let request = CreateWordBookRequest {
            title: "Test Book".to_string(),
            description: Some("Test Description".to_string()),
            icon: "📚".to_string(),
            icon_color: "#FF5733".to_string(),
            theme_tag_ids: None,
        };

        let id = repo.create(request).await;
        assert!(id.is_ok());

        let word_book_id = id.unwrap();
        assert!(word_book_id > 0);

        // 验证创建成功
        let found = repo.find_by_id(word_book_id).await;
        assert!(found.is_ok());
        assert!(found.unwrap().is_some());
    }

    #[tokio::test]
    async fn test_find_all_empty() {
        let repo = create_test_repository().await;

        let filters = WordBookFilters::default();
        let result = repo.find_all(filters).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }
}
