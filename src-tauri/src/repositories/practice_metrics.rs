//! 练习统计的统一口径（所有统计查询共用，避免各处各算各的）。
//!
//! - 首答：每个（会话, 单词, 步骤）第一条 `kind = 'learn'` 记录；纠正后重考（retry）与当轮小测（review）不计入正确率。
//! - 当次通过：某个**已完成**会话中该词首答全对——新词三步、复习词只考第三步（与 `StudyScheduleRepository::refresh_completion` 一致）。
//!   用于日程完成数、每日学习量等“当天”的统计。
//! - 掌握（长期）：自适应复习的记忆等级 `study_plan_words.srs_box >= SRS_MASTERED_BOX`（间隔 ≥7 天后仍首次写对，见 `services::srs`）。
//!   用于已掌握单词数、计划详情的学习进度。
//! - 已学：`srs_box >= SRS_LEARNED_BOX`（完成过一次含该词的练习），用于学习单词数、首页计划卡进度。
//! - 日期：练习时间以 UTC 的 RFC3339 存储，统计按**本地日期**（`DATE(x, 'localtime')`）分组。
//! - 时长：`practice_sessions.active_time`（毫秒，不含暂停）。

/// 已完成会话中的首答记录：列 session_id, word_id, step, is_correct, is_review, plan_id, schedule_id, end_time
pub const FIRST_LEARN_CTE: &str = r#"
    first_learn AS (
        SELECT f.session_id, f.word_id, f.step, f.is_correct, COALESCE(sw.is_review, 0) AS is_review,
               ps.plan_id, ps.schedule_id, ps.end_time
        FROM (
            SELECT r.session_id, r.word_id, r.plan_word_id, r.step, r.is_correct,
                   ROW_NUMBER() OVER (PARTITION BY r.session_id, r.word_id, r.step
                                      ORDER BY r.created_at, r.id) AS rn
            FROM word_practice_records r
            WHERE r.kind = 'learn'
        ) f
        JOIN practice_sessions ps ON ps.id = f.session_id
        LEFT JOIN study_plan_schedule_words sw ON sw.id = f.plan_word_id
        WHERE f.rn = 1 AND ps.completed = TRUE
    )"#;

/// 当次通过的（会话, 单词）：首答全对且做满应做的步数（新词 3 步、复习词 1 步）；
/// 列 session_id, word_id, plan_id, end_time。需与 FIRST_LEARN_CTE 一起使用
pub const MASTERED_CTE: &str = r#"
    mastered AS (
        SELECT session_id, word_id, plan_id, end_time
        FROM first_learn
        GROUP BY session_id, word_id
        HAVING SUM(is_correct) = COUNT(*)
           AND COUNT(*) = CASE WHEN MAX(is_review) = 1 THEN 1 ELSE 3 END
    )"#;

/// 长期掌握的记忆等级下限（见 `services::srs`）
pub const SRS_MASTERED_BOX: i64 = 4;
/// 已学（完成过一次含该词的练习）的记忆等级下限：用于学习单词数、首页计划进度
pub const SRS_LEARNED_BOX: i64 = 1;

/// 学习日：完成过练习的本地日期（全部计划，不含已删除计划）。连续天数等按此计算。
pub async fn study_dates(pool: &sqlx::SqlitePool) -> Result<Vec<chrono::NaiveDate>, sqlx::Error> {
    let dates: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT DATE(ps.end_time, 'localtime') FROM practice_sessions ps
         JOIN study_plans sp ON sp.id = ps.plan_id
         WHERE ps.completed = TRUE AND ps.end_time IS NOT NULL AND sp.deleted_at IS NULL",
    )
    .fetch_all(pool)
    .await?;
    Ok(dates
        .iter()
        .filter_map(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        .collect())
}

/// 连续学习天数：从今天往前数连续有学习的天数；今天还没学时允许从昨天开始数（只在起点允许一次）。
pub fn streak_days(dates: &[chrono::NaiveDate], today: chrono::NaiveDate) -> i32 {
    use std::collections::HashSet;
    let set: HashSet<_> = dates.iter().copied().collect();
    let one = chrono::Duration::days(1);
    let mut day = if set.contains(&today) {
        today
    } else {
        today - one
    };
    let mut streak = 0;
    while set.contains(&day) {
        streak += 1;
        day -= one;
    }
    streak
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn streak_counts_consecutive_days_only() {
        let today = d("2026-10-07");
        assert_eq!(
            streak_days(&[d("2026-10-07"), d("2026-10-06"), d("2026-10-05")], today),
            3
        );
        // 今天还没学：从昨天数
        assert_eq!(streak_days(&[d("2026-10-06"), d("2026-10-05")], today), 2);
        // 昨天空档：今天和前天不连续
        assert_eq!(streak_days(&[d("2026-10-07"), d("2026-10-05")], today), 1);
        // 今天、昨天都没学
        assert_eq!(streak_days(&[d("2026-10-05"), d("2026-10-04")], today), 0);
        // 超过 30 天也能数
        let long: Vec<_> = (0..45).map(|i| today - chrono::Duration::days(i)).collect();
        assert_eq!(streak_days(&long, today), 45);
        assert_eq!(streak_days(&[], today), 0);
    }
}
