//! 学习情况、学习计划与后台任务

use super::*;

#[tool_router(router = study_router, vis = "pub(super)")]
impl PinduTools {
    #[tool(
        description = "Check background jobs (writing / saving passages, generating questions, spelling analysis of new words): status, progress and current stage. Running jobs and those finished in the last hour; `fromThisConversation` marks the ones you started here. Use it whenever the learner asks about progress, and before saying something you started is ready.",
        annotations(read_only_hint = true)
    )]
    async fn background_jobs(&self) -> Result<CallToolResult, ErrorData> {
        let since = crate::time::minutes_ago_utc(60);
        let here = crate::mcp::job_notice::current_conversation();
        let jobs = self.app.state::<crate::jobs::Jobs>().list();
        let shown: Vec<&crate::jobs::Job> = jobs
            .iter()
            .filter(|j| {
                j.status.is_active()
                    || j.finished_at
                        .as_deref()
                        .is_some_and(|t| t >= since.as_str())
            })
            .collect();
        let data: Vec<Value> = shown
            .iter()
            .map(|j| {
                let from_here = here.is_some() && crate::mcp::job_notice::origin_of(&j.id) == here;
                json!({
                    "id": j.id,
                    "title": j.title,
                    "status": job_status_text(j.status),
                    "progress": (j.total > 0).then(|| format!("{}/{}", j.current, j.total)),
                    "stage": j.stage,
                    "error": j.error.as_ref().and_then(|e| e.get("message")).cloned(),
                    "fromThisConversation": from_here,
                })
            })
            .collect();
        let running = shown.iter().filter(|j| j.status.is_active()).count();
        let step = if shown.is_empty() {
            "看了后台任务：没有进行中的".to_string()
        } else {
            format!(
                "看了后台任务：{} 个进行中，{} 个刚结束",
                running,
                shown.len() - running
            )
        };
        done(json!(data), step, None)
    }
}
