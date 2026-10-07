//! 日历视图业务逻辑服务
//!
//! 封装日历视图相关的业务逻辑

use crate::error::{AppError, AppResult};
use crate::repositories::calendar_repository::{
    CalendarRepository, CalendarScheduleRow, CalendarSessionRow,
};
use crate::repositories::plan_passage_repository::{CalendarPassageRow, PlanPassageRepository};
use crate::repositories::practice_metrics::streak_days;
use crate::types::study::{
    CalendarDayData, CalendarMonthResponse, CalendarMonthlyStats, CalendarPassageTask,
    CalendarStudyPlan, CalendarStudySession, StudyPlanLifecycleStatus, TodayStudySchedule,
};
use chrono::{Datelike, Duration, NaiveDate};
use std::collections::HashSet;

/// 日历视图服务
///
/// 负责日历视图的业务逻辑处理
pub struct CalendarService {
    calendar_repo: CalendarRepository,
    passage_repo: PlanPassageRepository,
}

impl CalendarService {
    /// 创建新的服务实例
    pub fn new(calendar_repo: CalendarRepository) -> Self {
        Self {
            passage_repo: PlanPassageRepository::new(calendar_repo.pool()),
            calendar_repo,
        }
    }

    /// 获取今日学习日程
    pub async fn get_today_study_schedules(&self) -> AppResult<Vec<TodayStudySchedule>> {
        self.calendar_repo.sync_today_reviews().await?;
        // 使用 Repository 查询今日日程
        let today_schedule_infos = self.calendar_repo.find_today_schedules().await?;

        // 转换为业务类型
        let schedules: Vec<TodayStudySchedule> = today_schedule_infos
            .into_iter()
            .map(|info| self.convert_to_today_schedule(info))
            .collect();

        Ok(schedules)
    }

    /// 将 Repository 返回的类型转换为 Service 层类型
    fn convert_to_today_schedule(
        &self,
        info: crate::repositories::calendar_repository::TodayScheduleInfo,
    ) -> TodayStudySchedule {
        let total_words = info.total_words_count;
        let completed_words = info.completed_words_count;

        let progress_percentage = if total_words > 0 {
            (completed_words as f64 / total_words as f64 * 100.0).round() as i32
        } else {
            0
        };

        // 状态：练完即完成；练了一半为进行中；日期已过为待补；进度（progress_percentage）是掌握率
        let today = crate::time::format_date(crate::time::local_today());
        let status = if info.practiced {
            "completed"
        } else if info.has_open_session {
            "in-progress"
        } else if info.schedule_date < today {
            "overdue"
        } else {
            "not-started"
        }
        .to_string();

        TodayStudySchedule {
            plan_id: info.plan_id,
            plan_name: info.plan_name,
            schedule_id: info.schedule_id,
            schedule_date: info.schedule_date,
            new_words_count: info.new_words_count,
            review_words_count: info.review_words_count,
            total_words_count: total_words,
            completed_words_count: completed_words,
            progress_percentage,
            status,
            can_start_practice: total_words > 0 && completed_words < total_words,
            overdue_count: info.overdue_count,
        }
    }

    /// 获取月度日历数据（含日状态与月度统计）
    pub async fn get_month_data(
        &self,
        year: i32,
        month: i32,
        include_other_months: bool,
    ) -> AppResult<CalendarMonthResponse> {
        let (start_date, end_date) = month_range(year, month, include_other_months)?;
        let start = start_date.format("%Y-%m-%d").to_string();
        let end = end_date.format("%Y-%m-%d").to_string();

        self.calendar_repo.sync_today_reviews().await?;
        let schedules = self
            .calendar_repo
            .find_schedules_in_range(&start, &end)
            .await?;
        let sessions = self
            .calendar_repo
            .find_session_summaries_in_range(&start, &end)
            .await?;
        let study_dates = self.calendar_repo.find_study_dates().await?;
        let passages = self.passage_repo.in_range(&start, &end, None).await?;

        let today = crate::time::local_today();
        Ok(build_month_with_passages(
            MonthInput {
                year,
                month,
                start_date,
                end_date,
                today,
            },
            &schedules,
            &passages,
            &sessions,
            &study_dates,
        ))
    }
}

