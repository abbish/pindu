//! 界面与整理：打开页面、后台任务、标签

use super::*;
use tauri::Emitter;

/// 打开哪个页面（前端监听 `tutor-open-page` 后跳转）
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct OpenPageArgs {
    /// word_book / passage / plan / video（需要 id），或 word_books / passages / videos / plans / calendar / home
    pub target: String,
    /// The id of the word book / passage / plan / video
    #[serde(default)]
    pub id: Option<i64>,
}

/// 目标 → 页面键与参数（navigation.ts 的路由表）
pub fn page_of(target: &str, id: Option<i64>) -> Option<(&'static str, Value)> {
    let with_id = |page: &'static str, key: &str| id.map(|id| (page, json!({ key: id })));
    match target {
        "word_book" => with_id("wordbook-detail", "id"),
        "passage" => with_id("passage-detail", "passageId"),
        "plan" => with_id("plan-detail", "planId"),
        "video" => with_id("video-editor", "videoId"),
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
    /// Job title as shown by background_jobs
    pub title: String,
}

#[tool_router(router = organize_router, vis = "pub(super)")]
impl PinduTools {
    #[tool(
        description = "Open a page of the app for the learner: a word book, passage, study plan (where they start today's practice) or video (in the clip editor) by id, or a list page (word_books / passages / videos / plans / calendar / home). Use when the learner asks to open / go to / start something; the app switches to that page.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn open_page(
        &self,
        Parameters(args): Parameters<OpenPageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let Some((page, params)) = page_of(args.target.trim(), args.id) else {
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
        description = "Stop a running background job (by its title from background_jobs). The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn stop_job(
        &self,
        Parameters(args): Parameters<JobArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let jobs = self.app.state::<crate::jobs::Jobs>();
        let title = args.title.trim();
        let Some(job) = jobs
            .list()
            .into_iter()
            .find(|j| j.status.is_active() && j.title == title)
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
}
