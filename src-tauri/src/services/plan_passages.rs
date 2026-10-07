//! 学习计划里的短文（C4，DECISIONS D29）：
//! - 计划的练习内容：words 只练单词 / passages 只练短文 / both 两者都练；
//! - 短文任务 = 短文库里的一篇短文 + 一套题组（为空：只朗读、自由学习，点「读完了」算完成）+ 阅读 / 听力；
//! - 从计划开始日起每 N 天一篇；完成后日期、题组、方式锁定；到期没完成的留在今日任务里；
//! - 计划结束日 = 单词结束日与最后一篇短文日期中较晚的（只练短文 = 最后一篇短文的日期）；
//! - 计划自动完成：单词全部掌握（没有单词视为满足）且短文全部完成。
//!
//! 计划自身不产生短文：短文都来自短文库。

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::passage_repository::PassageRepository;
use crate::repositories::plan_passage_repository::{PlanPassageRepository as Repo, PlanPassageRow};
use crate::repositories::study_plan_repository::{StatusChange, StudyPlanRepository};
use crate::types::common::Id;
use crate::types::passage::{
    PlanPassage, PlanPassageCandidate, PlanPassageCandidatesRequest, PlanPassageInput,
    SetPlanPassagesRequest, TodayPassageTask,
};
use chrono::{Duration, NaiveDate};
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub const PRACTICE_CONTENTS: [&str; 3] = ["words", "passages", "both"];
pub const DEFAULT_INTERVAL_DAYS: i64 = 2;
pub const INTERVAL_RANGE: std::ops::RangeInclusive<i64> = 1..=30;
/// 一个计划最多放多少篇短文
pub const MAX_PLAN_PASSAGES: usize = 60;
const PLAN_MODES: [&str; 2] = ["reading", "listening"];
/// 可以改短文的计划状态：未结束的计划
const EDITABLE: [&str; 4] = ["Draft", "Pending", "Active", "Paused"];

// ==================== 规则（纯函数） ====================

/// 校验练习内容与间隔天数
pub fn validate_settings(practice_content: &str, interval_days: i64) -> AppResult<()> {
    if !PRACTICE_CONTENTS.contains(&practice_content) {
        return Err(AppError::ValidationError(
            "练习内容只能是单词、短文或两者都练".to_string(),
        ));
    }
    if !INTERVAL_RANGE.contains(&interval_days) {
        return Err(AppError::ValidationError(format!(
            "短文间隔天数需要在 {}–{} 天之间",
            INTERVAL_RANGE.start(),
            INTERVAL_RANGE.end()
        )));
    }
    Ok(())
}

/// 校验短文列表的形状：不重复、方式合法、篇数上限、与练习内容一致
pub fn validate_inputs(practice_content: &str, inputs: &[PlanPassageInput]) -> AppResult<()> {
    if practice_content == "words" && !inputs.is_empty() {
        return Err(AppError::ValidationError(
            "只练单词的计划不能加短文；要加短文请把练习内容改成「两者都练」".to_string(),
        ));
    }
    if practice_content != "words" && inputs.is_empty() {
        return Err(AppError::ValidationError("请至少选一篇短文".to_string()));
    }
    if inputs.len() > MAX_PLAN_PASSAGES {
        return Err(AppError::ValidationError(format!(
            "一个计划最多放 {} 篇短文",
            MAX_PLAN_PASSAGES
        )));
    }
    let mut seen = HashSet::new();
    for input in inputs {
        if !seen.insert(input.passage_id) {
            return Err(AppError::ValidationError(
                "同一篇短文只能加一次".to_string(),
            ));
        }
        if !PLAN_MODES.contains(&input.mode.as_str()) {
            return Err(AppError::ValidationError(
                "练习方式只能是阅读或听力".to_string(),
            ));
        }
    }
    Ok(())
}

/// 排期：第 i 篇（从 0 起）自然日期 = 开始日 + i × 间隔。
/// 已完成的（`locked` 为 Some）保留原日期；没完成的取自然日期，但不早于 `floor`（已开始的计划为今天，
/// 避免新加的短文一加进来就逾期），并与前一篇没完成的至少隔一个间隔。
pub fn schedule_dates(
    start: NaiveDate,
    interval_days: i64,
    locked: &[Option<NaiveDate>],
    floor: Option<NaiveDate>,
) -> Vec<NaiveDate> {
    let interval = Duration::days(interval_days.max(1));
    let mut cursor: Option<NaiveDate> = None;
    locked
        .iter()
        .enumerate()
        .map(|(i, done)| {
            if let Some(date) = done {
                return *date;
            }
            let mut date = start + interval * i as i32;
            if let Some(floor) = floor {
                date = date.max(floor);
            }
            if let Some(prev) = cursor {
                date = date.max(prev + interval);
            }
            cursor = Some(date);
            date
        })
        .collect()
}

