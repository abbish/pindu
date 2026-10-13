//! 统计数据访问层
//!
//! 提供 Repository 模式的数据访问封装
//!
//! 负责统计相关的所有数据库操作

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::practice_metrics::{
    streak_days, study_dates, ACTIVITY_CTE, FIRST_LEARN_CTE, MASTERED_CTE, SRS_LEARNED_BOX,
    SRS_MASTERED_BOX,
};
use crate::types::*;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

/// 统计仓储
///
/// 负责统计数据的数据访问逻辑,封装所有数据库操作
/// 不能经「清空选中的表」清掉的表：迁移记录、AI / 语音配置、应用设置、配对过的设备
/// 重置所有用户数据时也保留：朗读缓存（音频文件在缓存目录，与学习内容无关）、
/// 标签名（含预置标签；素材上的标签随素材清空，没有素材的标签不出现在侧边栏）
const KEPT_ON_RESET: [&str; 2] = ["tts_cache", "tags"];

const PROTECTED_TABLES: [&str; 7] = [
    "_sqlx_migrations",
    "ai_providers",
    "ai_models",
    "app_settings",
    "volcengine_tts_config",
    "elevenlabs_config",
    "lan_devices",
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

    /// 首页学习统计（口径见 `practice_metrics`）：已学单词、已掌握单词、一次答对率、连续学习天数
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
        let study_dates = study_dates(self.pool.as_ref(), None)
            .await
            .map_err(db_err)?;
        let today = crate::time::local_today();
        let streak_days = streak_days(&study_dates, today);

        // 3. 已掌握的单词数（隔 7 天还能写对，按单词去重）
        let words_mastered: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(DISTINCT spw.word_id) FROM study_plan_words spw
             JOIN study_plans sp ON sp.id = spw.plan_id
             WHERE sp.deleted_at IS NULL AND spw.srs_box >= {}",
            SRS_MASTERED_BOX
        ))
        .fetch_one(self.pool.as_ref())
        .await
        .map_err(db_err)?;

        self.logger.database_operation(
            "SELECT",
            "statistics",
            true,
            Some("Retrieved study statistics"),
        );

        Ok(StudyStatistics {
            total_words_learned: total_words_learned as i32,
            words_mastered: words_mastered as i32,
            average_accuracy,
            streak_days,
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
            "WITH {}, {}, {},
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
             read AS (
                 SELECT DATE(a.at, 'localtime') AS d, COUNT(*) AS n
                 FROM activity a
                 JOIN study_plans sp ON sp.id = a.plan_id
                 WHERE a.kind = 'passage' AND sp.deleted_at IS NULL
                   AND DATE(a.at, 'localtime') >= ?
                 GROUP BY d
             ),
             days AS (SELECT d FROM practiced UNION SELECT d FROM learned UNION SELECT d FROM read)
             SELECT days.d AS study_date,
                    COALESCE(p.n, 0) AS practiced,
                    COALESCE(l.n, 0) AS mastered,
                    COALESCE(r.n, 0) AS passages
             FROM days
             LEFT JOIN practiced p ON p.d = days.d
             LEFT JOIN learned l ON l.d = days.d
             LEFT JOIN read r ON r.d = days.d
             WHERE days.d IS NOT NULL
             ORDER BY days.d",
            FIRST_LEARN_CTE, MASTERED_CTE, ACTIVITY_CTE
        );
        let rows = sqlx::query(&query)
            .bind(&since)
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
                passages: row.get::<i64, _>("passages") as i32,
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

    /// 重置用户数据：清空全部学习内容（词汇本、计划、短文、视频、素材上的标签、练习与跟读记录等），
    /// 只保留配置（AI 服务与模型、语音服务、设置、配对的设备）、标签名与朗读缓存
    pub async fn reset_user_data(&self) -> AppResult<ResetResult> {
        let user_data_tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(self.pool.as_ref())
        .await?
        .into_iter()
        .filter(|name: &String| {
            !PROTECTED_TABLES.contains(&name.as_str()) && !KEPT_ON_RESET.contains(&name.as_str())
        })
        .collect();

        let mut deleted_records = 0i64;
        let mut affected_tables = Vec::new();

        let mut tx = crate::services::srs::begin_write(&self.pool).await?;
        // 表按名字顺序清空：外键到提交时再检查（那时子表也都清空了）
        sqlx::query("PRAGMA defer_foreign_keys = ON")
            .execute(&mut *tx)
            .await?;

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
                        return Err(AppError::DatabaseError(
                            "清空数据没有完成，已全部撤销，请稍后再试".to_string(),
                        ));
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
                        return Err(AppError::DatabaseError(
                            "清空数据没有完成，已全部撤销，请稍后再试".to_string(),
                        ));
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

    /// 获取全局词汇本统计
    pub async fn get_global_word_book_statistics(&self) -> AppResult<WordBookStatistics> {
        // 获取词汇本总数
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
        // 只统计未删除词汇本里的单词
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

        // 归类规则与单个词汇本统计一致（WordTypeDistribution::add）
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
            SELECT start_date, end_date, total_words, unified_status
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

        let (start_date, end_date, total_words, unified_status) = match plan_row {
            Some(row) => (
                row.get::<Option<String>, _>("start_date"),
                row.get::<Option<String>, _>("end_date"),
                row.get::<i64, _>("total_words"),
                row.get::<String, _>("unified_status"),
            ),
            None => {
                return Err(AppError::NotFound(
                    "学习计划不存在，可能已被删除".to_string(),
                ));
            }
        };

        // 本次统计的“今天”（本地日期，只取一次）
        let today = crate::time::local_today();

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

        // 4. 练习时长（有效时长，不含暂停）与学习天数：单词练习 + 短文（practice_metrics::ACTIVITY_CTE）
        let time_row = sqlx::query(&format!(
            "WITH {}
             SELECT COALESCE(SUM(active_ms), 0) AS active_ms,
                    COUNT(DISTINCT DATE(at, 'localtime')) AS study_days
             FROM activity WHERE plan_id = ?",
            ACTIVITY_CTE
        ))
        .bind(plan_id)
        .fetch_one(self.pool.as_ref())
        .await
        .map_err(db_err)?;
        let total_active_time: i64 = time_row.get("active_ms");
        let study_days: i64 = time_row.get("study_days");

        // 6. 周期里每天的任务：单词日程（有单词的）+ 短文任务；一天的任务都完成才算练完
        let tasks: Vec<(String, bool)> = sqlx::query_as(
            "SELECT schedule_date, COALESCE(status, '') = 'completed' FROM study_plan_schedules
             WHERE plan_id = ?1 AND total_words_count > 0
             UNION ALL
             SELECT scheduled_date, completed_at IS NOT NULL FROM study_plan_passages
             WHERE plan_id = ?1",
        )
        .bind(plan_id)
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(db_err)?;
        let parse = |d: &Option<String>| {
            d.as_deref()
                .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        };
        let days = plan_days(
            parse(&start_date),
            parse(&end_date),
            today,
            &tasks
                .iter()
                .filter_map(|(d, done)| {
                    chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
                        .ok()
                        .map(|d| (d, *done))
                })
                .collect::<Vec<_>>(),
            // 待开始的计划第一次练习时整体平移到当天：开始前的日子不算没练
            unified_status == "Active",
        );
        let count = |status: &str| days.iter().filter(|d| d.status == status).count() as i64;
        let task_days = days.iter().filter(|d| d.status != "rest").count() as i64;
        let (completed_days, overdue_days) = (count("done"), count("missed"));

        // 7. 连续学习天数（该计划，本地日期，含短文）
        let plan_dates = study_dates(self.pool.as_ref(), Some(plan_id))
            .await
            .map_err(db_err)?;
        let plan_streak_days = streak_days(&plan_dates, today);

        self.logger.database_operation(
            "SELECT",
            "study_plan_statistics",
            true,
            Some(&format!("Calculated statistics for plan {}", plan_id)),
        );

        Ok(StudyPlanStatistics {
            // 按学习天数平均（不是按会话数）
            average_daily_active_ms: if study_days > 0 {
                total_active_time / study_days
            } else {
                0
            },
            actual_progress_percentage: if total_words > 0 {
                (completed_words as f64 / total_words as f64) * 100.0
            } else {
                0.0
            },
            average_accuracy_rate: avg_accuracy,
            streak_days: plan_streak_days,
            total_days: days.len() as i64,
            task_days,
            completed_days,
            overdue_days,
            days,
            total_words,
            completed_words,
            learned_words,
            total_active_ms: total_active_time,
        })
    }
}

/// 计划周期最多显示多少天（防止异常日期拉出几千格）
const MAX_PLAN_DAYS: i64 = 400;

/// 计划周期里每天一格：开始日到结束日（有超出的任务时扩到任务日期）；
/// 一天的任务都完成 → done；过去没完成 → 计划进行中为 missed，暂停 / 结束为 skipped；
/// 今天没完成 → today；以后的 → upcoming；没有任务 → rest
fn plan_days(
    start: Option<chrono::NaiveDate>,
    end: Option<chrono::NaiveDate>,
    today: chrono::NaiveDate,
    tasks: &[(chrono::NaiveDate, bool)],
    can_be_overdue: bool,
) -> Vec<PlanDay> {
    use std::collections::BTreeMap;
    let mut by_day: BTreeMap<chrono::NaiveDate, bool> = BTreeMap::new();
    for (date, done) in tasks {
        let all_done = by_day.entry(*date).or_insert(true);
        *all_done &= *done;
    }
    let first = [start, by_day.keys().next().copied()]
        .into_iter()
        .flatten()
        .min();
    let last = [end, by_day.keys().next_back().copied()]
        .into_iter()
        .flatten()
        .max();
    let (Some(first), Some(last)) = (first, last) else {
        return Vec::new();
    };
    let span = (last - first).num_days().clamp(-1, MAX_PLAN_DAYS - 1);
    (0..=span)
        .map(|i| {
            let date = first + chrono::Duration::days(i);
            let status = match by_day.get(&date) {
                None => "rest",
                Some(true) => "done",
                Some(false) if date > today => "upcoming",
                Some(false) if date == today => "today",
                Some(false) if can_be_overdue => "missed",
                Some(false) => "skipped",
            };
            PlanDay {
                date: crate::time::format_date(date),
                status: status.to_string(),
            }
        })
        .collect()
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
                    mastered_words: 1,
                    passages: 0
                },
                DailyLearningActivity {
                    date: "2026-10-06".into(),
                    practiced_words: 1,
                    mastered_words: 0,
                    passages: 0
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
    fn plan_days_follow_the_calendar_from_start_to_end() {
        let d = |s: &str| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        let statuses = |days: Vec<PlanDay>| days.into_iter().map(|d| d.status).collect::<Vec<_>>();
        let tasks = [
            (d("2026-10-05"), true),
            (d("2026-10-06"), false),
            // 同一天单词练完了、短文没读：不算练完
            (d("2026-10-08"), true),
            (d("2026-10-08"), false),
            (d("2026-10-09"), false),
            (d("2026-10-10"), false),
        ];
        let today = d("2026-10-09");
        assert_eq!(
            statuses(plan_days(
                Some(d("2026-10-05")),
                Some(d("2026-10-11")),
                today,
                &tasks,
                true
            )),
            ["done", "missed", "rest", "missed", "today", "upcoming", "rest"]
        );
        // 暂停 / 结束的计划：没练的不算逾期
        assert_eq!(
            statuses(plan_days(
                Some(d("2026-10-05")),
                Some(d("2026-10-06")),
                today,
                &tasks,
                false
            ))[1],
            "skipped"
        );
        // 任务超出了结束日（短文排得更晚）：扩到任务那天
        assert_eq!(
            plan_days(
                Some(d("2026-10-05")),
                Some(d("2026-10-07")),
                today,
                &tasks,
                true
            )
            .len(),
            6
        );
        assert!(plan_days(None, None, today, &[], true).is_empty());
    }

    #[tokio::test]
    async fn passage_tasks_count_as_study_activity() {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 1).await;
        let at = crate::time::now_utc();
        sqlx::query("INSERT INTO passages (id, title, sentences, target_words, level, word_count, created_at, updated_at) VALUES (1, 't', '[]', '[]', 'a1', 0, ?1, ?1)")
            .bind(&at)
            .execute(pool.as_ref())
            .await
            .unwrap();
        // 只朗读的短文任务读完了：没有单词练习，也算今天学习过
        sqlx::query("INSERT INTO study_plan_passages (plan_id, passage_id, mode, sort_order, scheduled_date, completed_at, created_at) VALUES (?1, 1, 'reading', 0, '2026-10-06', ?2, ?2)")
            .bind(fx.plan_id)
            .bind(&at)
            .execute(pool.as_ref())
            .await
            .unwrap();
        let repo = StatisticsRepository::new(pool.clone(), test_logger());
        let stats = repo.get_study_plan_statistics(fx.plan_id).await.unwrap();
        assert_eq!(stats.streak_days, 1);
        let days = repo
            .get_daily_learning_activity(crate::time::local_today())
            .await
            .unwrap();
        assert_eq!(days.len(), 1);
        assert_eq!((days[0].practiced_words, days[0].passages), (0, 1));
        assert_eq!(repo.get_study_statistics().await.unwrap().streak_days, 1);
    }

    #[tokio::test]
    async fn quiz_mistake_means_not_passed_this_time() {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 2).await;
        seed_session(&pool, &fx, "s1", true).await;
        sqlx::query(
            "UPDATE practice_sessions SET end_time = '2026-10-05T12:30:00+00:00' WHERE id = 's1'",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();
        for i in 0..2 {
            for step in 1..=3 {
                seed_step(
                    &pool,
                    "s1",
                    fx.word_ids[i],
                    fx.schedule_word_ids[i],
                    step,
                    true,
                    &format!("2026-10-05T12:0{i}:0{step}+00:00"),
                )
                .await;
            }
        }
        // 第一个词的当轮小测第一次写错，之后又写对：本次不算通过
        for (correct, at) in [
            (false, "2026-10-05T12:10:00.000Z"),
            (true, "2026-10-05T12:11:00.000Z"),
        ] {
            sqlx::query(
                "INSERT INTO word_practice_records (session_id, word_id, plan_word_id, step, user_input, is_correct, time_spent, attempts, kind, created_at)
                 VALUES ('s1', ?, ?, 3, '', ?, 1000, 1, 'review', ?)",
            )
            .bind(fx.word_ids[0])
            .bind(fx.schedule_word_ids[0])
            .bind(correct)
            .bind(at)
            .execute(pool.as_ref())
            .await
            .unwrap();
        }
        let repo = StatisticsRepository::new(pool.clone(), test_logger());
        let days = repo
            .get_daily_learning_activity(chrono::NaiveDate::from_ymd_opt(2026, 10, 1).unwrap())
            .await
            .unwrap();
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].practiced_words, 2);
        assert_eq!(days[0].mastered_words, 1);
    }

    #[tokio::test]
    async fn reset_user_data_clears_all_learning_content_and_keeps_config() {
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 2).await;
        seed_session(&pool, &fx, "s1", true).await;
        let now = "2026-10-13T00:00:00.000Z";
        for sql in [
            "INSERT INTO passages (id, title, sentences, target_words, level, word_count, created_at, updated_at) VALUES (1, 't', '[]', '[]', 'a1', 0, ?1, ?1)",
            "INSERT INTO material_tags (kind, ref_id, tag_id, created_at) SELECT 'passage', 1, id, ?1 FROM tags LIMIT 1",
            "INSERT INTO app_settings (key, value, updated_at) VALUES ('prompt.profile', '{}', ?1)",
        ] {
            sqlx::query(sql).bind(now).execute(pool.as_ref()).await.unwrap();
        }
        let count = |table: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
                    .fetch_one(pool.as_ref())
                    .await
                    .unwrap()
            }
        };
        let providers = count("ai_providers").await;
        let settings = count("app_settings").await;
        let tags = count("tags").await;

        let repo = StatisticsRepository::new(pool.clone(), test_logger());
        let result = repo.reset_user_data().await.unwrap();

        assert!(result.success);
        for table in [
            "word_books",
            "words",
            "study_plans",
            "practice_sessions",
            "passages",
            "material_tags",
        ] {
            assert_eq!(count(table).await, 0, "{table}");
        }
        assert_eq!(count("app_settings").await, settings);
        assert_eq!(count("tags").await, tags);
        assert_eq!(count("ai_providers").await, providers);
    }
}
