//! 学习情况、学习计划与后台任务

use super::*;

#[tool_router(router = study_router, vis = "pub(super)")]
impl PinduTools {
    #[tool(
        description = "The learner's current study plans with progress, and words they got wrong most in the last 30 days.",
        annotations(read_only_hint = true)
    )]
    async fn learning_overview(&self) -> Result<CallToolResult, ErrorData> {
        let plans = crate::services::study_plan::StudyPlanService::new(self.pool(), self.logger())
            .get_study_plans_with_progress(false)
            .await;
        let trouble =
            tutor_repository::trouble_words(&self.pool(), &crate::time::days_ago_utc(30), 20).await;
        match (plans, trouble) {
            (Ok(plans), Ok(trouble)) => {
                let plans: Vec<Value> = plans
                    .iter()
                    .filter(|p| {
                        matches!(p.unified_status.as_str(), "Active" | "Pending" | "Paused")
                    })
                    .map(|p| {
                        json!({ "name": p.name, "status": p.unified_status, "words": p.total_words,
                                "progress": format!("{:.0}%", p.progress_percentage) })
                    })
                    .collect();
                let words: Vec<Value> = trouble
                    .iter()
                    .map(|t| json!({ "word": t.word, "meaning": t.meaning, "book": t.book_title, "wrong": t.wrong, "answers": t.attempts }))
                    .collect();
                let step = format!(
                    "看了你的学习情况：{} 个在学的计划，最近容易错的 {} 个词",
                    plans.len(),
                    words.len()
                );
                done(json!({ "plans": plans, "troubleWords": words }), step, None)
            }
            (Err(e), _) | (_, Err(e)) => failed("没能查看学习情况", e),
        }
    }

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