/// 任务状态：completed / due（今天）/ overdue / upcoming
pub fn item_status(scheduled_date: &str, completed: bool, today: &str) -> &'static str {
    if completed {
        "completed"
    } else if scheduled_date < today {
        "overdue"
    } else if scheduled_date == today {
        "due"
    } else {
        "upcoming"
    }
}

// ==================== 事务内的协作函数（计划服务、练习服务、短文服务共用） ====================

/// 校验每项短文存在、题组属于这篇短文
pub async fn check_inputs_exist_conn(
    conn: &mut SqliteConnection,
    inputs: &[PlanPassageInput],
) -> AppResult<()> {
    for input in inputs {
        if !Repo::passage_exists_conn(conn, input.passage_id).await? {
            return Err(AppError::ValidationError(format!(
                "短文 {} 不存在，可能已被删除",
                input.passage_id
            )));
        }
        if let Some(set_id) = input.set_id {
            if Repo::set_passage_conn(conn, set_id).await? != Some(input.passage_id) {
                return Err(AppError::ValidationError(
                    "选的阅读理解题不属于这篇短文，请重新选择".to_string(),
                ));
            }
        }
    }
    Ok(())
}

/// 新建计划时写入练习内容与短文任务（调用方事务内；短文已校验）
pub async fn init_conn(
    conn: &mut SqliteConnection,
    plan_id: Id,
    practice_content: &str,
    interval_days: i64,
    inputs: &[PlanPassageInput],
    today: NaiveDate,
) -> AppResult<()> {
    Repo::update_settings_conn(conn, plan_id, practice_content, interval_days).await?;
    for (i, input) in inputs.iter().enumerate() {
        // 先占位，下面统一排期
        Repo::insert_item_conn(conn, plan_id, input, i as i64, "").await?;
    }
    reschedule_conn(conn, plan_id, today).await
}

/// 按计划开始日与间隔重排没完成的短文日期，并刷新计划结束日。
/// 开始学习、重新学习、暂停后继续、改短文时调用。
pub async fn reschedule_conn(
    conn: &mut SqliteConnection,
    plan_id: Id,
    today: NaiveDate,
) -> AppResult<()> {
    let Some(settings) = Repo::settings_conn(conn, plan_id).await? else {
        return Ok(());
    };
    let items = Repo::items_conn(conn, plan_id).await?;
    if items.is_empty() {
        return Repo::refresh_end_date_conn(conn, plan_id).await;
    }
    let start = settings
        .start_date
        .as_deref()
        .and_then(crate::time::parse_date)
        .unwrap_or(today);
    let started = matches!(settings.unified_status.as_str(), "Active" | "Paused");
    let locked: Vec<Option<NaiveDate>> = items
        .iter()
        .map(|it| {
            it.completed_at
                .as_ref()
                .and_then(|_| crate::time::parse_date(&it.scheduled_date))
        })
        .collect();
    let dates = schedule_dates(
        start,
        settings.interval_days,
        &locked,
        started.then_some(today),
    );
    for (item, date) in items.iter().zip(dates) {
        let date = crate::time::format_date(date);
        if item.scheduled_date != date {
            Repo::update_date_conn(conn, item.id, &date).await?;
        }
    }
    Repo::refresh_end_date_conn(conn, plan_id).await
}

/// 待开始的计划第一次练习（单词或短文）时自动转为进行中：日程平移到从今天开始，短文重新排期
pub async fn auto_start_conn(
    plans: &StudyPlanRepository,
    conn: &mut SqliteConnection,
    plan_id: Id,
    today: NaiveDate,
) -> AppResult<()> {
    if plans
        .find_unified_status_conn(conn, plan_id)
        .await?
        .as_deref()
        != Some("Pending")
    {
        return Ok(());
    }
    plans
        .transition_conn(
            conn,
            plan_id,
            &["Pending"],
            "Active",
            StatusChange {
                set_actual_start: true,
                ..Default::default()
            },
            "开始学习",
            "第一次练习，自动开始学习",
        )
        .await?;
    plans.start_now_conn(conn, plan_id, today).await?;
    reschedule_conn(conn, plan_id, today).await
}

