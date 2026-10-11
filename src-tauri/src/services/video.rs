//! 视频库：导入（后台任务：复制 → 读取信息 → 需要时转成可编辑格式 → 波形与缩略图）、列表与详情、规划草稿、删除。
//!
//! 文件都在 `<数据目录>/videos/<id>/`：source.<扩展名>（原视频）、proxy.mp4（编辑用，原视频能直接播放时没有）、
//! peaks.json（波形）、thumbs/thumb_0001.jpg…（时间轴缩略图）、cover.jpg（封面）、clips/（切出来的短片）。数据库只存文件名。

use crate::error::{AppError, AppResult};
use crate::jobs::JobCtx;
use crate::logger::Logger;
use crate::media::MediaTools;
use crate::repositories::video_repository::{ClipRow, VideoRepository, VideoRow};
use crate::types::video::{Video, VideoClip, VideoDetail};
use serde_json::Value;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const PEAKS_FILE: &str = "peaks.json";
const THUMBS_DIR: &str = "thumbs";
const PROXY_FILE: &str = "proxy.mp4";
const COVER_FILE: &str = "cover.jpg";
/// 黑场 / 纯色的 360p 封面只有 2KB 左右，有画面的一般 10KB 以上
const MIN_COVER_BYTES: u64 = 6 * 1024;
/// 封面最多试几个位置
const COVER_TRIES: usize = 5;
const COPY_CHUNK: usize = 4 * 1024 * 1024;

/// 视频文件所在目录
pub fn video_dir(data_dir: &Path, id: i64) -> PathBuf {
    data_dir.join("videos").join(id.to_string())
}

/// 时间轴缩略图间隔：整段大约 400 张，2–30 秒一张
pub fn thumb_interval_ms(duration_ms: i64) -> i64 {
    ((duration_ms / 400 / 1000).clamp(2, 30)) * 1000
}

/// 文件路径 → 播放地址（本机媒体服务，见 media_server.rs）
pub type UrlOf<'a> = &'a dyn Fn(&Path) -> Option<String>;

fn thumbs(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir.join(THUMBS_DIR))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|e| e == "jpg"))
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// 做封面的候选缩略图，按画面信息从多到少（JPEG 越大细节越多；黑场、纯色只有几百字节）。
/// 跳过开头和结尾各 5%（片头、片尾字幕）；同样大小靠前的在前
fn cover_candidates(sizes: &[u64]) -> Vec<usize> {
    let n = sizes.len();
    let skip = n / 20;
    let mut out: Vec<usize> = if n > 2 * skip {
        (skip..n - skip).collect()
    } else {
        (0..n).collect()
    };
    out.sort_by_key(|&i| std::cmp::Reverse(sizes[i]));
    out
}

/// 还没有封面（cover.jpg）时用的缩略图
fn fallback_cover(thumbs: &[PathBuf]) -> Option<&PathBuf> {
    let sizes: Vec<u64> = thumbs.iter().map(|p| file_size(p)).collect();
    cover_candidates(&sizes).first().map(|&i| &thumbs[i])
}

/// 生成封面 cover.jpg：在画面信息最多的几张缩略图的位置截 360p 的关键帧，截到黑场就换下一个位置。
/// 返回是否生成成功（都不行时不留文件，列表继续用缩略图）
pub async fn make_cover(
    tools: &MediaTools,
    dir: &Path,
    media_file: &str,
    duration_ms: i64,
) -> AppResult<bool> {
    let thumbs = thumbs(dir);
    let sizes: Vec<u64> = thumbs.iter().map(|p| file_size(p)).collect();
    let interval = thumb_interval_ms(duration_ms);
    let out = dir.join(COVER_FILE);
    for i in cover_candidates(&sizes).into_iter().take(COVER_TRIES) {
        // 第 i 张缩略图大约在 i × 间隔处；从半个间隔前开始找关键帧
        let at = (i as i64 * interval - interval / 2).max(0);
        tools
            .keyframe_poster(&dir.join(media_file), at, &out)
            .await?;
        if file_size(&out) >= MIN_COVER_BYTES {
            return Ok(true);
        }
    }
    let _ = std::fs::remove_file(&out);
    Ok(false)
}

