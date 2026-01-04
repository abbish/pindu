//! 诊断命令处理器
//!
//! 包含所有诊断和计划更新相关的 Tauri 命令

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::types::*;
use chrono::Datelike;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager};

/// 获取学习计划状态变更历史
#[tauri::command]
pub async fn get_study_plan_status_history(
    app: AppHandle,
    plan_id: i64,
) -> AppResult<Vec<StudyPlanStatusHistory>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_study_plan_status_history",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let query = r#"
        SELECT
            id,
            plan_id,
            from_status,
            to_status,
            changed_at,
            reason
        FROM study_plan_status_history
        WHERE plan_id = ?
        ORDER BY changed_at DESC
    "#;

    match sqlx::query(query)
        .bind(plan_id)
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => {
            let history: Vec<StudyPlanStatusHistory> = rows
                .into_iter()
                .map(|row| {
                    #[allow(deprecated)]
                    StudyPlanStatusHistory {
                        id: row.get("id"),
                        plan_id: row.get("plan_id"),
                        from_status: row.get("from_status"),
                        to_status: row.get("to_status"),
                        from_lifecycle_status: None, // 已废弃字段，保留用于兼容
                        to_lifecycle_status: String::new(), // 已废弃字段，保留用于兼容
                        changed_at: row.get("changed_at"),
                        reason: row.get("reason"),
                    }
                })
                .collect();

            logger.api_response(
                "get_study_plan_status_history",
                true,
                Some(&format!("返回 {} 条历史记录", history.len())),
            );
            Ok(history)
        }
        Err(e) => {
            let error_msg = format!("获取状态历史失败: {}", e);
            logger.api_response("get_study_plan_status_history", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 获取学习计划关联的单词本ID列表
#[tauri::command]
pub async fn get_study_plan_word_books(app: AppHandle, plan_id: i64) -> AppResult<Vec<i64>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_study_plan_word_books",
        Some(&format!("plan_id: {}", plan_id)),
    );

    let query = r#"
        SELECT DISTINCT w.word_book_id
        FROM study_plan_words spw
        JOIN words w ON w.id = spw.word_id
        WHERE spw.plan_id = ?
        ORDER BY w.word_book_id
    "#;

    match sqlx::query(query)
        .bind(plan_id)
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => {
            let word_book_ids: Vec<i64> = rows
                .iter()
                .map(|row| row.get::<i64, _>("word_book_id"))
                .collect();

            logger.api_response(
                "get_study_plan_word_books",
                true,
                Some(&format!("Found {} word books", word_book_ids.len())),
            );
            Ok(word_book_ids)
        }
        Err(e) => {
            let error_msg = format!("数据库错误: {}", e);
            logger.api_response("get_study_plan_word_books", false, Some(&error_msg));
            Err(AppError::DatabaseError(error_msg))
        }
    }
}

/// 更新学习计划基本信息（仅名称和描述）
#[tauri::command]
pub async fn update_study_plan_basic_info(
    app: AppHandle,
    plan_id: i64,
    name: String,
    description: Option<String>,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "update_study_plan_basic_info",
        Some(&format!("plan_id: {}", plan_id)),
    );

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划是否存在且为草稿状态
    let check_query = "SELECT status FROM study_plans WHERE id = ? AND deleted_at IS NULL";
    let plan_status: String = match sqlx::query_scalar(check_query)
        .bind(plan_id)
        .fetch_optional(&mut *tx)
        .await?
    {
        Some(status) => status,
        None => {
            let error_msg = "学习计划不存在";
            logger.api_response("update_study_plan_basic_info", false, Some(error_msg));
            return Err(AppError::DatabaseError(error_msg.to_string()));
        }
    };

    // 只允许更新草稿状态的计划
    if plan_status != "draft" {
        let error_msg = "只能编辑草稿状态的学习计划";
        logger.api_response("update_study_plan_basic_info", false, Some(error_msg));
        return Err(AppError::DatabaseError(error_msg.to_string()));
    }

    // 更新学习计划基本信息（仅名称和描述）
    let update_query = r#"
        UPDATE study_plans
        SET
            name = ?,
            description = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    "#;

    sqlx::query(update_query)
        .bind(&name)
        .bind(description.as_deref())
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 提交事务
    tx.commit().await?;

    logger.api_response(
        "update_study_plan_basic_info",
        true,
        Some("学习计划基本信息已更新"),
    );
    Ok(())
}

