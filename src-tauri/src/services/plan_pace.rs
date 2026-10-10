//! 计划就地调整（authoring-flows-redesign B5，用户决定：已开始的计划只做不丢数据的调整）：
//! - 改每天新词数：只重排“还没练过的日程”里的新词，保持原顺序；
//! - 追加词汇本：新词（未学，srs_box = 0）排在还没学的新词后面。
//!
//! 已练过的日程、复习条目、`study_plan_words.srs_*` 与练习记录一律不动；全部在一个事务里。

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::plan_pace_repository as repo;
use crate::repositories::plan_passage_repository::PlanPassageRepository;
use crate::repositories::study_plan_repository::StudyPlanRepository;
use crate::services::study_planning::{
    estimated_difficulty, CONSOLIDATION_DAYS, DAILY_NEW_WORDS_RANGE,
};
use crate::types::common::Id;
use chrono::{Duration, NaiveDate};
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use std::sync::Arc;

/// 调整后的结果（界面据此提示“剩余 N 个新词，X 天学完”）
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanPaceResult {
    /// 还没学的新词数（含本次追加的）
    pub remaining_new_words: usize,
    /// 这些新词要学的天数
    pub learning_days: usize,
    /// 计划结束日期（最后一个新词日 + 巩固期）
    pub end_date: Option<String>,
    /// 本次追加的单词数（改节奏时为 0）
    pub added_words: usize,
}

/// 可以调整的状态：未结束的计划
const EDITABLE: [&str; 4] = ["Draft", "Pending", "Active", "Paused"];

/// 待放置的新词
struct PendingWord {
    word_id: Id,
    wordbook_id: Id,
    priority: String,
    difficulty_level: i32,
}

pub struct PlanPaceService {
    pool: Arc<SqlitePool>,
    plans: StudyPlanRepository,
}

