//! 启动时打开数据库并升级到本版本（唯一 owner）。
//!
//! 用户每次自己构建、覆盖安装新版本，启动时自动执行新增的迁移。为了让升级不丢数据、出问题能恢复：
//! 1. 先对账：上次升级没完成、数据库来自更新的版本（降级）、已执行的迁移后来被改过 —— 都不动数据，直接报告原因；
//! 2. 有待执行的迁移时，先用 `VACUUM INTO` 把当前库完整备份到 `backups/`（含 WAL 中已提交的内容），备份失败就不升级；
//! 3. 再执行迁移（每个迁移一个事务，失败会回滚到上一个完成的版本）；
//! 4. 只保留最近 [`KEEP_BACKUPS`] 份升级备份。
//!
//! 任何一步失败都返回 [`StartupFailure`]：应用照常打开窗口，前端只显示错误页（原因、数据目录、备份位置），不会建新库、不会崩溃。

use crate::app_paths::AppDirs;
use crate::database::{connect, MIGRATOR};
use crate::logger::Logger;
use crate::types::common::StartupFailure;
use sqlx::migrate::{MigrateError, Migrator};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// 升级备份文件名前缀
const BACKUP_PREFIX: &str = "vocabulary-before-v";
/// 保留的升级备份份数
pub const KEEP_BACKUPS: usize = 5;

/// 打开并升级数据库；成功返回连接池
pub async fn open_database(dirs: &AppDirs, logger: &Logger) -> Result<SqlitePool, StartupFailure> {
    let data_dir = dirs.data.display().to_string();
    let fail = |kind: &str, title: &str, message: String, detail: Option<String>| {
        logger.error("STARTUP", title, Some(&format!("{message} {detail:?}")));
        StartupFailure {
            kind: kind.to_string(),
            title: title.to_string(),
            message,
            detail,
            data_dir: data_dir.clone(),
            backup_dir: dirs.backups_dir().display().to_string(),
        }
    };

    let db_path = dirs.db_path();
    let existed = db_path.exists();
    logger.info(
        "DATABASE",
        &format!(
            "Database path: {} ({})",
            db_path.display(),
            if existed { "existing" } else { "new" }
        ),
    );
    let pool = connect(&db_path).await.map_err(|e| {
        fail(
            "connect",
            "无法打开数据库",
            "数据库文件打不开，可能被其他程序占用或没有读写权限。".to_string(),
            Some(e.to_string()),
        )
    })?;

    let plan = match check(&pool, &MIGRATOR).await {
        Ok(plan) => plan,
        Err(e) => {
            pool.close().await;
            return Err(match e {
                CheckError::Query(e) => fail(
                    "connect",
                    "无法读取数据库",
                    "数据库文件可能已损坏。".to_string(),
                    Some(e.to_string()),
                ),
                CheckError::Interrupted(v) => fail(
                    "interrupted",
                    "上次数据库升级没有完成",
                    format!("第 {v} 号升级上次中途出错，数据库被标记为未完成，为了安全没有继续。升级前的备份在 backups 文件夹里。请到 GitHub Issues 反馈，并附上日志。"),
                    None,
                ),
                CheckError::Newer { db, app } => fail(
                    "newer_database",
                    "数据来自更新的版本",
                    format!("这份数据已经被更新版本的拼读升级过（数据库版本 {db}），当前应用只支持到版本 {app}。为了不损坏数据，没有打开它。请构建并安装最新版本后再打开，数据都还在。"),
                    None,
                ),
                CheckError::Modified(v) => fail(
                    "modified_migration",
                    "数据库升级脚本和记录不一致",
                    format!("应用自带的第 {v} 号数据库升级脚本，和当初升级这份数据时用的不一样，继续可能出错，所以没有打开数据。通常是因为构建了改动过的源码，请用官方仓库的代码重新构建。"),
                    None,
                ),
            });
        }
    };

    if plan.pending.is_empty() {
        logger.info(
            "DATABASE",
            &format!("Database is up to date (version {})", plan.applied_max),
        );
        return Ok(pool);
    }

    // 新库直接建表；已有数据的库先备份再升级
    let backup = if plan.applied_max > 0 {
        match backup(&pool, &dirs.backups_dir(), plan.applied_max, plan.target).await {
            Ok(path) => {
                logger.info(
                    "DATABASE",
                    &format!("Backed up before upgrade: {}", path.display()),
                );
                Some(path)
            }
            Err(e) => {
                pool.close().await;
                return Err(fail(
                    "backup",
                    "升级前无法备份数据",
                    "升级数据库之前要先备份，但备份没有成功，为了安全没有升级。请检查磁盘空间后重新打开应用。".to_string(),
                    Some(e),
                ));
            }
        }
    } else {
        None
    };

    logger.info(
        "DATABASE",
        &format!(
            "Upgrading database {} -> {} ({} migrations)",
            plan.applied_max,
            plan.target,
            plan.pending.len()
        ),
    );
    if let Err(e) = MIGRATOR.run(&pool).await {
        pool.close().await;
        let step = match &e {
            MigrateError::ExecuteMigration(_, v) => format!("第 {v} 号"),
            _ => "数据库".to_string(),
        };
        let saved = match &backup {
            Some(path) => format!("升级前的数据已备份为 {}。", path.display()),
            None => String::new(),
        };
        return Err(fail(
            "migrate",
            "数据库升级失败",
            format!("执行{step}升级时出错，数据库停在了上一个完成的版本。{saved}请到 GitHub Issues 反馈，并附上日志。"),
            Some(e.to_string()),
        ));
    }
    logger.info("DATABASE", "Database migrations completed successfully");

    if let Err(e) = prune_backups(&dirs.backups_dir(), KEEP_BACKUPS) {
        logger.warn("DATABASE", "清理旧的升级备份失败", Some(&e.to_string()));
    }
    Ok(pool)
}

