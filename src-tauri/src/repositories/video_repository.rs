//! 视频库的数据访问（videos / video_plans / video_clips，迁移 059、061）。文件路径在 service 层按数据目录拼出，这里只存文件名。

use crate::error::AppResult;
use crate::services::subtitle::Cue;
use crate::types::video::VideoPlan;
use sqlx::{FromRow, Row, SqlitePool};

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
    /// 「AI 规划」的要求建议 JSON（迁移 061）
    pub plan_suggestions: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub clip_count: i64,
    /// 字幕条数（SQL 里算，列表不读字幕本身）
    pub cue_count: i64,
    /// 字幕时间纠偏（毫秒，正数 = 字幕延后），迁移 060
    pub subtitle_offset_ms: i64,
}

impl VideoRow {
    /// 按纠偏换算后的字幕：显示、规划、切分一律用它（唯一换算点）
    pub fn cues(&self) -> Vec<Cue> {
        shift_cues(self.raw_cues(), self.subtitle_offset_ms)
    }

    /// 字幕文件里的原始时间（写回翻译时用，下标与 cues() 一一对应）
    pub fn raw_cues(&self) -> Vec<Cue> {
        serde_json::from_str(&self.cues).unwrap_or_default()
    }

    pub fn suggestions(&self) -> Vec<String> {
        self.plan_suggestions
            .as_deref()
            .and_then(|p| serde_json::from_str(p).ok())
            .unwrap_or_default()
    }
}

/// video_plans 表的一行：一个视频的一个切分规划（迁移 061）
#[derive(Debug, Clone, FromRow)]
pub struct PlanRow {
    pub id: i64,
    pub video_id: i64,
    pub name: String,
    pub plan: String,
    pub created_at: String,
    pub updated_at: String,
}

impl PlanRow {
    pub fn plan(&self) -> VideoPlan {
        serde_json::from_str(&self.plan).unwrap_or_default()
    }
}

/// 字幕整体平移 offset 毫秒（早于 0 的截到 0；条数与下标不变，翻译按下标写回原始字幕）
pub fn shift_cues(cues: Vec<Cue>, offset_ms: i64) -> Vec<Cue> {
    if offset_ms == 0 {
        return cues;
    }
    cues.into_iter()
        .map(|c| Cue {
            start_ms: (c.start_ms + offset_ms).max(0),
            end_ms: (c.end_ms + offset_ms).max(0),
            ..c
        })
        .collect()
}

fn clip_with_title(r: &sqlx::sqlite::SqliteRow) -> (ClipRow, String) {
    (
        ClipRow {
            video_id: r.get("video_id"),
            plan_id: r.get("plan_id"),
            passage_id: r.get("passage_id"),
            seq: r.get("seq"),
            start_ms: r.get("start_ms"),
            end_ms: r.get("end_ms"),
            file: r.get("file"),
            poster_file: r.get("poster_file"),
        },
        r.get("title"),
    )
}

/// video_clips 表的一行
#[derive(Debug, Clone, FromRow)]
pub struct ClipRow {
    pub video_id: i64,
    /// 从哪个规划切出来的（规划删除后为空）
    pub plan_id: Option<i64>,
    pub passage_id: i64,
    pub seq: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub file: String,
    pub poster_file: Option<String>,
}

/// 一个视频的全部信息（含字幕与规划）
const SELECT: &str = "SELECT v.id, v.title, v.source_name, v.source_file, v.media_file, v.subtitle_name,
        v.duration_ms, v.width, v.height, v.size_bytes, v.status, v.error, v.created_at, v.updated_at,
        (SELECT COUNT(*) FROM video_clips c WHERE c.video_id = v.id) AS clip_count, v.subtitle_offset_ms,
        json_array_length(v.cues) AS cue_count, v.cues, v.plan_suggestions
     FROM videos v";

