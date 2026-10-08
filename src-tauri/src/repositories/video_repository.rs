//! 视频库的数据访问（videos / video_clips，迁移 059）。文件路径在 service 层按数据目录拼出，这里只存文件名。

use crate::error::AppResult;
use crate::services::subtitle::Cue;
use crate::types::video::VideoPlan;
use sqlx::{FromRow, SqlitePool};

/// videos 表的一行
#[derive(Debug, Clone, FromRow)]
pub struct VideoRow {
    pub id: i64,
    pub title: String,
    pub source_name: String,
    pub source_file: Option<String>,
    pub media_file: Option<String>,
    pub subtitle_name: Option<String>,
    pub cues: String,
    pub duration_ms: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub size_bytes: i64,
    pub plan: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub clip_count: i64,
}

impl VideoRow {
    pub fn cues(&self) -> Vec<Cue> {
        serde_json::from_str(&self.cues).unwrap_or_default()
    }

    pub fn plan(&self) -> Option<VideoPlan> {
        self.plan
            .as_deref()
            .and_then(|p| serde_json::from_str(p).ok())
    }
}

/// video_clips 表的一行
#[derive(Debug, Clone, FromRow)]
pub struct ClipRow {
    pub video_id: i64,
    pub passage_id: i64,
    pub seq: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub file: String,
    pub poster_file: Option<String>,
}

const SELECT: &str = "SELECT v.id, v.title, v.source_name, v.source_file, v.media_file, v.subtitle_name, v.cues,
        v.duration_ms, v.width, v.height, v.size_bytes, v.plan, v.status, v.error, v.created_at, v.updated_at,
        (SELECT COUNT(*) FROM video_clips c WHERE c.video_id = v.id) AS clip_count
     FROM videos v";

pub struct VideoRepository;

impl VideoRepository {
    /// 新建（导入中），返回 id
    pub async fn insert(
        pool: &SqlitePool,
        title: &str,
        source_name: &str,
        subtitle_name: Option<&str>,
        cues: &[Cue],
        size_bytes: i64,
    ) -> AppResult<i64> {
        let now = crate::time::now_utc();
        let id = sqlx::query(
            "INSERT INTO videos (title, source_name, subtitle_name, cues, size_bytes, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'importing', ?, ?)",
        )
        .bind(title)
        .bind(source_name)
        .bind(subtitle_name)
        .bind(serde_json::to_string(cues).unwrap_or_else(|_| "[]".into()))
        .bind(size_bytes)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?
        .last_insert_rowid();
        Ok(id)
    }

    pub async fn list(pool: &SqlitePool) -> AppResult<Vec<VideoRow>> {
        Ok(sqlx::query_as::<_, VideoRow>(&format!(
            "{SELECT} ORDER BY v.created_at DESC, v.id DESC"
        ))
        .fetch_all(pool)
        .await?)
    }

    pub async fn get(pool: &SqlitePool, id: i64) -> AppResult<Option<VideoRow>> {
        Ok(
            sqlx::query_as::<_, VideoRow>(&format!("{SELECT} WHERE v.id = ?"))
                .bind(id)
                .fetch_optional(pool)
                .await?,
        )
    }