/// 获取日历月度数据
#[tauri::command]
pub async fn get_calendar_month_data(
    app: AppHandle,
    year: i32,
    month: i32,
    include_other_months: Option<bool>,
) -> AppResult<CalendarMonthResponse> {
    use crate::types::study::{
        CalendarDayData, CalendarMonthResponse, CalendarMonthlyStats, CalendarStudyPlan,
        CalendarStudySession,
    };

    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_calendar_month_data",
        Some(&format!("year: {}, month: {}", year, month)),
    );

    let include_other = include_other_months.unwrap_or(true);

    // 计算日历范围
    let start_date = if include_other {
        // 包含其他月份，从月初的周一开始
        let first_day = chrono::NaiveDate::from_ymd_opt(year, month as u32, 1)
            .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?;
        let weekday = first_day.weekday().num_days_from_monday();
        first_day - chrono::Duration::days(weekday as i64)
    } else {
        // 只包含当前月份
        chrono::NaiveDate::from_ymd_opt(year, month as u32, 1)
            .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
    };

    let end_date = if include_other {
        // 包含其他月份，到月末的周日结束
        let last_day = if month == 12 {
            chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
                .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
                - chrono::Duration::days(1)
        } else {
            chrono::NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)
                .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
                - chrono::Duration::days(1)
        };
        let weekday = last_day.weekday().num_days_from_monday();
        last_day + chrono::Duration::days(6 - weekday as i64)
    } else {
        // 只包含当前月份
        if month == 12 {
            chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
                .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
                - chrono::Duration::days(1)
        } else {
            chrono::NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)
                .ok_or_else(|| AppError::ValidationError("Invalid date".to_string()))?
                - chrono::Duration::days(1)
        }
    };

    // 获取日期范围内的学习计划日程，使用预计算的统计字段
    let schedules_query = r#"
        SELECT
            sps.schedule_date,
            sp.id as plan_id,
            sp.name as plan_name,
            sp.unified_status,
            sps.total_words_count as total_words,
            sps.new_words_count as new_words,
            sps.review_words_count as review_words,
            sps.completed_words_count,
            sps.status as schedule_status
        FROM study_plan_schedules sps
        JOIN study_plans sp ON sps.plan_id = sp.id
        WHERE sps.schedule_date BETWEEN ? AND ?
            AND sp.deleted_at IS NULL
            AND sp.unified_status IN ('Pending', 'Active', 'Paused')
        ORDER BY sps.schedule_date, sp.id
    "#;

    let schedule_rows = match sqlx::query(schedules_query)
        .bind(start_date.format("%Y-%m-%d").to_string())
        .bind(end_date.format("%Y-%m-%d").to_string())
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            let error_msg = format!("Failed to fetch calendar schedules: {}", e);
            logger.database_operation("SELECT", "study_plan_schedules", false, Some(&error_msg));
            logger.api_response("get_calendar_month_data", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    // 获取学习记录
    let sessions_query = r#"
        SELECT
            DATE(ss.started_at) as study_date,
            ss.plan_id,
            sp.name as plan_name,
            SUM(ss.words_studied) as words_studied,
            SUM(CAST(ss.total_time_seconds AS REAL) / 60.0) as study_time_minutes,
            AVG(CAST(ss.correct_answers AS REAL) / NULLIF(ss.words_studied, 0) * 100.0) as accuracy_rate,
            MAX(ss.started_at) as completed_at
        FROM study_sessions ss
        JOIN study_plans sp ON ss.plan_id = sp.id
        WHERE DATE(ss.started_at) BETWEEN ? AND ?
        GROUP BY DATE(ss.started_at), ss.plan_id, sp.name
        ORDER BY study_date, ss.plan_id
    "#;

    let session_rows = match sqlx::query(sessions_query)
        .bind(start_date.format("%Y-%m-%d").to_string())
        .bind(end_date.format("%Y-%m-%d").to_string())
        .fetch_all(pool.inner())
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            let error_msg = format!("Failed to fetch calendar sessions: {}", e);
            logger.database_operation("SELECT", "study_sessions", false, Some(&error_msg));
            logger.api_response("get_calendar_month_data", false, Some(&error_msg));
            return Err(AppError::DatabaseError(error_msg));
        }
    };

    // 构建日历数据
    let mut days = Vec::new();
    let today = chrono::Local::now().date_naive();
    let mut current_date = start_date;

    while current_date <= end_date {
        let date_str = current_date.format("%Y-%m-%d").to_string();
        let is_today = current_date == today;
        let _is_current_month = current_date.month() == month as u32;

        // 收集该日期的学习计划
        let mut study_plans = Vec::new();
        let mut total_words = 0;
        let mut new_words = 0;
        let mut review_words = 0;

        for row in &schedule_rows {
            let schedule_date: String = row.get("schedule_date");
            if schedule_date == date_str {
                let plan_id: i64 = row.get("plan_id");
                let plan_name: String = row.get("plan_name");
                let unified_status: String = row.get("unified_status");
                let plan_total_words: i32 = row.get("total_words");
                let plan_new_words: i32 = row.get("new_words");
                let plan_review_words: i32 = row.get("review_words");
                let _plan_completed_words: i32 = row.get("completed_words_count");

                // 转换 unified_status
                let unified_status_enum = match unified_status.as_str() {
                    "Draft" => StudyPlanLifecycleStatus::Draft,
                    "Pending" => StudyPlanLifecycleStatus::Pending,
                    "Active" => StudyPlanLifecycleStatus::Active,
                    "Paused" => StudyPlanLifecycleStatus::Paused,
                    "Completed" => StudyPlanLifecycleStatus::Completed,
                    "Terminated" => StudyPlanLifecycleStatus::Terminated,
                    "Deleted" => StudyPlanLifecycleStatus::Deleted,
                    _ => StudyPlanLifecycleStatus::Draft,
                };

                study_plans.push(CalendarStudyPlan {
                    plan_id,
                    plan_name,
                    schedule_id: 0, // 诊断工具中不使用此字段
                    unified_status: unified_status_enum,
                });

                total_words += plan_total_words;
                new_words += plan_new_words;
                review_words += plan_review_words;
            }
        }

        // 收集该日期的学习记录
        let mut study_sessions = Vec::new();
        let mut completed_words = 0;
        let mut study_time_minutes = 0;

        for row in &session_rows {
            let study_date: String = row.get("study_date");
            if study_date == date_str {
                let plan_id: i64 = row.get("plan_id");
                let plan_name: String = row.get("plan_name");
                let words_studied: i64 = row.get("words_studied");
                let session_time: f64 = row.get("study_time_minutes");
                let accuracy_rate: Option<f64> = row.try_get("accuracy_rate").ok();
                let completed_at: String = row.get("completed_at");

                study_sessions.push(CalendarStudySession {
                    session_id: format!("diag-{}", plan_id), // 生成诊断用ID
                    plan_id,
                    plan_name,
                    words_studied,
                    study_time_minutes: session_time.round() as i64,
                    accuracy_rate: accuracy_rate.unwrap_or(0.0),
                    completed_at,
                });

                completed_words += words_studied as i32;
                study_time_minutes += session_time.round() as i32;
            }
        }

        // 确定状态
        let is_in_plan = !study_plans.is_empty();
        let status = if !is_in_plan {
            "not-started".to_string()
        } else if current_date > today {
            "not-started".to_string()
        } else if completed_words >= total_words && total_words > 0 {
            "completed".to_string()
        } else if completed_words > 0 {
            "in-progress".to_string()
        } else if current_date < today {
            "overdue".to_string()
        } else {
            "not-started".to_string()
        };

        // 计算进度百分比
        let progress_percentage = if total_words > 0 {
            (completed_words as f64 / total_words as f64 * 100.0).min(100.0)
        } else {
            0.0
        };

        days.push(CalendarDayData {
            date: date_str,
            is_today,
            is_in_plan, // 移除月份限制，让所有有计划的日期都显示
            status,
            new_words_count: new_words,
            review_words_count: review_words,
            total_words_count: total_words,
            completed_words_count: completed_words,
            progress_percentage,
            study_time_minutes: if study_time_minutes > 0 {
                Some(study_time_minutes)
            } else {
                None
            },
            study_plans: if study_plans.is_empty() {
                None
            } else {
                Some(study_plans)
            },
            study_sessions: if study_sessions.is_empty() {
                None
            } else {
                Some(study_sessions)
            },
        });

        current_date += chrono::Duration::days(1);
    }

    // 计算月度统计
    let current_month_days: Vec<&CalendarDayData> = days
        .iter()
        .filter(|d| {
            let date_obj =
                chrono::NaiveDate::parse_from_str(&d.date, "%Y-%m-%d").unwrap_or_default();
            date_obj.month() == month as u32
        })
        .collect();

    // 计算平均准确率
    let sessions_with_accuracy: Vec<&CalendarStudySession> = current_month_days
        .iter()
        .filter_map(|d| d.study_sessions.as_ref())
        .flatten()
        .collect();
    let average_accuracy = if !sessions_with_accuracy.is_empty() {
        sessions_with_accuracy
            .iter()
            .map(|s| s.accuracy_rate)
            .sum::<f64>()
            / sessions_with_accuracy.len() as f64
    } else {
        0.0
    };

    // 计算连续学习天数（从今天往前数）
    let mut streak_days = 0;
    let _today_str = chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string();
    let mut check_date = chrono::Local::now().date_naive();

    for _ in 0..30 {
        // 最多检查30天
        let date_str = check_date.format("%Y-%m-%d").to_string();
        if let Some(day_data) = days.iter().find(|d| d.date == date_str) {
            if day_data.status == "completed" {
                streak_days += 1;
            } else if day_data.is_in_plan {
                // 如果有计划但未完成，则中断连续记录
                break;
            }
        }
        check_date -= chrono::Duration::days(1);
    }

    // 计算活跃计划数
    let mut active_plan_ids = std::collections::HashSet::new();
    for day in &current_month_days {
        if let Some(plans) = &day.study_plans {
            for plan in plans {
                active_plan_ids.insert(plan.plan_id);
            }
        }
    }

    let monthly_stats = CalendarMonthlyStats {
        total_days: current_month_days.len() as i32,
        study_days: current_month_days.iter().filter(|d| d.is_in_plan).count() as i32,
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

    let response = CalendarMonthResponse {
        year,
        month,
        days,
        monthly_stats,
    };

    logger.api_response(
        "get_calendar_month_data",
        true,
        Some(&format!("Retrieved {} days", response.days.len())),
    );
    Ok(response)
}

