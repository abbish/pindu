//! 自适应间隔复习（Leitner 盒子，D20）——计划单词记忆等级的唯一规则 owner。
//!
//! - 等级 0 = 未学；1–5 对应复习间隔 1 / 3 / 7 / 14 / 30 天。
//! - 新词学完（当天练习完成）：进入 1 级，明天复习。
//! - 复习（只做第三步，不看答案独立拼写）首次作答：对 → 升一级、按新等级的间隔推后；错 → 回到 1 级、明天再练。
//! - 掌握：等级 ≥ 4（间隔 7 天后仍首次写对）。
//! - 间隔以**实际练习日期**为基准，漏练不会打乱后续安排；每天的复习数量有上限，积压时最早到期、等级低的优先。

use crate::error::AppResult;
use crate::repositories::srs_repository::SrsRepository;
use chrono::{Duration, NaiveDate};
use sqlx::{Sqlite, SqliteConnection, SqlitePool, Transaction};

/// 各等级的复习间隔（天）：下标 = 等级 - 1
pub const INTERVALS: [i64; 5] = [1, 3, 7, 14, 30];
pub const MAX_BOX: i32 = INTERVALS.len() as i32;
/// 掌握等级（与 `practice_metrics::SRS_MASTERED_BOX` 一致）
pub const MASTERED_BOX: i32 = 4;

/// 一个词在一次练习中的结果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// 新词学完
    Learned,
    /// 复习首次作答
    Reviewed { correct: bool },
}

/// 记忆状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryState {
    pub box_level: i32,
    pub due: NaiveDate,
    pub lapsed: bool,
}

/// 下一个记忆状态（纯函数）
pub fn next_state(current_box: i32, outcome: Outcome, today: NaiveDate) -> MemoryState {
    let (box_level, lapsed) = match outcome {
        Outcome::Learned => (1, false),
        Outcome::Reviewed { correct: true } => ((current_box.max(1) + 1).min(MAX_BOX), false),
        Outcome::Reviewed { correct: false } => (1, true),
    };
    MemoryState {
        box_level,
        due: today + Duration::days(INTERVALS[(box_level - 1) as usize]),
        lapsed,
    }
}

/// 每天复习上限：每天新词数的 3 倍，限制在 15–60（旧计划没有每天新词数时按 10 计）
pub fn daily_review_cap(daily_new_words: Option<i32>) -> i64 {
    (daily_new_words.unwrap_or(10).max(1) as i64 * 3).clamp(15, 60)
}

/// 练习完成后按本次结果更新记忆状态（调用方事务内）
pub async fn apply_session_results(
    conn: &mut SqliteConnection,
    plan_id: i64,
    results: &[(i64, Outcome)],
    today: NaiveDate,
) -> AppResult<()> {
    for (word_id, outcome) in results {
        let current = SrsRepository::current_box_conn(conn, plan_id, *word_id).await?;
        let Some(current) = current else { continue };
        let next = next_state(current, *outcome, today);
        SrsRepository::save_state_conn(
            conn,
            plan_id,
            *word_id,
            &next,
            today,
            matches!(outcome, Outcome::Reviewed { .. }),
        )
        .await?;
    }
    Ok(())
}

/// 把今天到期的复习放进今天的日程（调用方事务内）：
/// 1. 清理过去 / 未来还没练的复习条目（复习都在“今天”动态生成，过期的不再保留），删掉因此变空且没有练习记录的日程；
/// 2. 今天的日程已练完或正在练时不改动；否则把到期的词（最多上限个）加入今天的日程，没有今天的日程就新建。
///
/// 只处理待开始 / 进行中的计划。
pub async fn sync_today(
    conn: &mut SqliteConnection,
    plan_id: i64,
    today: NaiveDate,
) -> AppResult<()> {
    let Some(plan) = SrsRepository::plan_for_sync_conn(conn, plan_id).await? else {
        return Ok(());
    };
    let today_str = today.format("%Y-%m-%d").to_string();
    SrsRepository::drop_stale_reviews_conn(conn, plan_id, &today_str).await?;

    let today_schedule = SrsRepository::schedule_on_conn(conn, plan_id, &today_str).await?;
    if let Some(s) = &today_schedule {
        if s.practiced || s.has_open_session {
            return Ok(());
        }
    }
    let due = SrsRepository::due_words_conn(
        conn,
        plan_id,
        &today_str,
        daily_review_cap(plan.daily_new_words),
    )
    .await?;
    if due.is_empty() {
        return Ok(());
    }
    let schedule_id = match today_schedule {
        Some(s) => s.id,
        None => {
            let day_number = plan
                .start_date
                .and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok())
                .map(|start| (today - start).num_days() + 1)
                .filter(|n| *n >= 1)
                .unwrap_or(1);
            SrsRepository::create_schedule_conn(conn, plan_id, day_number, &today_str).await?
        }
    };
    SrsRepository::add_review_words_conn(conn, schedule_id, &due).await?;
    SrsRepository::recount_schedule_conn(conn, schedule_id).await?;
    Ok(())
}

