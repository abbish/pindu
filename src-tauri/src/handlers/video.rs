//! 视频库命令：视频组件（ffmpeg）状态与位置、导入（后台任务）、列表 / 详情 / 波形、改名、规划草稿、删除。见 services/video.rs。

use crate::error::{AppError, AppResult};
use crate::jobs::{JobLink, JobSpec, Jobs, Lane};
use crate::logger::Logger;
use crate::media::{self, MediaTools, MediaToolsStatus};
use crate::repositories::settings_repository::SettingsRepository;
use crate::repositories::video_repository::VideoRepository;
use crate::services::{subtitle, video as video_service};
use crate::types::video::{
    StartVideoImportRequest, StartVideoPlanRequest, Video, VideoDetail, VideoImportStarted,
    VideoPlan,
};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// 字幕文件上限（字幕是文本，正常不到 1MB）
const MAX_SUBTITLE_BYTES: u64 = 5 * 1024 * 1024;

/// 找 ffmpeg（设置里指定的目录优先）
pub(crate) async fn media_tools(app: &AppHandle) -> AppResult<Option<MediaTools>> {
    let pool = app.state::<SqlitePool>();
    let setting = SettingsRepository::get(pool.inner(), media::FFMPEG_DIR_SETTING).await?;
    Ok(media::locate(setting.as_deref(), &crate::app_paths::dirs(app).data).await)
}

async fn require_tools(app: &AppHandle) -> AppResult<MediaTools> {
    media_tools(app).await?.ok_or_else(|| {
        AppError::ValidationError(
            "还没有视频组件（ffmpeg），请在「设置 → 通用 → 视频组件」里选择它所在的文件夹"
                .to_string(),
        )
    })
}

/// 视频组件状态
#[tauri::command]
pub async fn get_media_tools_status(app: AppHandle) -> AppResult<MediaToolsStatus> {
    let logger = app.state::<Logger>();
    logger.api_request("get_media_tools_status", None);
    let result = media_status(&app).await;
    super::finish(&logger, "get_media_tools_status", result)
}

async fn media_status(app: &AppHandle) -> AppResult<MediaToolsStatus> {
    let tools = media_tools(app).await?;
    Ok(MediaTools::status(tools.as_ref()).await)
}

/// 指定 ffmpeg 所在目录（None 表示恢复自动查找）；目录里没有可用的 ffmpeg 与 ffprobe 时拒绝
#[tauri::command]
pub async fn set_ffmpeg_dir(app: AppHandle, dir: Option<String>) -> AppResult<MediaToolsStatus> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    let dir = dir.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    logger.api_request(
        "set_ffmpeg_dir",
        Some(&format!(
            "dir: {}",
            dir.as_deref().unwrap_or("（自动查找）")
        )),
    );
    let result = async {
        if let Some(dir) = &dir {
            if media::locate_in(Path::new(dir)).await.is_none() {
                return Err(AppError::ValidationError(
                    "这个文件夹里没有可用的 ffmpeg 和 ffprobe".to_string(),
                ));
            }
        }
        let mut conn = pool.acquire().await?;
        SettingsRepository::set(&mut conn, media::FFMPEG_DIR_SETTING, dir.as_deref()).await?;
        media_status(&app).await
    }
    .await;
    super::finish(&logger, "set_ffmpeg_dir", result)
}

