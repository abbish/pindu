//! 学习计划：查看、新建（与新建计划页同一条路径）、调整、暂停 / 继续 / 重新学习 / 结束 / 删除；今天的任务

use super::*;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PlanArgs {
    pub plan_id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PlanPassage {
    pub passage_id: i64,
    /// Question set to practise (from get_passage); empty = just read it
    #[serde(default)]
    pub set_id: Option<i64>,
    /// reading (default) or listening — must match the question set's mode
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreatePlanArgs {
    /// Plan name in Chinese
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Word books to learn (normal ones, not drafts)
    #[serde(default)]
    pub book_ids: Vec<i64>,
    /// New words per day, 1–50 (default 10)
    #[serde(default)]
    pub daily_new_words: Option<i32>,
    /// easy (default: order from easy to hard, arranged in the background) or book (keep the word book order)
    #[serde(default)]
    pub order: Option<String>,
    /// Passages to practise in the plan, in order (optional)
    #[serde(default)]
    pub passages: Vec<PlanPassage>,
    /// One passage every N days (default 2)
    #[serde(default)]
    pub passage_interval_days: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdatePlanArgs {
    pub plan_id: i64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// Change new words per day (only words not practised yet are rescheduled)
    #[serde(default)]
    pub daily_new_words: Option<i32>,
    /// Add these word books to the plan
    #[serde(default)]
    pub add_book_ids: Vec<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PlanPassagesArgs {
    pub plan_id: i64,
    /// words / passages / both
    pub practice_content: String,
    /// The complete passage list in order (finished ones are kept as they are)
    #[serde(default)]
    pub passages: Vec<PlanPassage>,
    #[serde(default)]
    pub passage_interval_days: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PlanWordsArgs {
    pub plan_id: i64,
    /// Word ids (from get_plan words)
    pub word_ids: Vec<i64>,
}

fn plan_inputs(passages: &[PlanPassage]) -> Vec<crate::types::passage::PlanPassageInput> {
    passages
        .iter()
        .map(|p| crate::types::passage::PlanPassageInput {
            passage_id: p.passage_id,
            set_id: p.set_id,
            mode: match p.mode.as_deref() {
                Some("listening") => "listening".to_string(),
                _ => "reading".to_string(),
            },
        })
        .collect()
}

fn status_text(status: &str) -> &str {
    match status {
        "Pending" => "待开始",
        "Active" => "进行中",
        "Paused" => "已暂停",
        "Completed" => "已完成",
        "Terminated" => "已结束",
        "Draft" => "草稿",
        other => other,
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PlanPassageReadArgs {
    pub plan_id: i64,
    pub passage_id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct MonthArgs {
    pub year: i32,
    /// 1–12
    pub month: i32,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct StatsArgs {
    /// How many recent days (default 14, at most 90)
    #[serde(default)]
    pub days: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PreviewPlanArgs {
    pub book_ids: Vec<i64>,
    #[serde(default)]
    pub daily_new_words: Option<i32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CandidatesArgs {
    #[serde(default)]
    pub book_ids: Vec<i64>,
    #[serde(default)]
    pub plan_id: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SessionArgs {
    /// From unfinished_practice
    pub session_id: String,
}

/// 改了一部分后失败：如实说明哪些已经改好了
fn partly_failed(
    done_changes: &[&str],
    what: &str,
    e: AppError,
) -> Result<CallToolResult, ErrorData> {
    if done_changes.is_empty() {
        return failed(what, e);
    }
    let message = format!(
        "{}（{} 已经改好了）",
        e.user_message(),
        done_changes.join("、")
    );
    failed(what, AppError::ValidationError(message))
}

/// 这些词汇本里还在进行的加词分析任务（id）
fn analyzing_books(app: &tauri::AppHandle, book_ids: &[i64]) -> Vec<String> {
    use tauri::Manager;
    app.state::<crate::jobs::Jobs>()
        .list()
        .into_iter()
        .filter(|job| job.kind == "word_analysis" && job.status.is_active())
        .filter(|job| {
            job.link
                .as_ref()
                .and_then(|link| link.params.get("id"))
                .and_then(serde_json::Value::as_i64)
                .is_some_and(|id| book_ids.contains(&id))
        })
        .map(|job| job.id)
        .collect()
}

#[tool_router(router = plans_router, vis = "pub(super)")]
impl PinduTools {
    #[tool(
        description = "List study plans (id, name, status, progress, words, new words per day). Ended plans included.",
        annotations(read_only_hint = true)
    )]
    async fn list_plans(&self) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_study_plans(self.app.clone()).await {
            Ok(plans) => {
                let data: Vec<Value> = plans
                    .iter()
                    .map(|p| {
                        json!({ "id": p.id, "name": p.name, "status": status_text(&p.unified_status),
                                "progress": format!("{:.0}%", p.progress_percentage), "words": p.total_words,
                                "dailyNewWords": p.daily_new_words, "content": p.practice_content })
                    })
                    .collect();
                done(
                    json!(data),
                    format!("看了学习计划：共 {} 个", plans.len()),
                    None,
                )
            }
            Err(e) => failed("没能查看学习计划", e),
        }
    }

    #[tool(
        description = "One study plan in detail: status, progress, the next days' schedule (new / review words), its words with learning progress, word books and passages.",
        annotations(read_only_hint = true)
    )]
    async fn get_plan(
        &self,
        Parameters(args): Parameters<PlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let plan = match crate::handlers::get_study_plan(self.app.clone(), args.plan_id).await {
            Ok(p) => p,
            Err(e) => return failed("没能打开学习计划", e),
        };
        let today = crate::time::format_date(crate::time::local_today());
        // 查不到时如实说没能查看，不当成「没有」
        let schedules =
            match crate::handlers::get_study_plan_schedules(self.app.clone(), args.plan_id).await {
                Ok(s) => s,
                Err(e) => return failed("没能查看计划的日程", e),
            };
        let upcoming: Vec<Value> = schedules
            .iter()
            .filter(|s| s.schedule_date >= today || !s.completed)
            .take(7)
            .map(|s| {
                json!({ "date": s.schedule_date, "day": s.day, "newWords": s.new_words_count,
                        "reviewWords": s.review_words_count, "done": s.completed })
            })
            .collect();
        let words =
            match crate::handlers::get_study_plan_words(self.app.clone(), args.plan_id).await {
                Ok(w) => w,
                Err(e) => return failed("没能查看计划的单词", e),
            };
        let word_list: Vec<Value> = words
            .iter()
            .take(200)
            .map(|w| json!({ "id": w.id, "word": w.word, "meaning": w.meaning, "date": w.scheduled_date }))
            .collect();
        let passages =
            match crate::handlers::get_plan_passages(self.app.clone(), args.plan_id).await {
                Ok(p) => p,
                Err(e) => return failed("没能查看计划的短文", e),
            };
        let passage_list: Vec<Value> = passages
            .iter()
            .map(|p| json!({ "passageId": p.passage_id, "title": p.title, "date": p.scheduled_date, "done": p.completed_at.is_some() }))
            .collect();
        done(
            json!({ "id": plan.id, "name": plan.name, "description": plan.description,
                    "status": status_text(&plan.unified_status), "progress": format!("{:.0}%", plan.progress_percentage),
                    "dailyNewWords": plan.daily_new_words, "content": plan.practice_content,
                    "upcoming": upcoming, "words": word_list, "totalWords": words.len(), "passages": passage_list }),
            format!("看了学习计划《{}》", plan.name),
            None,
        )
    }

    #[tool(
        description = "What to study today: each plan's words for today (new / review, done or not, overdue days) and passage tasks due.",
        annotations(read_only_hint = true)
    )]
    async fn today(&self) -> Result<CallToolResult, ErrorData> {
        let words = crate::handlers::get_today_study_schedules(self.app.clone()).await;
        let passages = crate::handlers::get_today_passage_tasks(self.app.clone()).await;
        match (words, passages) {
            (Ok(words), Ok(passages)) => {
                let word_tasks: Vec<Value> = words
                    .iter()
                    .map(|s| json!({ "planId": s.plan_id, "plan": s.plan_name, "newWords": s.new_words_count,
                                     "reviewWords": s.review_words_count, "status": s.status, "overdueDays": s.overdue_count }))
                    .collect();
                let passage_tasks: Vec<Value> = passages
                    .iter()
                    .map(|t| json!({ "planId": t.plan_id, "plan": t.plan_name, "passageId": t.passage_id, "title": t.title,
                                     "mode": t.mode, "setId": t.set_id, "status": t.status }))
                    .collect();
                done(
                    json!({ "words": word_tasks, "passages": passage_tasks }),
                    format!(
                        "看了今天的任务：{} 个计划要学单词，{} 篇短文",
                        words.len(),
                        passages.len()
                    ),
                    None,
                )
            }
            (Err(e), _) | (_, Err(e)) => failed("没能查看今天的任务", e),
        }
    }

    #[tool(
        description = "Create a study plan from word books (and optionally passages), same as the New Plan page. With order \"easy\" the words are arranged from easy to hard in the background; the plan can be used right away.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn create_plan(
        &self,
        Parameters(args): Parameters<CreatePlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let name = args.name.trim().to_string();
        let description = args.description.clone().unwrap_or_default();
        let start = crate::time::format_date(crate::time::local_today());
        let passages = plan_inputs(&args.passages);
        let interval = args.passage_interval_days;
        let content = match (args.book_ids.is_empty(), passages.is_empty()) {
            (false, false) => "both",
            (true, false) => "passages",
            (false, true) => "words",
            (true, true) => {
                return failed(
                    "没能新建计划",
                    AppError::ValidationError("至少选一个词汇本或一篇短文".to_string()),
                )
            }
        };
        // 词要等后台分析完才进词汇本：还在分析的词汇本现在建计划会漏掉这些词
        let analyzing = analyzing_books(&self.app, &args.book_ids);
        if !analyzing.is_empty() {
            return failed(
                "还不能新建计划",
                AppError::ValidationError(format!(
                    "词汇本里的词还在后台分析（任务 {}），分析完才会进词汇本；收到完成通知后再建计划",
                    analyzing.join("、")
                )),
            );
        }
        let (end_date, plan_data) = if args.book_ids.is_empty() {
            let days = (passages.len() as i64 - 1).max(0) * interval.unwrap_or(2);
            let end = crate::time::local_today() + chrono::Duration::days(days);
            (crate::time::format_date(end), String::new())
        } else {
            let request = crate::types::study::StudyPlanScheduleRequest {
                name: name.clone(),
                description: description.clone(),
                daily_new_words: args.daily_new_words.unwrap_or(10),
                intensity_level: String::new(),
                study_period_days: 0,
                review_frequency: 0,
                start_date: start.clone(),
                wordbook_ids: args.book_ids.clone(),
                model_id: None,
                use_ai: Some(false),
            };
            match crate::handlers::generate_study_plan_schedule(self.app.clone(), request).await {
                Ok(schedule) => (
                    schedule.plan_metadata.end_date.clone(),
                    serde_json::to_string(&schedule).unwrap_or_default(),
                ),
                Err(e) => return failed("没能新建计划", e),
            }
        };
        let request = crate::types::study::CreateStudyPlanWithScheduleRequest {
            name: name.clone(),
            description,
            intensity_level: String::new(),
            study_period_days: 0,
            review_frequency: 0,
            start_date: start,
            end_date,
            ai_plan_data: plan_data,
            wordbook_ids: args.book_ids.clone(),
            status: Some("normal".to_string()),
            practice_content: Some(content.to_string()),
            passages,
            passage_interval_days: interval,
        };
        let plan_id =
            match crate::handlers::create_study_plan_with_schedule(self.app.clone(), request).await
            {
                Ok(id) => id,
                Err(e) => return failed("没能新建计划", e),
            };
        let mut job = None;
        if !args.book_ids.is_empty() && args.order.as_deref() != Some("book") {
            match crate::handlers::start_study_plan_ordering(self.app.clone(), plan_id).await {
                Ok(id) => {
                    crate::mcp::job_notice::track(&id, false);
                    job = Some(id);
                }
                Err(e) => self.logger().warn(
                    "TUTOR",
                    "没能开始安排学习顺序，计划按词汇本顺序",
                    Some(&e.to_string()),
                ),
            }
        }
        done(
            json!({ "planId": plan_id, "orderingInBackground": job.is_some(),
                    "note": job.is_some().then_some("The plan exists and can be used now; its words are being arranged from easy to hard in the background.") }),
            format!("新建了学习计划《{}》", name),
            Some(json!({ "kind": "plan", "id": plan_id, "title": name, "jobId": job })),
        )
    }

    #[tool(
        description = "Change a study plan: name / description, new words per day (reschedules words not practised yet), or add word books. Only the fields you give are changed.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn update_plan(
        &self,
        Parameters(args): Parameters<UpdatePlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let plan = match crate::handlers::get_study_plan(self.app.clone(), args.plan_id).await {
            Ok(p) => p,
            Err(e) => return failed("没能打开学习计划", e),
        };
        let mut changes = Vec::new();
        if args.name.is_some() || args.description.is_some() {
            let name = args
                .name
                .clone()
                .map(|n| n.trim().to_string())
                .unwrap_or(plan.name.clone());
            let description = args.description.clone().or(Some(plan.description.clone()));
            if let Err(e) = crate::handlers::update_study_plan_basic_info(
                self.app.clone(),
                args.plan_id,
                name,
                description,
            )
            .await
            {
                return failed("没能修改计划", e);
            }
            changes.push("名称和说明");
        }
        if let Some(daily) = args.daily_new_words {
            if let Err(e) =
                crate::handlers::replan_study_plan_pace(self.app.clone(), args.plan_id, daily).await
            {
                return partly_failed(&changes, "没能改每天新词数", e);
            }
            changes.push("每天新词数");
        }
        if !args.add_book_ids.is_empty() {
            let analyzing = analyzing_books(&self.app, &args.add_book_ids);
            if !analyzing.is_empty() {
                return partly_failed(
                    &changes,
                    "还不能追加词汇本",
                    AppError::ValidationError(format!(
                        "词汇本里的词还在后台分析（任务 {}），分析完才会进词汇本；收到完成通知后再追加",
                        analyzing.join("、")
                    )),
                );
            }
            if let Err(e) = crate::handlers::add_word_books_to_plan(
                self.app.clone(),
                args.plan_id,
                args.add_book_ids.clone(),
            )
            .await
            {
                return partly_failed(&changes, "没能追加词汇本", e);
            }
            changes.push("追加了词汇本");
        }
        done(
            json!({ "changed": changes }),
            format!("改好了计划《{}》：{}", plan.name, changes.join("、")),
            Some(json!({ "kind": "plan", "id": args.plan_id, "title": plan.name })),
        )
    }

    #[tool(
        description = "Set what a plan practises (words / passages / both) and its passages in order, one every N days. Finished passage tasks are kept.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn set_plan_passages(
        &self,
        Parameters(args): Parameters<PlanPassagesArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let request = crate::types::passage::SetPlanPassagesRequest {
            plan_id: args.plan_id,
            practice_content: args.practice_content.clone(),
            passages: plan_inputs(&args.passages),
            interval_days: args.passage_interval_days.unwrap_or(2),
        };
        match crate::handlers::set_plan_passages(self.app.clone(), request).await {
            Ok(()) => done(
                json!({ "updated": true }),
                format!("排好了计划里的 {} 篇短文", args.passages.len()),
                None,
            ),
            Err(e) => failed("没能修改计划里的短文", e),
        }
    }

    #[tool(
        description = "Pause a study plan (no practice or reviews while paused; resuming shifts the schedule).",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn pause_plan(
        &self,
        Parameters(args): Parameters<PlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::pause_study_plan(self.app.clone(), args.plan_id).await {
            Ok(()) => done(
                json!({ "paused": true }),
                "暂停了学习计划".to_string(),
                None,
            ),
            Err(e) => failed("没能暂停计划", e),
        }
    }

    #[tool(
        description = "Resume a paused study plan (unfinished days move later by the paused days).",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn resume_plan(
        &self,
        Parameters(args): Parameters<PlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::resume_study_plan(self.app.clone(), args.plan_id).await {
            Ok(()) => done(
                json!({ "resumed": true }),
                "继续了学习计划".to_string(),
                None,
            ),
            Err(e) => failed("没能继续计划", e),
        }
    }

    #[tool(
        description = "Learn an ended or finished plan again from today (the schedule moves to today; records are kept).",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn restart_plan(
        &self,
        Parameters(args): Parameters<PlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::restart_study_plan(self.app.clone(), args.plan_id).await {
            Ok(()) => done(
                json!({ "restarted": true }),
                "重新开始了学习计划".to_string(),
                None,
            ),
            Err(e) => failed("没能重新开始计划", e),
        }
    }

    #[tool(
        description = "End a study plan early (records are kept; it can be learned again later). The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn end_plan(
        &self,
        Parameters(args): Parameters<PlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::terminate_study_plan(self.app.clone(), args.plan_id).await {
            Ok(()) => done(json!({ "ended": true }), "结束了学习计划".to_string(), None),
            Err(e) => failed("没能结束计划", e),
        }
    }

    #[tool(
        description = "Deletes a study plan with its schedule and practice records (cannot be undone). The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_plan(
        &self,
        Parameters(args): Parameters<PlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::delete_study_plan(self.app.clone(), args.plan_id).await {
            Ok(()) => done(
                json!({ "deleted": true }),
                "删除了学习计划".to_string(),
                None,
            ),
            Err(e) => failed("没能删除计划", e),
        }
    }

    #[tool(
        description = "Remove words from a study plan (the words stay in their word book). The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn remove_words_from_plan(
        &self,
        Parameters(args): Parameters<PlanWordsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::batch_remove_words_from_plan(
            self.app.clone(),
            args.plan_id,
            args.word_ids.clone(),
        )
        .await
        {
            Ok(()) => done(
                json!({ "removed": args.word_ids.len() }),
                format!("从计划里移除了 {} 个词", args.word_ids.len()),
                None,
            ),
            Err(e) => failed("没能从计划里移除这些词", e),
        }
    }

    #[tool(
        description = "Learning statistics: words learned, accuracy, streak days, words practised / mastered per day over the last N days (default 14), and the words got wrong most in that period.",
        annotations(read_only_hint = true)
    )]
    async fn study_stats(
        &self,
        Parameters(args): Parameters<StatsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let days_back = args.days.unwrap_or(14).clamp(1, 90);
        let trouble = match crate::repositories::tutor_repository::trouble_words(
            &self.pool(),
            &crate::time::days_ago_utc(days_back),
            20,
        )
        .await
        {
            Ok(t) => t,
            Err(e) => return failed("没能查看学习统计", e),
        };
        let trouble: Vec<Value> = trouble
            .iter()
            .map(|t| json!({ "word": t.word, "meaning": t.meaning, "book": t.book_title, "wrong": t.wrong, "answers": t.attempts }))
            .collect();
        let stats = crate::handlers::get_study_statistics(self.app.clone()).await;
        let days = crate::handlers::get_daily_learning_activity(self.app.clone(), days_back).await;
        match (stats, days) {
            (Ok(stats), Ok(days)) => done(
                json!({ "totalWordsLearned": stats.total_words_learned, "averageAccuracy": stats.average_accuracy,
                        "streakDays": stats.streak_days, "daily": serde_json::to_value(&days).unwrap_or(Value::Null),
                        "troubleWords": trouble }),
                "看了学习统计".to_string(),
                None,
            ),
            (Err(e), _) | (_, Err(e)) => failed("没能查看学习统计", e),
        }
    }

    #[tool(
        description = "Mark a read-only passage task of a plan as read (tasks without a question set).",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn mark_passage_read(
        &self,
        Parameters(args): Parameters<PlanPassageReadArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::complete_plan_passage_reading(
            self.app.clone(),
            args.plan_id,
            args.passage_id,
        )
        .await
        {
            Ok(()) => done(
                json!({ "done": true }),
                "记下了这篇短文已读完".to_string(),
                None,
            ),
            Err(e) => failed("没能标记读完", e),
        }
    }

    #[tool(
        description = "Practice history of a plan: each session's date, time spent, words passed, and the words not passed (mistakes). Also lists unfinished sessions that can be continued.",
        annotations(read_only_hint = true)
    )]
    async fn practice_history(
        &self,
        Parameters(args): Parameters<PlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let sessions =
            match crate::handlers::get_plan_practice_sessions(self.app.clone(), args.plan_id).await
            {
                Ok(s) => s,
                Err(e) => return failed("没能查看练习记录", e),
            };
        let data: Vec<Value> = sessions
            .iter()
            .take(30)
            .map(|s| {
                let missed: Vec<String> = s
                    .word_states
                    .iter()
                    .filter(|w| w.completed && !w.passed)
                    .map(|w| w.word_info.word.clone())
                    .collect();
                json!({ "date": s.schedule_date, "completed": s.completed, "minutes": s.active_time / 60000,
                        "words": s.word_states.len(), "passed": s.word_states.iter().filter(|w| w.passed).count(),
                        "missed": missed })
            })
            .collect();
        done(
            json!(data),
            format!("看了练习记录：{} 次", sessions.len()),
            None,
        )
    }

    #[tool(
        description = "Memory levels of a plan's words: not started / learning / mastered, how many reviews are due today and the next review date.",
        annotations(read_only_hint = true)
    )]
    async fn plan_memory(
        &self,
        Parameters(args): Parameters<PlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_plan_memory_overview(self.app.clone(), args.plan_id).await {
            Ok(m) => done(
                serde_json::to_value(&m).unwrap_or(Value::Null),
                "看了单词的记忆情况".to_string(),
                None,
            ),
            Err(e) => failed("没能查看记忆情况", e),
        }
    }

    #[tool(
        description = "Statistics of one plan: time spent, study days, accuracy, words that are often wrong, parts of speech.",
        annotations(read_only_hint = true)
    )]
    async fn plan_stats(
        &self,
        Parameters(args): Parameters<PlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_study_plan_statistics(self.app.clone(), args.plan_id).await {
            Ok(s) => done(
                serde_json::to_value(&s).unwrap_or(Value::Null),
                "看了这个计划的统计".to_string(),
                None,
            ),
            Err(e) => failed("没能查看计划统计", e),
        }
    }

    #[tool(
        description = "Study calendar of a month: which days had study tasks and whether they were done, plus monthly totals.",
        annotations(read_only_hint = true)
    )]
    async fn calendar_month(
        &self,
        Parameters(args): Parameters<MonthArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_calendar_month_data(
            self.app.clone(),
            args.year,
            args.month,
            Some(false),
        )
        .await
        {
            Ok(m) => done(
                serde_json::to_value(&m).unwrap_or(Value::Null),
                format!("看了 {} 年 {} 月的学习日历", args.year, args.month),
                None,
            ),
            Err(e) => failed("没能查看学习日历", e),
        }
    }

    #[tool(
        description = "Preview a plan before creating it: how many days the new words take, when it ends, about how many minutes a day.",
        annotations(read_only_hint = true)
    )]
    async fn preview_plan(
        &self,
        Parameters(args): Parameters<PreviewPlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::preview_study_plan(
            self.app.clone(),
            args.book_ids.clone(),
            args.daily_new_words.unwrap_or(10),
        )
        .await
        {
            Ok(r) => {
                let m = &r.plan_metadata;
                done(
                    json!({ "words": m.total_words, "days": m.study_period_days, "start": m.start_date, "end": m.end_date,
                            "newWordDays": r.daily_plans.iter().filter(|d| !d.words.is_empty()).count() }),
                    format!(
                        "预览了计划：{} 个词，共 {} 天",
                        m.total_words, m.study_period_days
                    ),
                    None,
                )
            }
            Err(e) => failed("没能预览计划", e),
        }
    }

    #[tool(
        description = "Arrange a plan's words again from easy to hard (only words not practised yet; runs in the background).",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn reorder_plan(
        &self,
        Parameters(args): Parameters<PlanArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::start_study_plan_ordering(self.app.clone(), args.plan_id).await {
            Ok(job) => {
                crate::mcp::job_notice::track(&job, true);
                done(
                    json!({ "started": true, "jobId": job, "note": "Not done yet: the new order applies when the job finishes; you will get a notice." }),
                    "开始按从易到难重新排学习顺序（后台进行）".to_string(),
                    None,
                )
            }
            Err(e) => failed("没能重新排学习顺序", e),
        }
    }

    #[tool(
        description = "Passages that fit a plan (or some word books), ranked by how many of their words they use, with their question sets — to pick passages for create_plan / set_plan_passages.",
        annotations(read_only_hint = true)
    )]
    async fn plan_passage_candidates(
        &self,
        Parameters(args): Parameters<CandidatesArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let request = crate::types::passage::PlanPassageCandidatesRequest {
            book_ids: args.book_ids.clone(),
            plan_id: args.plan_id,
        };
        match crate::handlers::get_plan_passage_candidates(self.app.clone(), request).await {
            Ok(list) => {
                let data: Vec<Value> = list
                    .iter()
                    .take(30)
                    .map(|c| json!({ "passageId": c.passage.id, "title": c.passage.title, "level": c.passage.level,
                                     "sharedWords": c.overlap,
                                     "sets": c.sets.iter().map(|s| json!({ "id": s.id, "name": s.name, "mode": s.mode })).collect::<Vec<_>>() }))
                    .collect();
                done(
                    json!(data),
                    format!("找了适合的短文：{} 篇", list.len()),
                    None,
                )
            }
            Err(e) => failed("没能找适合的短文", e),
        }
    }

    #[tool(
        description = "Unfinished word practice sessions (left in the middle) that can be continued or discarded.",
        annotations(read_only_hint = true)
    )]
    async fn unfinished_practice(&self) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_incomplete_practice_sessions(self.app.clone()).await {
            Ok(list) => {
                let data: Vec<Value> = list
                    .iter()
                    .map(|s| json!({ "sessionId": s.session_id, "planId": s.plan_id, "scheduleId": s.schedule_id, "plan": s.plan_title,
                                     "date": s.schedule_date, "words": s.word_states.len(),
                                     "done": s.word_states.iter().filter(|w| w.completed).count() }))
                    .collect();
                done(
                    json!(data),
                    format!("看了没练完的练习：{} 次", list.len()),
                    None,
                )
            }
            Err(e) => failed("没能查看没练完的练习", e),
        }
    }

    #[tool(
        description = "Discard an unfinished practice session (its answers so far are dropped). The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn discard_practice(
        &self,
        Parameters(args): Parameters<SessionArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::cancel_practice_session(self.app.clone(), args.session_id.clone())
            .await
        {
            Ok(()) => done(
                json!({ "discarded": true }),
                "放弃了这次没练完的练习".to_string(),
                None,
            ),
            Err(e) => failed("没能放弃这次练习", e),
        }
    }
}
