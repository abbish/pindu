//! 素材标签业务：新建（同名复用）、按名称批量确保存在（AI 给的标签）、整体设置素材的标签

use crate::error::{AppError, AppResult};
use crate::repositories::tag_repository::TagRepository;
use crate::types::material::{MaterialKind, Tag, TagUsage};
use crate::types::Id;
use sqlx::{SqliteConnection, SqlitePool};
use std::sync::Arc;

/// 标签名最长字数
pub const TAG_NAME_MAX: usize = 10;

pub struct TagService {
    repository: TagRepository,
}

/// AI 生成素材时给的标签最多几个
pub const AI_TAGS_MAX: usize = 3;
/// 发给 AI 参考的已有标签最多几个
const KNOWN_TAGS_MAX: usize = 60;

fn usage_total(t: &TagUsage) -> i64 {
    t.word_books + t.passages + t.clips + t.videos
}

/// AI 工具参数里的 `tags` → 清理后的标签名：去掉不合格的、忽略大小写去重，最多 AI_TAGS_MAX 个
pub fn tags_from_submission(details: &serde_json::Value) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    for name in details
        .get("tags")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .filter_map(clean_name)
    {
        if tags.len() < AI_TAGS_MAX && !tags.iter().any(|t| t.to_lowercase() == name.to_lowercase())
        {
            tags.push(name);
        }
    }
    tags
}

/// 清理标签名：去首尾空格、合并连续空白；空或超长返回 None
pub fn clean_name(name: &str) -> Option<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let len = name.chars().count();
    (len > 0 && len <= TAG_NAME_MAX).then_some(name)
}