    /// 导入完成：文件、视频信息，状态改为 ready
    pub async fn finish_import(
        pool: &SqlitePool,
        id: i64,
        source_file: &str,
        media_file: &str,
        duration_ms: i64,
        width: Option<i64>,
        height: Option<i64>,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE videos SET source_file = ?, media_file = ?, duration_ms = ?, width = ?, height = ?,
                 status = 'ready', error = NULL, updated_at = ?
             WHERE id = ?",
        )
        .bind(source_file)
        .bind(media_file)
        .bind(duration_ms)
        .bind(width)
        .bind(height)
        .bind(crate::time::now_utc())
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn set_status(
        pool: &SqlitePool,
        id: i64,
        status: &str,
        error: Option<&str>,
    ) -> AppResult<()> {
        sqlx::query("UPDATE videos SET status = ?, error = ?, updated_at = ? WHERE id = ?")
            .bind(status)
            .bind(error)
            .bind(crate::time::now_utc())
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn rename(pool: &SqlitePool, id: i64, title: &str) -> AppResult<bool> {
        let done = sqlx::query("UPDATE videos SET title = ?, updated_at = ? WHERE id = ?")
            .bind(title)
            .bind(crate::time::now_utc())
            .bind(id)
            .execute(pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }

    pub async fn save_plan(pool: &SqlitePool, id: i64, plan: &VideoPlan) -> AppResult<bool> {
        let done = sqlx::query("UPDATE videos SET plan = ?, updated_at = ? WHERE id = ?")
            .bind(serde_json::to_string(plan).unwrap_or_default())
            .bind(crate::time::now_utc())
            .bind(id)
            .execute(pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }

    /// 删除原视频文件后：不再有 source_file；播放文件就是原视频时一起清空
    pub async fn clear_source(pool: &SqlitePool, id: i64) -> AppResult<()> {
        sqlx::query(
            "UPDATE videos SET media_file = CASE WHEN media_file = source_file THEN NULL ELSE media_file END,
                 source_file = NULL, updated_at = ?
             WHERE id = ?",
        )
        .bind(crate::time::now_utc())
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// 已切出的短片（按序号）
    pub async fn clips(pool: &SqlitePool, video_id: i64) -> AppResult<Vec<ClipRow>> {
        Ok(sqlx::query_as::<_, ClipRow>(
            "SELECT video_id, passage_id, seq, start_ms, end_ms, file, poster_file
             FROM video_clips WHERE video_id = ? ORDER BY seq, id",
        )
        .bind(video_id)
        .fetch_all(pool)
        .await?)
    }

    /// 短文对应的短片（短文详情页播放用）
    pub async fn clip_of_passage(pool: &SqlitePool, passage_id: i64) -> AppResult<Option<ClipRow>> {
        Ok(sqlx::query_as::<_, ClipRow>(
            "SELECT video_id, passage_id, seq, start_ms, end_ms, file, poster_file
             FROM video_clips WHERE passage_id = ?",
        )
        .bind(passage_id)
        .fetch_optional(pool)
        .await?)
    }

    /// 写入短片（与短文同一事务）
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_clip_conn(
        conn: &mut sqlx::SqliteConnection,
        video_id: i64,
        passage_id: i64,
        seq: i64,
        start_ms: i64,
        end_ms: i64,
        file: &str,
        poster_file: Option<&str>,
    ) -> AppResult<i64> {
        Ok(sqlx::query(
            "INSERT INTO video_clips (video_id, passage_id, seq, start_ms, end_ms, file, poster_file, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(video_id)
        .bind(passage_id)
        .bind(seq)
        .bind(start_ms)
        .bind(end_ms)
        .bind(file)
        .bind(poster_file)
        .bind(crate::time::now_utc())
        .execute(&mut *conn)
        .await?
        .last_insert_rowid())
    }

    /// 删除视频（短片记录级联删除；短文由调用方处理）
    pub async fn delete(pool: &SqlitePool, id: i64) -> AppResult<bool> {
        let done = sqlx::query("DELETE FROM videos WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::memory_pool;

    fn cue(start: i64, en: &str) -> Cue {
        Cue {
            start_ms: start,
            end_ms: start + 1000,
            en: en.into(),
            zh: String::new(),
        }
    }

    #[tokio::test]
    async fn import_lifecycle_and_plan_round_trip() {
        let pool = memory_pool().await;
        let id = VideoRepository::insert(
            &pool,
            "Friends",
            "friends.mkv",
            Some("friends.srt"),
            &[cue(0, "Hi"), cue(2000, "Bye")],
            1234,
        )
        .await
        .unwrap();
        let row = VideoRepository::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.status, "importing");
        assert_eq!(row.cues().len(), 2);
        assert_eq!(row.clip_count, 0);
        crate::time::assert_instants_canonical(&pool).await;

        VideoRepository::finish_import(
            &pool,
            id,
            "source.mkv",
            "proxy.mp4",
            60_000,
            Some(1920),
            Some(1080),
        )
        .await
        .unwrap();
        let row = VideoRepository::get(&pool, id).await.unwrap().unwrap();
        assert_eq!((row.status.as_str(), row.duration_ms), ("ready", 60_000));

        let plan = VideoPlan {
            requirements: "每段 1 分钟".into(),
            segments: vec![crate::types::video::VideoSegment {
                id: "s1".into(),
                start_ms: 0,
                end_ms: 30_000,
                title: "打招呼".into(),
                ..Default::default()
            }],
        };
        assert!(VideoRepository::save_plan(&pool, id, &plan).await.unwrap());
        assert_eq!(
            VideoRepository::get(&pool, id)
                .await
                .unwrap()
                .unwrap()
                .plan(),
            Some(plan)
        );

        VideoRepository::clear_source(&pool, id).await.unwrap();
        let row = VideoRepository::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(
            (row.source_file, row.media_file.as_deref()),
            (None, Some("proxy.mp4"))
        );

        assert!(VideoRepository::delete(&pool, id).await.unwrap());
        assert!(VideoRepository::list(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn status_check_rejects_unknown_values() {
        let pool = memory_pool().await;
        let id = VideoRepository::insert(&pool, "t", "t.mp4", None, &[], 0)
            .await
            .unwrap();
        assert!(VideoRepository::set_status(&pool, id, "weird", None)
            .await
            .is_err());
        VideoRepository::set_status(&pool, id, "failed", Some("坏了"))
            .await
            .unwrap();
        let row = VideoRepository::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.error.as_deref(), Some("坏了"));
    }
}
