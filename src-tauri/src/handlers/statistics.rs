//! 数据统计和管理命令处理器
//!
//! 包含所有与数据统计和管理相关的 Tauri 命令

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::services::statistics::StatisticsService;
use crate::types::*;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// 每日学习量（首页学习热力图）：最近 `days` 天（含今天，本地日期），只返回有学习的日期
#[tauri::command]
pub async fn get_daily_learning_activity(
    app: AppHandle,
    days: i64,
) -> AppResult<Vec<DailyLearningActivity>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "get_daily_learning_activity",
        Some(&format!("days: {}", days)),
    );

    let service = StatisticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.get_daily_learning_activity(days).await {
        Ok(result) => {
            logger.api_response(
                "get_daily_learning_activity",
                true,
                Some(&format!("{} active days", result.len())),
            );
            Ok(result)
        }
        Err(e) => {
            logger.api_response("get_daily_learning_activity", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 获取数据库统计信息
#[tauri::command]
pub async fn get_database_statistics(app: AppHandle) -> AppResult<DatabaseOverview> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("get_database_statistics", None);

    let service = StatisticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.get_database_statistics().await {
        Ok(overview) => {
            logger.api_response(
                "get_database_statistics",
                true,
                Some(&format!(
                    "Found {} tables with {} total records",
                    overview.total_tables, overview.total_records
                )),
            );
            Ok(overview)
        }
        Err(e) => {
            logger.api_response("get_database_statistics", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 重置用户数据（保留配置数据）
#[tauri::command]
pub async fn reset_user_data(app: AppHandle) -> AppResult<ResetResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request("reset_user_data", None);

    let service = StatisticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.reset_user_data().await {
        Ok(result) => {
            logger.api_response("reset_user_data", true, Some(&result.message));
            Ok(result)
        }
        Err(e) => {
            logger.api_response("reset_user_data", false, Some(&e.to_string()));
            Err(e)
        }
    }
}

/// 删除数据库文件并重启应用
#[tauri::command]
pub async fn delete_database_and_restart(app: AppHandle) -> AppResult<()> {
    let logger = app.state::<Logger>();

    logger.api_request("delete_database_and_restart", None);
    logger.info(
        "DATABASE",
        "🗑️ Starting database deletion and app restart process",
    );

    let dirs = crate::app_paths::dirs(&app);
    let db_path = dirs.db_path();
    let wal_path = db_path.with_extension("db-wal");
    let shm_path = db_path.with_extension("db-shm");

    logger.info(
        "DATABASE",
        &format!("Database file path: {}", db_path.display()),
    );
    logger.info(
        "DATABASE",
        &format!("WAL file path: {}", wal_path.display()),
    );
    logger.info(
        "DATABASE",
        &format!("SHM file path: {}", shm_path.display()),
    );

    // 检查数据库文件是否存在
    if !db_path.exists() {
        let error_msg = "数据库文件不存在";
        logger.api_response("delete_database_and_restart", false, Some(error_msg));
        return Err(AppError::NotFound(error_msg.to_string()));
    }

    // 删除前先完整备份一份（误操作时还能找回），备份失败就不删
    let pool = app.state::<SqlitePool>();
    let backup = dirs.backups_dir().join(format!(
        "vocabulary-before-reset-{}.db",
        crate::time::local_file_stamp()
    ));
    if let Err(e) = std::fs::create_dir_all(dirs.backups_dir()) {
        let msg = format!("删除前无法创建备份目录：{}", e);
        logger.api_response("delete_database_and_restart", false, Some(&msg));
        return Err(AppError::InternalError(msg));
    }
    if let Err(e) = crate::database::vacuum_into(pool.inner(), &backup).await {
        let msg = format!("删除前备份数据库失败，没有删除：{}", e);
        logger.api_response("delete_database_and_restart", false, Some(&msg));
        return Err(AppError::InternalError(msg));
    }
    logger.info(
        "DATABASE",
        &format!("Backed up before reset: {}", backup.display()),
    );

    // 关闭所有连接
    logger.info("DATABASE", "Closing database connections...");

    // 关闭连接池
    pool.close().await;
    logger.info("DATABASE", "✅ Database connections closed");

    // 等待一小段时间确保文件句柄被释放
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    logger.info("DATABASE", "Preparing to delete database file");

    // 尝试删除数据库文件，如果失败则重试几次
    let mut attempts = 0;
    let max_attempts = 5;

    loop {
        attempts += 1;
        logger.info(
            "DATABASE",
            &format!("Delete attempt {} of {}", attempts, max_attempts),
        );

        // 尝试删除主数据库文件
        match std::fs::remove_file(&db_path) {
            Ok(_) => {
                logger.info("DATABASE", "✅ Main database file deleted successfully");

                // 删除WAL文件（如果存在）
                if wal_path.exists() {
                    match std::fs::remove_file(&wal_path) {
                        Ok(_) => logger.info("DATABASE", "✅ WAL file deleted successfully"),
                        Err(e) => logger.info(
                            "DATABASE",
                            &format!("⚠️ Failed to delete WAL file (non-critical): {}", e),
                        ),
                    }
                }

                // 删除SHM文件（如果存在）
                if shm_path.exists() {
                    match std::fs::remove_file(&shm_path) {
                        Ok(_) => logger.info("DATABASE", "✅ SHM file deleted successfully"),
                        Err(e) => logger.info(
                            "DATABASE",
                            &format!("⚠️ Failed to delete SHM file (non-critical): {}", e),
                        ),
                    }
                }

                logger.api_response(
                    "delete_database_and_restart",
                    true,
                    Some("All database files deleted, restarting app"),
                );

                // 重启应用程序
                app.restart();
                // 注意：restart() 会终止当前进程，所以这里不会返回
            }
            Err(e) => {
                if attempts >= max_attempts {
                    let error_msg = format!("删除数据库文件失败 (尝试{}次): {}", attempts, e);
                    logger.error(
                        "DATABASE",
                        "Failed to delete database file after multiple attempts",
                        Some(&error_msg),
                    );
                    logger.api_response("delete_database_and_restart", false, Some(&error_msg));
                    return Err(AppError::InternalError(error_msg));
                } else {
                    logger.info(
                        "DATABASE",
                        &format!(
                            "Delete attempt {} failed, retrying in 200ms: {}",
                            attempts, e
                        ),
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                }
            }
        }
    }
}

/// 选择性重置用户数据
#[tauri::command]
pub async fn reset_selected_tables(
    app: AppHandle,
    table_names: Vec<String>,
) -> AppResult<ResetResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    logger.api_request(
        "reset_selected_tables",
        Some(&format!("Tables: {:?}", table_names)),
    );

    if table_names.is_empty() {
        return Ok(ResetResult {
            success: false,
            message: "请先选择要清空的数据".to_string(),
            deleted_records: 0,
            affected_tables: vec![],
        });
    }

    let service = StatisticsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    );

    match service.reset_selected_tables(&table_names).await {
        Ok(result) => {
            logger.api_response("reset_selected_tables", true, Some(&result.message));
            Ok(result)
        }
        Err(e) => {
            logger.api_response("reset_selected_tables", false, Some(&e.to_string()));
            Err(e)
        }
    }
}