impl TagService {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self {
            repository: TagRepository::new(pool),
        }
    }

    pub async fn get_tags(&self) -> AppResult<Vec<TagUsage>> {
        self.repository.find_all_with_usage().await
    }

    /// 新建标签：名称 1–10 个字；同名（忽略大小写）已存在时直接返回已有的
    pub async fn create_tag(&self, name: &str) -> AppResult<Tag> {
        let name = clean_name(name).ok_or_else(|| {
            AppError::ValidationError(format!("标签名称需要 1–{TAG_NAME_MAX} 个字"))
        })?;
        let mut tx = self.repository.begin().await?;
        let tag = match self.repository.find_by_name_conn(&mut tx, &name).await? {
            Some(existing) => existing,
            None => self.repository.insert_conn(&mut tx, &name).await?,
        };
        tx.commit().await?;
        Ok(tag)
    }

    /// 按名称确保标签存在，返回 id（去重；不合格的名字跳过）。AI 规划给的标签用这个落库
    pub async fn ensure_names_conn(
        &self,
        conn: &mut SqliteConnection,
        names: &[String],
    ) -> AppResult<Vec<Id>> {
        let mut ids: Vec<Id> = Vec::new();
        for name in names.iter().filter_map(|n| clean_name(n)) {
            let tag = match self.repository.find_by_name_conn(conn, &name).await? {
                Some(t) => t,
                None => self.repository.insert_conn(conn, &name).await?,
            };
            if !ids.contains(&tag.id) {
                ids.push(tag.id);
            }
        }
        Ok(ids)
    }

    /// 给素材加上这些名字的标签（没有就新建，已有的不重复；不合格的名字跳过）。AI 生成素材时用
    pub async fn add_names_conn(
        &self,
        conn: &mut SqliteConnection,
        kind: MaterialKind,
        ref_id: Id,
        names: &[String],
    ) -> AppResult<()> {
        if names.is_empty() {
            return Ok(());
        }
        let ids = self.ensure_names_conn(conn, names).await?;
        self.repository.add_conn(conn, kind, ref_id, &ids).await
    }

    /// 给 AI 参考的已有标签名：用得多的在前，最多 KNOWN_TAGS_MAX 个
    pub async fn known_names(&self) -> AppResult<Vec<String>> {
        let mut tags = self.repository.find_all_with_usage().await?;
        tags.retain(|t| usage_total(t) > 0);
        tags.sort_by_key(|t| std::cmp::Reverse(usage_total(t)));
        Ok(tags
            .into_iter()
            .take(KNOWN_TAGS_MAX)
            .map(|t| t.tag.name)
            .collect())
    }

    /// 改名：与另一个标签同名（忽略大小写）时合并进那个标签，返回最终的标签
    pub async fn rename_tag(&self, id: Id, name: &str) -> AppResult<Tag> {
        let name = clean_name(name).ok_or_else(|| {
            AppError::ValidationError(format!("标签名称需要 1–{TAG_NAME_MAX} 个字"))
        })?;
        let mut tx = self.repository.begin().await?;
        let tag = self
            .repository
            .find_conn(&mut tx, id)
            .await?
            .ok_or_else(|| AppError::NotFound("标签不存在，可能已被删除".to_string()))?;
        let result = match self.repository.find_by_name_conn(&mut tx, &name).await? {
            Some(other) if other.id != id => {
                self.repository.merge_conn(&mut tx, id, other.id).await?;
                other
            }
            _ => {
                self.repository.rename_conn(&mut tx, id, &name).await?;
                Tag { name, ..tag }
            }
        };
        tx.commit().await?;
        Ok(result)
    }

    /// 删除标签：素材本身不受影响，只是不再带这个标签
    pub async fn delete_tag(&self, id: Id) -> AppResult<()> {
        let mut tx = self.repository.begin().await?;
        self.repository.delete_conn(&mut tx, id).await?;
        tx.commit().await?;
        Ok(())
    }

    /// 批量给多个素材加 / 去标签（一个事务）；不存在的素材跳过
    pub async fn update_material_tags(
        &self,
        kind: MaterialKind,
        ref_ids: &[Id],
        add: &[Id],
        remove: &[Id],
    ) -> AppResult<usize> {
        // 先挑出存在的素材，再开事务写（事务里不再走连接池读）
        let mut existing = Vec::new();
        for &ref_id in ref_ids {
            if self.repository.material_exists(kind, ref_id).await? {
                existing.push(ref_id);
            }
        }
        let mut tx = self.repository.begin().await?;
        for &ref_id in &existing {
            self.repository.add_conn(&mut tx, kind, ref_id, add).await?;
            self.repository
                .remove_conn(&mut tx, kind, ref_id, remove)
                .await?;
        }
        tx.commit().await?;
        Ok(existing.len())
    }

    /// 整体设置一个素材的标签
    pub async fn set_material_tags(
        &self,
        kind: MaterialKind,
        ref_id: Id,
        tag_ids: &[Id],
    ) -> AppResult<Vec<Tag>> {
        if !self.repository.material_exists(kind, ref_id).await? {
            return Err(AppError::NotFound("素材不存在".to_string()));
        }
        let mut tx = self.repository.begin().await?;
        self.repository
            .replace_conn(&mut tx, kind, ref_id, tag_ids)
            .await?;
        tx.commit().await?;
        self.repository.tags_of(kind, ref_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::memory_pool;

    #[test]
    fn ai_tags_are_cleaned_deduplicated_and_capped() {
        let details = serde_json::json!({ "tags": [" 点餐 ", "TED", "ted", "", "一二三四五六七八九十一", "问路", "道歉", "面试"] });
        assert_eq!(tags_from_submission(&details), vec!["点餐", "TED", "问路"]);
        assert!(tags_from_submission(&serde_json::json!({})).is_empty());
    }

    #[tokio::test]
    async fn ai_tags_are_added_to_material_and_known_names_by_usage() {
        let pool = memory_pool().await;
        let service = TagService::new(pool.clone());
        let a = service.create_tag("旅行").await.unwrap();
        let mut conn = pool.acquire().await.unwrap();
        service
            .add_names_conn(
                &mut conn,
                MaterialKind::Passage,
                1,
                &["点餐".to_string(), "旅行".to_string()],
            )
            .await
            .unwrap();
        service
            .add_names_conn(&mut conn, MaterialKind::Video, 2, &["旅行".to_string()])
            .await
            .unwrap();
        drop(conn);
        let rows: Vec<(String, i64)> =
            sqlx::query_as("SELECT kind, tag_id FROM material_tags ORDER BY kind, tag_id")
                .fetch_all(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(rows.len(), 3);
        assert!(rows.contains(&("video".to_string(), a.id)));
        assert_eq!(service.known_names().await.unwrap(), vec!["旅行", "点餐"]);
    }

    #[tokio::test]
    async fn creating_tags_validates_and_reuses_same_name() {
        let pool = memory_pool().await;
        let service = TagService::new(pool.clone());
        assert!(service.create_tag("  ").await.is_err());
        assert!(service.create_tag("一二三四五六七八九十一").await.is_err());

        let tag = service.create_tag(" 演讲 ").await.unwrap();
        assert_eq!(tag.name, "演讲");
        assert_eq!(service.create_tag("演讲").await.unwrap().id, tag.id);
        let ted = service.create_tag("TED").await.unwrap();
        assert_eq!(service.create_tag("ted").await.unwrap().id, ted.id);
        crate::time::assert_instants_canonical(&pool).await;
    }

    #[tokio::test]
    async fn material_tags_are_replaced_and_cleaned_with_material() {
        let pool = memory_pool().await;
        let service = TagService::new(pool.clone());
        let mut conn = pool.acquire().await.unwrap();
        let ids = service
            .ensure_names_conn(
                &mut conn,
                &["餐厅".into(), " 餐厅 ".into(), "".into(), "旅行".into()],
            )
            .await
            .unwrap();
        drop(conn);
        assert_eq!(ids.len(), 2);

        crate::test_support::seed_schedule(pool.as_ref(), 1).await;
        let book: Id = sqlx::query_scalar("SELECT id FROM word_books ORDER BY id LIMIT 1")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        let tags = service
            .set_material_tags(MaterialKind::WordBook, book, &ids)
            .await
            .unwrap();
        assert_eq!(tags.len(), 2);
        let tags = service
            .set_material_tags(MaterialKind::WordBook, book, &ids[..1])
            .await
            .unwrap();
        assert_eq!(tags.len(), 1);
        assert!(service
            .set_material_tags(MaterialKind::Video, 999, &ids)
            .await
            .is_err());

        let usage = service.get_tags().await.unwrap();
        let canteen = usage.iter().find(|u| u.tag.name == "餐厅").unwrap();
        assert_eq!(canteen.word_books, 1);

        // 删除素材时触发器清掉关联
        sqlx::query("DELETE FROM word_books WHERE id = ?")
            .bind(book)
            .execute(pool.as_ref())
            .await
            .unwrap();
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM material_tags")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(left, 0);
        crate::time::assert_instants_canonical(&pool).await;
    }

    #[tokio::test]
    async fn renaming_to_an_existing_name_merges_tags() {
        let pool = memory_pool().await;
        crate::test_support::seed_schedule(pool.as_ref(), 1).await;
        let service = TagService::new(pool.clone());
        let book: Id = sqlx::query_scalar("SELECT id FROM word_books ORDER BY id LIMIT 1")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        let a = service.create_tag("点餐").await.unwrap();
        let b = service.create_tag("餐厅点餐").await.unwrap();
        service
            .set_material_tags(MaterialKind::WordBook, book, &[a.id, b.id])
            .await
            .unwrap();
        // 普通改名
        let renamed = service.rename_tag(b.id, "  在餐厅 ").await.unwrap();
        assert_eq!((renamed.id, renamed.name.as_str()), (b.id, "在餐厅"));
        // 改成已有的名字：合并，素材上只剩一个
        let merged = service.rename_tag(b.id, "点餐").await.unwrap();
        assert_eq!(merged.id, a.id);
        let tags = service
            .set_material_tags(MaterialKind::WordBook, book, &[a.id])
            .await
            .unwrap();
        assert_eq!(tags.len(), 1);
        let names: Vec<String> = service
            .get_tags()
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.tag.name)
            .collect();
        assert!(names.contains(&"点餐".to_string()) && !names.contains(&"在餐厅".to_string()));
        service.delete_tag(a.id).await.unwrap();
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM material_tags")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn batch_adds_and_removes_tags_skipping_missing_materials() {
        let pool = memory_pool().await;
        crate::test_support::seed_schedule(pool.as_ref(), 1).await;
        let service = TagService::new(pool.clone());
        let book: Id = sqlx::query_scalar("SELECT id FROM word_books ORDER BY id LIMIT 1")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        let a = service.create_tag("点餐").await.unwrap();
        let b = service.create_tag("旅行学习").await.unwrap();
        let n = service
            .update_material_tags(MaterialKind::WordBook, &[book, 99_999], &[a.id, b.id], &[])
            .await
            .unwrap();
        assert_eq!(n, 1);
        service
            .update_material_tags(MaterialKind::WordBook, &[book], &[], &[a.id])
            .await
            .unwrap();
        let ids: Vec<Id> = sqlx::query_scalar("SELECT tag_id FROM material_tags WHERE ref_id = ?")
            .bind(book)
            .fetch_all(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(ids, vec![b.id]);
        crate::time::assert_instants_canonical(&pool).await;
    }
}