/// 升级计划
#[derive(Debug, PartialEq)]
pub struct UpgradePlan {
    /// 已执行的最高版本（新库为 0）
    pub applied_max: i64,
    /// 本版本内置的最高版本
    pub target: i64,
    /// 待执行的版本
    pub pending: Vec<i64>,
}

#[derive(Debug)]
pub enum CheckError {
    Query(sqlx::Error),
    /// 上次的迁移没有成功（`success = 0`）
    Interrupted(i64),
    /// 数据库有本版本不认识的迁移：来自更新的版本
    Newer {
        db: i64,
        app: i64,
    },
    /// 已执行的迁移内容和本版本内置的不一致
    Modified(i64),
}

/// 对账：已执行的迁移 ↔ 本版本内置的迁移
pub async fn check(pool: &SqlitePool, migrator: &Migrator) -> Result<UpgradePlan, CheckError> {
    let known: HashMap<i64, &[u8]> = migrator
        .iter()
        .filter(|m| m.migration_type.is_up_migration())
        .map(|m| (m.version, m.checksum.as_ref()))
        .collect();
    let target = known.keys().copied().max().unwrap_or(0);

    let has_table: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await
    .map_err(CheckError::Query)?;
    let rows = if has_table {
        sqlx::query("SELECT version, checksum, success FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await
            .map_err(CheckError::Query)?
    } else {
        Vec::new()
    };

    let mut applied = Vec::with_capacity(rows.len());
    let newest = rows
        .iter()
        .map(|r| r.get::<i64, _>("version"))
        .max()
        .unwrap_or(0);
    for row in &rows {
        let version: i64 = row.get("version");
        let checksum: Vec<u8> = row.get("checksum");
        let success: bool = row.get("success");
        if !success {
            return Err(CheckError::Interrupted(version));
        }
        match known.get(&version) {
            None => {
                return Err(CheckError::Newer {
                    db: newest,
                    app: target,
                })
            }
            Some(expected) if *expected != checksum.as_slice() => {
                return Err(CheckError::Modified(version))
            }
            Some(_) => applied.push(version),
        }
    }

    let mut pending: Vec<i64> = known
        .keys()
        .copied()
        .filter(|v| !applied.contains(v))
        .collect();
    pending.sort_unstable();
    Ok(UpgradePlan {
        applied_max: applied.iter().copied().max().unwrap_or(0),
        target,
        pending,
    })
}

/// 把当前库完整复制到 `backups/vocabulary-before-v<from>-to-v<to>-<本地时间>.db`
pub async fn backup(pool: &SqlitePool, dir: &Path, from: i64, to: i64) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建备份目录：{e}"))?;
    let path = dir.join(format!(
        "{BACKUP_PREFIX}{from:03}-to-v{to:03}-{}.db",
        crate::time::local_file_stamp()
    ));
    crate::database::vacuum_into(pool, &path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path)
}

