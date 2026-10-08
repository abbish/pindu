//! 时间与时区的唯一后端入口。
//!
//! 规范：`.claude/skills/deliver-contract-and-data/references/time-and-timezone.md`
//! - 时刻（`*_at` / `*_time`）：UTC 定长 `YYYY-MM-DDTHH:MM:SS.sssZ`，由 [`now_utc`] / [`SQL_NOW_UTC`] 产生
//! - 日历日期（`*_date`）：`YYYY-MM-DD`，本地日历上的一天，不做时区换算
//! - “今天”：[`local_today`]，一次请求只取一次并向下传参
//!
//! 本模块之外不直接调用 `Utc::now()` / `Local::now()` / `datetime('now')`（`scripts/check-time.py` 棘轮）。

// T2 期间各处逐步改用本模块；全部接入后删除此 allow

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, SecondsFormat, Utc};

/// SQL 中“当前时刻”的规范表达式，与 [`now_utc`] 逐字节同格式
pub const SQL_NOW_UTC: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/// 日历日期格式
pub const DATE_FORMAT: &str = "%Y-%m-%d";

/// 当前时刻（UTC 规范格式，如 `2026-10-07T02:20:15.123Z`）
pub fn now_utc() -> String {
    format_instant(Utc::now())
}

/// 把 UTC 时刻格式化为规范字符串
pub fn format_instant(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// 本地时间戳，用于文件名（如 `20261008-093341`）
pub fn local_file_stamp() -> String {
    Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// 今天的本地日期（本机时区；桌面应用中与前端 WebView 一致）
pub fn local_today() -> NaiveDate {
    Local::now().date_naive()
}

/// 日历日期 → `YYYY-MM-DD`
pub fn format_date(date: NaiveDate) -> String {
    date.format(DATE_FORMAT).to_string()
}

/// 解析日历日期 `YYYY-MM-DD`（只取前 10 位以兼容带时间的旧值）
pub fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.get(..10)?, DATE_FORMAT).ok()
}

/// 解析时刻：规范格式 / RFC3339（带偏移）/ SQLite 默认 `YYYY-MM-DD HH:MM:SS`（无时区标记，按 UTC）
pub fn parse_instant(value: &str) -> Option<DateTime<Utc>> {
    let s = value.trim();
    if let Ok(at) = DateTime::parse_from_rfc3339(s) {
        return Some(at.with_timezone(&Utc));
    }
    [
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M",
    ]
    .iter()
    .find_map(|f| NaiveDateTime::parse_from_str(s, f).ok())
    .map(|naive| naive.and_utc())
}

/// 时刻所在的本地日期（按本机时区归日；不要截取 UTC 字符串的前 10 位）
pub fn local_date_of(value: &str) -> Option<NaiveDate> {
    parse_instant(value).map(|at| at.with_timezone(&Local).date_naive())
}

