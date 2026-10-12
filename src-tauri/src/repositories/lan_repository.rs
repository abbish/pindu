//! 配对过的设备（lan_devices）的数据访问

use crate::error::AppResult;
use sqlx::SqlitePool;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LanDeviceRow {
    pub fingerprint: String,
    pub alias: String,
    pub os: String,
    pub app_version: String,
    pub last_address: Option<String>,
    pub last_port: Option<i64>,
    pub paired_at: String,
    pub last_seen_at: Option<String>,
}

pub struct LanRepository;

impl LanRepository {
    pub async fn list(pool: &SqlitePool) -> AppResult<Vec<LanDeviceRow>> {
        Ok(sqlx::query_as(
            "SELECT fingerprint, alias, os, app_version, last_address, last_port, paired_at, last_seen_at
             FROM lan_devices ORDER BY paired_at",
        )
        .fetch_all(pool)
        .await?)
    }

    pub async fn get(pool: &SqlitePool, fingerprint: &str) -> AppResult<Option<LanDeviceRow>> {
        Ok(sqlx::query_as(
            "SELECT fingerprint, alias, os, app_version, last_address, last_port, paired_at, last_seen_at
             FROM lan_devices WHERE fingerprint = ?",
        )
        .bind(fingerprint)
        .fetch_optional(pool)
        .await?)
    }

    /// 配对成功：新增，或更新已有的名字与地址（配对时间保留第一次的）
    pub async fn upsert_paired(pool: &SqlitePool, row: &LanDeviceRow) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO lan_devices
                (fingerprint, alias, os, app_version, last_address, last_port, paired_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(fingerprint) DO UPDATE SET
                alias = ?2, os = ?3, app_version = ?4, last_address = ?5, last_port = ?6, last_seen_at = ?8",
        )
        .bind(&row.fingerprint)
        .bind(&row.alias)
        .bind(&row.os)
        .bind(&row.app_version)
        .bind(&row.last_address)
        .bind(row.last_port)
        .bind(&row.paired_at)
        .bind(&row.last_seen_at)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// 在局域网里看到了已配对的设备：更新名字、地址与最后在线时间（没配对的不写）
    #[allow(clippy::too_many_arguments)]
    pub async fn touch_seen(
        pool: &SqlitePool,
        fingerprint: &str,
        alias: &str,
        os: &str,
        app_version: &str,
        address: &str,
        port: i64,
        seen_at: &str,
    ) -> AppResult<bool> {
        let result = sqlx::query(
            "UPDATE lan_devices
             SET alias = ?2, os = ?3, app_version = ?4, last_address = ?5, last_port = ?6, last_seen_at = ?7
             WHERE fingerprint = ?1",
        )
        .bind(fingerprint)
        .bind(alias)
        .bind(os)
        .bind(app_version)
        .bind(address)
        .bind(port)
        .bind(seen_at)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete(pool: &SqlitePool, fingerprint: &str) -> AppResult<bool> {
        let result = sqlx::query("DELETE FROM lan_devices WHERE fingerprint = ?")
            .bind(fingerprint)
            .execute(pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::memory_pool;

    fn row(fp: &str, alias: &str, at: &str) -> LanDeviceRow {
        LanDeviceRow {
            fingerprint: fp.into(),
            alias: alias.into(),
            os: "macos".into(),
            app_version: "0.3.1".into(),
            last_address: Some("192.168.1.8".into()),
            last_port: Some(53318),
            paired_at: at.into(),
            last_seen_at: Some(at.into()),
        }
    }

    #[tokio::test]
    async fn pair_touch_and_unpair() {
        let pool = memory_pool().await;
        let first = crate::time::now_utc();
        LanRepository::upsert_paired(&pool, &row("f1", "书房", &first))
            .await
            .unwrap();
        // 再次配对：更新名字，配对时间保留第一次的
        let later = crate::time::now_utc();
        LanRepository::upsert_paired(&pool, &row("f1", "书房电脑", &later))
            .await
            .unwrap();
        let got = LanRepository::get(&pool, "f1").await.unwrap().unwrap();
        assert_eq!(got.alias, "书房电脑");
        assert_eq!(got.paired_at, first);

        assert!(LanRepository::touch_seen(
            &pool,
            "f1",
            "新名字",
            "macos",
            "0.4.0",
            "10.0.0.2",
            50000,
            &later
        )
        .await
        .unwrap());
        assert!(
            !LanRepository::touch_seen(&pool, "nope", "x", "", "", "10.0.0.3", 1, &later)
                .await
                .unwrap()
        );
        let got = LanRepository::get(&pool, "f1").await.unwrap().unwrap();
        assert_eq!(got.alias, "新名字");
        assert_eq!(got.last_port, Some(50000));

        assert_eq!(LanRepository::list(&pool).await.unwrap().len(), 1);
        assert!(LanRepository::delete(&pool, "f1").await.unwrap());
        assert!(!LanRepository::delete(&pool, "f1").await.unwrap());
        crate::time::assert_instants_canonical(&pool).await;
    }
}
