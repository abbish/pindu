//! 统计数据访问层
//!
//! 提供 Repository 模式的数据访问封装
//!
//! 负责统计相关的所有数据库操作

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::*;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

/// 统计仓储
///
/// 负责统计数据的数据访问逻辑,封装所有数据库操作
pub struct StatisticsRepository {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl StatisticsRepository {
    /// 创建新的仓储实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 获取学习统计
    pub async fn get_study_statistics(&self) -> AppResult<StudyStatistics> {
        // 1. 获取总学习单词数
        let total_words_query = r#"
            SELECT COALESCE(COUNT(DISTINCT wpr.word_id), 0) as total
            FROM word_practice_records wpr
            JOIN practice_sessions ps ON wpr.session_id = ps.id
            WHERE ps.completed = TRUE AND wpr.is_correct = TRUE
        "#;

        let total_words_row = sqlx::query(total_words_query)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "word_practice_records", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let total_words_learned: i32 = total_words_row.get("total");

        // 2. 获取平均准确率
        let accuracy_query = r#"
            SELECT
                COALESCE(
                    CASE
                        WHEN COUNT(*) > 0 THEN
                            (COUNT(CASE WHEN is_correct = TRUE THEN 1 END) * 100.0 / COUNT(*))
                        ELSE 0.0
                    END,
                    0.0
                ) as avg_accuracy
            FROM word_practice_records wpr
            JOIN practice_sessions ps ON wpr.session_id = ps.id
            WHERE ps.completed = TRUE
        "#;

        let accuracy_row = sqlx::query(accuracy_query)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "word_practice_records", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let average_accuracy: f64 = accuracy_row.get("avg_accuracy");

        // 3. 计算连续学习天数
        let streak_query = r#"
            SELECT DISTINCT DATE(ps.end_time) as study_date
            FROM practice_sessions ps
            WHERE ps.completed = TRUE
            AND DATE(ps.end_time) >= DATE('now', '-30 days')
            ORDER BY study_date DESC
        "#;

        let mut streak_days = 0;
        match sqlx::query(streak_query)
            .fetch_all(self.pool.as_ref())
            .await
        {
            Ok(rows) => {
                let today = chrono::Local::now().date_naive();
                let mut current_date = today;

                let mut study_dates: Vec<chrono::NaiveDate> = Vec::new();
                for row in rows {
                    let date_str: String = row.get("study_date");
                    if let Ok(date) = chrono::NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") {
                        study_dates.push(date);
                    }
                }
                study_dates.sort_by(|a, b| b.cmp(a));

                for study_date in study_dates {
                    if study_date == current_date {
                        streak_days += 1;
                        current_date = current_date - chrono::Duration::days(1);
                    } else if study_date == current_date - chrono::Duration::days(1) {
                        current_date = study_date;
                        streak_days += 1;
                        current_date = current_date - chrono::Duration::days(1);
                    } else {
                        break;
                    }
                }
            }
            Err(_) => {
                streak_days = 0;
            }
        }

        // 4. 获取完成率
        let completion_query = r#"
            SELECT
                CASE
                    WHEN COUNT(*) > 0 THEN (COUNT(CASE WHEN status = 'completed' THEN 1 END) * 100.0 / COUNT(*))
                    ELSE 0.0
                END as completion_rate
            FROM study_plans
        "#;

        let completion_row = sqlx::query(completion_query)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let completion_rate: f64 = completion_row.get("completion_rate");

        // 5. 计算最近7天的学习进度
        let weekly_progress_query = r#"
            SELECT
                DATE(ps.end_time) as study_date,
                COUNT(DISTINCT wpr.word_id) as words_learned
            FROM practice_sessions ps
            JOIN word_practice_records wpr ON ps.id = wpr.session_id
            WHERE ps.completed = TRUE
            AND DATE(ps.end_time) >= DATE('now', '-7 days')
            AND DATE(ps.end_time) <= DATE('now')
            GROUP BY DATE(ps.end_time)
            ORDER BY study_date ASC
        "#;