/// 日历显示范围：包含其他月份时从月初所在周的周一到月末所在周的周日，否则为当月首末日
fn month_range(
    year: i32,
    month: i32,
    include_other_months: bool,
) -> AppResult<(NaiveDate, NaiveDate)> {
    let invalid = || AppError::ValidationError("日期格式不正确".to_string());
    let first_day = NaiveDate::from_ymd_opt(year, month as u32, 1).ok_or_else(invalid)?;
    let last_day = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1).ok_or_else(invalid)?
    } else {
        NaiveDate::from_ymd_opt(year, month as u32 + 1, 1).ok_or_else(invalid)?
    } - Duration::days(1);

    if include_other_months {
        let start = first_day - Duration::days(first_day.weekday().num_days_from_monday() as i64);
        let end = last_day + Duration::days(6 - last_day.weekday().num_days_from_monday() as i64);
        Ok((start, end))
    } else {
        Ok((first_day, last_day))
    }
}

fn parse_lifecycle_status(status: &str) -> StudyPlanLifecycleStatus {
    match status {
        "Draft" => StudyPlanLifecycleStatus::Draft,
        "Pending" => StudyPlanLifecycleStatus::Pending,
        "Active" => StudyPlanLifecycleStatus::Active,
        "Paused" => StudyPlanLifecycleStatus::Paused,
        "Completed" => StudyPlanLifecycleStatus::Completed,
        "Terminated" => StudyPlanLifecycleStatus::Terminated,
        "Deleted" => StudyPlanLifecycleStatus::Deleted,
        _ => StudyPlanLifecycleStatus::Draft,
    }
}

/// 计划状态是否会“欠账”：进行中 / 待开始的计划没练的过期日程算逾期；暂停、已结束的不算
pub(crate) fn plan_can_be_overdue(unified_status: &str) -> bool {
    matches!(unified_status, "Active" | "Pending")
}

/// 一天里某个日程的练习情况（日状态的输入）
#[derive(Debug, Clone, Copy)]
pub(crate) struct DayScheduleState {
    /// 有已完成的练习会话
    pub practiced: bool,
    /// 有练了一半的会话，或已有掌握的词
    pub started: bool,
    /// 计划状态允许算逾期
    pub can_be_overdue: bool,
}

/// 日状态（全局日历与计划日历共用）：
/// 全部练完 → completed（提前练完的未来日期也算）；练了一部分 → in-progress；
/// 日期已过且有该练没练的 → overdue；其余 → not-started。
pub(crate) fn day_status(
    date: NaiveDate,
    today: NaiveDate,
    schedules: &[DayScheduleState],
) -> &'static str {
    if schedules.is_empty() {
        return "not-started";
    }
    if schedules.iter().all(|s| s.practiced) {
        "completed"
    } else if schedules.iter().any(|s| s.practiced || s.started) {
        "in-progress"
    } else if date < today && schedules.iter().any(|s| s.can_be_overdue) {
        "overdue"
    } else {
        "not-started"
    }
}

/// 月视图的日期参数
pub(crate) struct MonthInput {
    pub year: i32,
    pub month: i32,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub today: NaiveDate,
}

/// 由日程与学习记录组装日历（没有短文任务）
#[cfg(test)]
fn build_month(
    input: MonthInput,
    schedules: &[CalendarScheduleRow],
    sessions: &[CalendarSessionRow],
    study_dates: &[NaiveDate],
) -> CalendarMonthResponse {
    build_month_with_passages(input, schedules, &[], sessions, study_dates)
}