/// 诊断学习计划数据
#[tauri::command]
pub async fn diagnose_study_plan_data(
    app: AppHandle,
    plan_name: String,
) -> AppResult<serde_json::Value> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "diagnose_study_plan_data",
        Some(&format!("plan_name: {}", plan_name)),
    );

    let mut diagnosis = serde_json::Map::new();

    // 检查学习计划基本信息
    let plan_query = "SELECT id, name, status, unified_status, ai_plan_data, total_words FROM study_plans WHERE name LIKE ?";
    let plan_rows = sqlx::query(plan_query)
        .bind(format!("%{}%", plan_name))
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default();

    let mut plans_info = Vec::new();
    for row in plan_rows {
        let plan_id: i64 = row.get("id");
        let name: String = row.get("name");
        let status: String = row.get("status");
        let unified_status: String = row.get("unified_status");
        let ai_plan_data: Option<String> = row.get("ai_plan_data");
        let total_words: i32 = row.get("total_words");

        // 从实际练习记录计算已学单词数
        let learned_words: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(DISTINCT wpr.word_id)
            FROM word_practice_records wpr
            JOIN practice_sessions ps ON wpr.session_id = ps.id
            WHERE ps.plan_id = ? AND ps.completed = TRUE AND wpr.is_correct = TRUE
        "#,
        )
        .bind(plan_id)
        .fetch_one(pool.inner())
        .await
        .unwrap_or(0);

        // 检查日程数据
        let schedule_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM study_plan_schedules WHERE plan_id = ?")
                .bind(plan_id)
                .fetch_one(pool.inner())
                .await
                .unwrap_or(0);

        // 检查单词关联数据
        let word_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM study_plan_words WHERE plan_id = ?")
                .bind(plan_id)
                .fetch_one(pool.inner())
                .await
                .unwrap_or(0);

        plans_info.push(serde_json::json!({
            "id": plan_id,
            "name": name,
            "status": status,
            "unified_status": unified_status,
            "has_ai_data": ai_plan_data.is_some(),
            "ai_data_length": ai_plan_data.as_ref().map(|s| s.len()).unwrap_or(0),
            "total_words": total_words,
            "learned_words": learned_words,
            "schedule_count": schedule_count,
            "word_count": word_count
        }));
    }

    diagnosis.insert("plans".to_string(), serde_json::Value::Array(plans_info));

    logger.api_response("diagnose_study_plan_data", true, Some("诊断完成"));
    Ok(serde_json::Value::Object(diagnosis))
}