impl PlanPaceService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            plans: StudyPlanRepository::new(pool.clone(), logger),
            pool,
        }
    }

    async fn ensure_editable(&self, conn: &mut SqliteConnection, plan_id: Id) -> AppResult<()> {
        let status = self
            .plans
            .find_unified_status_conn(conn, plan_id)
            .await?
            .ok_or_else(|| AppError::NotFound("学习计划不存在，可能已被删除".to_string()))?;
        if !EDITABLE.contains(&status.as_str()) {
            return Err(AppError::ValidationError(
                "计划已结束，不能再调整；可以“重新学习”后再改".to_string(),
            ));
        }
        Ok(())
    }

    /// 改每天新词数：只重排还没练过的新词日
    pub async fn replan_pace(
        &self,
        plan_id: Id,
        daily_new_words: i32,
        today: NaiveDate,
    ) -> AppResult<PlanPaceResult> {
        if !DAILY_NEW_WORDS_RANGE.contains(&daily_new_words) {
            return Err(AppError::ValidationError(
                "每天新词数需在 1–50 之间".to_string(),
            ));
        }
        let mut tx = crate::services::srs::begin_write(&self.pool).await?;
        self.ensure_editable(&mut tx, plan_id).await?;
        let result = self
            .relayout(&mut tx, plan_id, daily_new_words, Vec::new(), today)
            .await?;
        tx.commit().await?;
        Ok(result)
    }

    /// 追加词汇本：新词排在还没学的新词后面（按当前每天新词数）
    pub async fn add_word_books(
        &self,
        plan_id: Id,
        book_ids: &[Id],
        today: NaiveDate,
    ) -> AppResult<PlanPaceResult> {
        if book_ids.is_empty() {
            return Err(AppError::ValidationError(
                "请至少选择一个词汇本".to_string(),
            ));
        }
        let mut tx = crate::services::srs::begin_write(&self.pool).await?;
        self.ensure_editable(&mut tx, plan_id).await?;
        let words = repo::words_not_in_plan_conn(&mut tx, plan_id, book_ids).await?;
        if words.is_empty() {
            return Err(AppError::ValidationError(
                "这些词汇本里的单词都已经在计划中了".to_string(),
            ));
        }
        let mut added = Vec::with_capacity(words.len());
        for (word_id, word, wordbook_id, _) in words {
            repo::insert_plan_word_conn(&mut tx, plan_id, word_id).await?;
            let difficulty = estimated_difficulty(&word);
            added.push(PendingWord {
                word_id,
                wordbook_id,
                priority: if difficulty <= 2 { "high" } else { "medium" }.to_string(),
                difficulty_level: difficulty,
            });
        }
        // 只练短文的计划追加了单词：练习内容变成两者都练
        if let Some(settings) = PlanPassageRepository::settings_conn(&mut tx, plan_id).await? {
            if settings.practice_content == "passages" {
                PlanPassageRepository::update_settings_conn(
                    &mut tx,
                    plan_id,
                    "both",
                    settings.interval_days,
                )
                .await?;
            }
        }
        let daily = repo::daily_new_words_conn(&mut tx, plan_id).await?;
        let result = self.relayout(&mut tx, plan_id, daily, added, today).await?;
        tx.commit().await?;
        Ok(result)
    }

    /// 取出还没练过的新词（保持顺序）+ `extra`，按 `daily` 重新排日程
    async fn relayout(
        &self,
        conn: &mut SqliteConnection,
        plan_id: Id,
        daily: i32,
        extra: Vec<PendingWord>,
        today: NaiveDate,
    ) -> AppResult<PlanPaceResult> {
        let added_words = extra.len();
        let open = repo::open_new_words_conn(conn, plan_id).await?;
        // 起点：练过的计划从今天起（落后的也一起重新铺开）；没练过的保持原来的第一天
        let practiced = self.plans.has_practice_conn(conn, plan_id).await?;
        let first_open = open
            .iter()
            .filter_map(|w| crate::time::parse_date(&w.schedule_date))
            .min();
        let start = match (practiced, first_open) {
            (false, Some(first)) => first,
            _ => today,
        };

        repo::delete_schedule_word_rows_conn(
            conn,
            &open.iter().map(|w| w.row_id).collect::<Vec<_>>(),
        )
        .await?;
        let mut pending: Vec<PendingWord> = open
            .into_iter()
            .map(|w| PendingWord {
                word_id: w.word_id,
                wordbook_id: w.wordbook_id,
                priority: w.priority,
                difficulty_level: w.difficulty_level,
            })
            .collect();
        pending.extend(extra);
        let remaining_new_words = pending.len();

        repo::recount_and_prune_conn(conn, plan_id).await?;
        repo::clear_day_numbers_conn(conn, plan_id).await?;

        let mut date = start;
        let mut temp_day = -1_000_000_000i64;
        let mut learning_days = 0usize;
        for chunk in pending.chunks(daily.max(1) as usize) {
            // 找一个还没练过的日子（练过的日子不往里加新词）
            let schedule_id = loop {
                let key = crate::time::format_date(date);
                match repo::schedule_on_date_conn(conn, plan_id, &key).await? {
                    Some((id, true)) => break id,
                    Some((_, false)) => date += Duration::days(1),
                    None => {
                        temp_day -= 1;
                        break repo::create_schedule_conn(conn, plan_id, &key, temp_day).await?;
                    }
                }
            };
            for w in chunk {
                repo::insert_new_word_conn(
                    conn,
                    schedule_id,
                    w.word_id,
                    w.wordbook_id,
                    &w.priority,
                    w.difficulty_level,
                )
                .await?;
            }
            learning_days += 1;
            date += Duration::days(1);
        }

        repo::recount_and_prune_conn(conn, plan_id).await?;
        repo::renumber_days_conn(conn, plan_id).await?;
        let end_date = repo::last_new_word_date_conn(conn, plan_id)
            .await?
            .and_then(|d| crate::time::parse_date(&d))
            .map(|d| crate::time::format_date(d + Duration::days(CONSOLIDATION_DAYS as i64)));
        repo::save_pace_conn(conn, plan_id, daily, end_date.as_deref()).await?;
        // 计划里有短文时，结束日取单词结束日与最后一篇短文中较晚的
        PlanPassageRepository::refresh_end_date_conn(conn, plan_id).await?;

        Ok(PlanPaceResult {
            remaining_new_words,
            learning_days,
            end_date,
            added_words,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, seed_schedule, seed_session, test_logger};

    async fn count(pool: &SqlitePool, sql: &str, id: Id) -> i64 {
        sqlx::query_scalar(sql)
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// 计划：第 1 天（10-06）6 个新词；再把其中后 4 个挪到 10-08、10-09 两天，组成 3 个日程
    async fn plan_with_three_days(pool: &Arc<SqlitePool>) -> crate::test_support::ScheduleFixture {
        let fx = seed_schedule(pool, 6).await;
        for (i, date) in [(2, "2026-10-08"), (4, "2026-10-09")] {
            let id = sqlx::query(
                "INSERT INTO study_plan_schedules (plan_id, day_number, schedule_date, created_at, updated_at)
                 VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            )
            .bind(fx.plan_id)
            .bind(i as i64)
            .bind(date)
            .execute(pool.as_ref())
            .await
            .unwrap()
            .last_insert_rowid();
            for sw in &fx.schedule_word_ids[i..i + 2] {
                sqlx::query("UPDATE study_plan_schedule_words SET schedule_id = ? WHERE id = ?")
                    .bind(id)
                    .bind(sw)
                    .execute(pool.as_ref())
                    .await
                    .unwrap();
            }
        }
        for w in &fx.word_ids {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
                .bind(fx.plan_id)
                .bind(w)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }
        repo::recount_and_prune_conn(&mut pool.acquire().await.unwrap(), fx.plan_id)
            .await
            .unwrap();
        fx
    }

    #[tokio::test]
    async fn replanning_keeps_practiced_days_and_relays_open_new_words_from_today() {
        let pool = memory_pool().await;
        let fx = plan_with_three_days(&pool).await;
        // 第 1 天（10-06）练过，且第一个词已有记忆等级
        seed_session(&pool, &fx, "s1", true).await;
        sqlx::query(
            "UPDATE study_plan_words SET srs_box = 2, srs_due = '2026-10-09' WHERE word_id = ?",
        )
        .bind(fx.word_ids[0])
        .execute(pool.as_ref())
        .await
        .unwrap();
        let service = PlanPaceService::new(pool.clone(), test_logger());
        let today = NaiveDate::from_ymd_opt(2026, 10, 7).unwrap();

        let result = service.replan_pace(fx.plan_id, 3, today).await.unwrap();
        // 还没练过的 4 个新词（10-08、10-09 两天）按每天 3 个从今天起重排：10-07 三个、10-08 一个
        assert_eq!(result.remaining_new_words, 4);
        assert_eq!(result.learning_days, 2);
        assert_eq!(result.end_date.as_deref(), Some("2026-10-19"));

        let days: Vec<(i64, String, i64)> = sqlx::query_as(
            "SELECT day_number, schedule_date, new_words_count FROM study_plan_schedules WHERE plan_id = ? ORDER BY schedule_date",
        )
        .bind(fx.plan_id)
        .fetch_all(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(
            days,
            vec![
                (1, "2026-10-06".to_string(), 2),
                (2, "2026-10-07".to_string(), 3),
                (3, "2026-10-08".to_string(), 1),
            ]
        );
        // 原顺序保持：word3 排在第 2 天的第一个
        let first_open: Id = sqlx::query_scalar(
            "SELECT sw.word_id FROM study_plan_schedule_words sw JOIN study_plan_schedules s ON s.id = sw.schedule_id
             WHERE s.plan_id = ? AND s.schedule_date = '2026-10-07' ORDER BY sw.id LIMIT 1",
        )
        .bind(fx.plan_id)
        .fetch_one(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(first_open, fx.word_ids[2]);
        // 记忆等级与练习会话不动
        assert_eq!(
            count(
                &pool,
                "SELECT srs_box FROM study_plan_words WHERE word_id = ?",
                fx.word_ids[0]
            )
            .await,
            2
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM practice_sessions WHERE plan_id = ?",
                fx.plan_id
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT daily_new_words FROM study_plans WHERE id = ?",
                fx.plan_id
            )
            .await,
            3
        );
        crate::time::assert_instants_canonical(&pool).await;
    }

    #[tokio::test]
    async fn unstarted_plans_keep_their_first_day_and_validate_input() {
        let pool = memory_pool().await;
        let fx = plan_with_three_days(&pool).await;
        let service = PlanPaceService::new(pool.clone(), test_logger());
        let today = NaiveDate::from_ymd_opt(2026, 10, 7).unwrap();
        assert!(service.replan_pace(fx.plan_id, 0, today).await.is_err());

        let result = service.replan_pace(fx.plan_id, 6, today).await.unwrap();
        assert_eq!((result.remaining_new_words, result.learning_days), (6, 1));
        let dates: Vec<String> = sqlx::query_scalar(
            "SELECT schedule_date FROM study_plan_schedules WHERE plan_id = ? ORDER BY schedule_date",
        )
        .bind(fx.plan_id)
        .fetch_all(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(
            dates,
            vec!["2026-10-06".to_string()],
            "没开始的计划从原来的第 1 天排"
        );

        sqlx::query("UPDATE study_plans SET unified_status = 'Completed' WHERE id = ?")
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        assert!(matches!(
            service.replan_pace(fx.plan_id, 5, today).await,
            Err(AppError::ValidationError(_))
        ));
    }

    #[tokio::test]
    async fn adding_word_books_appends_unlearned_new_words_without_duplicates() {
        let pool = memory_pool().await;
        let fx = plan_with_three_days(&pool).await;
        seed_session(&pool, &fx, "s1", true).await;
        // 另一个词汇本：2 个新词 + 1 个与计划里重名的词（word1）
        let book: Id = sqlx::query(
            "INSERT INTO word_books (title, description, created_at, last_used, updated_at)
             VALUES ('追加', '', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .execute(pool.as_ref())
        .await
        .unwrap()
        .last_insert_rowid();
        for w in ["giraffe", "zebra", "WORD1"] {
            sqlx::query(
                "INSERT INTO words (word, meaning, word_book_id, created_at, updated_at)
                 VALUES (?, '含义', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            )
            .bind(w)
            .bind(book)
            .execute(pool.as_ref())
            .await
            .unwrap();
        }
        let service = PlanPaceService::new(pool.clone(), test_logger());
        let today = NaiveDate::from_ymd_opt(2026, 10, 7).unwrap();

        let result = service
            .add_word_books(fx.plan_id, &[book], today)
            .await
            .unwrap();
        assert_eq!(result.added_words, 2);
        assert_eq!(result.remaining_new_words, 6); // 4 个还没学的 + 2 个追加的
        assert_eq!(
            count(
                &pool,
                "SELECT total_words FROM study_plans WHERE id = ?",
                fx.plan_id
            )
            .await,
            8
        );
        let srs_boxes: Vec<i64> = sqlx::query_scalar(
            "SELECT spw.srs_box FROM study_plan_words spw JOIN words w ON w.id = spw.word_id
             WHERE spw.plan_id = ? AND w.word_book_id = ?",
        )
        .bind(fx.plan_id)
        .bind(book)
        .fetch_all(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(srs_boxes, vec![0, 0]);
        // 再加一次：都已在计划中
        assert!(service
            .add_word_books(fx.plan_id, &[book], today)
            .await
            .is_err());
        crate::time::assert_instants_canonical(&pool).await;
    }
}
