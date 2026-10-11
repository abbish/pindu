//! 界面与整理：打开页面、后台任务、标签

use super::*;
use tauri::Emitter;

/// 打开哪个页面（前端监听 `tutor-open-page` 后跳转）
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct OpenPageArgs {
    /// word_book / passage / plan / video / practice（开始这个计划今天的练习）/ passage_practice（做某套题，id 为题组 id）/ continue_practice（接着没练完的那次），
    /// 或 word_books / passages / videos / plans / calendar / home
    pub target: String,
    /// The id of the word book / passage / plan / video / question set
    #[serde(default)]
    pub id: Option<i64>,
    /// passage_practice: reading or listening (must match the question set)
    #[serde(default)]
    pub mode: Option<String>,
    /// continue_practice: the session from unfinished_practice (empty = the latest)
    #[serde(default)]
    pub session_id: Option<String>,
}

/// 目标 → 页面键与参数（navigation.ts 的路由表）
pub fn page_of(target: &str, id: Option<i64>, mode: Option<&str>) -> Option<(&'static str, Value)> {
    let with_id = |page: &'static str, key: &str| id.map(|id| (page, json!({ key: id })));
    match target {
        "word_book" => with_id("wordbook-detail", "id"),
        "passage" => with_id("passage-detail", "passageId"),
        "plan" => with_id("plan-detail", "planId"),
        "video" => with_id("video-editor", "videoId"),
        "continue_practice" => None, // 需要会话：见 open_page 里的处理
        "passage_practice" => id.map(|id| {
            let mode = if mode == Some("listening") {
                "listening"
            } else {
                "reading"
            };
            ("passage-practice", json!({ "setId": id, "mode": mode }))
        }),
        "word_books" => Some(("wordbooks", Value::Null)),
        "passages" => Some(("passages", Value::Null)),
        "videos" => Some(("videos", Value::Null)),
        "plans" => Some(("plans", Value::Null)),
        "calendar" => Some(("calendar", Value::Null)),
        "home" => Some(("home", Value::Null)),
        _ => None,
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetTagsArgs {
    /// word_book / passage / video
    pub kind: String,
    /// The id of the word book / passage / video
    pub id: i64,
    /// Tag names (1–10 characters each); replaces all tags of this material. Reuse existing tag names.
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RenameTagArgs {
    pub tag_id: i64,
    /// New name; renaming to an existing tag's name merges the two
    pub name: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TagArgs {
    pub tag_id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct JobArgs {
    /// Job id from background_jobs
    pub job_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TagMaterialsArgs {
    /// word_book / passage / video
    pub kind: String,
    pub ids: Vec<i64>,
    /// Tag names to add (existing names preferred)
    #[serde(default)]
    pub add: Vec<String>,
    /// Tag names to remove
    #[serde(default)]
    pub remove: Vec<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ReadAloudArgs {
    /// English word or sentence
    pub text: String,
    /// Read slowly
    #[serde(default)]
    pub slow: Option<bool>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct MaterialArgs {
    /// word_book / passage
    pub kind: String,
    pub id: i64,
}

#[tool_router(router = organize_router, vis = "pub(super)")]
impl PinduTools {
    #[tool(
        description = "Open a page of the app for the learner: a word book, passage, study plan or video (clip editor) by id; `practice` starts today's practice of a plan (id = plan id, same as the plan's Start button); `passage_practice` opens a question set to answer (id = set id, mode reading / listening); `continue_practice` continues an unfinished practice (session_id from unfinished_practice); or a list page (word_books / passages / videos / plans / calendar / home). Use when the learner asks to open / go to / start something.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn open_page(
        &self,
        Parameters(args): Parameters<OpenPageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        // 开始计划今天的练习：不是一个页面，由前端按计划卡「开始学习」的规则决定去哪（TutorBridge → startPlanPractice）
        if args.target.trim() == "practice" {
            let Some(plan_id) = args.id else {
                return failed(
                    "没能开始练习",
                    AppError::ValidationError("缺少计划 id".to_string()),
                );
            };
            let _ = self
                .app
                .emit("tutor-start-practice", json!({ "planId": plan_id }));
            return done(
                json!({ "started": plan_id }),
                "开始今天的练习".to_string(),
                None,
            );
        }
        // 接着练没练完的那次：用 unfinished_practice 给的会话
        if args.target.trim() == "continue_practice" {
            let sessions = crate::handlers::get_incomplete_practice_sessions(self.app.clone())
                .await
                .unwrap_or_default();
            let Some(s) = sessions.iter().find(|s| {
                args.session_id
                    .as_deref()
                    .is_none_or(|id| id == s.session_id)
            }) else {
                return failed(
                    "没能接着练",
                    AppError::ValidationError("没有没练完的练习".to_string()),
                );
            };
            let _ = self.app.emit(
                "tutor-open-page",
                json!({ "page": "word-practice", "params": { "planId": s.plan_id, "scheduleId": s.schedule_id, "sessionId": s.session_id } }),
            );
            return done(
                json!({ "opened": "word-practice" }),
                "接着上次的练习".to_string(),
                None,
            );
        }
        let Some((page, params)) = page_of(args.target.trim(), args.id, args.mode.as_deref())
        else {
            return failed(
                "没能打开页面",
                AppError::ValidationError("不认识这个页面，或者缺少 id".to_string()),
            );
        };
        let _ = self
            .app
            .emit("tutor-open-page", json!({ "page": page, "params": params }));
        done(json!({ "opened": page }), "打开了页面".to_string(), None)
    }

    #[tool(
        description = "List all tags with how many word books, passages and clips use each.",
        annotations(read_only_hint = true)
    )]
    async fn list_tags(&self) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_tags(self.app.clone()).await {
            Ok(tags) => {
                let data: Vec<Value> = tags
                    .iter()
                    .map(|t| json!({ "id": t.tag.id, "name": t.tag.name, "wordBooks": t.word_books, "passages": t.passages, "clips": t.clips }))
                    .collect();
                done(json!(data), format!("看了标签：共 {} 个", tags.len()), None)
            }
            Err(e) => failed("没能查看标签", e),
        }
    }

    #[tool(
        description = "Set the tags of a word book, passage or video (replaces all its tags). Prefer existing tag names from list_tags.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn set_tags(
        &self,
        Parameters(args): Parameters<SetTagsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let ids = match self.tag_ids(&args.tags).await {
            Ok(ids) => ids,
            Err(e) => return failed("没能设置标签", e),
        };
        match crate::handlers::set_material_tags(self.app.clone(), args.kind.clone(), args.id, ids)
            .await
        {
            Ok(tags) => {
                let names: Vec<String> = tags.iter().map(|t| t.name.clone()).collect();
                let step = if names.is_empty() {
                    "去掉了标签".to_string()
                } else {
                    format!("设好了标签：{}", names.join("、"))
                };
                done(json!({ "tags": names }), step, None)
            }
            Err(e) => failed("没能设置标签", e),
        }
    }

    #[tool(
        description = "Rename a tag (renaming to an existing name merges the two tags).",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn rename_tag(
        &self,
        Parameters(args): Parameters<RenameTagArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::rename_tag(
            self.app.clone(),
            args.tag_id,
            args.name.trim().to_string(),
        )
        .await
        {
            Ok(tag) => done(
                json!({ "id": tag.id, "name": tag.name }),
                format!("标签改名为「{}」", tag.name),
                None,
            ),
            Err(e) => failed("没能改标签名", e),
        }
    }

    #[tool(
        description = "Deletes a tag (materials keep everything else). The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_tag(
        &self,
        Parameters(args): Parameters<TagArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::delete_tag(self.app.clone(), args.tag_id).await {
            Ok(()) => done(json!({ "deleted": true }), "删除了标签".to_string(), None),
            Err(e) => failed("没能删除标签", e),
        }
    }

    #[tool(
        description = "Stop a running background job (job id from background_jobs). The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn stop_job(
        &self,
        Parameters(args): Parameters<JobArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let jobs = self.app.state::<crate::jobs::Jobs>();
        let Some(job) = jobs
            .list()
            .into_iter()
            .find(|j| j.id == args.job_id.trim())
            .filter(|j| j.status.is_active())
        else {
            return failed(
                "没能停止任务",
                AppError::ValidationError("没有找到这个进行中的任务".to_string()),
            );
        };
        if jobs.cancel(&job.id) {
            done(
                json!({ "stopped": job.title }),
                format!("停止了「{}」", job.title),
                None,
            )
        } else {
            failed(
                "没能停止任务",
                AppError::ValidationError("这个任务已经结束了".to_string()),
            )
        }
    }

    #[tool(
        description = "Add and / or remove tags on several materials at once (kind word_book / passage / video).",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn tag_materials(
        &self,
        Parameters(args): Parameters<TagMaterialsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let add = match self.tag_ids(&args.add).await {
            Ok(ids) => ids,
            Err(e) => return failed("没能改标签", e),
        };
        let tags = match crate::handlers::get_tags(self.app.clone()).await {
            Ok(t) => t,
            Err(e) => return failed("没能改标签", e),
        };
        let remove: Vec<i64> = tags
            .iter()
            .filter(|t| args.remove.iter().any(|n| n.trim() == t.tag.name))
            .map(|t| t.tag.id)
            .collect();
        match crate::handlers::update_material_tags(
            self.app.clone(),
            args.kind.clone(),
            args.ids.clone(),
            add,
            remove,
        )
        .await
        {
            Ok(n) => done(
                json!({ "changed": n }),
                format!("改了 {} 份素材的标签", n),
                None,
            ),
            Err(e) => failed("没能改标签", e),
        }
    }

    #[tool(
        description = "Read an English word or sentence aloud to the learner with the app's voice (plays in the app).",
        annotations(read_only_hint = true)
    )]
    async fn read_aloud(
        &self,
        Parameters(args): Parameters<ReadAloudArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let text = args.text.trim().to_string();
        if text.is_empty() || text.chars().count() > 500 {
            return failed(
                "没能朗读",
                AppError::ValidationError("要读的内容为空或太长（500 字以内）".to_string()),
            );
        }
        let style = if text.contains(' ') {
            "sentence"
        } else {
            "word"
        };
        let _ = self.app.emit(
            "tutor-speak",
            json!({ "text": text, "style": style, "slow": args.slow.unwrap_or(false) }),
        );
        done(
            json!({ "playing": true }),
            format!("读了：{}", text.chars().take(40).collect::<String>()),
            None,
        )
    }

    #[tool(
        description = "Which study plans use a word book, passage or video clip (check before deleting or changing it).",
        annotations(read_only_hint = true)
    )]
    async fn material_plans(
        &self,
        Parameters(args): Parameters<MaterialArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_material_linked_plans(
            self.app.clone(),
            args.kind.clone(),
            args.id,
        )
        .await
        {
            Ok(plans) => {
                let data: Vec<Value> = plans
                    .iter()
                    .map(|p| json!({ "id": p.id, "name": p.name, "status": p.unified_status }))
                    .collect();
                done(
                    json!(data),
                    format!("查了用到它的计划：{} 个", plans.len()),
                    None,
                )
            }
            Err(e) => failed("没能查用到它的计划", e),
        }
    }
}
