//! 单词本数据访问层
//!
//! 提供 Repository 模式的数据访问封装
//!
//! # 注意
//! 此模块当前独立实现,未来将集成到 Service 层

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::{common::Id, wordbook::*};
use sqlx::{Row, SqliteConnection, SqlitePool};
use std::sync::Arc;

/// 单词本查询过滤器
#[derive(Debug, Clone, Default)]
pub struct WordBookFilters {
    /// normal / draft / deleted（deleted = 已删除，只能在“已删除”里看到）
    pub status: Option<String>,
    /// 不指定状态时是否也列出已删除的
    pub include_deleted: bool,
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
                (SELECT COUNT(*) FROM words w WHERE w.word_book_id = wb.id) AS total_words,
                (SELECT COUNT(DISTINCT spw.plan_id) FROM study_plan_words spw
                 JOIN words w ON w.id = spw.word_id WHERE w.word_book_id = wb.id) AS linked_plans,
                wb.created_at, wb.updated_at, wb.last_used, wb.status, wb.deleted_at
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
                (SELECT COUNT(*) FROM words w WHERE w.word_book_id = wb.id) AS total_words,
                (SELECT COUNT(DISTINCT spw.plan_id) FROM study_plan_words spw
                 JOIN words w ON w.id = spw.word_id WHERE w.word_book_id = wb.id) AS linked_plans,
                wb.created_at, wb.updated_at, wb.last_used, wb.status, wb.deleted_at
            FROM word_books wb
            WHERE 1 = 1
        "#,
        );

        // 已删除的单词本只在“已删除”或“包含已删除”时出现
        let status = filters.status.clone();
        match status.as_deref() {
            Some("deleted") => sql.push_str(" AND wb.deleted_at IS NOT NULL"),
            Some(_) => sql.push_str(" AND wb.deleted_at IS NULL AND wb.status = ?"),
            None if filters.include_deleted => {}
            None => sql.push_str(" AND wb.deleted_at IS NULL"),
        }

        sql.push_str(" ORDER BY wb.updated_at DESC");

        let mut query = sqlx::query(&sql);

        // 绑定参数
        if let Some(status) = status.as_deref().filter(|s| *s != "deleted") {
            query = query.bind(status.to_string());
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

        rows.into_iter()
            .map(|row| {
                let id: Id = row.get("id");
                let tags = all_tags.get(&id).cloned().unwrap_or_default();
                self.row_to_entity(row, tags)
            })
            .collect::<AppResult<Vec<WordBook>>>()
    }

    /// 创建单词本及其主题标签（同一事务）
    pub async fn create(&self, request: CreateWordBookRequest) -> AppResult<Id> {
        let mut tx = self.pool.begin().await?;
        let id = self
            .insert_conn(
                &mut tx,
                &request.title,
                &request.description,
                &request.icon,
                &request.icon_color,
                "normal",
            )
            .await?;
        if let Some(tag_ids) = &request.theme_tag_ids {
            self.add_theme_tags_conn(&mut tx, id, tag_ids).await?;
        }
        tx.commit().await?;

        self.logger.database_operation(
            "INSERT",
            "word_books",
            true,
            Some(&format!("Created word book {}", id)),
        );
        Ok(id)
    }

    /// 插入单词本（在调用方事务内执行），返回新 ID
    pub async fn insert_conn(
        &self,
        conn: &mut SqliteConnection,
        title: &str,
        description: &str,
        icon: &str,
        icon_color: &str,
        status: &str,
    ) -> AppResult<Id> {
        let result = sqlx::query(&format!(
            "INSERT INTO word_books (title, description, icon, icon_color, status, created_at, updated_at, last_used)
             VALUES (?, ?, ?, ?, ?, {now}, {now}, {now})",
            now = crate::time::SQL_NOW_UTC
        ))
        .bind(title)
        .bind(description)
        .bind(icon)
        .bind(icon_color)
        .bind(status)
        .execute(&mut *conn)
        .await?;
        // 必须取同一连接上的插入结果；另发 `SELECT last_insert_rowid()` 可能落到池中其它连接
        Ok(result.last_insert_rowid())
    }

    /// 关联主题标签（在调用方事务内执行；已存在的关联忽略）
    pub async fn add_theme_tags_conn(
        &self,
        conn: &mut SqliteConnection,
        word_book_id: Id,
        tag_ids: &[Id],
    ) -> AppResult<()> {
        for tag_id in tag_ids {
            sqlx::query(
                "INSERT OR IGNORE INTO word_book_theme_tags (word_book_id, theme_tag_id, created_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            )
            .bind(word_book_id)
            .bind(tag_id)
            .execute(&mut *conn)
            .await?;
        }
        Ok(())
    }

    /// 单词本是否存在且未删除（在调用方事务内读取）
    pub async fn exists_active_conn(&self, conn: &mut SqliteConnection, id: Id) -> AppResult<bool> {
        let row = sqlx::query("SELECT id FROM word_books WHERE id = ? AND deleted_at IS NULL")
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?;
        Ok(row.is_some())
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
            return Err(AppError::ValidationError(
                "至少需要提供一个要更新的字段".to_string(),
            ));
        }

        let updated_at = format!("updated_at = {}", crate::time::SQL_NOW_UTC);
        set_clauses.push(&updated_at);

        let query = format!(
            "UPDATE word_books SET {} WHERE id = ? AND deleted_at IS NULL",
            set_clauses.join(", ")
        );

        let mut query_builder = sqlx::query(&query);
        for value in &update_values {
            query_builder = query_builder.bind(value);
        }
        query_builder = query_builder.bind(id);

        // 单词本与主题标签在一个事务里改完，失败时不留下标签被清空的单词本
        let mut tx = self.pool.begin().await?;
        let rows_affected = query_builder
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("UPDATE", "word_books", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?
            .rows_affected();

        if rows_affected == 0 {
            return Err(AppError::NotFound("单词本不存在，可能已被删除".to_string()));
        }

        self.logger.database_operation(
            "UPDATE",
            "word_books",
            true,
            Some(&format!("Updated word book {}", id)),
        );

        // 更新主题标签：整体替换
        if let Some(tag_ids) = &request.theme_tag_ids {
            sqlx::query("DELETE FROM word_book_theme_tags WHERE word_book_id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            self.add_theme_tags_conn(&mut tx, id, tag_ids).await?;
        }
        tx.commit().await?;

        Ok(())
    }

    /// 软删除单词本
    pub async fn delete(&self, id: Id) -> AppResult<()> {
        let query = format!(
            "UPDATE word_books SET deleted_at = {now}, updated_at = {now}, status = 'deleted'
             WHERE id = ? AND deleted_at IS NULL",
            now = crate::time::SQL_NOW_UTC
        );

        let rows_affected = sqlx::query(&query)
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
            return Err(AppError::NotFound("单词本不存在，可能已被删除".to_string()));
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

        // 词性分布（归类规则见 WordTypeDistribution::add）
        let word_types = self
            .word_type_distributions(Some(id))
            .await?
            .remove(&id)
            .unwrap_or_default();

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
                last_used = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
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

    /// 各单词本的词性分布（一次查询）；`book_id` 为 None 时统计全部单词本
    pub async fn word_type_distributions(
        &self,
        book_id: Option<Id>,
    ) -> AppResult<std::collections::HashMap<Id, WordTypeDistribution>> {
        let rows = sqlx::query(
            r#"
            SELECT word_book_id,
                   COALESCE(part_of_speech, pos_english, pos_abbreviation) AS pos,
                   COUNT(*) AS count
            FROM words
            WHERE (?1 IS NULL OR word_book_id = ?1)
            GROUP BY word_book_id, COALESCE(part_of_speech, pos_english, pos_abbreviation)
            "#,
        )
        .bind(book_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        let mut map: std::collections::HashMap<Id, WordTypeDistribution> =
            std::collections::HashMap::new();
        for row in rows {
            let pos: Option<String> = row.get("pos");
            let count: i64 = row.get("count");
            map.entry(row.get("word_book_id"))
                .or_default()
                .add(pos.as_deref(), count as i32);
        }
        Ok(map)
    }

    // ===== 辅助方法 =====

    /// 恢复已删除的单词本（回到正式状态）
    pub async fn restore(&self, id: Id) -> AppResult<bool> {
        Ok(sqlx::query(&format!(
            "UPDATE word_books SET deleted_at = NULL, status = 'normal', updated_at = {}
             WHERE id = ? AND deleted_at IS NOT NULL",
            crate::time::SQL_NOW_UTC
        ))
        .bind(id)
        .execute(self.pool.as_ref())
        .await?
        .rows_affected()
            > 0)
    }

    /// 用到这个单词本的单词、且还没结束（草稿 / 待开始 / 进行中 / 已暂停）的计划名称
    pub async fn unfinished_plan_names(&self, id: Id) -> AppResult<Vec<String>> {
        Ok(sqlx::query_scalar(
            "SELECT DISTINCT sp.name FROM study_plans sp
             JOIN study_plan_words spw ON spw.plan_id = sp.id
             JOIN words w ON w.id = spw.word_id
             WHERE w.word_book_id = ? AND sp.deleted_at IS NULL
               AND sp.unified_status IN ('Draft', 'Pending', 'Active', 'Paused')
             ORDER BY sp.name",
        )
        .bind(id)
        .fetch_all(self.pool.as_ref())
        .await?)
    }

    /// 单词本练习后刷新“最近使用”（练习完成时调用，调用方事务内）
    pub async fn touch_last_used_by_schedule_conn(
        conn: &mut SqliteConnection,
        schedule_id: Id,
    ) -> AppResult<()> {
        sqlx::query(&format!(
            "UPDATE word_books SET last_used = {} WHERE id IN (
                 SELECT DISTINCT w.word_book_id FROM study_plan_schedule_words sw
                 JOIN words w ON w.id = sw.word_id WHERE sw.schedule_id = ?)",
            crate::time::SQL_NOW_UTC
        ))
        .bind(schedule_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

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
            deleted_at: row.get("deleted_at"),
            status: row.get("status"),
            theme_tags: if tags.is_empty() { None } else { Some(tags) },
            word_types: None,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, test_logger};

    async fn create_test_repository() -> WordBookRepository {
        WordBookRepository::new(memory_pool().await, test_logger())
    }

    #[tokio::test]
    async fn test_create_word_book() {
        let repo = create_test_repository().await;

        let request = CreateWordBookRequest {
            title: "Test Book".to_string(),
            description: "Test Description".to_string(),
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
    async fn find_all_includes_newly_created_book() {
        let repo = create_test_repository().await;
        // 001 迁移自带示例单词本，库在迁移后不为空
        let before = repo.find_all(WordBookFilters::default()).await.unwrap();

        let id = repo
            .create(CreateWordBookRequest {
                title: "Listed Book".to_string(),
                description: String::new(),
                icon: "📚".to_string(),
                icon_color: "#FF5733".to_string(),
                theme_tag_ids: None,
            })
            .await
            .unwrap();

        let after = repo.find_all(WordBookFilters::default()).await.unwrap();
        assert_eq!(after.len(), before.len() + 1);
        assert!(after.iter().any(|b| b.id == id && b.title == "Listed Book"));
    }
}