/// 计划自动完成：单词日程全部练过且单词全部掌握（没有单词视为满足），且短文全部完成。
/// 只对待开始 / 进行中的计划生效；返回是否完成了。
pub async fn try_auto_complete_conn(
    plans: &StudyPlanRepository,
    conn: &mut SqliteConnection,
    plan_id: Id,
) -> AppResult<bool> {
    let Some(settings) = Repo::settings_conn(conn, plan_id).await? else {
        return Ok(false);
    };
    if !matches!(settings.unified_status.as_str(), "Active" | "Pending") {
        return Ok(false);
    }
    let words_done = plans
        .count_unpracticed_schedules_conn(conn, plan_id)
        .await?
        == 0
        && crate::services::srs::unmastered_count(conn, plan_id).await? == 0;
    if !words_done || Repo::pending_count_conn(conn, plan_id).await? > 0 {
        return Ok(false);
    }
    let reason = match settings.practice_content.as_str() {
        "passages" => "短文全部完成，自动完成",
        "both" => "全部单词都已掌握、短文全部完成，自动完成",
        _ => "全部单词都已掌握，自动完成",
    };
    plans
        .transition_conn(
            conn,
            plan_id,
            &["Active", "Pending"],
            "Completed",
            StatusChange {
                set_actual_end: true,
                ..Default::default()
            },
            "完成",
            reason,
        )
        .await?;
    Ok(true)
}

/// 计划内的一次短文作答完成：对应的任务（同一篇短文、同一套题、同一种方式）标记完成，再看计划能否自动完成。
/// 计划已暂停 / 结束，或计划里这篇的安排已经变了：作答转为自由练习，不计入计划
pub async fn on_attempt_completed_conn(
    plans: &StudyPlanRepository,
    conn: &mut SqliteConnection,
    plan_id: Id,
    passage_id: Id,
    set_id: Id,
    mode: &str,
    attempt_id: Id,
) -> AppResult<()> {
    let status = plans.find_unified_status_conn(conn, plan_id).await?;
    let item = Repo::find_item_conn(conn, plan_id, passage_id).await?;
    let matches = item
        .as_ref()
        .is_some_and(|it| it.set_id == Some(set_id) && it.mode == mode);
    // 暂停 / 结束期间不能练习；计划改了这篇的安排：这次作答只算自由练习
    if !matches!(status.as_deref(), Some("Pending" | "Active")) || !matches {
        return Repo::detach_attempt_conn(conn, attempt_id).await;
    }
    let item = item.expect("matches 为真时任务存在");
    if item.completed_at.is_some() {
        return Ok(());
    }
    Repo::mark_completed_conn(conn, item.id, Some(attempt_id)).await?;
    try_auto_complete_conn(plans, conn, plan_id).await?;
    Ok(())
}

/// 计划内的短文作答前校验：计划可以练习、短文在计划里、题组与方式和计划安排的一致
pub async fn check_plan_attempt_conn(
    plans: &StudyPlanRepository,
    conn: &mut SqliteConnection,
    plan_id: Id,
    passage_id: Id,
    set_id: Id,
    mode: &str,
) -> AppResult<()> {
    let status = plans
        .find_unified_status_conn(conn, plan_id)
        .await?
        .ok_or_else(|| AppError::NotFound("学习计划不存在，可能已被删除".to_string()))?;
    if !matches!(status.as_str(), "Pending" | "Active") {
        return Err(AppError::ValidationError(
            "这个学习计划已暂停或已结束，不能练习".to_string(),
        ));
    }
    let item = Repo::find_item_conn(conn, plan_id, passage_id)
        .await?
        .ok_or_else(|| AppError::ValidationError("这篇短文不在这个计划里".to_string()))?;
    if item.set_id != Some(set_id) || item.mode != mode {
        return Err(AppError::ValidationError(
            "计划里这篇短文安排的题组或练习方式已经变了，请从计划里重新进入".to_string(),
        ));
    }
    Ok(())
}

// ==================== 服务 ====================

pub struct PlanPassageService {
    pool: Arc<SqlitePool>,
    repo: Repo,
    plans: StudyPlanRepository,
    passages: PassageRepository,
}

