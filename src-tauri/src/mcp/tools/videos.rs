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

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PlanCutsArgs {
    pub video_id: i64,
    /// Revise this existing plan (from get_video); empty = new plan
    #[serde(default)]
    pub plan_id: Option<i64>,
    /// Name of a new plan (optional)
    #[serde(default)]
    pub name: Option<String>,
    /// What to cut, in Chinese (scenes, learner, purpose)
    #[serde(default)]
    pub requirements: Option<String>,
    #[serde(default)]
    pub min_seconds: Option<i64>,
    #[serde(default)]
    pub max_seconds: Option<i64>,
    /// How to change the existing plan (with plan_id)
    #[serde(default)]
    pub feedback: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VideoPlanArgs {
    /// Cut plan id (from get_video plans)
    pub plan_id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RenameVideoPlanArgs {
    pub plan_id: i64,
    pub name: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SubtitleOffsetArgs {
    pub video_id: i64,
    pub offset_ms: i64,
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

    #[tool(
        description = "Suggestions for how to cut a video into scene clips (based on its subtitles), e.g. which kinds of scenes to keep.",
        annotations(read_only_hint = true)
    )]
    async fn suggest_cuts(
        &self,
        Parameters(args): Parameters<VideoArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::suggest_video_requirements(
            self.app.clone(),
            args.video_id,
            false,
            None,
        )
        .await
        {
            Ok(list) => done(json!(list), "看了切分建议".to_string(), None),
            Err(e) => failed("没能给出切分建议", e),
        }
    }

    #[tool(
        description = "Plan how to cut a video into scene clips (the app's planner reads the subtitles; runs in the background). Give the requirements in Chinese (what scenes, for whom), clip length range in seconds. Creates a new plan unless plan_id is given; with feedback it revises that plan. Then cut_clips to cut them.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn plan_cuts(
        &self,
        Parameters(args): Parameters<PlanCutsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let plan_id = match args.plan_id {
            Some(id) => id,
            None => match crate::handlers::create_video_plan(
                self.app.clone(),
                args.video_id,
                args.name.clone(),
                None,
            )
            .await
            {
                Ok(p) => p.id,
                Err(e) => return failed("没能新建切分规划", e),
            },
        };
        let request = crate::types::video::StartVideoPlanRequest {
            video_id: args.video_id,
            plan_id,
            requirements: args.requirements.clone().unwrap_or_default(),
            min_seconds: args.min_seconds.unwrap_or(20),
            max_seconds: args.max_seconds.unwrap_or(90),
            feedback: args.feedback.clone().filter(|f| !f.trim().is_empty()),
        };
        match crate::handlers::start_video_plan(self.app.clone(), request).await {
            Ok(job) => {
                crate::mcp::job_notice::track(&job, true);
                done(
                    json!({ "planId": plan_id, "jobId": job, "note": "Not done yet: the cut plan is written in the background; you will get a notice, then read it with get_video." }),
                    "开始规划怎么切分（后台进行）".to_string(),
                    None,
                )
            }
            Err(e) => failed("没能开始规划切分", e),
        }
    }

    #[tool(
        description = "Cut the scene clips of a video by one of its plans (from get_video), each clip saved as a passage. Runs in the background; clips already cut with the same range are kept.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn cut_clips(
        &self,
        Parameters(args): Parameters<VideoPlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::start_video_processing(self.app.clone(), args.plan_id).await {
            Ok(job) => {
                crate::mcp::job_notice::track(&job, true);
                done(
                    json!({ "started": true, "jobId": job, "note": "Not done yet: the clips are cut in the background; you will get a notice when they are saved." }),
                    "开始切出场景片段（后台进行）".to_string(),
                    None,
                )
            }
            Err(e) => failed("没能开始切分", e),
        }
    }

    #[tool(
        description = "Rename a video's cut plan.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn rename_cut_plan(
        &self,
        Parameters(args): Parameters<RenameVideoPlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::rename_video_plan(
            self.app.clone(),
            args.plan_id,
            args.name.trim().to_string(),
        )
        .await
        {
            Ok(()) => done(
                json!({ "renamed": true }),
                format!("切分规划改名为「{}」", args.name.trim()),
                None,
            ),
            Err(e) => failed("没能给规划改名", e),
        }
    }

    #[tool(
        description = "Deletes a video's cut plan (clips already cut are kept). The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_cut_plan(
        &self,
        Parameters(args): Parameters<VideoPlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::delete_video_plan(self.app.clone(), args.plan_id).await {
            Ok(()) => done(
                json!({ "deleted": true }),
                "删除了切分规划".to_string(),
                None,
            ),
            Err(e) => failed("没能删除规划", e),
        }
    }

    #[tool(
        description = "Shift a video's subtitles when they are early or late: offset in milliseconds (positive = subtitles appear later).",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn set_subtitle_offset(
        &self,
        Parameters(args): Parameters<SubtitleOffsetArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::set_video_subtitle_offset(
            self.app.clone(),
            args.video_id,
            args.offset_ms,
        )
        .await
        {
            Ok(()) => done(
                json!({ "offsetMs": args.offset_ms }),
                format!("字幕调整了 {:.1} 秒", args.offset_ms as f64 / 1000.0),
                None,
            ),
            Err(e) => failed("没能调整字幕", e),
        }
    }

    #[tool(
        description = "Deletes the original video file to free disk space after its clips are cut (clips are kept; it cannot be cut again). The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_video_source(
        &self,
        Parameters(args): Parameters<VideoArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::delete_video_source(self.app.clone(), args.video_id).await {
            Ok(()) => done(
                json!({ "deleted": true }),
                "删除了原视频文件（场景片段保留）".to_string(),
                None,
            ),
            Err(e) => failed("没能删除原视频", e),
        }
    }
}
