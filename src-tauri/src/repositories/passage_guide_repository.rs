//! 场景片段的内容讲解（passage_guides）：一个片段一份

use crate::error::AppResult;
use crate::types::common::Id;
use crate::types::passage::ClipGuide;
use sqlx::SqlitePool;
use std::sync::Arc;

pub struct PassageGuideRepository {
    pool: Arc<SqlitePool>,
}

impl PassageGuideRepository {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn find(&self, passage_id: Id) -> AppResult<Option<ClipGuide>> {
        let row: Option<(String, Option<String>, String)> = sqlx::query_as(
            "SELECT content, model_name, updated_at FROM passage_guides WHERE passage_id = ?",
        )
        .bind(passage_id)
        .fetch_optional(self.pool.as_ref())
        .await?;
        Ok(row.map(|(content, model_name, updated_at)| ClipGuide {
            passage_id,
            content,
            model_name,
            generated_at: updated_at,
        }))
    }

    /// 写入或覆盖（重新生成时以新的为准）
    pub async fn upsert(&self, guide: &ClipGuide) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO passage_guides (passage_id, content, model_name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(passage_id) DO UPDATE SET
                content = excluded.content, model_name = excluded.model_name, updated_at = excluded.updated_at",
        )
        .bind(guide.passage_id)
        .bind(&guide.content)
        .bind(&guide.model_name)
        .bind(&guide.generated_at)
        .bind(&guide.generated_at)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::memory_pool;

    #[tokio::test]
    async fn guide_is_saved_overwritten_and_deleted_with_the_passage() {
        let pool = memory_pool().await;
        let now = crate::time::now_utc();
        sqlx::query(
            "INSERT INTO passages (id, title, sentences, target_words, level, word_count, created_at, updated_at) VALUES (1, 't', '[]', '[]', 'A2', 0, ?, ?)",
        )
        .bind(&now)
        .bind(&now)
        .execute(pool.as_ref())
        .await
        .unwrap();
        let repo = PassageGuideRepository::new(pool.clone());
        assert!(repo.find(1).await.unwrap().is_none());
        let mut guide = ClipGuide {
            passage_id: 1,
            content: "第一版".into(),
            model_name: Some("m".into()),
            generated_at: now.clone(),
        };
        repo.upsert(&guide).await.unwrap();
        guide.content = "第二版".into();
        repo.upsert(&guide).await.unwrap();
        assert_eq!(repo.find(1).await.unwrap().unwrap().content, "第二版");
        sqlx::query("DELETE FROM passages WHERE id = 1")
            .execute(pool.as_ref())
            .await
            .unwrap();
        assert!(repo.find(1).await.unwrap().is_none());
    }
}