/// 已导入、还没有封面的视频：(id, 视频目录, 编辑用文件, 时长)
pub fn missing_covers(rows: &[VideoRow], data_dir: &Path) -> Vec<(i64, PathBuf, String, i64)> {
    rows.iter()
        .filter_map(|row| {
            let media = row.media_file.clone()?;
            let dir = video_dir(data_dir, row.id);
            (!dir.join(COVER_FILE).exists() && !thumbs(&dir).is_empty()).then_some((
                row.id,
                dir,
                media,
                row.duration_ms,
            ))
        })
        .collect()
}

/// 本次运行里补过封面的视频（列表每次加载都会检查：不重复补，补不出来的也不反复试）
static COVER_BACKFILL: std::sync::Mutex<Vec<i64>> = std::sync::Mutex::new(Vec::new());

/// 给更新前导入的视频补封面（后台逐个生成，下次加载列表时显示）
pub fn backfill_covers(
    tools: MediaTools,
    list: Vec<(i64, PathBuf, String, i64)>,
    logger: Arc<Logger>,
) {
    let list: Vec<_> = {
        let Ok(mut tried) = COVER_BACKFILL.lock() else {
            return;
        };
        let fresh: Vec<_> = list
            .into_iter()
            .filter(|(id, ..)| !tried.contains(id))
            .collect();
        tried.extend(fresh.iter().map(|(id, ..)| *id));
        fresh
    };
    if list.is_empty() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        for (id, dir, media, duration_ms) in list {
            match make_cover(&tools, &dir, &media, duration_ms).await {
                Ok(true) => logger.info("VIDEO", &format!("视频 {id} 已补封面")),
                Ok(false) => {}
                Err(e) => logger.warn(
                    "VIDEO",
                    &format!("视频 {id} 补封面失败，继续用缩略图"),
                    Some(&e.to_string()),
                ),
            }
        }
    });
}

/// 数据库行 → 前端类型（文件名换成绝对路径）
pub fn to_video(row: &VideoRow, data_dir: &Path, url: UrlOf) -> Video {
    let dir = video_dir(data_dir, row.id);
    let thumbs = thumbs(&dir);
    Video {
        id: row.id,
        title: row.title.clone(),
        source_name: row.source_name.clone(),
        subtitle_name: row.subtitle_name.clone(),
        has_source: row.source_file.is_some(),
        media_url: row.media_file.as_ref().and_then(|f| url(&dir.join(f))),
        cover_url: Some(dir.join(COVER_FILE))
            .filter(|p| p.exists())
            .as_ref()
            .or(fallback_cover(&thumbs))
            .and_then(|p| url(p)),
        duration_ms: row.duration_ms,
        width: row.width,
        height: row.height,
        size_bytes: row.size_bytes,
        status: row.status.clone(),
        error: row.error.clone(),
        cue_count: row.cue_count,
        clip_count: row.clip_count,
        subtitle_offset_ms: row.subtitle_offset_ms,
        tags: Vec::new(),
        created_at: row.created_at.clone(),
        updated_at: row.updated_at.clone(),
    }
}

pub fn to_detail(
    row: &VideoRow,
    plans: &[crate::repositories::video_repository::PlanRow],
    data_dir: &Path,
    clips: &[ClipRow],
    url: UrlOf,
) -> VideoDetail {
    VideoDetail {
        video: to_video(row, data_dir, url),
        cues: row.cues(),
        plans: plans
            .iter()
            .map(|p| crate::types::video::VideoPlanInfo {
                id: p.id,
                name: p.name.clone(),
                plan: p.plan(),
                created_at: p.created_at.clone(),
                updated_at: p.updated_at.clone(),
            })
            .collect(),
        thumbs: thumbs(&video_dir(data_dir, row.id))
            .iter()
            .filter_map(|p| url(p))
            .collect(),
        thumb_interval_ms: thumb_interval_ms(row.duration_ms),
        clips: clips
            .iter()
            .map(|c| VideoClip {
                passage_id: c.passage_id,
                plan_id: c.plan_id,
                seq: c.seq,
                start_ms: c.start_ms,
                end_ms: c.end_ms,
            })
            .collect(),
    }
}