/// 导入视频与字幕（后台任务）：字幕在这里就解析，格式不对立即报错；视频复制、转码、生成时间轴在任务里做
#[tauri::command]
pub async fn start_video_import(
    app: AppHandle,
    request: StartVideoImportRequest,
) -> AppResult<VideoImportStarted> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_video_import",
        Some(&format!("video: {}", request.video_path)),
    );
    let result = async {
        let tools = require_tools(&app).await?;
        let source = Path::new(&request.video_path).to_path_buf();
        let size = std::fs::metadata(&source)
            .map_err(|_| AppError::ValidationError("找不到这个视频文件".to_string()))?
            .len();
        let primary = read_subtitle(&request.subtitle_path)?;
        let secondary = request
            .second_subtitle_path
            .as_deref()
            .filter(|p| !p.trim().is_empty())
            .map(read_subtitle)
            .transpose()?;
        let cues = subtitle::build_cues(&primary, secondary.as_deref())?;

        let source_name = file_name(&source);
        let title = request
            .title
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| {
                source
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| source_name.clone())
            });
        let video_id = VideoRepository::insert(
            pool.inner(),
            &title,
            &source_name,
            Some(&file_name(Path::new(&request.subtitle_path))),
            &cues,
            size as i64,
        )
        .await?;

        let import = video_service::VideoImport {
            pool: Arc::new(pool.inner().clone()),
            logger: Arc::new(logger.inner().clone()),
            tools,
            data_dir: crate::app_paths::dirs(&app).data,
            video_id,
            source,
        };
        let job_id = app.state::<Jobs>().spawn(
            JobSpec {
                kind: "video_import",
                title: format!("导入视频 · {title}"),
                lane: Lane::Media,
                detached: true,
                link: Some(JobLink::new(
                    "video-editor",
                    serde_json::json!({ "videoId": video_id }),
                )),
            },
            move |ctx| import.run(ctx),
        );
        Ok(VideoImportStarted { video_id, job_id })
    }
    .await;
    super::finish(&logger, "start_video_import", result)
}

fn read_subtitle(path: &str) -> AppResult<String> {
    let meta = std::fs::metadata(path)
        .map_err(|_| AppError::ValidationError("找不到字幕文件".to_string()))?;
    if meta.len() > MAX_SUBTITLE_BYTES {
        return Err(AppError::ValidationError(
            "字幕文件太大，不像是字幕".to_string(),
        ));
    }
    let bytes =
        std::fs::read(path).map_err(|e| AppError::InternalError(format!("读取字幕失败：{e}")))?;
    Ok(crate::services::passage_import::decode_text(&bytes))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 文件路径 → 本机媒体服务的地址（服务没启动时为 None）
fn url_of(app: &AppHandle) -> impl Fn(&Path) -> Option<String> {
    let server = app
        .try_state::<crate::media_server::MediaServer>()
        .map(|s| s.inner().clone());
    move |path| server.as_ref().and_then(|s| s.url(path))
}

#[tauri::command]
pub async fn get_videos(app: AppHandle) -> AppResult<Vec<Video>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request("get_videos", None);
    let data = crate::app_paths::dirs(&app).data;
    let result = VideoRepository::list(pool.inner()).await.map(|rows| {
        rows.iter()
            .map(|row| video_service::to_video(row, &data, &url_of(&app)))
            .collect()
    });
    super::finish(&logger, "get_videos", result)
}

#[tauri::command]
pub async fn get_video(app: AppHandle, video_id: i64) -> AppResult<VideoDetail> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request("get_video", Some(&format!("video_id: {video_id}")));
    let result = async {
        let row = VideoRepository::get(pool.inner(), video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?;
        let clips = VideoRepository::clips(pool.inner(), video_id).await?;
        let data = crate::app_paths::dirs(&app).data;
        // 短文库里删掉的短片只删了记录：顺手清掉没有记录的短片文件（处理中时不清，文件可能还没登记）
        if !busy(&app, video_id) {
            video_service::prune_clip_files(&data, video_id, &clips, &logger);
        }
        Ok(video_service::to_detail(&row, &data, &clips, &url_of(&app)))
    }
    .await;
    super::finish(&logger, "get_video", result)
}

/// 波形峰值（每秒 50 个，0–1）
#[tauri::command]
pub async fn get_video_peaks(app: AppHandle, video_id: i64) -> AppResult<Vec<f32>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_video_peaks", Some(&format!("video_id: {video_id}")));
    let peaks = video_service::read_peaks(&crate::app_paths::dirs(&app).data, video_id);
    super::finish(&logger, "get_video_peaks", Ok(peaks))
}

#[tauri::command]
pub async fn rename_video(app: AppHandle, video_id: i64, title: String) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("rename_video", Some(&format!("video_id: {video_id}")));
    let result = async {
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 100 {
            return Err(AppError::ValidationError("标题需要 1–100 个字".to_string()));
        }
        let pool = app.state::<SqlitePool>();
        if VideoRepository::rename(pool.inner(), video_id, title).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("视频不存在，可能已被删除".to_string()))
        }
    }
    .await;
    super::finish(&logger, "rename_video", result)
}