/// 同步用的写事务：一开始就拿写锁（`BEGIN IMMEDIATE`）。
///
/// 同步是「先读后写」，而页面打开时会并发发出好几个都要同步的请求（日历、今日日程、计划日程…）。
/// 普通的 `BEGIN`（DEFERRED）在 WAL 下从读升级为写时，如果别的连接已经写过，SQLite 直接返回
/// `database is locked`，不走 busy_timeout 等待；先拿写锁则后来者按 busy_timeout 排队。
pub async fn begin_write(pool: &SqlitePool) -> AppResult<Transaction<'static, Sqlite>> {
    Ok(pool.begin_with("BEGIN IMMEDIATE").await?)
}

/// 所有待开始 / 进行中计划的今日复习同步（启动时、日历与今日日程前调用）
pub async fn sync_all_today(pool: &SqlitePool) -> AppResult<()> {
    let today = crate::time::local_today();
    for plan_id in SrsRepository::syncable_plan_ids(pool).await? {
        let mut tx = begin_write(pool).await?;
        sync_today(&mut tx, plan_id, today).await?;
        tx.commit().await?;
    }
    Ok(())
}

/// 计划的记忆概况（计划详情展示用）
pub async fn plan_overview(
    pool: &sqlx::SqlitePool,
    plan_id: i64,
) -> AppResult<crate::types::study::PlanMemoryOverview> {
    use crate::types::study::{MemoryBoxCount, PlanMemoryOverview};
    if !SrsRepository::plan_exists(pool, plan_id).await? {
        return Err(crate::error::AppError::NotFound(
            "学习计划不存在，可能已被删除".to_string(),
        ));
    }
    let today = crate::time::format_date(crate::time::local_today());
    let (boxes, due_today, next_due_date) = SrsRepository::overview(pool, plan_id, &today).await?;
    let count_of = |b: i32| {
        boxes
            .iter()
            .filter(|(x, _)| *x == b)
            .map(|(_, n)| *n)
            .sum::<i64>()
    };
    let total: i64 = boxes.iter().map(|(_, n)| n).sum();
    let not_started = count_of(0);
    Ok(PlanMemoryOverview {
        plan_id,
        total,
        not_started,
        learned: total - not_started,
        mastered: boxes
            .iter()
            .filter(|(b, _)| *b >= MASTERED_BOX)
            .map(|(_, n)| n)
            .sum(),
        due_today,
        next_due_date,
        box_counts: (1..=MAX_BOX)
            .map(|b| MemoryBoxCount {
                box_level: b,
                count: count_of(b),
            })
            .collect(),
    })
}