/// 波形峰值（每秒 media::PEAKS_PER_SECOND 个）；还没生成时为空
pub fn read_peaks(data_dir: &Path, id: i64) -> Vec<f32> {
    std::fs::read_to_string(video_dir(data_dir, id).join(PEAKS_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// 导入任务：在 media 队列里执行；失败时把原因记到视频上，取消时删掉这条视频
pub struct VideoImport {
    pub pool: Arc<SqlitePool>,
    pub logger: Arc<Logger>,
    pub tools: MediaTools,
    pub data_dir: PathBuf,
    pub video_id: i64,
    pub source: PathBuf,
}

impl VideoImport {
    pub async fn run(self, ctx: JobCtx) -> AppResult<Value> {
        let dir = video_dir(&self.data_dir, self.video_id);
        match self.import(&ctx, &dir).await {
            Ok(()) => Ok(serde_json::json!({ "videoId": self.video_id })),
            Err(e) if ctx.is_cancelled() => {
                let _ = std::fs::remove_dir_all(&dir);
                VideoRepository::delete(&self.pool, self.video_id).await?;
                Err(e)
            }
            Err(e) => {
                self.logger.error(
                    "VIDEO",
                    &format!("导入视频 {} 失败", self.video_id),
                    Some(&e.to_string()),
                );
                VideoRepository::set_status(
                    &self.pool,
                    self.video_id,
                    "failed",
                    Some(&user_text(&e)),
                )
                .await?;
                Err(e)
            }
        }
    }

    async fn import(&self, ctx: &JobCtx, dir: &Path) -> AppResult<()> {
        std::fs::create_dir_all(dir).map_err(io_error)?;
        let ext = self
            .source
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_else(|| "mp4".into());
        let source_file = format!("source.{ext}");
        let source = dir.join(&source_file);

        ctx.stage("复制视频");
        copy_with_progress(
            &self.source,
            &source,
            |f| ctx.progress((f * 30.0) as u64, 100),
            || ctx.is_cancelled(),
        )
        .await?;

        ctx.stage("读取视频信息");
        let info = self.tools.probe(&source).await?;

        let media_file = if info.browser_playable() {
            source_file.clone()
        } else {
            ctx.stage("转成可以编辑的格式");
            self.tools
                .make_proxy(
                    &source,
                    &dir.join(PROXY_FILE),
                    info.duration_ms,
                    |f| ctx.progress(30 + (f * 50.0) as u64, 100),
                    || ctx.is_cancelled(),
                )
                .await?;
            PROXY_FILE.to_string()
        };

        ctx.stage("生成波形和缩略图");
        ctx.progress(85, 100);
        // 没有音轨等情况：时间轴不显示波形，导入照常完成
        let peaks = self.tools.peaks(&source).await.unwrap_or_else(|e| {
            self.logger.warn(
                "VIDEO",
                &format!("视频 {} 生成波形失败，时间轴不显示波形", self.video_id),
                Some(&e.to_string()),
            );
            Vec::new()
        });
        std::fs::write(
            dir.join(PEAKS_FILE),
            serde_json::to_string(&peaks).unwrap_or_default(),
        )
        .map_err(io_error)?;
        let interval_s = (thumb_interval_ms(info.duration_ms) / 1000) as u32;
        self.tools
            .filmstrip(&dir.join(&media_file), &dir.join(THUMBS_DIR), interval_s)
            .await?;
        // 封面不影响导入：失败时列表用缩略图
        if let Err(e) = make_cover(&self.tools, dir, &media_file, info.duration_ms).await {
            self.logger.warn(
                "VIDEO",
                &format!("视频 {} 生成封面失败，用缩略图代替", self.video_id),
                Some(&e.to_string()),
            );
        }

        VideoRepository::finish_import(
            &self.pool,
            self.video_id,
            &source_file,
            &media_file,
            info.duration_ms,
            info.width,
            info.height,
        )
        .await
    }
}

/// 分块复制，报告进度（0–1），可取消
async fn copy_with_progress(
    from: &Path,
    to: &Path,
    mut on_progress: impl FnMut(f64),
    cancelled: impl Fn() -> bool,
) -> AppResult<()> {
    let mut src = tokio::fs::File::open(from).await.map_err(io_error)?;
    let total = src.metadata().await.map_err(io_error)?.len().max(1);
    let mut dst = tokio::fs::File::create(to).await.map_err(io_error)?;
    let mut buf = vec![0u8; COPY_CHUNK];
    let mut copied = 0u64;
    loop {
        if cancelled() {
            return Err(AppError::ValidationError(
                crate::agent::session::CANCELLED.to_string(),
            ));
        }
        let n = src.read(&mut buf).await.map_err(io_error)?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).await.map_err(io_error)?;
        copied += n as u64;
        on_progress(copied as f64 / total as f64);
    }
    dst.flush().await.map_err(io_error)?;
    Ok(())
}

/// 删除视频、它切出的短片（短文）和文件；有短片还在没结束的计划里时拒绝
pub async fn delete(
    pool: &Arc<SqlitePool>,
    data_dir: &Path,
    id: i64,
    logger: &Logger,
) -> AppResult<()> {
    VideoRepository::get(pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?;
    let clips = VideoRepository::clips(pool, id).await?;
    let plans_repo =
        crate::repositories::plan_passage_repository::PlanPassageRepository::new(pool.clone());
    let mut in_plans: Vec<String> = Vec::new();
    for clip in &clips {
        for plan in plans_repo
            .unfinished_plans_using_passage(clip.passage_id)
            .await?
        {
            if !in_plans.contains(&plan) {
                in_plans.push(plan);
            }
        }
    }
    if !in_plans.is_empty() {
        return Err(AppError::ValidationError(format!(
            "这个视频的短片在计划「{}」里，计划还没结束；先从计划里去掉这些短片再删除",
            in_plans.join("」「")
        )));
    }
    let passages = crate::repositories::passage_repository::PassageRepository::new(pool.clone());
    for clip in &clips {
        passages.delete(clip.passage_id).await?;
    }
    VideoRepository::delete(pool, id).await?;
    logger.info(
        "VIDEO",
        &format!("删除视频 {id}，连同 {} 篇短片短文", clips.len()),
    );
    // 记录已删；文件删不掉只占空间，不影响使用
    if let Err(e) = std::fs::remove_dir_all(video_dir(data_dir, id)) {
        if e.kind() != std::io::ErrorKind::NotFound {
            logger.warn(
                "VIDEO",
                &format!("视频 {id} 的文件夹没删掉"),
                Some(&e.to_string()),
            );
        }
    }
    Ok(())
}

/// 删掉 clips/ 下没有短片记录的文件（短片的短文在短文库里被删时，记录级联删除，文件留下）
pub fn prune_clip_files(data_dir: &Path, id: i64, clips: &[ClipRow], logger: &Logger) {
    let dir = video_dir(data_dir, id).join("clips");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let keep: Vec<String> = clips
        .iter()
        .flat_map(|c| [Some(c.file.clone()), c.poster_file.clone()])
        .flatten()
        .filter_map(|f| f.rsplit('/').next().map(str::to_string))
        .collect();
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if keep.contains(&name) {
            continue;
        }
        match std::fs::remove_file(entry.path()) {
            Ok(()) => removed += 1,
            Err(e) => logger.warn(
                "VIDEO",
                &format!("视频 {id} 的残留短片文件 {name} 没删掉"),
                Some(&e.to_string()),
            ),
        }
    }
    if removed > 0 {
        logger.info(
            "VIDEO",
            &format!("清理视频 {id} 没有记录的短片文件 {removed} 个"),
        );
    }
}

/// 删除原视频释放空间（编辑用的文件就是原视频时不能删）
pub async fn delete_source(
    pool: &SqlitePool,
    data_dir: &Path,
    id: i64,
    logger: &Logger,
) -> AppResult<()> {
    let row = VideoRepository::get(pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?;
    let Some(source) = row.source_file.as_deref() else {
        return Ok(());
    };
    if row.status != "done" {
        return Err(AppError::ValidationError(
            "切分完成后才能删除原视频（之后就不能再重新切分了）".to_string(),
        ));
    }
    // 删不掉就不改记录，用户可以再试
    if let Err(e) = std::fs::remove_file(video_dir(data_dir, id).join(source)) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err(io_error(e));
        }
    }
    VideoRepository::clear_source(pool, id).await?;
    logger.info("VIDEO", &format!("删除视频 {id} 的原视频文件"));
    Ok(())
}

/// 失败原因写到视频上时只留用户能看懂的部分
fn user_text(e: &AppError) -> String {
    let text = e.to_string();
    text.split_once(": ")
        .map(|(_, rest)| rest.to_string())
        .unwrap_or(text)
}

fn io_error(e: std::io::Error) -> AppError {
    AppError::InternalError(format!("读写视频文件失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cover_candidates_skip_black_frames_and_credits() {
        assert!(cover_candidates(&[]).is_empty());
        assert_eq!(cover_candidates(&[300]), [0]);
        // 开头黑场、中间有画面：细节多的在前，同样大小靠前的在前，黑场最后
        assert_eq!(
            cover_candidates(&[316, 313, 1423, 2471, 2071, 2471]),
            [3, 5, 4, 2, 0, 1]
        );
        // 20 张：第一张和最后一张（片头、片尾字幕）再大也不选
        let mut sizes = vec![1000; 20];
        sizes[0] = 5000;
        sizes[19] = 9000;
        sizes[7] = 2000;
        let out = cover_candidates(&sizes);
        assert_eq!(out[0], 7);
        assert!(!out.contains(&0) && !out.contains(&19));
    }

    #[test]
    fn thumb_interval_scales_with_duration() {
        assert_eq!(thumb_interval_ms(60_000), 2000);
        assert_eq!(thumb_interval_ms(3_600_000), 9000);
        assert_eq!(thumb_interval_ms(36_000_000), 30_000);
    }

    #[tokio::test]
    async fn copy_reports_progress_and_can_be_cancelled() {
        let dir = std::env::temp_dir().join(format!("pindu-copy-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let from = dir.join("a.bin");
        std::fs::write(&from, vec![7u8; COPY_CHUNK * 2 + 10]).unwrap();
        let mut seen = Vec::new();
        copy_with_progress(&from, &dir.join("b.bin"), |f| seen.push(f), || false)
            .await
            .unwrap();
        assert_eq!(
            std::fs::metadata(dir.join("b.bin")).unwrap().len(),
            (COPY_CHUNK * 2 + 10) as u64
        );
        // 每次读到的块大小不固定：只要求进度递增并以 1 结束
        assert!(seen.len() >= 3 && seen.windows(2).all(|w| w[0] < w[1]));
        assert!((seen.last().unwrap() - 1.0).abs() < 1e-9);
        assert!(
            copy_with_progress(&from, &dir.join("c.bin"), |_| {}, || true)
                .await
                .is_err()
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn delete_removes_row_and_files() {
        let pool = crate::test_support::memory_pool().await;
        let data = std::env::temp_dir().join(format!("pindu-video-{}", std::process::id()));
        let id = VideoRepository::insert(&pool, "t", "t.mp4", None, &[], 0)
            .await
            .unwrap();
        std::fs::create_dir_all(video_dir(&data, id)).unwrap();
        delete(&pool, &data, id, &crate::test_support::test_logger())
            .await
            .unwrap();
        assert!(!video_dir(&data, id).exists());
        assert!(
            delete(&pool, &data, id, &crate::test_support::test_logger())
                .await
                .is_err()
        );
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn prune_keeps_only_recorded_clip_files() {
        let data = std::env::temp_dir().join(format!("pindu-prune-{}", std::process::id()));
        let clips_dir = video_dir(&data, 7).join("clips");
        std::fs::create_dir_all(&clips_dir).unwrap();
        for f in ["a.mp4", "a.jpg", "b.mp4"] {
            std::fs::write(clips_dir.join(f), b"x").unwrap();
        }
        let clip = ClipRow {
            video_id: 7,
            plan_id: None,
            passage_id: 1,
            seq: 1,
            start_ms: 0,
            end_ms: 1,
            file: "clips/a.mp4".into(),
            poster_file: Some("clips/a.jpg".into()),
        };
        prune_clip_files(&data, 7, &[clip], &crate::test_support::test_logger());
        assert!(clips_dir.join("a.mp4").exists() && clips_dir.join("a.jpg").exists());
        assert!(!clips_dir.join("b.mp4").exists());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn user_text_drops_error_category_prefix() {
        assert_eq!(
            user_text(&AppError::ExternalServiceError("ffmpeg 处理失败：x".into())),
            "ffmpeg 处理失败：x"
        );
    }
}

/// 真实 ffmpeg 端到端：`PINDU_FFMPEG_DIR=<目录> PINDU_SAMPLE_VIDEO=<视频> cargo test real_video_import -- --ignored`
#[cfg(test)]
mod real_tests {
    use super::*;
    use crate::jobs::{JobSpec, Jobs, Lane};

    #[tokio::test]
    #[ignore]
    async fn real_video_import() {
        let tools = crate::media::locate_in(Path::new(&std::env::var("PINDU_FFMPEG_DIR").unwrap()))
            .await
            .expect("ffmpeg");
        let source = PathBuf::from(std::env::var("PINDU_SAMPLE_VIDEO").unwrap());
        let pool = crate::test_support::memory_pool().await;
        let data = std::env::temp_dir().join(format!("pindu-real-import-{}", std::process::id()));
        let id = VideoRepository::insert(&pool, "sample", "sample", None, &[], 0)
            .await
            .unwrap();
        let jobs = Jobs::new(|job| {
            eprintln!(
                "{:?} {:?} {}/{}",
                job.status, job.stage, job.current, job.total
            )
        });
        let import = VideoImport {
            pool: pool.clone(),
            logger: crate::test_support::test_logger(),
            tools: tools.clone(),
            data_dir: data.clone(),
            video_id: id,
            source,
        };
        let spec = JobSpec {
            kind: "video_import",
            module: None,
            title: "t".into(),
            lane: Lane::Media,
            detached: true,
            link: None,
        };
        let job_id = jobs.spawn(spec, move |ctx| import.run(ctx));
        let job = loop {
            let job = jobs.get(&job_id).unwrap();
            if !job.status.is_active() {
                break job;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        };
        assert!(job.error.is_none(), "{:?}", job.error);
        let row = VideoRepository::get(&pool, id).await.unwrap().unwrap();
        let detail = to_detail(&row, &[], &data, &[], &|p| Some(p.display().to_string()));
        eprintln!(
            "status={} duration={} media={:?} thumbs={} peaks={}",
            row.status,
            row.duration_ms,
            row.media_file,
            detail.thumbs.len(),
            read_peaks(&data, id).len()
        );
        assert_eq!(row.status, "ready");
        assert!(!detail.thumbs.is_empty());
        let media = video_dir(&data, id).join(row.media_file.unwrap());
        let info = tools.probe(&media).await.unwrap();
        assert!(info.browser_playable());
        let _ = std::fs::remove_dir_all(&data);
    }
}