/// 保存切分规划草稿（编辑器自动保存）
#[tauri::command]
pub async fn save_video_plan(app: AppHandle, video_id: i64, plan: VideoPlan) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "save_video_plan",
        Some(&format!(
            "video_id: {video_id}, segments: {}",
            plan.segments.len()
        )),
    );
    let pool = app.state::<SqlitePool>();
    let result = match VideoRepository::save_plan(pool.inner(), video_id, &plan).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(AppError::NotFound("视频不存在，可能已被删除".to_string())),
        Err(e) => Err(e),
    };
    super::finish(&logger, "save_video_plan", result)
}

/// AI 规划切分（后台任务）：结果直接写进规划草稿，编辑器在任务结束时重新读取（可撤销）
#[tauri::command]
pub async fn start_video_plan(app: AppHandle, request: StartVideoPlanRequest) -> AppResult<String> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_video_plan",
        Some(&format!(
            "video_id: {}, {}–{}s, feedback: {}",
            request.video_id,
            request.min_seconds,
            request.max_seconds,
            request.feedback.is_some()
        )),
    );
    let result = async {
        if !(5..=900).contains(&request.min_seconds)
            || !(5..=900).contains(&request.max_seconds)
            || request.min_seconds > request.max_seconds
        {
            return Err(AppError::ValidationError(
                "每段时长需在 5–900 秒之间，最多不能小于最少".to_string(),
            ));
        }
        if request.requirements.chars().count() > 500
            || request
                .feedback
                .as_deref()
                .is_some_and(|f| f.chars().count() > 500)
        {
            return Err(AppError::ValidationError(
                "要求和意见各不超过 500 字".to_string(),
            ));
        }
        if busy(&app, request.video_id) {
            return Err(AppError::ValidationError(
                "这个视频正在处理，等它完成后再规划".to_string(),
            ));
        }
        let row = VideoRepository::get(pool.inner(), request.video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?;
        if row.status != "ready" && row.status != "done" {
            return Err(AppError::ValidationError("视频还没有导入完成".to_string()));
        }
        let pool_arc = Arc::new(pool.inner().clone());
        let logger_arc = Arc::new(logger.inner().clone());
        let job = crate::services::video_plan::VideoPlanJob {
            model: crate::services::agent_settings::AgentSettingsService::new(
                pool_arc.clone(),
                logger_arc.clone(),
            )
            .model_for(
                crate::services::agent_settings::AgentTaskKind::Passage,
                None,
            )
            .await?,
            profile: crate::services::prompt_profile::PromptProfileService::load(pool.inner())
                .await?,
            paths: super::agent_paths(&app)?,
            pool: pool_arc,
            logger: logger_arc,
            video_id: request.video_id,
            requirements: request.requirements.trim().to_string(),
            min_seconds: request.min_seconds,
            max_seconds: request.max_seconds,
            feedback: request.feedback.clone(),
        };
        Ok(app.state::<Jobs>().spawn(
            JobSpec {
                kind: "video_plan",
                title: format!("AI 规划切分 · {}", row.title),
                lane: Lane::Agent,
                detached: true,
                link: Some(JobLink::new(
                    "video-editor",
                    serde_json::json!({ "videoId": request.video_id }),
                )),
            },
            move |ctx| job.run(ctx),
        ))
    }
    .await;
    super::finish(&logger, "start_video_plan", result)
}