/// 只保留最新的 `keep` 份升级备份（按文件名排序，文件名里带时间）
pub fn prune_backups(dir: &Path, keep: usize) -> std::io::Result<()> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.starts_with(BACKUP_PREFIX) && name.ends_with(".db")
        })
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    for (_, path) in files.into_iter().skip(keep) {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn memory() -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap()
    }

    fn target() -> i64 {
        MIGRATOR.iter().map(|m| m.version).max().unwrap()
    }

    #[tokio::test]
    async fn new_database_plans_every_migration() {
        let pool = memory().await;
        let plan = check(&pool, &MIGRATOR).await.unwrap();
        assert_eq!(plan.applied_max, 0);
        assert_eq!(plan.target, target());
        assert_eq!(plan.pending.len(), MIGRATOR.iter().count());
    }

    #[tokio::test]
    async fn up_to_date_database_has_nothing_pending() {
        let pool = memory().await;
        MIGRATOR.run(&pool).await.unwrap();
        let plan = check(&pool, &MIGRATOR).await.unwrap();
        assert!(plan.pending.is_empty());
        assert_eq!(plan.applied_max, target());
    }

    #[tokio::test]
    async fn older_database_plans_only_the_new_migrations() {
        let pool = memory().await;
        MIGRATOR.run(&pool).await.unwrap();
        // 模拟上一个发行版：最后两个迁移还没执行
        let t = target();
        sqlx::query("DELETE FROM _sqlx_migrations WHERE version > ?")
            .bind(t - 2)
            .execute(&pool)
            .await
            .unwrap();
        let plan = check(&pool, &MIGRATOR).await.unwrap();
        assert_eq!(plan.applied_max, t - 2);
        assert_eq!(plan.pending, vec![t - 1, t]);
    }

    #[tokio::test]
    async fn database_from_a_newer_version_is_refused() {
        let pool = memory().await;
        MIGRATOR.run(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (9999, 'from the future', 1, x'00', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        match check(&pool, &MIGRATOR).await {
            Err(CheckError::Newer { db, app }) => {
                assert_eq!(db, 9999);
                assert_eq!(app, target());
            }
            other => panic!("应拒绝更新版本的数据库，实际 {other:?}"),
        }
    }

    #[tokio::test]
    async fn modified_migration_is_refused() {
        let pool = memory().await;
        MIGRATOR.run(&pool).await.unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET checksum = x'00' WHERE version = 5")
            .execute(&pool)
            .await
            .unwrap();
        assert!(matches!(
            check(&pool, &MIGRATOR).await,
            Err(CheckError::Modified(5))
        ));
    }

    #[tokio::test]
    async fn interrupted_migration_is_refused() {
        let pool = memory().await;
        MIGRATOR.run(&pool).await.unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET success = 0 WHERE version = ?")
            .bind(target())
            .execute(&pool)
            .await
            .unwrap();
        assert!(matches!(
            check(&pool, &MIGRATOR).await,
            Err(CheckError::Interrupted(_))
        ));
    }

    /// 端到端：上一个发行版的库（带用户数据）升级 —— 先备份、再迁移；升级后和备份里都有用户数据
    #[tokio::test]
    async fn upgrade_backs_up_then_migrates_and_keeps_user_data() {
        let tmp = std::env::temp_dir().join(format!("pindu-startup-{}", uuid::Uuid::new_v4()));
        let dirs = AppDirs {
            data: tmp.clone(),
            cache: tmp.join("cache"),
        };
        std::fs::create_dir_all(&tmp).unwrap();
        let logger = Logger::new(&tmp).unwrap();
        let t = target();

        // “上一个发行版”：只带到 t-1 的迁移，用户在里面建了单词本
        let previous = Migrator {
            migrations: std::borrow::Cow::Owned(
                MIGRATOR.iter().filter(|m| m.version < t).cloned().collect(),
            ),
            ..Migrator::DEFAULT
        };
        let pool = connect(&dirs.db_path()).await.unwrap();
        previous.run(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO word_books (title, description, created_at, updated_at)
             VALUES ('我的单词本', '', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool.close().await;

        // 新版本启动：备份 → 迁移
        let pool = open_database(&dirs, &logger).await.unwrap();
        let count = |pool: SqlitePool| async move {
            let n: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM word_books WHERE title = '我的单词本'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            pool.close().await;
            n
        };
        assert!(check(&pool, &MIGRATOR).await.unwrap().pending.is_empty());
        assert_eq!(count(pool).await, 1, "升级后用户数据应保留");

        let backups: Vec<PathBuf> = std::fs::read_dir(dirs.backups_dir())
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        assert_eq!(backups.len(), 1, "升级前应有一份备份");
        let name = backups[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(
            name.starts_with(&format!("vocabulary-before-v{:03}-to-v{t:03}-", t - 1)),
            "{name}"
        );
        let backup = connect(&backups[0]).await.unwrap();
        assert_eq!(check(&backup, &MIGRATOR).await.unwrap().pending, vec![t]);
        assert_eq!(count(backup).await, 1, "备份里应有升级前的数据");

        // 再次启动：已是最新，不再备份
        let pool = open_database(&dirs, &logger).await.unwrap();
        pool.close().await;
        // 只数 .db（上面打开备份时 SQLite 会在旁边生成 -wal / -shm）
        let db_files = std::fs::read_dir(dirs.backups_dir())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|x| x == "db")
            })
            .count();
        assert_eq!(db_files, 1);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn prune_keeps_the_newest_backups() {
        let dir = std::env::temp_dir().join(format!("pindu-prune-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..7 {
            let p = dir.join(format!("{BACKUP_PREFIX}00{i}-to-v00{}-x.db", i + 1));
            std::fs::write(&p, b"x").unwrap();
            let t = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000 + i);
            std::fs::File::options()
                .write(true)
                .open(&p)
                .unwrap()
                .set_modified(t)
                .unwrap();
        }
        std::fs::write(dir.join("my-own-copy.db"), b"x").unwrap();
        prune_backups(&dir, 5).unwrap();
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        left.sort();
        assert_eq!(left.len(), 6, "5 份最新备份 + 用户自己的文件：{left:?}");
        assert!(left.contains(&"my-own-copy.db".to_string()));
        assert!(!left
            .iter()
            .any(|n| n.contains("000-to") || n.contains("001-to")));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