/// 计划里还没掌握的词数（自动完成计划用）
pub async fn unmastered_count(conn: &mut SqliteConnection, plan_id: i64) -> AppResult<i64> {
    SrsRepository::unmastered_count_conn(conn, plan_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn leitner_boxes_expand_on_success_and_reset_on_failure() {
        let today = d("2026-10-07");
        let learned = next_state(0, Outcome::Learned, today);
        assert_eq!((learned.box_level, learned.due), (1, d("2026-10-08")));
        // 1 → 2（3 天）→ 3（7 天）→ 4（14 天，掌握）→ 5（30 天）→ 5
        let mut b = 1;
        let mut gaps = vec![];
        for _ in 0..5 {
            let s = next_state(b, Outcome::Reviewed { correct: true }, today);
            gaps.push((s.box_level, (s.due - today).num_days()));
            b = s.box_level;
        }
        assert_eq!(gaps, vec![(2, 3), (3, 7), (4, 14), (5, 30), (5, 30)]);
        let lapse = next_state(4, Outcome::Reviewed { correct: false }, today);
        assert_eq!(
            (lapse.box_level, lapse.due, lapse.lapsed),
            (1, d("2026-10-08"), true)
        );
        // 从未学过的词按 1 级处理（升到 2）
        assert_eq!(
            next_state(0, Outcome::Reviewed { correct: true }, today).box_level,
            2
        );
    }

    #[test]
    fn review_cap_scales_with_daily_new_words() {
        assert_eq!(daily_review_cap(Some(3)), 15);
        assert_eq!(daily_review_cap(Some(10)), 30);
        assert_eq!(daily_review_cap(Some(30)), 60);
        assert_eq!(daily_review_cap(None), 30);
    }

    #[test]
    fn consolidation_period_matches_intervals() {
        // 巩固期 = 从 1 级升到掌握所需的间隔之和
        let needed: i64 = INTERVALS[..(MASTERED_BOX - 1) as usize].iter().sum();
        assert_eq!(
            needed as usize,
            crate::services::study_planning::CONSOLIDATION_DAYS
        );
    }

    /// 端到端：昨天学过的词今天出现在复习里 → 复习只考第三步 → 答对升级、答错回到 1 级；
    /// 过去没练的复习条目在同步时清理
    #[tokio::test]
    async fn due_reviews_are_synced_into_today_and_results_update_boxes() {
        use crate::services::practice::PracticeService;
        use crate::services::study_plan::StudyPlanService;
        use crate::test_support::{memory_pool, seed_schedule, test_logger};
        use crate::types::study::PracticeStepRecord;

        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 3).await; // 第 1 天（2026-10-06）三个新词
        let today = crate::time::local_today();
        let fmt = |d: NaiveDate| d.format("%Y-%m-%d").to_string();
        // 计划从前天开始；词 0、1 昨天学过（等级 1，今天到期），词 2 等级 2 还没到期
        sqlx::query("UPDATE study_plans SET start_date = ?, daily_new_words = 5 WHERE id = ?")
            .bind(fmt(today - Duration::days(2)))
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        sqlx::query(
            "UPDATE study_plan_schedules SET schedule_date = ?, status = 'completed' WHERE id = ?",
        )
        .bind(fmt(today - Duration::days(2)))
        .bind(fx.schedule_id)
        .execute(pool.as_ref())
        .await
        .unwrap();
        for (i, (b, due)) in [(1, today), (1, today), (2, today + Duration::days(2))]
            .iter()
            .enumerate()
        {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id, srs_box, srs_due) VALUES (?, ?, ?, ?)")
                .bind(fx.plan_id)
                .bind(fx.word_ids[i])
                .bind(b)
                .bind(fmt(*due))
                .execute(pool.as_ref())
                .await
                .unwrap();
        }
        // 昨天遗留的一个没练过的复习日程：同步时应被清理
        let stale = sqlx::query(
            "INSERT INTO study_plan_schedules (plan_id, day_number, schedule_date, total_words_count, review_words_count) VALUES (?, 2, ?, 1, 1)",
        )
        .bind(fx.plan_id)
        .bind(fmt(today - Duration::days(1)))
        .execute(pool.as_ref())
        .await
        .unwrap()
        .last_insert_rowid();
        sqlx::query("INSERT INTO study_plan_schedule_words (schedule_id, word_id, wordbook_id, is_review) SELECT ?, word_id, wordbook_id, TRUE FROM study_plan_schedule_words WHERE schedule_id = ? LIMIT 1")
            .bind(stale)
            .bind(fx.schedule_id)
            .execute(pool.as_ref())
            .await
            .unwrap();

        let plans = StudyPlanService::new(pool.clone(), test_logger());
        let schedules = plans.get_plan_schedules(fx.plan_id).await.unwrap();
        let today_row = schedules
            .iter()
            .find(|s| s.schedule_date == fmt(today))
            .expect("今天的复习日程");
        assert_eq!(today_row.word_count, 2);
        assert!(!schedules.iter().any(|s| s.id == stale), "过期复习已清理");

        // 练习：复习词只做第三步；词 0 答对、词 1 答错
        let practice = PracticeService::from_pool_and_logger(pool.clone(), test_logger());
        let session = practice
            .start_practice_session(fx.plan_id, today_row.id)
            .await
            .unwrap();
        assert_eq!(session.word_states.len(), 2);
        assert!(session.word_states.iter().all(|w| w.is_review));
        for (i, w) in session.word_states.iter().enumerate() {
            practice
                .submit_step_result(PracticeStepRecord {
                    session_id: session.session_id.clone(),
                    word_id: w.word_id,
                    plan_word_id: w.plan_word_id,
                    step: 3,
                    user_input: "x".into(),
                    is_correct: w.word_id == fx.word_ids[0],
                    time_spent: 1000,
                    attempts: 1,
                    kind: "learn".into(),
                })
                .await
                .unwrap();
            let _ = i;
        }
        let result = practice
            .complete_practice_session(&session.session_id, 60_000, 60_000)
            .await
            .unwrap();
        assert_eq!(result.passed_words, 1);

        let states: Vec<(i64, i32, String, i32)> = sqlx::query_as(
            "SELECT word_id, srs_box, srs_due, srs_lapses FROM study_plan_words WHERE plan_id = ? ORDER BY word_id",
        )
        .bind(fx.plan_id)
        .fetch_all(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(
            states[0],
            (fx.word_ids[0], 2, fmt(today + Duration::days(3)), 0)
        );
        assert_eq!(
            states[1],
            (fx.word_ids[1], 1, fmt(today + Duration::days(1)), 1)
        );
        assert_eq!(states[2].1, 2, "未到期的词不变");
        // 今天练完后再同步不会重复加词
        let again = plans.get_plan_schedules(fx.plan_id).await.unwrap();
        let today_again = again
            .iter()
            .find(|s| s.schedule_date == fmt(today))
            .unwrap();
        assert_eq!(today_again.word_count, 2);
    }

    #[tokio::test]
    async fn plan_overview_counts_boxes_due_and_mastered() {
        use crate::test_support::{memory_pool, seed_schedule};
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 6).await;
        let today = crate::time::local_today();
        let fmt = |d: NaiveDate| d.format("%Y-%m-%d").to_string();
        let rows: [(i32, Option<NaiveDate>); 6] = [
            (0, None),
            (1, Some(today - Duration::days(1))), // 过期未练，算今天待复习
            (1, Some(today)),
            (2, Some(today + Duration::days(2))),
            (4, Some(today + Duration::days(9))),
            (5, Some(today + Duration::days(20))),
        ];
        for (i, (b, due)) in rows.iter().enumerate() {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id, srs_box, srs_due) VALUES (?, ?, ?, ?)")
                .bind(fx.plan_id)
                .bind(fx.word_ids[i])
                .bind(b)
                .bind(due.map(fmt))
                .execute(pool.as_ref())
                .await
                .unwrap();
        }

        let o = plan_overview(pool.as_ref(), fx.plan_id).await.unwrap();
        assert_eq!(
            (o.total, o.not_started, o.learned, o.mastered),
            (6, 1, 5, 2)
        );
        assert_eq!(o.due_today, 2);
        assert_eq!(o.next_due_date.as_deref(), Some(fmt(today).as_str()));
        assert_eq!(
            o.box_counts
                .iter()
                .map(|b| (b.box_level, b.count))
                .collect::<Vec<_>>(),
            vec![(1, 2), (2, 1), (3, 0), (4, 1), (5, 1)]
        );
        let v = serde_json::to_value(&o).unwrap();
        assert!(v.get("due_today").is_some() && v["box_counts"][0].get("box_level").is_some());
        assert!(matches!(
            plan_overview(pool.as_ref(), 9999).await,
            Err(crate::error::AppError::NotFound(_))
        ));
    }

    /// 回归：页面打开时并发的多个同步请求不能互相报 database is locked（日历「数据正忙」）
    #[tokio::test]
    async fn concurrent_syncs_do_not_fail_with_database_locked() {
        use crate::test_support::seed_schedule;
        use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};

        let path = std::env::temp_dir().join(format!("redlark-srs-{}.db", uuid::Uuid::new_v4()));
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();

        let today = crate::time::local_today();
        let fmt = |d: NaiveDate| d.format("%Y-%m-%d").to_string();
        for _ in 0..4 {
            let fx = seed_schedule(&pool, 3).await;
            sqlx::query("UPDATE study_plan_schedules SET schedule_date = ?, status = 'completed' WHERE id = ?")
                .bind(fmt(today - Duration::days(2)))
                .bind(fx.schedule_id)
                .execute(&pool)
                .await
                .unwrap();
            for w in &fx.word_ids {
                sqlx::query("INSERT INTO study_plan_words (plan_id, word_id, srs_box, srs_due) VALUES (?, ?, 1, ?)")
                    .bind(fx.plan_id)
                    .bind(w)
                    .bind(fmt(today))
                    .execute(&pool)
                    .await
                    .unwrap();
            }
        }

        let results = futures::future::join_all((0..8).map(|_| sync_all_today(&pool))).await;
        for r in &results {
            assert!(r.is_ok(), "并发同步失败：{:?}", r.as_ref().err());
        }
        // 每个计划今天只有一个日程（重复同步是幂等的）
        let today_schedules: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM study_plan_schedules WHERE schedule_date = ?")
                .bind(fmt(today))
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(today_schedules, 4);
        pool.close().await;
        let _ = std::fs::remove_file(&path);
    }
}
