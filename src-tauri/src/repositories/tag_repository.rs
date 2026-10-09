//! 素材标签数据访问层：tags 与 material_tags 的唯一 SQL owner（迁移 060）

use crate::error::AppResult;
use crate::types::material::{MaterialKind, Tag, TagUsage};
use crate::types::Id;
use sqlx::{Row, SqliteConnection, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;

pub struct TagRepository {
    pool: Arc<SqlitePool>,
}

fn row_to_tag(row: &sqlx::sqlite::SqliteRow) -> Tag {
    Tag {
        id: row.get("id"),
        name: row.get("name"),
        icon: row.get("icon"),
    }
}

impl TagRepository {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    /// 全部标签与各类素材的数量（单词本不算已删除的），按名称排序
    pub async fn find_all_with_usage(&self) -> AppResult<Vec<TagUsage>> {
        let rows = sqlx::query(
            "SELECT t.id, t.name, t.icon,
                    (SELECT COUNT(*) FROM material_tags m JOIN word_books b ON b.id = m.ref_id
                      WHERE m.tag_id = t.id AND m.kind = 'word_book' AND b.deleted_at IS NULL) AS word_books,
                    (SELECT COUNT(*) FROM material_tags m WHERE m.tag_id = t.id AND m.kind = 'passage') AS passages,
                    (SELECT COUNT(*) FROM material_tags m WHERE m.tag_id = t.id AND m.kind = 'video') AS videos
             FROM tags t
             ORDER BY t.name COLLATE NOCASE",
        )
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows
            .iter()
            .map(|r| TagUsage {
                tag: row_to_tag(r),
                word_books: r.get("word_books"),
                passages: r.get("passages"),
                videos: r.get("videos"),
            })
            .collect())
    }

    /// 按名称查找（忽略大小写与首尾空格）
    pub async fn find_by_name_conn(
        &self,
        conn: &mut SqliteConnection,
        name: &str,
    ) -> AppResult<Option<Tag>> {
        let row = sqlx::query("SELECT id, name, icon FROM tags WHERE name = TRIM(?)")
            .bind(name)
            .fetch_optional(&mut *conn)
            .await?;
        Ok(row.as_ref().map(row_to_tag))
    }

    /// 新建标签（调用方已确认不重名）
    pub async fn insert_conn(
        &self,
        conn: &mut SqliteConnection,
        name: &str,
        icon: Option<&str>,
    ) -> AppResult<Tag> {
        let id = sqlx::query(
            "INSERT INTO tags (name, icon, created_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(name)
        .bind(icon)
        .execute(&mut *conn)
        .await?
        .last_insert_rowid();
        Ok(Tag {
            id,
            name: name.to_string(),
            icon: icon.map(str::to_string),
        })
    }

    /// 一个素材的标签
    pub async fn tags_of(&self, kind: MaterialKind, ref_id: Id) -> AppResult<Vec<Tag>> {
        let rows = sqlx::query(
            "SELECT t.id, t.name, t.icon FROM material_tags m JOIN tags t ON t.id = m.tag_id
             WHERE m.kind = ? AND m.ref_id = ? ORDER BY t.name COLLATE NOCASE",
        )
        .bind(kind.as_str())
        .bind(ref_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows.iter().map(row_to_tag).collect())
    }

    /// 某类素材全部的标签：ref_id → 标签（列表页一次查出）
    pub async fn tags_of_kind(&self, kind: MaterialKind) -> AppResult<HashMap<Id, Vec<Tag>>> {
        let rows = sqlx::query(
            "SELECT m.ref_id, t.id, t.name, t.icon FROM material_tags m JOIN tags t ON t.id = m.tag_id
             WHERE m.kind = ? ORDER BY m.ref_id, t.name COLLATE NOCASE",
        )
        .bind(kind.as_str())
        .fetch_all(self.pool.as_ref())
        .await?;
        let mut map: HashMap<Id, Vec<Tag>> = HashMap::new();
        for r in &rows {
            map.entry(r.get("ref_id")).or_default().push(row_to_tag(r));
        }
        Ok(map)
    }

    /// 整体替换一个素材的标签（在调用方事务内）
    pub async fn replace_conn(
        &self,
        conn: &mut SqliteConnection,
        kind: MaterialKind,
        ref_id: Id,
        tag_ids: &[Id],
    ) -> AppResult<()> {
        sqlx::query("DELETE FROM material_tags WHERE kind = ? AND ref_id = ?")
            .bind(kind.as_str())
            .bind(ref_id)
            .execute(&mut *conn)
            .await?;
        self.add_conn(conn, kind, ref_id, tag_ids).await
    }

    /// 给素材加标签（已有的忽略；不存在的标签 id 忽略）
    pub async fn add_conn(
        &self,
        conn: &mut SqliteConnection,
        kind: MaterialKind,
        ref_id: Id,
        tag_ids: &[Id],
    ) -> AppResult<()> {
        for tag_id in tag_ids {
            sqlx::query(
                "INSERT OR IGNORE INTO material_tags (kind, ref_id, tag_id, created_at)
                 SELECT ?, ?, id, strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM tags WHERE id = ?",
            )
            .bind(kind.as_str())
            .bind(ref_id)
            .bind(tag_id)
            .execute(&mut *conn)
            .await?;
        }
        Ok(())
    }

    pub async fn find_conn(&self, conn: &mut SqliteConnection, id: Id) -> AppResult<Option<Tag>> {
        let row = sqlx::query("SELECT id, name, icon FROM tags WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?;
        Ok(row.as_ref().map(row_to_tag))
    }

    pub async fn rename_conn(
        &self,
        conn: &mut SqliteConnection,
        id: Id,
        name: &str,
    ) -> AppResult<()> {
        sqlx::query("UPDATE tags SET name = ? WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    /// 把 from 的素材关联并到 into（已有的忽略），然后删除 from
    pub async fn merge_conn(
        &self,
        conn: &mut SqliteConnection,
        from: Id,
        into: Id,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT OR IGNORE INTO material_tags (kind, ref_id, tag_id, created_at)
             SELECT kind, ref_id, ?, created_at FROM material_tags WHERE tag_id = ?",
        )
        .bind(into)
        .bind(from)
        .execute(&mut *conn)
        .await?;
        self.delete_conn(conn, from).await
    }

    /// 删除标签（素材关联级联删除）
    pub async fn delete_conn(&self, conn: &mut SqliteConnection, id: Id) -> AppResult<()> {
        sqlx::query("DELETE FROM tags WHERE id = ?")
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    /// 素材是否存在（单词本含已删除的，可在回收站里改）
    pub async fn material_exists(&self, kind: MaterialKind, ref_id: Id) -> AppResult<bool> {
        let table = match kind {
            MaterialKind::WordBook => "word_books",
            MaterialKind::Passage => "passages",
            MaterialKind::Video => "videos",
        };
        let n: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?"))
            .bind(ref_id)
            .fetch_one(self.pool.as_ref())
            .await?;
        Ok(n > 0)
    }

    pub async fn begin(&self) -> AppResult<sqlx::Transaction<'static, sqlx::Sqlite>> {
        Ok(self.pool.begin().await?)
    }
}

/// 迁移 060 在「上一个发行版」的真实形状数据上升级：主题 → 标签（同名合并）、单词本关联保留、
/// 已切出的片段不受影响（来源由 video_clips 推导）、旧短文的词索引在第一次查询时补齐
#[cfg(test)]
mod migration_060_tests {
    use crate::database::MIGRATOR;
    use crate::repositories::passage_word_repository::PassageWordRepository;
    use sqlx::migrate::Migrator;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn upgrades_themes_clips_and_backfills_word_index() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let before = Migrator {
            migrations: std::borrow::Cow::Owned(
                MIGRATOR
                    .iter()
                    .filter(|m| m.version < 60)
                    .cloned()
                    .collect(),
            ),
            ..Migrator::DEFAULT
        };
        before.run(&pool).await.unwrap();
        // 059 时的旧表（theme_tags 等在 060 删除），放在夹具文件里
        sqlx::raw_sql(include_str!("../../tests/fixtures/before_060.sql"))
            .execute(&pool)
            .await
            .unwrap();
        MIGRATOR.run(&pool).await.unwrap();

        let tags: Vec<(i64, String, Option<String>)> =
            sqlx::query_as("SELECT id, name, icon FROM tags WHERE id >= 100 ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        // 同名（忽略大小写）的两个主题合成一个，保留 id 小的；名字去掉首尾空格；空图标为 NULL
        assert_eq!(
            tags,
            vec![
                (100, "自驾旅行".to_string(), Some("✈️".to_string())),
                (101, "TED".to_string(), None)
            ]
        );
        let linked: Vec<i64> = sqlx::query_scalar(
            "SELECT tag_id FROM material_tags WHERE kind = 'word_book' AND ref_id = 900 ORDER BY tag_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(linked, vec![100, 101]);
        // 切片短文原样保留，offset 默认 0
        let offset: i64 =
            sqlx::query_scalar("SELECT subtitle_offset_ms FROM videos WHERE id = 900")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(offset, 0);
        // 旧短文没有词索引：第一次查询时补齐，再查不重复补
        assert_eq!(
            PassageWordRepository::index_missing(&pool).await.unwrap(),
            1
        );
        assert_eq!(
            PassageWordRepository::index_missing(&pool).await.unwrap(),
            0
        );
        let hits = PassageWordRepository::hits(&pool, &["order".into(), "ordered".into()])
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].is_video && !hits[0].key && hits[0].sentence == 0);
        let menu = PassageWordRepository::hits(&pool, &["menu".into()])
            .await
            .unwrap();
        assert!(menu[0].key && menu[0].sentence == -1);
        // 删除短文：索引级联删除、标签关联由触发器清理
        sqlx::query("INSERT INTO material_tags (kind, ref_id, tag_id, created_at) VALUES ('passage', 900, 100, 'x')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM passages WHERE id = 900")
            .execute(&pool)
            .await
            .unwrap();
        let left: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM passage_words), (SELECT COUNT(*) FROM material_tags WHERE kind = 'passage')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(left, (0, 0));
    }
}
