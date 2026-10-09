//! 短文的词索引 passage_words（迁移 060）：单词 ↔ 素材关联的唯一 SQL owner。
//! 写短文 / 改目标词时在同一事务里重建这篇的索引；旧数据（迁移前的短文）在第一次查询时补齐（`index_missing`）。

use crate::error::AppResult;
use crate::services::word_forms;
use crate::types::passage::{PassageSentence, PassageTargetWord};
use crate::types::Id;
use sqlx::{Row, SqliteConnection, SqlitePool};

/// 一处命中：短文、是否目标词、第一次出现的句子（-1 = 正文里没有）、是否视频切片
#[derive(Debug, Clone, PartialEq)]
pub struct WordHit {
    pub passage_id: Id,
    pub key: bool,
    pub sentence: i64,
    pub is_video: bool,
}

pub struct PassageWordRepository;

impl PassageWordRepository {
    /// 重建一篇短文的索引（在调用方事务内）
    pub async fn replace_conn(
        conn: &mut SqliteConnection,
        passage_id: Id,
        sentences: &[PassageSentence],
        targets: &[PassageTargetWord],
    ) -> AppResult<()> {
        sqlx::query("DELETE FROM passage_words WHERE passage_id = ?")
            .bind(passage_id)
            .execute(&mut *conn)
            .await?;
        let entries = word_forms::index_entries(sentences, targets);
        // 一条语句批量写入（json_each 展开），比逐行 INSERT 快得多
        let rows: Vec<(String, i64, bool)> = entries;
        sqlx::query(
            "INSERT OR IGNORE INTO passage_words (passage_id, word, sentence, key)
             SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]')
             FROM json_each(?)",
        )
        .bind(passage_id)
        .bind(serde_json::to_string(&rows).unwrap_or_else(|_| "[]".into()))
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 补齐还没有索引的短文（迁移前的旧数据）；返回补了几篇。没有缺的时候只是一次索引探测
    pub async fn index_missing(pool: &SqlitePool) -> AppResult<usize> {
        let rows = sqlx::query(
            "SELECT p.id, p.sentences, p.target_words FROM passages p
             WHERE NOT EXISTS (SELECT 1 FROM passage_words w WHERE w.passage_id = p.id)",
        )
        .fetch_all(pool)
        .await?;
        if rows.is_empty() {
            return Ok(0);
        }
        let mut tx = pool.begin().await?;
        for r in &rows {
            let sentences: Vec<PassageSentence> =
                serde_json::from_str(r.get::<&str, _>("sentences")).unwrap_or_default();
            let targets: Vec<PassageTargetWord> =
                serde_json::from_str(r.get::<&str, _>("target_words")).unwrap_or_default();
            Self::replace_conn(&mut tx, r.get("id"), &sentences, &targets).await?;
        }
        tx.commit().await?;
        Ok(rows.len())
    }

    /// 出现了这些词形之一的短文（每篇一条：是否目标词取最大、句子取最早出现的）
    pub async fn hits(pool: &SqlitePool, forms: &[String]) -> AppResult<Vec<WordHit>> {
        let rows = sqlx::query(
            "SELECT w.passage_id, MAX(w.key) AS key,
                    MIN(CASE WHEN w.sentence < 0 THEN 1000000 ELSE w.sentence END) AS sentence,
                    EXISTS (SELECT 1 FROM video_clips vc WHERE vc.passage_id = w.passage_id) AS is_video
             FROM passage_words w
             WHERE w.word IN (SELECT value FROM json_each(?))
             GROUP BY w.passage_id",
        )
        .bind(serde_json::to_string(forms).unwrap_or_else(|_| "[]".into()))
        .fetch_all(pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let sentence: i64 = r.get("sentence");
                WordHit {
                    passage_id: r.get("passage_id"),
                    key: r.get("key"),
                    sentence: if sentence >= 1_000_000 { -1 } else { sentence },
                    is_video: r.get("is_video"),
                }
            })
            .collect())
    }

    /// 每个词（id → 它的词形）出现过的短文与切片数：一次查询
    pub async fn counts(
        pool: &SqlitePool,
        forms: &[(Id, String)],
    ) -> AppResult<Vec<(Id, i64, i64)>> {
        let rows = sqlx::query(
            "WITH f AS (SELECT json_extract(value, '$[0]') AS wid, json_extract(value, '$[1]') AS form
                        FROM json_each(?)),
                  hit AS (SELECT DISTINCT f.wid, w.passage_id FROM f JOIN passage_words w ON w.word = f.form)
             SELECT hit.wid,
                    SUM(EXISTS (SELECT 1 FROM video_clips vc WHERE vc.passage_id = hit.passage_id)) AS clips,
                    COUNT(*) AS total
             FROM hit GROUP BY hit.wid",
        )
        .bind(serde_json::to_string(forms).unwrap_or_else(|_| "[]".into()))
        .fetch_all(pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let clips: i64 = r.get("clips");
                let total: i64 = r.get("total");
                (r.get("wid"), clips, total - clips)
            })
            .collect())
    }

    /// 同时含有这些词的短文（短语：先用索引缩小范围，再由调用方逐句核对）
    pub async fn having_all(pool: &SqlitePool, tokens: &[String]) -> AppResult<Vec<Id>> {
        if tokens.is_empty() {
            return Ok(Vec::new());
        }
        Ok(sqlx::query_scalar(
            "SELECT passage_id FROM passage_words WHERE word IN (SELECT value FROM json_each(?1))
             GROUP BY passage_id HAVING COUNT(DISTINCT word) = json_array_length(?1)",
        )
        .bind(serde_json::to_string(tokens).unwrap_or_else(|_| "[]".into()))
        .fetch_all(pool)
        .await?)
    }
}
