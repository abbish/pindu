//! 统计数据访问层
//!
//! 提供 Repository 模式的数据访问封装
//!
//! 负责统计相关的所有数据库操作

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::practice_metrics::{
    streak_days, study_dates, FIRST_LEARN_CTE, MASTERED_CTE, SRS_LEARNED_BOX, SRS_MASTERED_BOX,
};
use crate::types::*;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

/// 统计仓储
///
/// 负责统计数据的数据访问逻辑,封装所有数据库操作
/// 不能经「清空选中的表」清掉的表：迁移记录、AI / 语音配置、应用设置
const PROTECTED_TABLES: [&str; 6] = [
    "_sqlx_migrations",
    "ai_providers",
    "ai_models",
    "app_settings",
    "volcengine_tts_config",
    "elevenlabs_config",
];

/// 表的类别：config 配置类（设置页不建议清空）/ user_data 用户数据
fn classify_table_type(table_name: &str) -> &'static str {
    if PROTECTED_TABLES.contains(&table_name) || table_name == "tags" {
        "config"
    } else {
        "user_data"
    }
}

pub struct StatisticsRepository {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl StatisticsRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 获取学习统计（口径见 `practice_metrics`：首答正确率、三步首答全对才算学会、本地日期、连续天数）
    pub async fn get_study_statistics(&self) -> AppResult<StudyStatistics> {
        let db_err = |e: sqlx::Error| {
            self.logger
                .database_operation("SELECT", "statistics", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        };

        // 1. 学过的单词数（按单词去重）与首答正确率
        let summary_query = format!(
            "WITH {}, {}
             SELECT
                 (SELECT COUNT(DISTINCT spw.word_id) FROM study_plan_words spw
                  JOIN study_plans sp ON sp.id = spw.plan_id
                  WHERE sp.deleted_at IS NULL AND spw.srs_box >= {learned_box}) AS words_learned,
                 COALESCE((SELECT AVG(is_correct) * 100.0 FROM first_learn), 0.0) AS avg_accuracy",
            FIRST_LEARN_CTE,
            MASTERED_CTE,
            learned_box = SRS_LEARNED_BOX
        );
        let row = sqlx::query(&summary_query)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(db_err)?;
        let total_words_learned: i64 = row.get("words_learned");
        let average_accuracy: f64 = row.get("avg_accuracy");

        // 2. 连续学习天数：完成过练习的本地日期
        let study_dates = study_dates(self.pool.as_ref()).await.map_err(db_err)?;
        let today = crate::time::local_today();
        let streak_days = streak_days(&study_dates, today);

        // 3. 计划完成率：已完成 / 有效计划（不含草稿与已删除）
        let completion_rate: f64 = sqlx::query_scalar(
            "SELECT COALESCE(
                 SUM(CASE WHEN unified_status = 'Completed' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0),
                 0.0)
             FROM study_plans
             WHERE deleted_at IS NULL AND unified_status NOT IN ('Draft', 'Deleted')",
        )
        .fetch_one(self.pool.as_ref())
        .await
        .map_err(db_err)?;

        // 4. 最近 7 天（本地日期）每天学会的单词数
        let weekly_query = format!(
            "WITH {}, {}
             SELECT DATE(end_time, 'localtime') AS study_date, COUNT(DISTINCT word_id) AS words
             FROM mastered
             WHERE DATE(end_time, 'localtime') >= ?
             GROUP BY study_date",
            FIRST_LEARN_CTE, MASTERED_CTE
        );
        let mut weekly_progress = vec![0; 7];
        for row in sqlx::query(&weekly_query)
            .bind(crate::time::format_date(today - chrono::Duration::days(6)))
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(db_err)?
        {
            let date: String = row.get("study_date");
            let words: i64 = row.get("words");
            if let Ok(date) = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d") {
                let days_ago = (today - date).num_days();
                if (0..7).contains(&days_ago) {
                    weekly_progress[(6 - days_ago) as usize] = words as i32;
                }
            }
        }

        self.logger.database_operation(
            "SELECT",
            "statistics",
            true,
            Some("Retrieved study statistics"),
        );