/// 按规划切出短片并生成短文（后台任务，media 队列）；已切好的片段跳过，可以中途停止后继续
#[tauri::command]
pub async fn start_video_processing(app: AppHandle, video_id: i64) -> AppResult<String> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_video_processing",
        Some(&format!("video_id: {video_id}")),
    );
    let result = async {
        if busy(&app, video_id) {
            return Err(AppError::ValidationError(
                "这个视频已经有任务在进行".to_string(),
            ));
        }
        let row = VideoRepository::get(pool.inner(), video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?;
        if row.plan().is_none_or(|p| p.segments.is_empty()) {
            return Err(AppError::ValidationError(
                "还没有片段，先规划切分".to_string(),
            ));
        }
        let pool_arc = Arc::new(pool.inner().clone());
        let logger_arc = Arc::new(logger.inner().clone());
        let job = crate::services::video_processing::VideoProcessJob {
            tools: require_tools(&app).await?,
            model: crate::services::agent_settings::AgentSettingsService::new(
                pool_arc.clone(),
                logger_arc.clone(),
            )
            .model_for(
                crate::services::agent_settings::AgentTaskKind::Passage,
                None,
            )
            .await?,
            profile: crate::services::prompt_profile::PromptProfileService::load(pool.inner())
                .await?,
            paths: super::agent_paths(&app)?,
            data_dir: crate::app_paths::dirs(&app).data,
            pool: pool_arc,
            logger: logger_arc,
            video_id,
        };
        Ok(app.state::<Jobs>().spawn(
            JobSpec {
                kind: "video_process",
                title: format!("切分视频 · {}", row.title),
                lane: Lane::Media,
                detached: true,
                link: Some(JobLink::new(
                    "video-editor",
                    serde_json::json!({ "videoId": video_id }),
                )),
            },
            move |ctx| job.run(ctx),
        ))
    }
    .await;
    super::finish(&logger, "start_video_processing", result)
}

/// 短文对应的视频短片；不是视频短片时返回 null
#[tauri::command]
pub async fn get_passage_video(
    app: AppHandle,
    passage_id: i64,
) -> AppResult<Option<crate::types::video::PassageVideo>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passage_video",
        Some(&format!("passage_id: {passage_id}")),
    );
    let result = passage_video(&app, passage_id).await;
    super::finish(&logger, "get_passage_video", result)
}

async fn passage_video(
    app: &AppHandle,
    passage_id: i64,
) -> AppResult<Option<crate::types::video::PassageVideo>> {
    let pool = app.state::<SqlitePool>();
    let Some(clip) = VideoRepository::clip_of_passage(pool.inner(), passage_id).await? else {
        return Ok(None);
    };
    let title = VideoRepository::get(pool.inner(), clip.video_id)
        .await?
        .map(|v| v.title)
        .unwrap_or_default();
    let data = crate::app_paths::dirs(app).data;
    let url = url_of(app);
    let path = |file: &str| {
        url(&crate::services::video_processing::clip_path(
            &data,
            clip.video_id,
            file,
        ))
    };
    Ok(Some(crate::types::video::PassageVideo {
        video_id: clip.video_id,
        video_title: title,
        clip_url: path(&clip.file)
            .ok_or_else(|| AppError::NotFound("短片文件不见了，可能已被删除".to_string()))?,
        poster_url: clip.poster_file.as_deref().and_then(path),
        start_ms: clip.start_ms,
        end_ms: clip.end_ms,
    }))
}

/// 有后台任务正在处理这个视频
fn busy(app: &AppHandle, video_id: i64) -> bool {
    app.state::<Jobs>().list().iter().any(|job| {
        job.status.is_active()
            && job
                .link
                .as_ref()
                .is_some_and(|l| l.params["videoId"] == video_id)
    })
}

#[tauri::command]
pub async fn delete_video(app: AppHandle, video_id: i64) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("delete_video", Some(&format!("video_id: {video_id}")));
    let result = async {
        if busy(&app, video_id) {
            return Err(AppError::ValidationError(
                "这个视频正在导入或处理，请先在后台任务里停止".to_string(),
            ));
        }
        let pool = app.state::<SqlitePool>();
        video_service::delete(
            &Arc::new(pool.inner().clone()),
            &crate::app_paths::dirs(&app).data,
            video_id,
            &logger,
        )
        .await
    }
    .await;
    super::finish(&logger, "delete_video", result)
}

/// 删除原视频释放空间（切分完成后）
#[tauri::command]
pub async fn delete_video_source(app: AppHandle, video_id: i64) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "delete_video_source",
        Some(&format!("video_id: {video_id}")),
    );
    let pool = app.state::<SqlitePool>();
    let result = video_service::delete_source(
        pool.inner(),
        &crate::app_paths::dirs(&app).data,
        video_id,
        &logger,
    )
    .await;
    super::finish(&logger, "delete_video_source", result)
}