/// 诊断日历数据状态
#[tauri::command]
pub async fn diagnose_calendar_data(app: AppHandle) -> AppResult<serde_json::Value> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("diagnose_calendar_data", None);

    let mut diagnosis = serde_json::Map::new();

    // 检查学习计划
    let plans_query = "SELECT id, name, ai_plan_data, start_date, end_date, unified_status FROM study_plans WHERE status != 'deleted'";
    let plan_rows = sqlx::query(plans_query)
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default();

    let mut plans_info = Vec::new();
    for row in &plan_rows {
        let id: i64 = row.get("id");
        let name: String = row.get("name");
        let ai_plan_data: Option<String> = row.get("ai_plan_data");
        let start_date: Option<String> = row.get("start_date");
        let end_date: Option<String> = row.get("end_date");
        let unified_status: String = row.get("unified_status");

        let has_ai_data = ai_plan_data.is_some() && !ai_plan_data.as_ref().unwrap().is_empty();

        // 检查是否有日程数据
        let schedule_count_query =
            "SELECT COUNT(*) as count FROM study_plan_schedules WHERE plan_id = ?";
        let schedule_count: i64 = sqlx::query(schedule_count_query)
            .bind(id)
            .fetch_one(pool.inner())
            .await
            .map(|row| row.get("count"))
            .unwrap_or(0);

        plans_info.push(serde_json::json!({
            "id": id,
            "name": name,
            "unified_status": unified_status,
            "start_date": start_date,
            "end_date": end_date,
            "has_ai_data": has_ai_data,
            "schedule_count": schedule_count
        }));
    }

    diagnosis.insert(
        "study_plans".to_string(),
        serde_json::Value::Array(plans_info),
    );

    // 检查总的日程数据
    let total_schedules_query = "SELECT COUNT(*) as count FROM study_plan_schedules";
    let total_schedules: i64 = sqlx::query(total_schedules_query)
        .fetch_one(pool.inner())
        .await
        .map(|row| row.get("count"))
        .unwrap_or(0);

    diagnosis.insert(
        "total_schedules".to_string(),
        serde_json::Value::Number(serde_json::Number::from(total_schedules)),
    );

    // 检查日程日期范围
    if total_schedules > 0 {
        let date_range_query = "SELECT MIN(schedule_date) as min_date, MAX(schedule_date) as max_date FROM study_plan_schedules";
        if let Ok(row) = sqlx::query(date_range_query).fetch_one(pool.inner()).await {
            let min_date: Option<String> = row.get("min_date");
            let max_date: Option<String> = row.get("max_date");
            diagnosis.insert(
                "schedule_date_range".to_string(),
                serde_json::json!({
                    "min_date": min_date,
                    "max_date": max_date
                }),
            );
        }
    }

    logger.api_response("diagnose_calendar_data", true, Some("Diagnosis completed"));
    Ok(serde_json::Value::Object(diagnosis))
}