        let mut weekly_progress = vec![0; 7];

        match sqlx::query(weekly_progress_query)
            .fetch_all(self.pool.as_ref())
            .await
        {
            Ok(rows) => {
                let today = chrono::Utc::now().date_naive();
                for row in rows {
                    let study_date_str: String = row.get("study_date");
                    let words_learned: i64 = row.get("words_learned");

                    if let Ok(study_date) =
                        chrono::NaiveDate::parse_from_str(&study_date_str, "%Y-%m-%d")
                    {
                        let days_ago = (today - study_date).num_days();
                        if days_ago >= 0 && days_ago < 7 {
                            let index = (6 - days_ago) as usize;
                            weekly_progress[index] = words_learned as i32;
                        }
                    }
                }
            }
            Err(_) => {
                // 保持默认的0值
            }
        }

        self.logger.database_operation(
            "SELECT",
            "statistics",
            true,
            Some("Retrieved study statistics"),
        );

        Ok(StudyStatistics {
            total_words_learned,
            average_accuracy,
            streak_days,
            completion_rate,
            weekly_progress,
        })
    }

    /// 获取数据库统计
    pub async fn get_database_statistics(&self) -> AppResult<DatabaseOverview> {
        use crate::handlers::shared::classify_table_type;

        let all_tables_query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations' ORDER BY name";
        let table_rows = sqlx::query(all_tables_query)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "sqlite_master", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let mut tables = Vec::new();
        let mut total_records = 0i64;

        let total_tables_count = table_rows.len() as i32;

        for table_row in table_rows {
            let table_name: String = table_row.get("name");
            let table_type = classify_table_type(&table_name);

            let count_query = format!("SELECT COUNT(*) as count FROM {}", table_name);
            let row = sqlx::query(&count_query).fetch_one(self.pool.as_ref()).await;

            let record_count = match row {
                Ok(row) => row.get::<i64, _>("count"),
                Err(_) => {
                    self.logger.info(
                        "TABLE_STATS_DEBUG",
                        &format!("Table {} does not exist or query failed", table_name),
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

        let mut tx = self.pool.begin().await.map_err(|e| {
            self.logger
                .database_operation("BEGIN", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        })?;

        for table_name in &user_data_tables {
            let count_query = format!("SELECT COUNT(*) as count FROM {}", table_name);
            let count_result = sqlx::query(&count_query).fetch_one(&mut *tx).await;

            let record_count = match count_result {
                Ok(row) => row.get::<i64, _>("count"),
                Err(_) => {
                    self.logger.info(
                        "RESET_DEBUG",
                        &format!("Table {} does not exist or is empty", table_name),
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
                            "RESET_DEBUG",
                            &format!("Deleted {} records from {}", rows_affected, table_name),
                        );
                    }
                    Err(e) => {
                        let _ = tx.rollback().await;
                        return Ok(ResetResult {
                            success: false,
                            message: format!("Failed to delete data from {}: {}", table_name, e),
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
                "Successfully reset user data. Deleted {} records from {} tables.",
                deleted_records,
                affected_tables.len()
            ),
            deleted_records,
            affected_tables,
        })
    }

    /// 重置选定的表
    pub async fn reset_selected_tables(&self, table_names: &[String]) -> AppResult<ResetResult> {
        let mut deleted_records = 0i64;
        let mut affected_tables = Vec::new();

        let mut tx = self.pool.begin().await.map_err(|e| {
            self.logger
                .database_operation("BEGIN", "transaction", false, Some(&e.to_string()));
            AppError::DatabaseError(e.to_string())
        })?;

        for table_name in table_names {
            let count_query = format!("SELECT COUNT(*) as count FROM {}", table_name);
            let count_result = sqlx::query(&count_query).fetch_one(&mut *tx).await;

            let record_count = match count_result {
                Ok(row) => row.get::<i64, _>("count"),
                Err(_) => {
                    self.logger.info(
                        "RESET_DEBUG",
                        &format!("Table {} does not exist or is empty", table_name),
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
                            "RESET_DEBUG",
                            &format!("Deleted {} records from {}", rows_affected, table_name),
                        );
                    }
                    Err(e) => {
                        let _ = tx.rollback().await;
                        return Ok(ResetResult {
                            success: false,
                            message: format!("Failed to delete data from {}: {}", table_name, e),
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
                "Successfully reset selected tables. Deleted {} records from {} tables.",
                deleted_records,
                affected_tables.len()
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
        let words_query = "SELECT COUNT(*) as count FROM words";
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
                COALESCE(part_of_speech, pos_english, pos_abbreviation) as pos,
                COUNT(*) as count
            FROM words
            WHERE part_of_speech IS NOT NULL OR pos_english IS NOT NULL OR pos_abbreviation IS NOT NULL
            GROUP BY COALESCE(part_of_speech, pos_english, pos_abbreviation)
        "#;
        let pos_rows = sqlx::query(pos_query)
            .fetch_all(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "words", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let mut nouns = 0;
        let mut verbs = 0;
        let mut adjectives = 0;
        let mut others = 0;

        for row in pos_rows {
            let pos: Option<String> = row.get("pos");
            let count: i64 = row.get("count");

            if let Some(pos_str) = pos {
                let pos_lower = pos_str.to_lowercase();
                if pos_lower.starts_with("n") || pos_lower == "noun" || pos_lower == "nouns" || pos_lower == "名词" {
                    nouns += count;
                } else if pos_lower.starts_with("v") || pos_lower == "verb" || pos_lower == "verbs" || pos_lower == "动词" {
                    verbs += count;
                } else if pos_lower.starts_with("adj") || pos_lower == "adjective" || pos_lower == "adjectives" || pos_lower == "形容词" {
                    adjectives += count;
                } else {
                    others += count;
                }
            } else {
                others += count;
            }
        }

        let word_types = WordTypeDistribution {
            nouns: nouns as i32,
            verbs: verbs as i32,
            adjectives: adjectives as i32,
            others: others as i32,
        };

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
                self.logger
                    .database_operation("SELECT", "study_plans", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?;

        let (start_date, end_date, total_words) = match plan_row {
            Some(row) => (
                row.get::<Option<String>, _>("start_date"),
                row.get::<Option<String>, _>("end_date"),
                row.get::<i64, _>("total_words"),
            ),
            None => {
                return Err(AppError::NotFound(format!("学习计划 {} 不存在", plan_id)));
            }
        };

        // 2. 计算时间相关统计
        let (total_days, time_progress_percentage) = if let (Some(start), Some(end)) = (&start_date, &end_date) {
            let start_date = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
                .map_err(|_| AppError::ValidationError("无效的开始日期格式".to_string()))?;
            let end_date = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
                .map_err(|_| AppError::ValidationError("无效的结束日期格式".to_string()))?;

            let total_days = (end_date - start_date).num_days() + 1;
            let today = chrono::Utc::now().date_naive();
            let time_progress = if today <= start_date {
                0.0
            } else if today >= end_date {
                100.0
            } else {
                let elapsed_days = (today - start_date).num_days() + 1;
                (elapsed_days as f64 / total_days as f64) * 100.0
            };

            (total_days, time_progress)
        } else {
            (0, 0.0)
        };

        // 3. 计算已学单词数
        let completed_words_query = r#"
            SELECT COUNT(DISTINCT wpr.word_id) as completed_count
            FROM word_practice_records wpr
            JOIN practice_sessions ps ON wpr.session_id = ps.id
            WHERE ps.plan_id = ? AND ps.completed = TRUE
        "#;

        let completed_words: i64 = sqlx::query(completed_words_query)
            .bind(plan_id)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "word_practice_records", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })?
            .get("completed_count");

        // 4. 计算练习时间
        let practice_time_query = r#"
            SELECT
                COUNT(CASE WHEN completed = TRUE THEN 1 END) as completed_sessions,
                COALESCE(SUM(CASE WHEN completed = TRUE THEN
                    CAST((julianday(end_time) - julianday(start_time)) * 24 * 60 * 60 * 1000 AS INTEGER)
                END), 0) as total_active_time_ms
            FROM practice_sessions
            WHERE plan_id = ?
        "#;

        let (completed_sessions, total_active_time) = sqlx::query(practice_time_query)
            .bind(plan_id)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "practice_sessions", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })
            .map(|row| (
                row.get::<i64, _>("completed_sessions"),
                row.get::<i64, _>("total_active_time_ms"),
            ))?;

        let total_minutes = total_active_time / (1000 * 60);

        // 5. 获取练习准确率
        let accuracy_query = r#"
            SELECT
                COUNT(*) as total_steps,
                COUNT(CASE WHEN is_correct = TRUE THEN 1 END) as correct_steps
            FROM word_practice_records wpr
            JOIN practice_sessions ps ON wpr.session_id = ps.id
            WHERE ps.plan_id = ? AND ps.completed = TRUE
        "#;

        let avg_accuracy = sqlx::query(accuracy_query)
            .bind(plan_id)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "word_practice_records", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })
            .map(|row| {
                let total_steps: i64 = row.get("total_steps");
                let correct_steps: i64 = row.get("correct_steps");
                if total_steps > 0 {
                    (correct_steps as f64 / total_steps as f64) * 100.0
                } else {
                    0.0
                }
            })?;

        // 6. 计算逾期统计
        let (overdue_days, overdue_ratio) = if let Some(start) = &start_date {
            let start_date = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").unwrap_or_default();
            let today = chrono::Utc::now().date_naive();

            if today > start_date {
                let overdue_query = r#"
                    SELECT COUNT(*) as overdue_count
                    FROM study_plan_schedules sps
                    WHERE sps.plan_id = ?
                    AND sps.schedule_date < date('now')
                    AND (sps.completed_words_count IS NULL OR sps.completed_words_count < sps.total_words_count)
                "#;

                let overdue_count: i64 = sqlx::query(overdue_query)
                    .bind(plan_id)
                    .fetch_one(self.pool.as_ref())
                    .await
                    .map_err(|e| {
                        self.logger
                            .database_operation("SELECT", "study_plan_schedules", false, Some(&e.to_string()));
                        AppError::DatabaseError(e.to_string())
                    })?
                    .get("overdue_count");

                let overdue_ratio = if total_days > 0 {
                    (overdue_count as f64 / total_days as f64) * 100.0
                } else {
                    0.0
                };

                (overdue_count, overdue_ratio)
            } else {
                (0, 0.0)
            }
        } else {
            (0, 0.0)
        };

        // 7. 计算连续学习天数
        let plan_streak_query = r#"
            SELECT COUNT(DISTINCT DATE(ps.end_time)) as streak_days
            FROM practice_sessions ps
            WHERE ps.completed = TRUE
            AND ps.plan_id = ?
            AND DATE(ps.end_time) >= DATE('now', '-7 days')
        "#;

        let plan_streak_days: i32 = sqlx::query(plan_streak_query)
            .bind(plan_id)
            .fetch_one(self.pool.as_ref())
            .await
            .map_err(|e| {
                self.logger
                    .database_operation("SELECT", "practice_sessions", false, Some(&e.to_string()));
                AppError::DatabaseError(e.to_string())
            })
            .map(|row| row.get::<i64, _>("streak_days") as i32)
            .unwrap_or(0);

        self.logger.database_operation(
            "SELECT",
            "study_plan_statistics",
            true,
            Some(&format!("Calculated statistics for plan {}", plan_id)),
        );

        Ok(StudyPlanStatistics {
            average_daily_study_minutes: if completed_sessions > 0 {
                total_minutes / completed_sessions
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
            total_days,
            completed_days: completed_sessions,
            overdue_days,
            total_words,
            completed_words,
            total_study_minutes: total_minutes,
        })
    }
}
