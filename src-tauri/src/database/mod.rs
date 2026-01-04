use crate::error::AppResult;
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::str::FromStr;

/// 数据库连接管理器
pub struct DatabaseManager {
    pool: SqlitePool,
}

impl DatabaseManager {
    /// 创建新的数据库管理器
    pub async fn new(database_url: &str) -> AppResult<Self> {
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);

        let pool = SqlitePool::connect_with(options).await?;

        Ok(Self { pool })
    }

    /// 获取数据库连接池
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// 运行数据库迁移
    pub async fn migrate(&self) -> AppResult<()> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }
}