impl PlanPassageService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repo: Repo::new(pool.clone()),
            plans: StudyPlanRepository::new(pool.clone(), logger),
            passages: PassageRepository::new(pool.clone()),
            pool,
        }
    }

    /// 计划里的短文任务（按顺序）
    pub async fn get_plan_passages(&self, plan_id: Id) -> AppResult<Vec<PlanPassage>> {
        let today = crate::time::format_date(crate::time::local_today());
        Ok(self
            .repo
            .details(plan_id)
            .await?
            .into_iter()
            .map(|r| PlanPassage {
                id: r.item.id,
                plan_id: r.plan_id,
                passage_id: r.item.passage_id,
                title: r.title,
                level: r.level,
                word_count: r.word_count,
                set_id: r.item.set_id,
                set_name: r.set_name,
                status: item_status(
                    &r.item.scheduled_date,
                    r.item.completed_at.is_some(),
                    &today,
                )
                .to_string(),
                mode: r.item.mode,
                sort_order: r.item.sort_order,
                scheduled_date: r.item.scheduled_date,
                completed_at: r.item.completed_at,
                attempt: r.attempt,
            })
            .collect())
    }

    /// 修改计划的练习内容与短文：只能增加练习内容或去掉没练过的短文；已完成的短文必须保留（日期、题组、方式锁定）
    pub async fn set_plan_passages(&self, request: &SetPlanPassagesRequest) -> AppResult<()> {
        let content = request.practice_content.as_str();
        validate_settings(content, request.interval_days)?;
        validate_inputs(content, &request.passages)?;
        let today = crate::time::local_today();
        let mut tx = crate::services::srs::begin_write(&self.pool).await?;
        let settings = Repo::settings_conn(&mut tx, request.plan_id)
            .await?
            .ok_or_else(|| AppError::NotFound("学习计划不存在，可能已被删除".to_string()))?;
        if !EDITABLE.contains(&settings.unified_status.as_str()) {
            return Err(AppError::ValidationError(
                "计划已结束，不能再调整；可以“重新学习”后再改".to_string(),
            ));
        }
        let has_words = self
            .plans
            .find_plan_words_count_conn(&mut tx, request.plan_id)
            .await?
            > 0;
        if has_words && content == "passages" {
            return Err(AppError::ValidationError(
                "这个计划里有单词，不能改成只练短文；可以选「两者都练」".to_string(),
            ));
        }
        if !has_words && content != "passages" {
            return Err(AppError::ValidationError(
                "这个计划里还没有单词，练习内容只能是短文；要练单词请先追加单词本".to_string(),
            ));
        }
        check_inputs_exist_conn(&mut tx, &request.passages).await?;

        let existing = Repo::items_conn(&mut tx, request.plan_id).await?;
        let by_passage: HashMap<Id, &PlanPassageRow> =
            existing.iter().map(|it| (it.passage_id, it)).collect();
        let wanted: HashSet<Id> = request.passages.iter().map(|p| p.passage_id).collect();
        for item in existing.iter().filter(|it| it.completed_at.is_some()) {
            if !wanted.contains(&item.passage_id) {
                return Err(AppError::ValidationError(
                    "已经完成的短文不能从计划里去掉".to_string(),
                ));
            }
        }
        for item in existing
            .iter()
            .filter(|it| !wanted.contains(&it.passage_id))
        {
            Repo::delete_item_conn(&mut tx, item.id).await?;
        }
        for (i, input) in request.passages.iter().enumerate() {
            let order = i as i64;
            match by_passage.get(&input.passage_id) {
                Some(item) if item.completed_at.is_some() => {
                    Repo::update_sort_order_conn(&mut tx, item.id, order).await?;
                }
                Some(item) => {
                    Repo::update_item_conn(&mut tx, item.id, input.set_id, &input.mode, order)
                        .await?;
                }
                None => {
                    Repo::insert_item_conn(&mut tx, request.plan_id, input, order, "").await?;
                }
            }
        }
        Repo::update_settings_conn(&mut tx, request.plan_id, content, request.interval_days)
            .await?;
        reschedule_conn(&mut tx, request.plan_id, today).await?;
        // 去掉了没练的短文后可能已经全部完成
        try_auto_complete_conn(&self.plans, &mut tx, request.plan_id).await?;
        tx.commit().await?;
        Ok(())
    }

    /// 今天的短文任务（到期没完成的 + 今天完成的）
    pub async fn today_tasks(&self) -> AppResult<Vec<TodayPassageTask>> {
        let today = crate::time::format_date(crate::time::local_today());
        Ok(self
            .repo
            .today(&today)
            .await?
            .into_iter()
            .map(|r| TodayPassageTask {
                item_id: r.item.id,
                plan_id: r.plan_id,
                plan_name: r.plan_name,
                passage_id: r.item.passage_id,
                title: r.title,
                word_count: r.word_count,
                set_id: r.item.set_id,
                set_name: r.set_name,
                status: item_status(
                    &r.item.scheduled_date,
                    r.item.completed_at.is_some(),
                    &today,
                )
                .to_string(),
                mode: r.item.mode,
                scheduled_date: r.item.scheduled_date,
            })
            .collect())
    }

    /// 只朗读的任务（没有题组）：读完了算完成
    pub async fn complete_reading(&self, plan_id: Id, passage_id: Id) -> AppResult<()> {
        let today = crate::time::local_today();
        let mut tx = crate::services::srs::begin_write(&self.pool).await?;
        let status = self
            .plans
            .find_unified_status_conn(&mut tx, plan_id)
            .await?
            .ok_or_else(|| AppError::NotFound("学习计划不存在，可能已被删除".to_string()))?;
        if !matches!(status.as_str(), "Pending" | "Active") {
            return Err(AppError::ValidationError(
                "这个学习计划已暂停或已结束，不能练习".to_string(),
            ));
        }
        let item = Repo::find_item_conn(&mut tx, plan_id, passage_id)
            .await?
            .ok_or_else(|| AppError::ValidationError("这篇短文不在这个计划里".to_string()))?;
        if item.set_id.is_some() {
            return Err(AppError::ValidationError(
                "这篇短文安排了阅读理解题，做完题才算完成".to_string(),
            ));
        }
        if item.completed_at.is_some() {
            return Ok(());
        }
        auto_start_conn(&self.plans, &mut tx, plan_id, today).await?;
        Repo::mark_completed_conn(&mut tx, item.id, None).await?;
        try_auto_complete_conn(&self.plans, &mut tx, plan_id).await?;
        tx.commit().await?;
        Ok(())
    }

    /// 可加进计划的短文：按相关度（目标词里属于计划单词 / 所选单词本的个数）从高到低，同分按新到旧
    pub async fn candidates(
        &self,
        request: &PlanPassageCandidatesRequest,
    ) -> AppResult<Vec<PlanPassageCandidate>> {
        let word_ids: HashSet<Id> = match request.plan_id {
            Some(plan_id) => self.repo.plan_word_ids(plan_id).await?,
            None if !request.book_ids.is_empty() => {
                self.repo.book_word_ids(&request.book_ids).await?
            }
            None => Vec::new(),
        }
        .into_iter()
        .collect();
        let mut sets = self.passages.all_set_summaries().await?;
        let mut out: Vec<PlanPassageCandidate> = self
            .passages
            .list(None, None, None)
            .await?
            .into_iter()
            .map(|passage| {
                let overlap = passage
                    .target_words
                    .iter()
                    .filter(|w| w.word_id.is_some_and(|id| word_ids.contains(&id)))
                    .count() as i64;
                let sets = sets.remove(&passage.id).unwrap_or_default();
                // 题组按新到旧排列：最早的一套在最后
                let default_set_id = sets.last().map(|s| s.id);
                PlanPassageCandidate {
                    passage,
                    overlap,
                    sets,
                    default_set_id,
                }
            })
            .collect();
        // list 已按新到旧排列，稳定排序保留同分时的顺序
        out.sort_by_key(|c| std::cmp::Reverse(c.overlap));
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::AgentPaths;
    use crate::services::passage::tests::{seed_passage, seed_plain_passage};
    use crate::services::passage::PassageService;
    use crate::services::study_plan::StudyPlanService;
    use crate::test_support::{memory_pool, seed_schedule, test_logger};
    use crate::types::passage::{PassageAnswer, SubmitPassageAttemptRequest};
    use serde_json::json;

    fn input(passage_id: Id, set_id: Option<Id>, mode: &str) -> PlanPassageInput {
        PlanPassageInput {
            passage_id,
            set_id,
            mode: mode.into(),
        }
    }

    async fn plan_status(pool: &Arc<SqlitePool>, plan_id: Id) -> String {
        sqlx::query_scalar("SELECT unified_status FROM study_plans WHERE id = ?")
            .bind(plan_id)
            .fetch_one(pool.as_ref())
            .await
            .unwrap()
    }

    /// 只练短文的计划：新建排期 → 第一次作答自动开始并平移 → 做完题、读完只朗读的短文 → 自动完成 → 重新学习
    #[tokio::test]
    async fn passages_only_plan_runs_from_creation_to_completion_and_restart() {
        let pool = memory_pool().await;
        let logger = test_logger();
        let (p1, set1) = seed_passage(&pool).await;
        let p2 = seed_plain_passage(&pool, "A Quiet Morning").await;
        let plans = StudyPlanService::new(pool.clone(), logger.clone());
        let request = serde_json::from_value(json!({
            "name": "短文计划",
            "description": "",
            "start_date": "2026-01-01",
            "end_date": "2026-01-01",
            "ai_plan_data": "",
            "wordbook_ids": [],
            "status": "active",
            "practice_content": "passages",
            "passages": [
                { "passageId": p1, "setId": set1, "mode": "reading" },
                { "passageId": p2 }
            ],
            "passage_interval_days": 3
        }))
        .unwrap();
        let plan_id = plans
            .create_study_plan_with_schedule(request)
            .await
            .unwrap();
        let service = PlanPassageService::new(pool.clone(), logger.clone());
        let items = service.get_plan_passages(plan_id).await.unwrap();
        assert_eq!(
            items
                .iter()
                .map(|i| i.scheduled_date.as_str())
                .collect::<Vec<_>>(),
            ["2026-01-01", "2026-01-04"]
        );
        assert_eq!(items[1].set_id, None);
        assert_eq!(items[1].mode, "reading");
        let plan = plans.get_study_plan(plan_id).await.unwrap();
        assert_eq!(plan.unified_status, "Pending");
        assert_eq!(plan.practice_content, "passages");
        assert_eq!(plan.end_date.as_deref(), Some("2026-01-04"));
        assert_eq!((plan.total_passages, plan.completed_passages), (2, 0));

        // 方式和计划安排的不一致：拒绝，计划不受影响
        let passages = PassageService::new(pool.clone(), logger.clone());
        assert!(passages
            .start_attempt(set1, "listening", Some(plan_id))
            .await
            .is_err());
        assert_eq!(plan_status(&pool, plan_id).await, "Pending");

        // 第一次作答：计划开始，短文从今天起重新排期
        let today = crate::time::local_today();
        let attempt = passages
            .start_attempt(set1, "reading", Some(plan_id))
            .await
            .unwrap();
        assert_eq!(attempt.plan_id, Some(plan_id));
        assert_eq!(plan_status(&pool, plan_id).await, "Active");
        let items = service.get_plan_passages(plan_id).await.unwrap();
        assert_eq!(items[0].scheduled_date, crate::time::format_date(today));
        assert_eq!(
            items[1].scheduled_date,
            crate::time::format_date(today + Duration::days(3))
        );
        assert_eq!(items[0].status, "due");
        let tasks = service.today_tasks().await.unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!((tasks[0].passage_id, tasks[0].status.as_str()), (p1, "due"));

        // 计划没结束：短文与它的题组都不能删
        assert!(passages.delete(p1).await.is_err());
        assert!(passages.delete_set(set1).await.is_err());

        // 做完题：任务完成并记下这次作答
        let set = passages.get_set(set1).await.unwrap();
        let answers = set
            .questions
            .iter()
            .map(|q| PassageAnswer {
                question_id: q.id,
                value: q.answer.clone().unwrap_or_else(|| "I want to fly.".into()),
            })
            .collect();
        let paths = AgentPaths {
            program: "/nonexistent/redlark-agent".into(),
            root: std::env::temp_dir().join("redlark-plan-passage-test"),
        };
        passages
            .submit_attempt(
                &SubmitPassageAttemptRequest {
                    attempt_id: attempt.id,
                    active_time: 60_000,
                    answers,
                },
                &paths,
            )
            .await
            .unwrap();
        let items = service.get_plan_passages(plan_id).await.unwrap();
        assert_eq!(items[0].status, "completed");
        assert_eq!(items[0].attempt.as_ref().map(|a| a.id), Some(attempt.id));
        assert_eq!(plan_status(&pool, plan_id).await, "Active");
        // 有题组的任务不能直接“读完了”
        assert!(service.complete_reading(plan_id, p1).await.is_err());

        // 读完只朗读的短文：全部完成，计划自动完成；之后可以删短文
        service.complete_reading(plan_id, p2).await.unwrap();
        assert_eq!(plan_status(&pool, plan_id).await, "Completed");
        let plan = plans.get_study_plan(plan_id).await.unwrap();
        assert_eq!((plan.total_passages, plan.completed_passages), (2, 2));
        assert!((plan.progress_percentage - 100.0).abs() < 1e-9);

        // 重新学习：任务回到未完成，作答留作自由练习，从今天重新排期
        plans.restart_study_plan(plan_id).await.unwrap();
        let items = service.get_plan_passages(plan_id).await.unwrap();
        assert!(items.iter().all(|i| i.completed_at.is_none()));
        assert_eq!(items[0].scheduled_date, crate::time::format_date(today));
        let detached: Option<Id> =
            sqlx::query_scalar("SELECT plan_id FROM passage_attempts WHERE id = ?")
                .bind(attempt.id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(detached, None);
        crate::time::assert_instants_canonical(&pool).await;
    }

    /// 单词计划加短文：练习内容规则、已完成短文不能去掉、日历带短文任务、单词没掌握不会自动完成
    #[tokio::test]
    async fn words_plan_adds_passages_and_keeps_completed_ones() {
        let pool = memory_pool().await;
        let logger = test_logger();
        let fixture = seed_schedule(&pool, 2).await;
        let plan_id = fixture.plan_id;
        for word_id in &fixture.word_ids {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
                .bind(plan_id)
                .bind(word_id)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }
        let (p1, set1) = seed_passage(&pool).await;
        let p2 = seed_plain_passage(&pool, "A Quiet Morning").await;
        let service = PlanPassageService::new(pool.clone(), logger.clone());
        let set = |content: &str, passages: Vec<PlanPassageInput>| SetPlanPassagesRequest {
            plan_id,
            practice_content: content.into(),
            passages,
            interval_days: 2,
        };
        // 计划里有单词：不能改成只练短文；只练单词时不能带短文
        assert!(service
            .set_plan_passages(&set("passages", vec![input(p1, Some(set1), "reading")]))
            .await
            .is_err());
        assert!(service
            .set_plan_passages(&set("words", vec![input(p1, None, "reading")]))
            .await
            .is_err());
        // 题组不属于这篇短文
        assert!(service
            .set_plan_passages(&set("both", vec![input(p2, Some(set1), "reading")]))
            .await
            .is_err());

        service
            .set_plan_passages(&set(
                "both",
                vec![
                    input(p2, None, "listening"),
                    input(p1, Some(set1), "reading"),
                ],
            ))
            .await
            .unwrap();
        let today = crate::time::local_today();
        let items = service.get_plan_passages(plan_id).await.unwrap();
        assert_eq!(items[0].passage_id, p2);
        assert_eq!(items[0].scheduled_date, crate::time::format_date(today));
        assert_eq!(
            items[1].scheduled_date,
            crate::time::format_date(today + Duration::days(2))
        );
        let plans = StudyPlanService::new(pool.clone(), logger.clone());
        let plan = plans.get_study_plan(plan_id).await.unwrap();
        assert_eq!(plan.practice_content, "both");
        assert_eq!(plan.end_date, Some(items[1].scheduled_date.clone()));

        // 读完第一篇：单词还没学，计划不会自动完成
        service.complete_reading(plan_id, p2).await.unwrap();
        assert_eq!(plan_status(&pool, plan_id).await, "Active");
        // 已完成的短文不能去掉；可以去掉没练的
        assert!(service
            .set_plan_passages(&set("both", vec![input(p1, Some(set1), "reading")]))
            .await
            .is_err());
        service
            .set_plan_passages(&set("both", vec![input(p2, None, "listening")]))
            .await
            .unwrap();
        assert_eq!(service.get_plan_passages(plan_id).await.unwrap().len(), 1);

        // 日历：今天有一项已完成的短文任务
        let calendar = crate::services::calendar::CalendarService::new(
            crate::repositories::calendar_repository::CalendarRepository::new(
                pool.clone(),
                logger.clone(),
            ),
        );
        use chrono::Datelike;
        let month = calendar
            .get_month_data(today.year(), today.month() as i32, true)
            .await
            .unwrap();
        let day = month
            .days
            .iter()
            .find(|d| d.date == crate::time::format_date(today))
            .unwrap();
        assert_eq!((day.passage_tasks, day.passage_completed), (1, 1));
        assert!(day.is_in_plan);
        crate::time::assert_instants_canonical(&pool).await;
    }

    /// 结束日随短文增删重新计算（不只增不减）；暂停期间提交的作答不计入计划
    #[tokio::test]
    async fn end_date_follows_passages_and_paused_submissions_become_free_practice() {
        let pool = memory_pool().await;
        let logger = test_logger();
        let fixture = seed_schedule(&pool, 1).await;
        let plan_id = fixture.plan_id;
        sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
            .bind(plan_id)
            .bind(fixture.word_ids[0])
            .execute(pool.as_ref())
            .await
            .unwrap();
        // 单词：最后一个新词日 10-06 → 单词结束日 10-17（+ 11 天巩固）
        sqlx::query("UPDATE study_plan_schedules SET new_words_count = 1 WHERE id = ?")
            .bind(fixture.schedule_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        sqlx::query("UPDATE study_plans SET start_date = '2026-10-06', unified_status = 'Pending' WHERE id = ?")
            .bind(plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        let (p1, set1) = seed_passage(&pool).await;
        let p2 = seed_plain_passage(&pool, "Later").await;
        let service = PlanPassageService::new(pool.clone(), logger.clone());
        let set = |passages: Vec<PlanPassageInput>, interval: i64| SetPlanPassagesRequest {
            plan_id,
            practice_content: "both".into(),
            passages,
            interval_days: interval,
        };
        let end = |pool: Arc<SqlitePool>| async move {
            sqlx::query_scalar::<_, Option<String>>("SELECT end_date FROM study_plans WHERE id = ?")
                .bind(plan_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap()
        };
        // 两篇、间隔 30 天：第二篇 11-05，晚于单词结束日
        service
            .set_plan_passages(&set(
                vec![input(p1, Some(set1), "reading"), input(p2, None, "reading")],
                30,
            ))
            .await
            .unwrap();
        assert_eq!(end(pool.clone()).await.as_deref(), Some("2026-11-05"));
        // 去掉第二篇：结束日回到单词结束日
        service
            .set_plan_passages(&set(vec![input(p1, Some(set1), "reading")], 30))
            .await
            .unwrap();
        assert_eq!(end(pool.clone()).await.as_deref(), Some("2026-10-17"));

        // 开始作答后计划被暂停：提交的作答转为自由练习，任务不完成
        let passages = PassageService::new(pool.clone(), logger.clone());
        let attempt = passages
            .start_attempt(set1, "reading", Some(plan_id))
            .await
            .unwrap();
        sqlx::query("UPDATE study_plans SET unified_status = 'Paused' WHERE id = ?")
            .bind(plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        let qs = passages.get_set(set1).await.unwrap();
        let done = passages
            .submit_attempt(
                &SubmitPassageAttemptRequest {
                    attempt_id: attempt.id,
                    active_time: 1_000,
                    answers: qs
                        .questions
                        .iter()
                        .map(|q| PassageAnswer {
                            question_id: q.id,
                            value: q.answer.clone().unwrap_or_else(|| "I want to fly.".into()),
                        })
                        .collect(),
                },
                &AgentPaths {
                    program: "/nonexistent/redlark-agent".into(),
                    root: std::env::temp_dir().join("redlark-plan-passage-test"),
                },
            )
            .await
            .unwrap();
        assert_eq!(done.plan_id, None);
        assert!(service.get_plan_passages(plan_id).await.unwrap()[0]
            .completed_at
            .is_none());
    }

    /// 候选短文按与所选单词本的相关度排序，默认题组是最早的一套
    #[tokio::test]
    async fn candidates_rank_by_overlap_with_books() {
        let pool = memory_pool().await;
        let (p1, set1) = seed_passage(&pool).await;
        let p2 = seed_plain_passage(&pool, "Later").await;
        let service = PlanPassageService::new(pool.clone(), test_logger());
        let out = service
            .candidates(&PlanPassageCandidatesRequest {
                book_ids: vec![970],
                plan_id: None,
            })
            .await
            .unwrap();
        assert_eq!(
            out.iter()
                .map(|c| (c.passage.id, c.overlap))
                .collect::<Vec<_>>(),
            [(p1, 2), (p2, 0)]
        );
        assert_eq!(out[0].default_set_id, Some(set1));
        assert_eq!(out[1].default_set_id, None);
    }

    fn d(s: &str) -> NaiveDate {
        crate::time::parse_date(s).unwrap()
    }

    #[test]
    fn dates_follow_interval_from_start() {
        let dates = schedule_dates(d("2026-10-01"), 2, &[None, None, None], None);
        assert_eq!(
            dates,
            vec![d("2026-10-01"), d("2026-10-03"), d("2026-10-05")]
        );
    }

    #[test]
    fn completed_items_keep_dates_and_pending_ones_start_no_earlier_than_floor() {
        // 第 1 篇 10-02 已完成；今天 10-08：没完成的从今天起每 3 天一篇
        let locked = [Some(d("2026-10-02")), None, None];
        let dates = schedule_dates(d("2026-10-01"), 3, &locked, Some(d("2026-10-08")));
        assert_eq!(
            dates,
            vec![d("2026-10-02"), d("2026-10-08"), d("2026-10-11")]
        );
        // 自然日期已经在今天之后的保持不变
        let dates = schedule_dates(
            d("2026-10-01"),
            3,
            &[None, None, None],
            Some(d("2026-10-02")),
        );
        assert_eq!(
            dates,
            vec![d("2026-10-02"), d("2026-10-05"), d("2026-10-08")]
        );
    }

    #[test]
    fn inputs_must_match_practice_content() {
        let input = |id: Id| PlanPassageInput {
            passage_id: id,
            set_id: None,
            mode: "reading".into(),
        };
        assert!(validate_inputs("words", &[]).is_ok());
        assert!(validate_inputs("words", &[input(1)]).is_err());
        assert!(validate_inputs("passages", &[]).is_err());
        assert!(validate_inputs("both", &[input(1), input(2)]).is_ok());
        assert!(validate_inputs("both", &[input(1), input(1)]).is_err());
        let mut bad = input(3);
        bad.mode = "speaking".into();
        assert!(validate_inputs("passages", &[bad]).is_err());
        assert!(validate_settings("all", 2).is_err());
        assert!(validate_settings("both", 0).is_err());
        assert!(validate_settings("both", 30).is_ok());
    }

    #[test]
    fn item_status_by_date() {
        assert_eq!(item_status("2026-10-05", true, "2026-10-07"), "completed");
        assert_eq!(item_status("2026-10-05", false, "2026-10-07"), "overdue");
        assert_eq!(item_status("2026-10-07", false, "2026-10-07"), "due");
        assert_eq!(item_status("2026-10-09", false, "2026-10-07"), "upcoming");
    }
}