        Ok(StudyStatistics {
            total_words_learned: total_words_learned as i32,
            average_accuracy,
            streak_days,
            completion_rate,
            weekly_progress,
        })
    }

    /// 每日学习量（本地日期 >= `since`，只含有学习的日期，按日期升序）；不含已删除计划
    pub async fn get_daily_learning_activity(
        &self,
        since: chrono::NaiveDate,
    ) -> AppResult<Vec<DailyLearningActivity>> {
        let db_err = |e: sqlx::Error| {
            self.logger
                .database_operation("SELECT", "statistics", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        };
        let since = since.format("%Y-%m-%d").to_string();

        let query = format!(
            "WITH {}, {},
             practiced AS (
                 SELECT DATE(r.created_at, 'localtime') AS d, COUNT(DISTINCT r.word_id) AS n
                 FROM word_practice_records r
                 JOIN practice_sessions ps ON ps.id = r.session_id
                 JOIN study_plans sp ON sp.id = ps.plan_id
                 WHERE r.kind = 'learn' AND sp.deleted_at IS NULL
                   AND DATE(r.created_at, 'localtime') >= ?
                 GROUP BY d
             ),
             learned AS (
                 SELECT DATE(m.end_time, 'localtime') AS d, COUNT(DISTINCT m.word_id) AS n
                 FROM mastered m
                 JOIN study_plans sp ON sp.id = m.plan_id
                 WHERE sp.deleted_at IS NULL AND m.end_time IS NOT NULL
                   AND DATE(m.end_time, 'localtime') >= ?
                 GROUP BY d
             ),
             days AS (SELECT d FROM practiced UNION SELECT d FROM learned)
             SELECT days.d AS study_date,
                    COALESCE(p.n, 0) AS practiced,
                    COALESCE(l.n, 0) AS mastered
             FROM days
             LEFT JOIN practiced p ON p.d = days.d
             LEFT JOIN learned l ON l.d = days.d
             WHERE days.d IS NOT NULL
             ORDER BY days.d",
            FIRST_LEARN_CTE, MASTERED_CTE
        );
        let rows = sqlx::query(&query)
            .bind(&since)
            .bind(&since)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(db_err)?;

        Ok(rows
            .iter()
            .map(|row| DailyLearningActivity {
                date: row.get("study_date"),
                practiced_words: row.get::<i64, _>("practiced") as i32,
                mastered_words: row.get::<i64, _>("mastered") as i32,
            })
            .collect())
    }

    /// 获取数据库统计
    pub async fn get_database_statistics(&self) -> AppResult<DatabaseOverview> {
        let all_tables_query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations' ORDER BY name";
        let table_rows = sqlx::query(all_tables_query)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "sqlite_master",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        let mut tables = Vec::new();
        let mut total_records = 0i64;

        let total_tables_count = table_rows.len() as i32;

        for table_row in table_rows {
            let table_name: String = table_row.get("name");
            let table_type = classify_table_type(&table_name);

            let count_query = format!("SELECT COUNT(*) as count FROM {}", table_name);
            let row = sqlx::query(&count_query)
                .fetch_one(self.pool.as_ref())
                .await;

            let record_count = match row {
                Ok(row) => row.get::<i64, _>("count"),
                Err(_) => {
                    self.logger.debug(
                        "STATISTICS",
                        &format!("Table {} does not exist or query failed", table_name),
                        None,
                    );
                    0
                }
            };

            total_records += record_count;

            let table_stats = DatabaseTableStats {
                table_name: table_name.clone(),
                display_name: table_name.clone(),
                record_count,
                table_type: table_type.to_string(),
                description: format!("数据表: {}", table_name),
            };

            tables.push(table_stats);
        }

        self.logger.database_operation(
            "SELECT",
            "database_statistics",
            true,
            Some(&format!(
                "Found {} tables with {} total records",
                total_tables_count, total_records
            )),
        );

        Ok(DatabaseOverview {
            total_tables: total_tables_count,
            total_records,
            tables,
        })
    }

    /// 重置用户数据
    pub async fn reset_user_data(&self) -> AppResult<ResetResult> {
        let user_data_tables = vec![
            "word_practice_records",
            "practice_sessions",
            "study_plan_words",
            "study_plan_schedules",
            "study_plans",
            "words",
            "word_books",
        ];

        let mut deleted_records = 0i64;
        let mut affected_tables = Vec::new();

        let mut tx = crate::services::srs::begin_write(&self.pool).await?;

        for table_name in &user_data_tables {
            let count_query = format!("SELECT COUNT(*) as count FROM {}", table_name);
            let count_result = sqlx::query(&count_query).fetch_one(&mut *tx).await;

            let record_count = match count_result {
                Ok(row) => row.get::<i64, _>("count"),
                Err(_) => {
                    self.logger.debug(
                        "RESET",
                        &format!("Table {} does not exist or is empty", table_name),
                        None,
                    );
                    continue;
                }
            };

            if record_count > 0 {
                let delete_query = format!("DELETE FROM {}", table_name);
                let delete_result = sqlx::query(&delete_query).execute(&mut *tx).await;

                match delete_result {
                    Ok(result) => {
                        let rows_affected = result.rows_affected() as i64;
                        deleted_records += rows_affected;
                        affected_tables.push(table_name.to_string());
                        self.logger.info(
                            "RESET",
                            &format!("Deleted {} records from {}", rows_affected, table_name),
                        );
                    }
                    Err(e) => {
                        let _ = tx.rollback().await;
                        self.logger.error(
                            "RESET",
                            &format!("清空 {} 失败", table_name),
                            Some(&e.to_string()),
                        );
                        return Ok(ResetResult {
                            success: false,
                            message: "清空数据没有完成，已全部撤销，请稍后再试".to_string(),
                            deleted_records: 0,
                            affected_tables: vec![],
                        });
                    }
                }
            }
        }

        tx.commit().await.map_err(|e| {
            self.logger
                .database_operation("COMMIT", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        })?;

        self.logger.database_operation(
            "DELETE",
            "user_data",
            true,
            Some(&format!(
                "Reset user data: deleted {} records from {} tables",
                deleted_records,
                affected_tables.len()
            )),
        );

        Ok(ResetResult {
            success: true,
            message: format!(
                "已从 {} 张表删除 {} 条记录",
                affected_tables.len(),
                deleted_records
            ),
            deleted_records,
            affected_tables,
        })
    }

    /// 重置选定的表
    pub async fn reset_selected_tables(&self, table_names: &[String]) -> AppResult<ResetResult> {
        // 表名会拼进 SQL：只接受库里真实存在的用户数据表（配置、迁移记录、系统表不能清）
        let existing: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .fetch_all(self.pool.as_ref())
        .await?;
        for name in table_names {
            if PROTECTED_TABLES.contains(&name.as_str()) || !existing.iter().any(|t| t == name) {
                return Err(AppError::ValidationError(
                    "选中的数据不能清空，请刷新页面后重新选择".to_string(),
                ));
            }
        }
        let mut deleted_records = 0i64;
        let mut affected_tables = Vec::new();

        let mut tx = crate::services::srs::begin_write(&self.pool).await?;

        for table_name in table_names {
            let count_query = format!("SELECT COUNT(*) as count FROM {}", table_name);
            let count_result = sqlx::query(&count_query).fetch_one(&mut *tx).await;

            let record_count = match count_result {
                Ok(row) => row.get::<i64, _>("count"),
                Err(_) => {
                    self.logger.debug(
                        "RESET",
                        &format!("Table {} does not exist or is empty", table_name),
                        None,
                    );
                    continue;
                }
            };

            if record_count > 0 {
                let delete_query = format!("DELETE FROM {}", table_name);
                let delete_result = sqlx::query(&delete_query).execute(&mut *tx).await;

                match delete_result {
                    Ok(result) => {
                        let rows_affected = result.rows_affected() as i64;
                        deleted_records += rows_affected;
                        affected_tables.push(table_name.clone());
                        self.logger.info(
                            "RESET",
                            &format!("Deleted {} records from {}", rows_affected, table_name),
                        );
                    }
                    Err(e) => {
                        let _ = tx.rollback().await;
                        self.logger.error(
                            "RESET",
                            &format!("清空 {} 失败", table_name),
                            Some(&e.to_string()),
                        );
                        return Ok(ResetResult {
                            success: false,
                            message: "清空数据没有完成，已全部撤销，请稍后再试".to_string(),
                            deleted_records: 0,
                            affected_tables: vec![],
                        });
                    }
                }
            }
        }

        tx.commit().await.map_err(|e| {
            self.logger
                .database_operation("COMMIT", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        })?;

        self.logger.database_operation(
            "DELETE",
            "selected_tables",
            true,
            Some(&format!(
                "Reset selected tables: deleted {} records from {} tables",
                deleted_records,
                affected_tables.len()
            )),
        );

        Ok(ResetResult {
            success: true,
            message: format!(
                "已从 {} 张表删除 {} 条记录",
                affected_tables.len(),
                deleted_records
            ),
            deleted_records,
            affected_tables,
        })
    }

    /// 获取全局单词本统计
    pub async fn get_global_word_book_statistics(&self) -> AppResult<WordBookStatistics> {
        // 获取单词本总数
        let books_query = "SELECT COUNT(*) as count FROM word_books WHERE deleted_at IS NULL";
        let books_row = sqlx::query(books_query)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "word_books", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;
        let total_books: i64 = books_row.get("count");

        // 获取单词总数
        // 只统计未删除单词本里的单词
        let words_query = "SELECT COUNT(*) as count FROM words w JOIN word_books b ON b.id = w.word_book_id WHERE b.deleted_at IS NULL";
        let words_row = sqlx::query(words_query)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;
        let total_words: i64 = words_row.get("count");

        // 获取词性统计
        let pos_query = r#"
            SELECT
                COALESCE(w.part_of_speech, w.pos_english, w.pos_abbreviation) as pos,
                COUNT(*) as count
            FROM words w
            JOIN word_books b ON b.id = w.word_book_id
            WHERE b.deleted_at IS NULL
            GROUP BY COALESCE(w.part_of_speech, w.pos_english, w.pos_abbreviation)
        "#;
        let pos_rows = sqlx::query(pos_query)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        // 归类规则与单个单词本统计一致（WordTypeDistribution::add）
        let mut word_types = WordTypeDistribution::default();
        for row in pos_rows {
            let pos: Option<String> = row.get("pos");
            let count: i64 = row.get("count");
            word_types.add(pos.as_deref(), count as i32);
        }

        self.logger.database_operation(
            "SELECT",
            "word_book_statistics",
            true,
            Some(&format!(
                "Global stats: books={}, words={}",
                total_books, total_words
            )),
        );

        Ok(WordBookStatistics {
            total_books: total_books as i32,
            total_words: total_words as i32,
            word_types,
        })
    }

    /// 获取学习计划统计
    pub async fn get_study_plan_statistics(&self, plan_id: Id) -> AppResult<StudyPlanStatistics> {
        // 1. 获取基本计划信息
        let plan_query = r#"
            SELECT start_date, end_date, total_words
            FROM study_plans
            WHERE id = ? AND deleted_at IS NULL
        "#;

        let plan_row = sqlx::query(plan_query)
            .bind(plan_id)
            .fetch_optional(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger.database_operation(
                    "SELECT",
                    "study_plans",
                    false,
                    Some(&e.to_string()),
                );
                AppError::DatabaseError(e.to_string())
            })?;

        let (start_date, end_date, total_words) = match plan_row {
            Some(row) => (
                row.get::<Option<String>, _>("start_date"),
                row.get::<Option<String>, _>("end_date"),
                row.get::<i64, _>("total_words"),
            ),
            None => {
                return Err(AppError::NotFound(
                    "学习计划不存在，可能已被删除".to_string(),
                ));
            }
        };

        // 本次统计的“今天”（本地日期，只取一次）
        let today = crate::time::local_today();

        // 2. 计算时间相关统计
        let (total_days, time_progress_percentage) =
            if let (Some(start), Some(end)) = (&start_date, &end_date) {
                let start_date = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
                    .map_err(|_| AppError::ValidationError("无效的开始日期格式".to_string()))?;
                let end_date = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
                    .map_err(|_| AppError::ValidationError("无效的结束日期格式".to_string()))?;

                time_progress(start_date, end_date, today)
            } else {
                (0, 0.0)
            };

        let db_err = |e: sqlx::Error| {
            self.logger.database_operation(
                "SELECT",
                "study_plan_statistics",
                false,
                Some(&e.to_string()),
            );
            AppError::DatabaseError(e.to_string())
        };

        // 3. 已掌握 / 已学的单词数与首答正确率
        let summary_query = format!(
            "WITH {}, {}
             SELECT
                 (SELECT COUNT(*) FROM study_plan_words WHERE plan_id = ?1 AND srs_box >= {mastered_box}) AS completed_count,
                 (SELECT COUNT(*) FROM study_plan_words WHERE plan_id = ?1 AND srs_box >= {learned_box}) AS learned_count,
                 COALESCE((SELECT AVG(is_correct) * 100.0 FROM first_learn WHERE plan_id = ?1), 0.0) AS avg_accuracy",
            FIRST_LEARN_CTE,
            MASTERED_CTE,
            mastered_box = SRS_MASTERED_BOX,
            learned_box = SRS_LEARNED_BOX
        );
        let summary = sqlx::query(&summary_query)
            .bind(plan_id)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(db_err)?;
        let completed_words: i64 = summary.get("completed_count");
        let learned_words: i64 = summary.get("learned_count");
        let avg_accuracy: f64 = summary.get("avg_accuracy");

        // 4. 练习时长（有效时长，不含暂停）与学习天数（完成过练习的本地日期）
        let time_row = sqlx::query(
            "SELECT COALESCE(SUM(active_time), 0) AS active_ms,
                    COUNT(DISTINCT DATE(end_time, 'localtime')) AS study_days
             FROM practice_sessions
             WHERE plan_id = ? AND completed = TRUE",
        )
        .bind(plan_id)
        .fetch_one(self.pool.as_ref())
        .await
        .map_err(db_err)?;
        let total_active_time: i64 = time_row.get("active_ms");
        let study_days: i64 = time_row.get("study_days");
        let total_minutes = total_active_time / (1000 * 60);

        // 6. 日程天数：练完（status = completed，与日历同一口径）/ 逾期（日期已过、没练，且计划仍在进行）
        let today_str = crate::time::format_date(today);
        let schedule_row = sqlx::query(
            "SELECT
                 COUNT(*) AS schedules,
                 COALESCE(SUM(CASE WHEN sps.status = 'completed' THEN 1 ELSE 0 END), 0) AS practiced,
                 COALESCE(SUM(CASE WHEN COALESCE(sps.status, '') != 'completed' AND sps.schedule_date < ?2
                                    AND sp.unified_status IN ('Active', 'Pending') THEN 1 ELSE 0 END), 0) AS overdue
             FROM study_plan_schedules sps
             JOIN study_plans sp ON sp.id = sps.plan_id
             WHERE sps.plan_id = ?1 AND sps.total_words_count > 0",
        )
        .bind(plan_id)
        .bind(&today_str)
        .fetch_one(self.pool.as_ref())
        .await
        .map_err(db_err)?;
        let schedule_days: i64 = schedule_row.get("schedules");
        let practiced_days: i64 = schedule_row.get("practiced");
        let overdue_days: i64 = schedule_row.get("overdue");
        let overdue_ratio = if schedule_days > 0 {
            overdue_days as f64 / schedule_days as f64 * 100.0
        } else {
            0.0
        };

        // 7. 连续学习天数（该计划，本地日期）
        let plan_dates: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT DATE(end_time, 'localtime') FROM practice_sessions
             WHERE plan_id = ? AND completed = TRUE AND end_time IS NOT NULL",
        )
        .bind(plan_id)
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(db_err)?;
        let plan_dates: Vec<chrono::NaiveDate> = plan_dates
            .iter()
            .filter_map(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
            .collect();
        let plan_streak_days = streak_days(&plan_dates, today);

        self.logger.database_operation(
            "SELECT",
            "study_plan_statistics",
            true,
            Some(&format!("Calculated statistics for plan {}", plan_id)),
        );

        Ok(StudyPlanStatistics {
            // 按学习天数平均（不是按会话数）
            average_daily_study_minutes: if study_days > 0 {
                total_minutes / study_days
            } else {
                0
            },
            time_progress_percentage,
            actual_progress_percentage: if total_words > 0 {
                (completed_words as f64 / total_words as f64) * 100.0
            } else {
                0.0
            },
            average_accuracy_rate: avg_accuracy,
            overdue_ratio,
            streak_days: plan_streak_days,
            // 日程天数（学习日）；没有日程时退回计划的自然天数
            total_days: if schedule_days > 0 {
                schedule_days
            } else {
                total_days
            },
            completed_days: practiced_days,
            overdue_days,
            total_words,
            completed_words,
            learned_words,
            total_study_minutes: total_minutes,
        })
    }
}

/// 计划时间进度：返回 (总天数, 百分比)。口径与前端 `src/utils/timeProgress.ts` 一致：
/// 截至今天开始时已过去的自然日 / 总天数（含首尾），即第 k 天为 (k-1)/n；开始前 0，结束日之后 100。
/// 使用本地日期（原实现用 UTC，在 UTC+8 的 0–8 点会少算一天）。
fn time_progress(
    start: chrono::NaiveDate,
    end: chrono::NaiveDate,
    today: chrono::NaiveDate,
) -> (i64, f64) {
    let total_days = (end - start).num_days() + 1;
    let pct = if today < start {
        0.0
    } else if today > end {
        100.0
    } else {
        (today - start).num_days() as f64 / total_days as f64 * 100.0
    };
    (total_days, pct)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        memory_pool, seed_passed_word, seed_schedule, seed_session, seed_step, test_logger,
    };

    #[tokio::test]
    async fn daily_learning_activity_counts_practiced_and_mastered_by_local_day() {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 3).await;
        // 10-05：已完成会话，word1 三步全对（学会），word2 第 1 步答错（练过未学会）
        seed_session(&pool, &fx, "s1", true).await;
        sqlx::query(
            "UPDATE practice_sessions SET end_time = '2026-10-05T12:30:00+00:00' WHERE id = 's1'",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();
        for step in 1..=3 {
            seed_step(
                &pool,
                "s1",
                fx.word_ids[0],
                fx.schedule_word_ids[0],
                step,
                true,
                &format!("2026-10-05T12:00:0{}+00:00", step),
            )
            .await;
        }
        seed_step(
            &pool,
            "s1",
            fx.word_ids[1],
            fx.schedule_word_ids[1],
            1,
            false,
            "2026-10-05T12:01:00+00:00",
        )
        .await;
        // 10-06：未完成会话，word3 练过；同一单词多步只算一次
        seed_session(&pool, &fx, "s2", false).await;
        seed_passed_word(
            &pool,
            "s2",
            fx.word_ids[2],
            fx.schedule_word_ids[2],
            "2026-10-06",
        )
        .await;
        // 早于 since 的记录不返回
        seed_step(
            &pool,
            "s2",
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            1,
            true,
            "2026-09-01T12:00:00+00:00",
        )
        .await;

        let repo = StatisticsRepository::new(pool.clone(), test_logger());
        let since = chrono::NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let days = repo.get_daily_learning_activity(since).await.unwrap();
        assert_eq!(
            days,
            vec![
                DailyLearningActivity {
                    date: "2026-10-05".into(),
                    practiced_words: 2,
                    mastered_words: 1
                },
                DailyLearningActivity {
                    date: "2026-10-06".into(),
                    practiced_words: 1,
                    mastered_words: 0
                },
            ]
        );

        // 已删除计划不计入
        sqlx::query("UPDATE study_plans SET deleted_at = '2026-10-07 00:00:00'")
            .execute(pool.as_ref())
            .await
            .unwrap();
        assert!(repo
            .get_daily_learning_activity(since)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn learned_counts_words_practiced_once_and_mastered_needs_box_4() {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 3).await;
        // 记忆等级：未学 0、学过 1、掌握 4
        for (word_id, srs_box) in fx.word_ids.iter().zip([0, 1, 4]) {
            sqlx::query(
                "INSERT INTO study_plan_words (plan_id, word_id, srs_box) VALUES (?, ?, ?)",
            )
            .bind(fx.plan_id)
            .bind(word_id)
            .bind(srs_box)
            .execute(pool.as_ref())
            .await
            .unwrap();
        }
        let repo = StatisticsRepository::new(pool.clone(), test_logger());

        let plan = repo.get_study_plan_statistics(fx.plan_id).await.unwrap();
        assert_eq!((plan.learned_words, plan.completed_words), (2, 1));
        assert_eq!(
            repo.get_study_statistics()
                .await
                .unwrap()
                .total_words_learned,
            2
        );
    }

    #[test]
    fn time_progress_counts_days_before_today() {
        let d = |s: &str| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        let (start, end) = (d("2026-10-05"), d("2026-10-07"));
        let pct = |today: &str| time_progress(start, end, d(today)).1.round();
        assert_eq!(time_progress(start, end, d("2026-10-05")).0, 3);
        assert_eq!(pct("2026-10-04"), 0.0);
        assert_eq!(pct("2026-10-05"), 0.0);
        assert_eq!(pct("2026-10-06"), 33.0);
        assert_eq!(pct("2026-10-07"), 67.0);
        assert_eq!(pct("2026-10-08"), 100.0);
    }
}