/// 列表：不读字幕与建议（长视频的字幕有几百 KB，列表只要条数）
fn select_list() -> String {
    SELECT.replace(
        "v.cues, v.plan_suggestions",
        "'[]' AS cues, NULL AS plan_suggestions",
    )
}

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
            "{} ORDER BY v.created_at DESC, v.id DESC",
            select_list()
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

    // ==================== 切分规划（一个视频可以有多个） ====================

    const PLAN_SELECT: &'static str =
        "SELECT id, video_id, name, plan, created_at, updated_at FROM video_plans";

    /// 一个视频的全部规划（按创建顺序）
    pub async fn plans(pool: &SqlitePool, video_id: i64) -> AppResult<Vec<PlanRow>> {
        Ok(sqlx::query_as::<_, PlanRow>(&format!(
            "{} WHERE video_id = ? ORDER BY id",
            Self::PLAN_SELECT
        ))
        .bind(video_id)
        .fetch_all(pool)
        .await?)
    }

    pub async fn get_plan(pool: &SqlitePool, plan_id: i64) -> AppResult<Option<PlanRow>> {
        Ok(
            sqlx::query_as::<_, PlanRow>(&format!("{} WHERE id = ?", Self::PLAN_SELECT))
                .bind(plan_id)
                .fetch_optional(pool)
                .await?,
        )
    }

    pub async fn insert_plan(
        pool: &SqlitePool,
        video_id: i64,
        name: &str,
        plan: &VideoPlan,
    ) -> AppResult<i64> {
        let now = crate::time::now_utc();
        Ok(sqlx::query(
            "INSERT INTO video_plans (video_id, name, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(video_id)
        .bind(name)
        .bind(serde_json::to_string(plan).unwrap_or_else(|_| "{}".into()))
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?
        .last_insert_rowid())
    }

    pub async fn save_plan(pool: &SqlitePool, plan_id: i64, plan: &VideoPlan) -> AppResult<bool> {
        let done = sqlx::query("UPDATE video_plans SET plan = ?, updated_at = ? WHERE id = ?")
            .bind(serde_json::to_string(plan).unwrap_or_default())
            .bind(crate::time::now_utc())
            .bind(plan_id)
            .execute(pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }

    pub async fn rename_plan(pool: &SqlitePool, plan_id: i64, name: &str) -> AppResult<bool> {
        let done = sqlx::query("UPDATE video_plans SET name = ?, updated_at = ? WHERE id = ?")
            .bind(name)
            .bind(crate::time::now_utc())
            .bind(plan_id)
            .execute(pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }

    /// 删除规划（切出的短片保留，plan_id 置空）
    pub async fn delete_plan(pool: &SqlitePool, plan_id: i64) -> AppResult<bool> {
        let done = sqlx::query("DELETE FROM video_plans WHERE id = ?")
            .bind(plan_id)
            .execute(pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }

    pub async fn set_suggestions(
        pool: &SqlitePool,
        video_id: i64,
        suggestions: &[String],
    ) -> AppResult<()> {
        sqlx::query("UPDATE videos SET plan_suggestions = ? WHERE id = ?")
            .bind(serde_json::to_string(suggestions).unwrap_or_else(|_| "[]".into()))
            .bind(video_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// 字幕时间纠偏
    pub async fn set_subtitle_offset(
        pool: &SqlitePool,
        id: i64,
        offset_ms: i64,
    ) -> AppResult<bool> {
        let done =
            sqlx::query("UPDATE videos SET subtitle_offset_ms = ?, updated_at = ? WHERE id = ?")
                .bind(offset_ms)
                .bind(crate::time::now_utc())
                .bind(id)
                .execute(pool)
                .await?;
        Ok(done.rows_affected() > 0)
    }

    /// 写回字幕（补上的中文翻译；时间保持原始值）
    pub async fn update_cues(pool: &SqlitePool, id: i64, cues: &[Cue]) -> AppResult<bool> {
        let done = sqlx::query("UPDATE videos SET cues = ?, updated_at = ? WHERE id = ?")
            .bind(serde_json::to_string(cues).unwrap_or_default())
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
            "SELECT video_id, plan_id, passage_id, seq, start_ms, end_ms, file, poster_file
             FROM video_clips WHERE video_id = ? ORDER BY seq, id",
        )
        .bind(video_id)
        .fetch_all(pool)
        .await?)
    }

    /// 全部短片与所属视频的标题（切片列表、单词 ↔ 素材关联用），按视频导入顺序与段序
    pub async fn all_clips(pool: &SqlitePool) -> AppResult<Vec<(ClipRow, String)>> {
        let rows = sqlx::query(
            "SELECT c.video_id, c.plan_id, c.passage_id, c.seq, c.start_ms, c.end_ms, c.file, c.poster_file, v.title
             FROM video_clips c JOIN videos v ON v.id = c.video_id
             ORDER BY v.created_at DESC, c.video_id, c.seq, c.id",
        )
        .fetch_all(pool)
        .await?;
        Ok(rows.iter().map(clip_with_title).collect())
    }

    /// 指定短文的短片与所属视频标题
    pub async fn clips_of_passages(
        pool: &SqlitePool,
        passage_ids: &[i64],
    ) -> AppResult<Vec<(ClipRow, String)>> {
        let rows = sqlx::query(
            "SELECT c.video_id, c.plan_id, c.passage_id, c.seq, c.start_ms, c.end_ms, c.file, c.poster_file, v.title
             FROM video_clips c JOIN videos v ON v.id = c.video_id
             WHERE c.passage_id IN (SELECT value FROM json_each(?))",
        )
        .bind(serde_json::to_string(passage_ids).unwrap_or_else(|_| "[]".into()))
        .fetch_all(pool)
        .await?;
        Ok(rows.iter().map(clip_with_title).collect())
    }

    /// 短文对应的短片（短文详情页播放用）
    pub async fn clip_of_passage(pool: &SqlitePool, passage_id: i64) -> AppResult<Option<ClipRow>> {
        Ok(sqlx::query_as::<_, ClipRow>(
            "SELECT video_id, plan_id, passage_id, seq, start_ms, end_ms, file, poster_file
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
        plan_id: Option<i64>,
        passage_id: i64,
        seq: i64,
        start_ms: i64,
        end_ms: i64,
        file: &str,
        poster_file: Option<&str>,
    ) -> AppResult<i64> {
        Ok(sqlx::query(
            "INSERT INTO video_clips (video_id, plan_id, passage_id, seq, start_ms, end_ms, file, poster_file, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(video_id)
        .bind(plan_id)
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
            join: None,
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
        let plan_id = VideoRepository::insert_plan(&pool, id, "规划 1", &VideoPlan::default())
            .await
            .unwrap();
        assert!(VideoRepository::save_plan(&pool, plan_id, &plan)
            .await
            .unwrap());
        let plans = VideoRepository::plans(&pool, id).await.unwrap();
        assert_eq!((plans.len(), plans[0].plan()), (1, plan));
        assert!(VideoRepository::rename_plan(&pool, plan_id, "点餐")
            .await
            .unwrap());
        assert_eq!(
            VideoRepository::get_plan(&pool, plan_id)
                .await
                .unwrap()
                .unwrap()
                .name,
            "点餐"
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
