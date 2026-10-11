//! 视频与场景片段（导入视频、规划与切分在视频库 / 剪辑编辑器里做，AI 老师可以打开那里）

use super::*;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VideoArgs {
    pub video_id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RenameVideoArgs {
    pub video_id: i64,
    pub title: String,
}

#[tool_router(router = videos_router, vis = "pub(super)")]
impl PinduTools {
    #[tool(
        description = "List imported videos (id, title, length, status, how many scene clips were cut).",
        annotations(read_only_hint = true)
    )]
    async fn list_videos(&self) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_videos(self.app.clone()).await {
            Ok(videos) => {
                let data: Vec<Value> = videos
                    .iter()
                    .map(|v| json!({ "id": v.id, "title": v.title, "minutes": (v.duration_ms as f64 / 60000.0 * 10.0).round() / 10.0,
                                     "status": v.status, "clips": v.clip_count, "subtitles": v.cue_count }))
                    .collect();
                done(
                    json!(data),
                    format!("看了视频库：共 {} 个视频", videos.len()),
                    None,
                )
            }
            Err(e) => failed("没能查看视频库", e),
        }
    }

    #[tool(
        description = "List scene clips cut from videos (each is a passage: id, title, level, video, vocabulary). Use get_passage with the id for the subtitles and translation.",
        annotations(read_only_hint = true)
    )]
    async fn list_clips(&self) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_clips(self.app.clone()).await {
            Ok(clips) => {
                let data: Vec<Value> = clips
                    .iter()
                    .map(|c| json!({ "passageId": c.passage.id, "title": c.passage.title, "level": c.passage.level,
                                     "video": c.video_title, "videoId": c.video_id, "seconds": (c.end_ms - c.start_ms) / 1000,
                                     "vocabulary": c.passage.target_words.iter().map(|w| w.word.clone()).collect::<Vec<_>>() }))
                    .collect();
                done(
                    json!(data),
                    format!("看了场景片段：共 {} 个", clips.len()),
                    None,
                )
            }
            Err(e) => failed("没能查看场景片段", e),
        }
    }

    #[tool(
        description = "One video: title, length, cut plans, scene clips, and the first subtitles (to understand what it is about).",
        annotations(read_only_hint = true)
    )]
    async fn get_video(
        &self,
        Parameters(args): Parameters<VideoArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_video(self.app.clone(), args.video_id).await {
            Ok(detail) => {
                let subtitles: Vec<String> =
                    detail.cues.iter().take(80).map(|c| c.en.clone()).collect();
                let clips: Vec<Value> = detail
                    .clips
                    .iter()
                    .map(|c| json!({ "passageId": c.passage_id, "seq": c.seq, "seconds": (c.end_ms - c.start_ms) / 1000 }))
                    .collect();
                let plans: Vec<Value> = detail
                    .plans
                    .iter()
                    .map(|p| json!({ "id": p.id, "name": p.name }))
                    .collect();
                done(
                    json!({ "id": detail.video.id, "title": detail.video.title, "status": detail.video.status,
                            "plans": plans, "clips": clips, "subtitles": subtitles, "subtitleCount": detail.cues.len() }),
                    format!("看了视频《{}》", detail.video.title),
                    None,
                )
            }
            Err(e) => failed("没能打开视频", e),
        }
    }

    #[tool(
        description = "Rename a video.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn rename_video(
        &self,
        Parameters(args): Parameters<RenameVideoArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let title = args.title.trim().to_string();
        match crate::handlers::rename_video(self.app.clone(), args.video_id, title.clone()).await {
            Ok(()) => done(
                json!({ "title": title }),
                format!("视频改名为《{}》", title),
                None,
            ),
            Err(e) => failed("没能给视频改名", e),
        }
    }

    #[tool(
        description = "Deletes a video together with the scene clips cut from it. Not allowed while a study plan still uses its clips. The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_video(
        &self,
        Parameters(args): Parameters<VideoArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::delete_video(self.app.clone(), args.video_id).await {
            Ok(()) => done(
                json!({ "deleted": true }),
                "删除了视频和它的场景片段".to_string(),
                None,
            ),
            Err(e) => failed("没能删除视频", e),
        }
    }
}