/// 由日程、短文任务与学习记录组装日历：逐日状态、进度，以及只统计当月日期的月度统计。
/// 已完成 / 已终止计划只保留练过的日程与完成的短文（历史记录），没练的不显示也不算逾期。
/// 短文任务和日程一样参与日状态（完成算练完；日期已过没完成算逾期）。
fn build_month_with_passages(
    input: MonthInput,
    schedules: &[CalendarScheduleRow],
    passages: &[CalendarPassageRow],
    sessions: &[CalendarSessionRow],
    study_dates: &[NaiveDate],
) -> CalendarMonthResponse {
    let MonthInput {
        year,
        month,
        start_date,
        end_date,
        today,
    } = input;
    let visible = |r: &&CalendarScheduleRow| {
        r.practiced || matches!(r.unified_status.as_str(), "Pending" | "Active" | "Paused")
    };
    let mut days = Vec::new();
    let mut current_date = start_date;

    while current_date <= end_date {
        let date_str = current_date.format("%Y-%m-%d").to_string();

        let mut study_plans = Vec::new();
        let mut states = Vec::new();
        let (mut total_words, mut new_words, mut review_words) = (0, 0, 0);
        // 当天掌握数以日程自身的完成数为准（练习记录可能是重复练习或补做其他日期的日程）
        let mut completed_words = 0;
        for row in schedules
            .iter()
            .filter(|r| r.schedule_date == date_str)
            .filter(visible)
        {
            study_plans.push(CalendarStudyPlan {
                plan_id: row.plan_id,
                plan_name: row.plan_name.clone(),
                schedule_id: row.schedule_id,
                unified_status: parse_lifecycle_status(&row.unified_status),
                practiced: row.practiced,
                in_progress: !row.practiced && row.has_open_session,
                new_words_count: row.new_words,
                review_words_count: row.review_words,
                total_words_count: row.total_words,
                completed_words_count: row.completed_words.min(row.total_words),
            });
            states.push(DayScheduleState {
                practiced: row.practiced,
                started: row.has_open_session || row.completed_words > 0,
                can_be_overdue: plan_can_be_overdue(&row.unified_status),
            });
            total_words += row.total_words;
            completed_words += row.completed_words.min(row.total_words);
            new_words += row.new_words;
            review_words += row.review_words;
        }

        let mut study_sessions = Vec::new();
        let mut study_time_minutes = 0;
        for row in sessions.iter().filter(|r| r.study_date == date_str) {
            study_sessions.push(CalendarStudySession {
                session_id: format!("diag-{}", row.plan_id),
                plan_id: row.plan_id,
                plan_name: row.plan_name.clone(),
                words_studied: row.words_studied,
                study_time_minutes: row.study_time_minutes.round() as i64,
                accuracy_rate: row.accuracy_rate.unwrap_or(0.0),
                completed_at: row.completed_at.clone(),
            });
            study_time_minutes += row.study_time_minutes.round() as i32;
        }

        let (mut passage_tasks, mut passage_completed) = (0, 0);
        let mut passage_items = Vec::new();
        for row in passages.iter().filter(|r| {
            r.scheduled_date == date_str
                && (r.completed
                    || matches!(r.unified_status.as_str(), "Pending" | "Active" | "Paused"))
        }) {
            passage_tasks += 1;
            passage_completed += row.completed as i32;
            passage_items.push(CalendarPassageTask {
                plan_id: row.plan_id,
                plan_name: row.plan_name.clone(),
                passage_id: row.passage_id,
                title: row.title.clone(),
                set_id: row.set_id,
                mode: row.mode.clone(),
                completed: row.completed,
                unified_status: parse_lifecycle_status(&row.unified_status),
            });
            states.push(DayScheduleState {
                practiced: row.completed,
                started: false,
                can_be_overdue: plan_can_be_overdue(&row.unified_status),
            });
        }

        let is_in_plan = !study_plans.is_empty() || passage_tasks > 0;
        let status = day_status(current_date, today, &states).to_string();

        let progress_percentage = if total_words > 0 {
            (completed_words as f64 / total_words as f64 * 100.0).min(100.0)
        } else {
            0.0
        };

        days.push(CalendarDayData {
            date: date_str,
            is_today: current_date == today,
            is_in_plan,
            status,
            new_words_count: new_words,
            review_words_count: review_words,
            total_words_count: total_words,
            completed_words_count: completed_words,
            progress_percentage,
            study_time_minutes: (study_time_minutes > 0).then_some(study_time_minutes),
            study_plans: (!study_plans.is_empty()).then_some(study_plans),
            study_sessions: (!study_sessions.is_empty()).then_some(study_sessions),
            passage_tasks,
            passage_completed,
            passages: passage_items,
        });

        current_date += Duration::days(1);
    }

    let current_month_days: Vec<&CalendarDayData> = days
        .iter()
        .filter(|d| {
            NaiveDate::parse_from_str(&d.date, "%Y-%m-%d")
                .map(|date| date.month() == month as u32)
                .unwrap_or(false)
        })
        .collect();

    let accuracies: Vec<f64> = current_month_days
        .iter()
        .filter_map(|d| d.study_sessions.as_ref())
        .flatten()
        .map(|s| s.accuracy_rate)
        .collect();
    let average_accuracy = if accuracies.is_empty() {
        0.0
    } else {
        accuracies.iter().sum::<f64>() / accuracies.len() as f64
    };

    // 连续学习天数：与首页统计同一口径（practice_metrics::streak_days，按实际学习日）
    let streak_days = streak_days(study_dates, today);

    // 本月涉及的进行中计划
    let active_plan_ids: HashSet<i64> = current_month_days
        .iter()
        .filter_map(|d| d.study_plans.as_ref())
        .flatten()
        .filter(|p| {
            matches!(
                p.unified_status,
                StudyPlanLifecycleStatus::Active | StudyPlanLifecycleStatus::Pending
            )
        })
        .map(|p| p.plan_id)
        .collect();

    let monthly_stats = CalendarMonthlyStats {
        total_days: current_month_days.len() as i32,
        // 学习天数：实际练过的天数（不是有安排的天数）
        study_days: current_month_days
            .iter()
            .filter(|d| d.study_sessions.is_some())
            .count() as i32,
        completed_days: current_month_days
            .iter()
            .filter(|d| d.status == "completed")
            .count() as i32,
        total_words_learned: current_month_days
            .iter()
            .map(|d| d.completed_words_count)
            .sum(),
        total_study_minutes: current_month_days
            .iter()
            .filter_map(|d| d.study_time_minutes)
            .sum(),
        average_accuracy,
        streak_days,
        active_plans_count: active_plan_ids.len() as i32,
    };

    CalendarMonthResponse {
        year,
        month,
        days,
        monthly_stats,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, seed_schedule, test_logger};

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn schedule(date: &str, plan_id: i64, total: i32) -> CalendarScheduleRow {
        schedule_done(date, plan_id, total, 0)
    }

    fn schedule_done(date: &str, plan_id: i64, total: i32, completed: i32) -> CalendarScheduleRow {
        CalendarScheduleRow {
            schedule_id: plan_id * 1000 + date[8..].parse::<i64>().unwrap(),
            schedule_date: date.to_string(),
            plan_id,
            plan_name: format!("计划{}", plan_id),
            unified_status: "Active".to_string(),
            total_words: total,
            completed_words: completed,
            practiced: completed > 0,
            has_open_session: false,
            new_words: total,
            review_words: 0,
        }
    }

    fn session(
        date: &str,
        plan_id: i64,
        words: i64,
        minutes: f64,
        accuracy: Option<f64>,
    ) -> CalendarSessionRow {
        CalendarSessionRow {
            study_date: date.to_string(),
            plan_id,
            plan_name: format!("计划{}", plan_id),
            words_studied: words,
            study_time_minutes: minutes,
            accuracy_rate: accuracy,
            completed_at: format!("{} 10:00:00", date),
        }
    }

    fn input(start_date: NaiveDate, end_date: NaiveDate, today: NaiveDate) -> MonthInput {
        MonthInput {
            year: 2026,
            month: 10,
            start_date,
            end_date,
            today,
        }
    }

    fn day<'a>(r: &'a CalendarMonthResponse, date: &str) -> &'a CalendarDayData {
        r.days.iter().find(|x| x.date == date).unwrap()
    }

    #[test]
    fn month_range_spans_whole_weeks_when_including_other_months() {
        // 2026-10-01 是周四，2026-10-31 是周六
        assert_eq!(
            month_range(2026, 10, true).unwrap(),
            (d("2026-09-28"), d("2026-11-01"))
        );
        assert_eq!(
            month_range(2026, 10, false).unwrap(),
            (d("2026-10-01"), d("2026-10-31"))
        );
        assert_eq!(month_range(2026, 12, false).unwrap().1, d("2026-12-31"));
        assert!(matches!(
            month_range(2026, 13, false),
            Err(AppError::ValidationError(_))
        ));
    }

    #[test]
    fn day_status_follows_completion_and_date_rules() {
        let today = d("2026-10-15");
        let schedules = vec![
            schedule_done("2026-10-10", 1, 5, 5),
            // 两个计划只练完一个：进行中
            schedule_done("2026-10-11", 1, 5, 2),
            schedule("2026-10-11", 2, 5),
            schedule("2026-10-12", 1, 5),
            // 练完但只掌握 1 个：完成（不会因为错词永远逾期），进度显示掌握率
            schedule_done("2026-10-13", 1, 5, 1),
            schedule("2026-10-15", 1, 5),
            schedule("2026-10-20", 1, 5),
        ];
        let sessions = vec![
            session("2026-10-10", 1, 6, 12.4, Some(80.0)),
            session("2026-10-11", 1, 2, 3.0, None),
            // 练过但一个都没完成（全错 / 重复练习）：不算完成
            session("2026-10-12", 1, 10, 5.0, Some(0.0)),
        ];
        let (start, end) = month_range(2026, 10, true).unwrap();
        let r = build_month(input(start, end, today), &schedules, &sessions, &[]);

        assert_eq!(day(&r, "2026-10-10").status, "completed");
        assert_eq!(day(&r, "2026-10-10").progress_percentage, 100.0);
        assert_eq!(day(&r, "2026-10-10").study_time_minutes, Some(12));
        assert_eq!(day(&r, "2026-10-11").status, "in-progress");
        assert_eq!(day(&r, "2026-10-11").progress_percentage, 20.0);
        assert_eq!(day(&r, "2026-10-13").status, "completed");
        assert_eq!(day(&r, "2026-10-13").progress_percentage, 20.0);
        assert_eq!(day(&r, "2026-10-12").status, "overdue");
        assert_eq!(day(&r, "2026-10-12").study_time_minutes, Some(5));
        assert_eq!(day(&r, "2026-10-15").status, "not-started");
        assert!(day(&r, "2026-10-15").is_today);
        assert_eq!(day(&r, "2026-10-20").status, "not-started");
        assert_eq!(day(&r, "2026-10-01").status, "not-started");
        assert!(!day(&r, "2026-10-01").is_in_plan);
        assert_eq!(
            day(&r, "2026-10-11").study_sessions.as_ref().unwrap()[0].accuracy_rate,
            0.0
        );
    }

    #[test]
    fn monthly_stats_only_count_days_of_the_requested_month() {
        let today = d("2026-10-15");
        let schedules = vec![
            schedule_done("2026-09-28", 2, 5, 5), // 显示范围内但不属于 10 月
            schedule_done("2026-10-10", 1, 5, 5),
        ];
        let sessions = vec![
            session("2026-09-28", 2, 5, 10.0, Some(100.0)),
            session("2026-10-10", 1, 5, 20.0, Some(60.0)),
        ];
        let (start, end) = month_range(2026, 10, true).unwrap();
        let stats = build_month(input(start, end, today), &schedules, &sessions, &[]).monthly_stats;

        assert_eq!(stats.total_days, 31);
        assert_eq!(stats.study_days, 1);
        assert_eq!(stats.completed_days, 1);
        assert_eq!(stats.total_words_learned, 5);
        assert_eq!(stats.total_study_minutes, 20);
        assert_eq!(stats.average_accuracy, 60.0);
        assert_eq!(stats.active_plans_count, 1);
    }

    #[test]
    fn streak_uses_actual_study_dates_and_tolerates_today_not_done_yet() {
        let today = d("2026-10-12");
        let (start, end) = month_range(2026, 10, true).unwrap();
        // 今天还没练：从昨天往前数；与首页统计同一口径
        let dates = [d("2026-10-09"), d("2026-10-10"), d("2026-10-11")];
        let stats = build_month(input(start, end, today), &[], &[], &dates).monthly_stats;
        assert_eq!(stats.streak_days, 3);
        // 看上个月时连续天数仍按今天计算（不受显示范围影响）
        let stats = build_month(
            MonthInput {
                year: 2026,
                month: 9,
                start_date: d("2026-08-31"),
                end_date: d("2026-10-04"),
                today,
            },
            &[],
            &[],
            &dates,
        )
        .monthly_stats;
        assert_eq!(stats.streak_days, 3);
    }

    #[test]
    fn day_lists_plan_counts_and_passage_items() {
        let today = d("2026-10-15");
        let mut half_done = schedule_done("2026-10-15", 1, 8, 3);
        half_done.practiced = false;
        half_done.has_open_session = true;
        half_done.new_words = 5;
        half_done.review_words = 3;
        let passage = |title: &str, completed: bool| CalendarPassageRow {
            scheduled_date: "2026-10-15".to_string(),
            completed,
            unified_status: "Active".to_string(),
            plan_id: 1,
            plan_name: "计划1".to_string(),
            passage_id: 7,
            title: title.to_string(),
            set_id: None,
            mode: "reading".to_string(),
        };
        let (start, end) = month_range(2026, 10, true).unwrap();
        let r = build_month_with_passages(
            input(start, end, today),
            &[half_done],
            &[passage("A", true), passage("B", false)],
            &[],
            &[],
        );
        let day = day(&r, "2026-10-15");
        let plan = &day.study_plans.as_ref().unwrap()[0];
        assert!(plan.in_progress && !plan.practiced);
        assert_eq!(
            (
                plan.new_words_count,
                plan.review_words_count,
                plan.total_words_count,
                plan.completed_words_count
            ),
            (5, 3, 8, 3)
        );
        let titles: Vec<_> = day
            .passages
            .iter()
            .map(|p| (p.title.as_str(), p.completed))
            .collect();
        assert_eq!(titles, vec![("A", true), ("B", false)]);
        assert_eq!((day.passage_tasks, day.passage_completed), (2, 1));
    }

    #[test]
    fn early_practice_paused_and_finished_plans() {
        let today = d("2026-10-15");
        let mut finished_unpracticed = schedule("2026-10-05", 3, 5);
        finished_unpracticed.unified_status = "Terminated".to_string();
        let mut finished_practiced = schedule_done("2026-10-06", 3, 5, 4);
        finished_practiced.unified_status = "Completed".to_string();
        let mut paused = schedule("2026-10-07", 4, 5);
        paused.unified_status = "Paused".to_string();
        let mut half_done = schedule("2026-10-08", 1, 5);
        half_done.has_open_session = true;
        let schedules = vec![
            finished_unpracticed,
            finished_practiced,
            paused,
            half_done,
            // 提前练完的未来日程：显示完成
            schedule_done("2026-10-20", 1, 5, 5),
        ];
        let sessions = vec![session("2026-10-06", 3, 5, 3.0, None)];
        let (start, end) = month_range(2026, 10, true).unwrap();
        let r = build_month(input(start, end, today), &schedules, &sessions, &[]);

        // 已结束计划没练的日程不显示、不算逾期；练过的保留为历史
        assert!(!day(&r, "2026-10-05").is_in_plan);
        assert_eq!(day(&r, "2026-10-06").status, "completed");
        let plan = &day(&r, "2026-10-06").study_plans.as_ref().unwrap()[0];
        assert!(plan.practiced);
        assert_eq!(plan.schedule_id, 3006);
        // 暂停期间没练的不算逾期
        assert_eq!(day(&r, "2026-10-07").status, "not-started");
        // 练了一半：进行中
        assert_eq!(day(&r, "2026-10-08").status, "in-progress");
        assert_eq!(day(&r, "2026-10-20").status, "completed");
        // 学习天数是实际练过的天数；进行中计划只算 Active / Pending
        assert_eq!(r.monthly_stats.study_days, 1);
        assert_eq!(r.monthly_stats.active_plans_count, 1);
    }

    /// 前端 `src/types/study.ts` 按这些 snake_case 键读取；改 serde 属性须同步 TS 类型
    #[test]
    fn month_response_wire_shape_is_snake_case() {
        let today = d("2026-10-10");
        let schedules = vec![schedule("2026-10-10", 1, 5)];
        let sessions = vec![session("2026-10-10", 1, 5, 1.0, Some(90.0))];
        let r = build_month(
            input(d("2026-10-10"), d("2026-10-10"), today),
            &schedules,
            &sessions,
            &[],
        );
        let v = serde_json::to_value(&r).unwrap();

        for key in ["year", "month", "days", "monthly_stats"] {
            assert!(v.get(key).is_some(), "missing {key}");
        }
        for key in [
            "total_days",
            "study_days",
            "total_words_learned",
            "streak_days",
            "active_plans_count",
        ] {
            assert!(
                v["monthly_stats"].get(key).is_some(),
                "missing monthly_stats.{key}"
            );
        }
        let day = &v["days"][0];
        for key in [
            "is_today",
            "is_in_plan",
            "new_words_count",
            "progress_percentage",
            "study_plans",
            "study_sessions",
        ] {
            assert!(day.get(key).is_some(), "missing day.{key}");
        }
        assert_eq!(day["study_plans"][0]["plan_name"], "计划1");
        assert_eq!(day["study_plans"][0]["unified_status"], "active");
        assert_eq!(day["study_sessions"][0]["accuracy_rate"], 90.0);
    }

    #[tokio::test]
    async fn month_data_reads_active_schedules_and_study_sessions() {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 4).await; // 2026-10-06，Active 计划
                                                // 日程完成 3 个词（由 refresh_completion 写入）；学习记录只提供时长与正确率
        sqlx::query(
            "INSERT INTO study_sessions (plan_id, started_at, finished_at, words_studied, correct_answers, total_time_seconds)
             VALUES (?1, '2026-10-06 11:50:00', '2026-10-06 12:00:00', 4, 4, 600);
             UPDATE study_plan_schedules SET completed_words_count = 3 WHERE id = ?2;",
        )
        .bind(fx.plan_id)
        .bind(fx.schedule_id)
        .execute(pool.as_ref())
        .await
        .unwrap();
        let service = CalendarService::new(CalendarRepository::new(pool.clone(), test_logger()));

        let r = service.get_month_data(2026, 10, false).await.unwrap();

        assert_eq!(r.days.len(), 31);
        let day = day(&r, "2026-10-06");
        assert!(day.is_in_plan);
        assert_eq!((day.total_words_count, day.completed_words_count), (4, 3));
        assert_eq!(day.study_time_minutes, Some(10));
        assert_eq!(day.study_sessions.as_ref().unwrap()[0].accuracy_rate, 100.0);
    }
}