/// 测试用：所有时刻列（清单的唯一 owner 是迁移 047）都必须是规范格式。
/// 新增写入路径的测试在写完后调用它，防止旧格式（列 DEFAULT / to_rfc3339）回流。
#[cfg(test)]
pub(crate) async fn assert_instants_canonical(pool: &sqlx::SqlitePool) {
    let migration = include_str!("../migrations/047_normalize_instants_to_utc_iso.sql");
    let columns: Vec<(&str, &str)> = migration
        .lines()
        .filter_map(|l| l.strip_prefix("UPDATE "))
        .filter_map(|l| {
            let (table, rest) = l.split_once(" SET ")?;
            let (column, rest) = rest.split_once(" = ")?;
            rest.starts_with("strftime").then_some((table, column))
        })
        .collect();
    assert!(columns.len() > 40, "未能从 047 解析出时刻列清单");
    // 之后的迁移删掉的表（如 058 的 word_explanations）跳过
    let tables: Vec<String> =
        sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table'")
            .fetch_all(pool)
            .await
            .unwrap();
    let mut bad = Vec::new();
    for (table, column) in columns {
        if !tables.iter().any(|t| t == table) {
            continue;
        }
        let rows: Vec<String> = sqlx::query_scalar(&format!(
            "SELECT {column} FROM {table} WHERE {column} IS NOT NULL"
        ))
        .fetch_all(pool)
        .await
        .unwrap_or_else(|e| panic!("{table}.{column}: {e}"));
        for v in rows {
            let ok = v.len() == 24
                && v.ends_with('Z')
                && v.as_bytes()[10] == b'T'
                && v.as_bytes()[19] == b'.'
                && parse_instant(&v).is_some();
            if !ok {
                bad.push(format!("{table}.{column} = {v}"));
            }
        }
    }
    assert!(bad.is_empty(), "非规范时刻：\n{}", bad.join("\n"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_utc_is_fixed_width_millis_z() {
        let now = now_utc();
        assert_eq!(now.len(), 24, "{now}");
        assert!(now.ends_with('Z') && now.as_bytes()[10] == b'T', "{now}");
        assert!(parse_instant(&now).is_some());
    }

    #[test]
    fn legacy_formats_parse_to_the_same_instant() {
        let expected = "2026-10-07T02:20:15.000Z";
        for input in [
            "2026-10-07T02:20:15.000Z",
            "2026-10-07 02:20:15",
            "2026-10-07T02:20:15",
            "2026-10-07T02:20:15.000000000+00:00",
            "2026-10-07T10:20:15+08:00",
        ] {
            let at = parse_instant(input).unwrap_or_else(|| panic!("无法解析 {input}"));
            assert_eq!(format_instant(at), expected, "{input}");
        }
        assert!(parse_instant("不是时间").is_none());
    }

    #[test]
    fn dates_round_trip_without_timezone() {
        let d = parse_date("2026-10-07").unwrap();
        assert_eq!(format_date(d), "2026-10-07");
        assert_eq!(parse_date("2026-10-07 23:59:59"), Some(d));
        assert!(parse_date("2026-1").is_none());
    }

    #[tokio::test]
    async fn sql_now_matches_rust_format() {
        let pool = crate::test_support::memory_pool().await;
        let sql: String = sqlx::query_scalar(&format!("SELECT {}", SQL_NOW_UTC))
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(sql.len(), now_utc().len(), "{sql}");
        assert!(sql.ends_with('Z') && parse_instant(&sql).is_some(), "{sql}");
        // SQLite 对规范格式的日期函数照常可用
        let day: String =
            sqlx::query_scalar("SELECT DATE('2026-10-06T17:30:00.000Z', 'localtime')")
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(
            Some(day.as_str()),
            local_date_of("2026-10-06T17:30:00.000Z")
                .map(format_date)
                .as_deref()
        );
    }

    #[tokio::test]
    async fn writes_produce_canonical_instants() {
        use crate::repositories::{
            ai_model_repository::AIModelRepository, tts_repository::TtsRepository,
        };
        use crate::types::ai_model::{AIModelUpdate, AIProviderUpdate, NewAIModel, NewAIProvider};

        let pool = crate::test_support::memory_pool().await;
        // 迁移 047 之后，种子数据已是规范格式
        assert_instants_canonical(&pool).await;

        let ai = AIModelRepository::new(pool.clone(), crate::test_support::test_logger());
        let provider_id = ai
            .insert_provider(&NewAIProvider {
                name: "t".into(),
                display_name: "T".into(),
                base_url: "https://example.com".into(),
                api_key: "sk-test".into(),
                description: None,
                pi_provider: None,
                api: "openai-completions".into(),
            })
            .await
            .unwrap();
        ai.update_provider(
            provider_id,
            &AIProviderUpdate {
                display_name: Some("T2".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let model_id = ai
            .insert_model(&NewAIModel {
                provider_id,
                name: "m".into(),
                display_name: "M".into(),
                model_id: "m-1".into(),
                description: None,
                generation: Default::default(),
            })
            .await
            .unwrap();
        ai.update_model(
            model_id,
            &AIModelUpdate {
                display_name: Some("M2".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let tts = TtsRepository::new(pool.clone());
        tts.upsert_cache_entry("h", "t", "v", "m", "/tmp/x.mp3", 1)
            .await
            .unwrap();
        tts.touch_cache_entry("h").await.unwrap();
        tts.update_volcengine_config(&crate::types::tts::UpdateTtsConfigRequest {
            default_voice_id: Some("v".into()),
            ..Default::default()
        })
        .await
        .unwrap();

        assert_instants_canonical(&pool).await;
    }
}