/// 更新学习计划完整信息（包括学习设置和日程）
#[tauri::command]
pub async fn update_study_plan_with_schedule(
    app: AppHandle,
    plan_id: i64,
    name: String,
    description: Option<String>,
    intensity_level: String,
    study_period_days: i64,
    review_frequency: i64,
    start_date: String,
    _wordbook_ids: Vec<i64>,
    schedule: serde_json::Value,
    status: String,
) -> AppResult<()> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "update_study_plan_with_schedule",
        Some(&format!("plan_id: {}", plan_id)),
    );

    // 开始事务
    let mut tx = pool.inner().begin().await?;

    // 检查学习计划是否存在且为草稿状态
    let plan_status: Option<String> =
        sqlx::query_scalar("SELECT status FROM study_plans WHERE id = ?")
            .bind(plan_id)
            .fetch_optional(&mut *tx)
            .await?;

    let plan_status = match plan_status {
        Some(status) => status,
        None => {
            let error_msg = "学习计划不存在";
            logger.api_response("update_study_plan_with_schedule", false, Some(error_msg));
            return Err(AppError::DatabaseError(error_msg.to_string()));
        }
    };

    // 只允许更新草稿状态的计划
    if plan_status != "draft" {
        let error_msg = "只能编辑草稿状态的学习计划";
        logger.api_response("update_study_plan_with_schedule", false, Some(error_msg));
        return Err(AppError::DatabaseError(error_msg.to_string()));
    }

    // 更新学习计划基本信息和设置
    let update_query = r#"
        UPDATE study_plans
        SET name = ?,
            description = ?,
            intensity_level = ?,
            study_period_days = ?,
            review_frequency = ?,
            start_date = ?,
            ai_plan_data = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    "#;

    sqlx::query(update_query)
        .bind(&name)
        .bind(&description)
        .bind(&intensity_level)
        .bind(study_period_days)
        .bind(review_frequency)
        .bind(&start_date)
        .bind(schedule.to_string())
        .bind(&status)
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 删除现有的单词关联和日程记录（与创建逻辑保持一致）
    sqlx::query("DELETE FROM study_plan_words WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 删除现有的日程记录（级联删除会自动删除 study_plan_schedule_words）
    sqlx::query("DELETE FROM study_plan_schedules WHERE plan_id = ?")
        .bind(plan_id)
        .execute(&mut *tx)
        .await?;

    // 重新创建学习计划单词关联（与创建逻辑保持一致）
    let mut all_word_ids = std::collections::HashSet::new();

    // 直接从 serde_json::Value 解析，避免不必要的序列化/反序列化
    if let Ok(ai_result) = serde_json::from_value::<StudyPlanAIResult>(schedule.clone()) {
        logger.info(
            "UPDATE_PLAN",
            &format!(
                "Successfully parsed AI result with {} daily plans",
                ai_result.daily_plans.len()
            ),
        );

        for daily_plan in &ai_result.daily_plans {
            for word in &daily_plan.words {
                if let Ok(word_id) = word.word_id.parse::<i64>() {
                    all_word_ids.insert(word_id);
                }
            }
        }

        logger.info(
            "UPDATE_PLAN",
            &format!(
                "Extracted {} unique word IDs from AI result",
                all_word_ids.len()
            ),
        );
    } else {
        logger.error(
            "UPDATE_PLAN",
            "Failed to parse AI result from schedule data",
            Some(
                &serde_json::to_string(&schedule)
                    .unwrap_or_default()
                    .chars()
                    .take(200)
                    .collect::<String>(),
            ),
        );
    }

    for word_id in all_word_ids {
        sqlx::query(
            "INSERT INTO study_plan_words (plan_id, word_id, learned, correct_count, total_attempts, mastery_score) VALUES (?, ?, FALSE, 0, 0, 0.0)"
        )
            .bind(plan_id)
            .bind(word_id)
            .execute(&mut *tx)
            .await?;
    }

    // 重新创建学习计划日程（如果有AI规划数据）
    if let Ok(ai_result) =
        serde_json::from_str::<crate::types::study::StudyPlanAIResult>(&schedule.to_string())
    {
        for daily_plan in &ai_result.daily_plans {
            // 预计算统计数据
            let new_words_count = daily_plan.words.iter().filter(|w| !w.is_review).count() as i32;
            let review_words_count = daily_plan.words.iter().filter(|w| w.is_review).count() as i32;
            let total_words_count = daily_plan.words.len() as i32;

            let insert_schedule_query = r#"
                INSERT INTO study_plan_schedules (
                    plan_id, day_number, schedule_date,
                    new_words_count, review_words_count, total_words_count, completed_words_count, status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, 'not-started', datetime('now'), datetime('now'))
            "#;

            let schedule_result = sqlx::query(insert_schedule_query)
                .bind(plan_id)
                .bind(daily_plan.day)
                .bind(&daily_plan.date)
                .bind(new_words_count)
                .bind(review_words_count)
                .bind(total_words_count)
                .execute(&mut *tx)
                .await?;

            let schedule_id = schedule_result.last_insert_rowid();

            // 创建日程单词
            for word in &daily_plan.words {
                let insert_word_query = r#"
                    INSERT INTO study_plan_schedule_words (
                        schedule_id, word_id, wordbook_id, is_review, review_count,
                        priority, difficulty_level, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                "#;

                let word_id: i64 = match word.word_id.parse() {
                    Ok(id) => id,
                    Err(e) => {
                        let _ = tx.rollback().await;
                        let error_msg = format!("Invalid word_id format: {}", e);
                        return Err(AppError::ValidationError(error_msg));
                    }
                };

                sqlx::query(insert_word_query)
                    .bind(schedule_id)
                    .bind(word_id)
                    .bind(word.wordbook_id.clone())
                    .bind(word.is_review)
                    .bind(word.review_count)
                    .bind(word.priority.clone())
                    .bind(word.difficulty_level)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        logger.info(
            "UPDATE_SCHEDULE",
            &format!(
                "Recreated {} daily schedules for plan {}",
                ai_result.daily_plans.len(),
                plan_id
            ),
        );
    }

    // 提交事务
    tx.commit().await?;

    logger.api_response(
        "update_study_plan_with_schedule",
        true,
        Some("学习计划已完整更新"),
    );
    Ok(())
}
