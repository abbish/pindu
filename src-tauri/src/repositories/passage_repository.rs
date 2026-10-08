//! 短文库的数据访问：passages / passage_sources / passage_question_sets / passage_questions / passage_attempts，
//! 以及生成短文时的候选词（单词本、学习计划的已学 / 难词 / 到期复习）

use crate::error::{AppError, AppResult};
use crate::services::passage_rules::{self, GeneratedPassage, GeneratedQuestionSet};
use crate::types::common::Id;
use crate::types::passage::{
    ClozeResult, Passage, PassageAttempt, PassageAttemptBrief, PassageModeStatistics,
    PassageQuestion, PassageSentence, PassageSource, PassageStatistics, PassageSummary,
    PassageTargetWord, QuestionResult, QuestionSet, QuestionSetSpec, QuestionSetSummary,
};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqliteConnection, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;

/// 作答记录里 answers 列的 JSON 形状
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAnswers {
    #[serde(default)]
    pub cloze_results: Vec<ClozeResult>,
    #[serde(default)]
    pub question_results: Vec<QuestionResult>,
    #[serde(default)]
    pub grading_error: Option<String>,
}

/// 新短文的元数据
pub struct NewPassage<'a> {
    /// generated / imported
    pub origin: &'a str,
    /// 导入时的文件名或「粘贴的文本」
    pub source_label: Option<&'a str>,
    pub scene: Option<&'a str>,
    pub level: &'a str,
    pub sources: &'a [PassageSource],
    pub model_name: Option<&'a str>,
    pub prompt_fingerprint: Option<&'a str>,
}

/// 新题组的元数据
pub struct NewQuestionSet<'a> {
    pub passage_id: Id,
    pub name: &'a str,
    pub spec: &'a QuestionSetSpec,
    pub model_name: Option<&'a str>,
    pub prompt_fingerprint: Option<&'a str>,
}

/// 作答完成时写入的结果
pub struct AttemptOutcome<'a> {
    pub answers: &'a StoredAnswers,
    pub objective_correct: i64,
    pub objective_total: i64,
    pub open_score: Option<i64>,
    pub open_total: Option<i64>,
    pub active_time: i64,
}

/// 候选词的原始数据（来源名、计划里的记忆情况）
#[derive(Debug, Clone, PartialEq)]
pub struct CandidateRow {
    pub word_id: Id,
    pub word: String,
    pub meaning: String,
    pub source: String,
    pub book_id: Option<Id>,
    /// 计划里的记忆等级（单词本来源为 None）
    pub srs_box: Option<i64>,
    pub srs_due: Option<String>,
    /// 答错的次数（首次作答与当轮小测；计划来源只算这个计划，单词本来源算所有计划）
    pub wrong: i64,
    /// 学习情况用的记忆等级：计划来源为这个计划里的，单词本来源为各计划里最高的（没进过计划为 0）
    pub level: i64,
    /// 计划里第一次学这个词的时刻
    pub first_learned: Option<String>,
}

fn json<T: Serialize>(value: &T) -> AppResult<String> {
    serde_json::to_string(value).map_err(|e| AppError::InternalError(e.to_string()))
}

fn parse<T: for<'de> Deserialize<'de> + Default>(raw: Option<String>) -> T {
    raw.and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn parse_spec(raw: String) -> QuestionSetSpec {
    serde_json::from_str(&raw).unwrap_or(QuestionSetSpec {
        cloze: 0,
        choice: 0,
        true_false: 0,
        open: 0,
        difficulty: "standard".into(),
    })
}

/// 最近一次完成作答的列（别名前缀 la_）
fn brief_from_row(r: &SqliteRow) -> Option<PassageAttemptBrief> {
    let id: Option<Id> = r.get("la_id");
    id.map(|id| PassageAttemptBrief {
        id,
        mode: r.get("la_mode"),
        objective_correct: r.get("la_correct"),
        objective_total: r.get("la_total"),
        open_score: r.get("la_open"),
        open_total: r.get("la_open_total"),
        completed_at: r.get("la_completed_at"),
    })
}

const SOURCE_SELECT: &str = "SELECT s.passage_id, s.kind, s.ref_id, s.name, s.detail,
        CASE s.kind
            WHEN 'book' THEN EXISTS(SELECT 1 FROM word_books b WHERE b.id = s.ref_id AND b.deleted_at IS NULL)
            ELSE EXISTS(SELECT 1 FROM study_plans sp WHERE sp.id = s.ref_id)
        END AS present
     FROM passage_sources s";

pub struct PassageRepository {
    pool: Arc<SqlitePool>,
}

impl PassageRepository {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    // ==================== 短文 ====================

    /// 写入短文与来源（同一事务由调用方提供）
    pub async fn insert_passage_conn(
        conn: &mut SqliteConnection,
        meta: &NewPassage<'_>,
        passage: &GeneratedPassage,
    ) -> AppResult<Id> {
        let now = crate::time::now_utc();
        let id = sqlx::query(
            "INSERT INTO passages (title, sentences, target_words, scene, level, word_count,
                 model_name, prompt_fingerprint, origin, source_label, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&passage.title)
        .bind(json(&passage.sentences)?)
        .bind(json(&passage.target_words)?)
        .bind(meta.scene)
        .bind(meta.level)
        .bind(passage.word_count as i64)
        .bind(meta.model_name)
        .bind(meta.prompt_fingerprint)
        .bind(meta.origin)
        .bind(meta.source_label)
        .bind(&now)
        .bind(&now)
        .execute(&mut *conn)
        .await?
        .last_insert_rowid();
        for source in meta.sources {
            sqlx::query(
                "INSERT INTO passage_sources (passage_id, kind, ref_id, name, detail)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(&source.kind)
            .bind(source.ref_id)
            .bind(&source.name)
            .bind(&source.detail)
            .execute(&mut *conn)
            .await?;
        }
        Ok(id)
    }

    /// 多篇短文的来源（一次查询），按短文分组
    async fn sources_of(&self, ids: &[Id]) -> AppResult<HashMap<Id, Vec<PassageSource>>> {
        let rows = sqlx::query(&format!(
            "{SOURCE_SELECT} WHERE s.passage_id IN (SELECT value FROM json_each(?)) ORDER BY s.id"
        ))
        .bind(json(&ids)?)
        .fetch_all(self.pool.as_ref())
        .await?;
        let mut map: HashMap<Id, Vec<PassageSource>> = HashMap::new();
        for r in rows {
            map.entry(r.get("passage_id"))
                .or_default()
                .push(PassageSource {
                    kind: r.get("kind"),
                    ref_id: r.get("ref_id"),
                    name: r.get("name"),
                    detail: r.get("detail"),
                    exists: r.get::<i64, _>("present") != 0,
                });
        }
        Ok(map)
    }

    pub async fn find(&self, id: Id) -> AppResult<Option<Passage>> {
        let Some(r) = sqlx::query(
            "SELECT id, title, sentences, target_words, scene, level, word_count, model_name, created_at,
                    origin, source_label
             FROM passages WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        else {
            return Ok(None);
        };
        Ok(Some(Passage {
            id,
            title: r.get("title"),
            sentences: parse(r.get("sentences")),
            target_words: parse(r.get("target_words")),
            scene: r.get("scene"),
            sources: self
                .sources_of(&[id])
                .await?
                .remove(&id)
                .unwrap_or_default(),
            level: r.get("level"),
            word_count: r.get("word_count"),
            model_name: r.get("model_name"),
            created_at: r.get("created_at"),
            question_sets: self.set_summaries(id).await?,
            origin: r.get("origin"),
            source_label: r.get("source_label"),
        }))
    }

    /// 只取正文（出题、评分用）
    pub async fn sentences(&self, id: Id) -> AppResult<Option<Vec<PassageSentence>>> {
        let raw: Option<String> = sqlx::query_scalar("SELECT sentences FROM passages WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await?;
        Ok(raw.map(|r| parse(Some(r))))
    }

    /// 列表（可按来源单词本 / 计划筛选，最新在前），附题组数、完成次数与最近一次成绩
    pub async fn list(
        &self,
        book_id: Option<Id>,
        plan_id: Option<Id>,
        origin: Option<&str>,
    ) -> AppResult<Vec<PassageSummary>> {
        let rows = sqlx::query(
            "SELECT p.id, p.title, p.level, p.word_count, p.target_words, p.created_at, p.origin, p.source_label,
                    (SELECT COUNT(*) FROM passage_question_sets qs WHERE qs.passage_id = p.id) AS set_count,
                    (SELECT COUNT(*) FROM passage_attempts a
                     WHERE a.passage_id = p.id AND a.status = 'completed') AS completed_attempts,
                    la.id AS la_id, la.mode AS la_mode, la.objective_correct AS la_correct,
                    la.objective_total AS la_total, la.open_score AS la_open, la.open_total AS la_open_total,
                    la.completed_at AS la_completed_at
             FROM passages p
             LEFT JOIN passage_attempts la ON la.id = (
                 SELECT a.id FROM passage_attempts a
                 WHERE a.passage_id = p.id AND a.status = 'completed'
                 ORDER BY a.completed_at DESC, a.id DESC LIMIT 1)
             WHERE (?1 IS NULL OR EXISTS (SELECT 1 FROM passage_sources s
                        WHERE s.passage_id = p.id AND s.kind = 'book' AND s.ref_id = ?1))
               AND (?2 IS NULL OR EXISTS (SELECT 1 FROM passage_sources s
                        WHERE s.passage_id = p.id AND s.kind = 'plan' AND s.ref_id = ?2))
               AND (?3 IS NULL OR p.origin = ?3)
             ORDER BY p.created_at DESC, p.id DESC",
        )
        .bind(book_id)
        .bind(plan_id)
        .bind(origin)
        .fetch_all(self.pool.as_ref())
        .await?;
        let ids: Vec<Id> = rows.iter().map(|r| r.get("id")).collect();
        let mut sources = self.sources_of(&ids).await?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let id: Id = r.get("id");
                PassageSummary {
                    id,
                    title: r.get("title"),
                    level: r.get("level"),
                    word_count: r.get("word_count"),
                    target_words: parse(r.get("target_words")),
                    sources: sources.remove(&id).unwrap_or_default(),
                    created_at: r.get("created_at"),
                    origin: r.get("origin"),
                    source_label: r.get("source_label"),
                    question_sets: r.get("set_count"),
                    completed_attempts: r.get("completed_attempts"),
                    last_attempt: brief_from_row(&r),
                }
            })
            .collect())
    }

    pub async fn delete(&self, id: Id) -> AppResult<bool> {
        Ok(sqlx::query("DELETE FROM passages WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?
            .rows_affected()
            > 0)
    }

    // ==================== 题组 ====================

    /// 写入题组与题目（同一事务由调用方提供）
    pub async fn insert_set_conn(
        conn: &mut SqliteConnection,
        meta: &NewQuestionSet<'_>,
        set: &GeneratedQuestionSet,
    ) -> AppResult<Id> {
        let id = sqlx::query(
            "INSERT INTO passage_question_sets (passage_id, name, spec, cloze_distractors, model_name,
                 prompt_fingerprint, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(meta.passage_id)
        .bind(meta.name)
        .bind(json(meta.spec)?)
        .bind(json(&set.cloze_distractors)?)
        .bind(meta.model_name)
        .bind(meta.prompt_fingerprint)
        .bind(crate::time::now_utc())
        .execute(&mut *conn)
        .await?
        .last_insert_rowid();
        for (i, q) in set.questions.iter().enumerate() {
            sqlx::query(
                "INSERT INTO passage_questions (set_id, sort_order, kind, stem, options, answer,
                     explanation, reference_answer, rubric, sentence_index)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(i as i64)
            .bind(&q.kind)
            .bind(&q.stem)
            .bind(
                (!q.options.is_empty())
                    .then(|| json(&q.options))
                    .transpose()?,
            )
            .bind(&q.answer)
            .bind(&q.explanation)
            .bind(&q.reference_answer)
            .bind(
                (!q.rubric.is_empty())
                    .then(|| json(&q.rubric))
                    .transpose()?,
            )
            .bind(q.sentence_index)
            .execute(&mut *conn)
            .await?;
        }
        Ok(id)
    }

    /// 某篇短文的题组数（给新题组起默认名）
    pub async fn set_count(&self, passage_id: Id) -> AppResult<i64> {
        Ok(
            sqlx::query_scalar("SELECT COUNT(*) FROM passage_question_sets WHERE passage_id = ?")
                .bind(passage_id)
                .fetch_one(self.pool.as_ref())
                .await?,
        )
    }

    async fn set_summaries(&self, passage_id: Id) -> AppResult<Vec<QuestionSetSummary>> {
        let rows = sqlx::query(
            "SELECT qs.id, qs.passage_id, qs.name, qs.spec, qs.created_at,
                    (SELECT COUNT(*) FROM passage_attempts a
                     WHERE a.set_id = qs.id AND a.status = 'completed') AS completed_attempts,
                    la.id AS la_id, la.mode AS la_mode, la.objective_correct AS la_correct,
                    la.objective_total AS la_total, la.open_score AS la_open, la.open_total AS la_open_total,
                    la.completed_at AS la_completed_at
             FROM passage_question_sets qs
             LEFT JOIN passage_attempts la ON la.id = (
                 SELECT a.id FROM passage_attempts a
                 WHERE a.set_id = qs.id AND a.status = 'completed'
                 ORDER BY a.completed_at DESC, a.id DESC LIMIT 1)
             WHERE qs.passage_id = ?
             ORDER BY qs.created_at DESC, qs.id DESC",
        )
        .bind(passage_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows
            .iter()
            .map(|r| QuestionSetSummary {
                id: r.get("id"),
                passage_id: r.get("passage_id"),
                name: r.get("name"),
                spec: parse_spec(r.get("spec")),
                created_at: r.get("created_at"),
                completed_attempts: r.get("completed_attempts"),
                last_attempt: brief_from_row(r),
            })
            .collect())
    }

    /// 全部题组摘要，按短文分组（每篇内新到旧）
    pub async fn all_set_summaries(&self) -> AppResult<HashMap<Id, Vec<QuestionSetSummary>>> {
        let rows = sqlx::query(
            "SELECT qs.id, qs.passage_id, qs.name, qs.spec, qs.created_at,
                    (SELECT COUNT(*) FROM passage_attempts a
                     WHERE a.set_id = qs.id AND a.status = 'completed') AS completed_attempts,
                    la.id AS la_id, la.mode AS la_mode, la.objective_correct AS la_correct,
                    la.objective_total AS la_total, la.open_score AS la_open, la.open_total AS la_open_total,
                    la.completed_at AS la_completed_at
             FROM passage_question_sets qs
             LEFT JOIN passage_attempts la ON la.id = (
                 SELECT a.id FROM passage_attempts a
                 WHERE a.set_id = qs.id AND a.status = 'completed'
                 ORDER BY a.completed_at DESC, a.id DESC LIMIT 1)
             ORDER BY qs.passage_id, qs.created_at DESC, qs.id DESC",
        )
        .fetch_all(self.pool.as_ref())
        .await?;
        let mut out: HashMap<Id, Vec<QuestionSetSummary>> = HashMap::new();
        for r in &rows {
            let summary = QuestionSetSummary {
                id: r.get("id"),
                passage_id: r.get("passage_id"),
                name: r.get("name"),
                spec: parse_spec(r.get("spec")),
                created_at: r.get("created_at"),
                completed_attempts: r.get("completed_attempts"),
                last_attempt: brief_from_row(r),
            };
            out.entry(summary.passage_id).or_default().push(summary);
        }
        Ok(out)
    }

    pub async fn find_set(&self, id: Id) -> AppResult<Option<QuestionSet>> {
        let Some(r) = sqlx::query(
            "SELECT id, passage_id, name, spec, cloze_distractors, model_name, created_at
             FROM passage_question_sets WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        else {
            return Ok(None);
        };
        let rows = sqlx::query(
            "SELECT id, kind, stem, options, answer, explanation, reference_answer, rubric, sentence_index
             FROM passage_questions WHERE set_id = ? ORDER BY sort_order",
        )
        .bind(id)
        .fetch_all(self.pool.as_ref())
        .await?;
        let questions: Vec<PassageQuestion> = rows
            .into_iter()
            .map(|r| PassageQuestion {
                id: r.get("id"),
                kind: r.get("kind"),
                stem: r.get("stem"),
                options: parse(r.get("options")),
                answer: r.get("answer"),
                explanation: r.get("explanation"),
                reference_answer: r.get("reference_answer"),
                rubric: parse(r.get("rubric")),
                sentence_index: r.get("sentence_index"),
            })
            .collect();
        let answers: Vec<String> = questions
            .iter()
            .filter(|q| q.kind == "cloze")
            .filter_map(|q| q.answer.clone())
            .collect();
        let distractors: Vec<String> = parse(r.get("cloze_distractors"));
        Ok(Some(QuestionSet {
            id,
            passage_id: r.get("passage_id"),
            name: r.get("name"),
            spec: parse_spec(r.get("spec")),
            model_name: r.get("model_name"),
            created_at: r.get("created_at"),
            cloze_bank: passage_rules::cloze_bank(&answers, &distractors, id),
            questions,
        }))
    }

    pub async fn delete_set(&self, id: Id) -> AppResult<bool> {
        Ok(
            sqlx::query("DELETE FROM passage_question_sets WHERE id = ?")
                .bind(id)
                .execute(self.pool.as_ref())
                .await?
                .rows_affected()
                > 0,
        )
    }

    // ==================== 候选词 ====================

    /// 单词本名称（已删除的单词本为 None）
    pub async fn book_title(&self, book_id: Id) -> AppResult<Option<String>> {
        Ok(
            sqlx::query_scalar("SELECT title FROM word_books WHERE id = ? AND deleted_at IS NULL")
                .bind(book_id)
                .fetch_optional(self.pool.as_ref())
                .await?,
        )
    }

    pub async fn plan_name(&self, plan_id: Id) -> AppResult<Option<String>> {
        Ok(
            sqlx::query_scalar("SELECT name FROM study_plans WHERE id = ?")
                .bind(plan_id)
                .fetch_optional(self.pool.as_ref())
                .await?,
        )
    }

    /// 按拼写在没删除的单词本里找单词（忽略大小写；同名多本时取 id 最小的）：小写拼写 → 单词 id
    pub async fn word_ids_by_text(&self, words: &[String]) -> AppResult<HashMap<String, Id>> {
        let rows: Vec<(String, Id)> = sqlx::query_as(
            "SELECT LOWER(w.word), MIN(w.id) FROM words w
             JOIN word_books wb ON wb.id = w.word_book_id AND wb.deleted_at IS NULL
             WHERE LOWER(w.word) IN (SELECT LOWER(value) FROM json_each(?))
             GROUP BY LOWER(w.word)",
        )
        .bind(json(&words)?)
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows.into_iter().collect())
    }

    /// 改写短文的目标词（生词加进单词本后补上 wordId）
    pub async fn update_target_words(
        &self,
        passage_id: Id,
        target_words: &[PassageTargetWord],
    ) -> AppResult<()> {
        sqlx::query("UPDATE passages SET target_words = ?, updated_at = ? WHERE id = ?")
            .bind(json(&target_words)?)
            .bind(crate::time::now_utc())
            .bind(passage_id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    /// 单词本里的词（最近加入在前），附它在各计划里最高的记忆等级与答错次数（判断学习情况）
    pub async fn book_candidates(&self, book_id: Id) -> AppResult<Vec<CandidateRow>> {
        let rows = sqlx::query(
            "SELECT w.id, w.word, w.meaning, wb.title,
                    COALESCE(lv.level, 0) AS level, COALESCE(er.wrong, 0) AS wrong
             FROM words w JOIN word_books wb ON wb.id = w.word_book_id
             LEFT JOIN (SELECT word_id, MAX(srs_box) AS level FROM study_plan_words GROUP BY word_id) lv
               ON lv.word_id = w.id
             LEFT JOIN (SELECT word_id, COUNT(*) AS wrong FROM word_practice_records
                        WHERE kind IN ('learn', 'review') AND is_correct = 0 GROUP BY word_id) er
               ON er.word_id = w.id
             WHERE w.word_book_id = ? AND wb.deleted_at IS NULL
             ORDER BY w.created_at DESC, w.id DESC",
        )
        .bind(book_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| CandidateRow {
                word_id: r.get("id"),
                word: r.get("word"),
                meaning: r.get("meaning"),
                source: r.get("title"),
                book_id: Some(book_id),
                srs_box: None,
                srs_due: None,
                wrong: r.get("wrong"),
                level: r.get("level"),
                first_learned: None,
            })
            .collect())
    }

    /// 计划里已学的词（记忆等级 ≥ 1），附记忆等级、复习日期、答错次数与第一次学的时刻；错得多、等级低的在前
    pub async fn plan_candidates(&self, plan_id: Id) -> AppResult<Vec<CandidateRow>> {
        let rows = sqlx::query(
            "SELECT w.id, w.word, w.meaning, w.word_book_id, sp.name, spw.srs_box, spw.srs_due,
                    (SELECT COUNT(*) FROM word_practice_records r
                     JOIN practice_sessions ps ON ps.id = r.session_id
                     WHERE ps.plan_id = spw.plan_id AND r.word_id = spw.word_id
                       AND r.kind IN ('learn', 'review') AND r.is_correct = 0) AS wrong,
                    (SELECT MIN(r.created_at) FROM word_practice_records r
                     JOIN practice_sessions ps ON ps.id = r.session_id
                     WHERE ps.plan_id = spw.plan_id AND r.word_id = spw.word_id AND r.kind = 'learn') AS first_learned
             FROM study_plan_words spw
             JOIN words w ON w.id = spw.word_id
             JOIN study_plans sp ON sp.id = spw.plan_id
             WHERE spw.plan_id = ? AND spw.srs_box >= 1
             ORDER BY wrong DESC, spw.srs_box ASC, w.id",
        )
        .bind(plan_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| CandidateRow {
                word_id: r.get("id"),
                word: r.get("word"),
                meaning: r.get("meaning"),
                source: r.get("name"),
                book_id: r.get("word_book_id"),
                srs_box: Some(r.get("srs_box")),
                srs_due: r.get("srs_due"),
                wrong: r.get("wrong"),
                level: r.get("srs_box"),
                first_learned: r.get("first_learned"),
            })
            .collect())
    }

    /// 按 id 取词（单词、所在单词本）
    pub async fn words_by_ids(&self, ids: &[Id]) -> AppResult<Vec<(Id, String, Option<Id>)>> {
        Ok(sqlx::query_as(
            "SELECT id, word, word_book_id FROM words WHERE id IN (SELECT value FROM json_each(?))",
        )
        .bind(json(&ids)?)
        .fetch_all(self.pool.as_ref())
        .await?)
    }

    /// 每个词已在几篇短文里用过
    pub async fn word_usage(&self) -> AppResult<HashMap<Id, i64>> {
        let rows: Vec<String> = sqlx::query_scalar("SELECT target_words FROM passages")
            .fetch_all(self.pool.as_ref())
            .await?;
        let mut usage = HashMap::new();
        for raw in rows {
            let words: Vec<PassageTargetWord> = parse(Some(raw));
            for id in words.into_iter().filter_map(|w| w.word_id) {
                *usage.entry(id).or_insert(0) += 1;
            }
        }
        Ok(usage)
    }

    // ==================== 作答 ====================

    fn attempt_from_row(r: &SqliteRow) -> PassageAttempt {
        let stored: StoredAnswers = parse(r.get("answers"));
        PassageAttempt {
            id: r.get("id"),
            set_id: r.get("set_id"),
            passage_id: r.get("passage_id"),
            plan_id: r.get("plan_id"),
            schedule_id: r.get("schedule_id"),
            mode: r.get("mode"),
            status: r.get("status"),
            cloze_results: stored.cloze_results,
            question_results: stored.question_results,
            objective_correct: r.get("objective_correct"),
            objective_total: r.get("objective_total"),
            open_score: r.get("open_score"),
            open_total: r.get("open_total"),
            grading_error: stored.grading_error,
            active_time: r.get("active_time"),
            started_at: r.get("started_at"),
            completed_at: r.get("completed_at"),
        }
    }

    const ATTEMPT_COLUMNS: &'static str = "id, set_id, passage_id, plan_id, schedule_id, mode, status, answers,
         objective_correct, objective_total, open_score, open_total, active_time, started_at, completed_at";

    pub async fn find_attempt(&self, id: Id) -> AppResult<Option<PassageAttempt>> {
        let row = sqlx::query(&format!(
            "SELECT {} FROM passage_attempts WHERE id = ?",
            Self::ATTEMPT_COLUMNS
        ))
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;
        Ok(row.as_ref().map(Self::attempt_from_row))
    }

    /// 某套题、某种模式下未完成的作答（`plan_id` 为空：自由练习；否则为这个计划里的）
    pub async fn find_open_attempt(
        &self,
        set_id: Id,
        mode: &str,
        plan_id: Option<Id>,
    ) -> AppResult<Option<PassageAttempt>> {
        let row = sqlx::query(&format!(
            "SELECT {} FROM passage_attempts
             WHERE set_id = ? AND mode = ? AND status = 'in_progress' AND plan_id IS ?
             ORDER BY id DESC LIMIT 1",
            Self::ATTEMPT_COLUMNS
        ))
        .bind(set_id)
        .bind(mode)
        .bind(plan_id)
        .fetch_optional(self.pool.as_ref())
        .await?;
        Ok(row.as_ref().map(Self::attempt_from_row))
    }

    pub async fn create_attempt(
        &self,
        set_id: Id,
        passage_id: Id,
        mode: &str,
        plan_id: Option<Id>,
    ) -> AppResult<Id> {
        Ok(sqlx::query(
            "INSERT INTO passage_attempts (set_id, passage_id, plan_id, mode, status, started_at)
             VALUES (?, ?, ?, ?, 'in_progress', ?)",
        )
        .bind(set_id)
        .bind(passage_id)
        .bind(plan_id)
        .bind(mode)
        .bind(crate::time::now_utc())
        .execute(self.pool.as_ref())
        .await?
        .last_insert_rowid())
    }

    /// 写入判分结果并标记完成（只更新进行中的作答；返回是否更新）
    pub async fn complete_attempt_conn(
        conn: &mut SqliteConnection,
        id: Id,
        outcome: &AttemptOutcome<'_>,
    ) -> AppResult<bool> {
        Ok(sqlx::query(
            "UPDATE passage_attempts SET status = 'completed', answers = ?, objective_correct = ?,
                 objective_total = ?, open_score = ?, open_total = ?, active_time = ?, completed_at = ?
             WHERE id = ? AND status = 'in_progress'",
        )
        .bind(json(outcome.answers)?)
        .bind(outcome.objective_correct)
        .bind(outcome.objective_total)
        .bind(outcome.open_score)
        .bind(outcome.open_total)
        .bind(outcome.active_time.max(0))
        .bind(crate::time::now_utc())
        .bind(id)
        .execute(&mut *conn)
        .await?
        .rows_affected()
            > 0)
    }

    /// 开放题重新评分后更新
    pub async fn update_open_grades(
        &self,
        id: Id,
        answers: &StoredAnswers,
        open_score: Option<i64>,
    ) -> AppResult<()> {
        sqlx::query("UPDATE passage_attempts SET answers = ?, open_score = ? WHERE id = ?")
            .bind(json(answers)?)
            .bind(open_score)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    // ==================== 统计 ====================

    /// 短文练习统计（可按计划筛选：只算这个计划里的作答）；阅读、听力分开
    pub async fn statistics(&self, plan_id: Option<Id>) -> AppResult<PassageStatistics> {
        let passages: i64 = sqlx::query_scalar(
            "SELECT COUNT(DISTINCT passage_id) FROM passage_attempts
             WHERE status = 'completed' AND (?1 IS NULL OR plan_id = ?1)",
        )
        .bind(plan_id)
        .fetch_one(self.pool.as_ref())
        .await?;
        let rows = sqlx::query(
            "SELECT mode, COUNT(*) AS attempts,
                    SUM(objective_correct) AS correct, SUM(objective_total) AS total,
                    SUM(COALESCE(open_score, 0)) AS open_score,
                    SUM(CASE WHEN open_score IS NOT NULL THEN open_total ELSE 0 END) AS open_total,
                    SUM(active_time) AS time
             FROM passage_attempts
             WHERE status = 'completed' AND (?1 IS NULL OR plan_id = ?1)
             GROUP BY mode",
        )
        .bind(plan_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        let (total_passages, total_sets): (i64, i64) = sqlx::query_as(
            "SELECT COUNT(*),
                    COALESCE(SUM((SELECT COUNT(*) FROM passage_question_sets qs WHERE qs.passage_id = p.id)), 0)
             FROM passages p
             WHERE ?1 IS NULL OR EXISTS (SELECT 1 FROM passage_sources s
                       WHERE s.passage_id = p.id AND s.kind = 'plan' AND s.ref_id = ?1)",
        )
        .bind(plan_id)
        .fetch_one(self.pool.as_ref())
        .await?;
        let mut stats = PassageStatistics {
            total_passages,
            total_sets,
            passages,
            ..Default::default()
        };
        for r in rows {
            let rate = |num: i64, den: i64| (den > 0).then(|| num as f64 * 100.0 / den as f64);
            let mode_stats = PassageModeStatistics {
                attempts: r.get("attempts"),
                objective_accuracy: rate(r.get("correct"), r.get("total")),
                open_score_rate: rate(r.get("open_score"), r.get("open_total")),
                total_time: r.get("time"),
            };
            match r.get::<String, _>("mode").as_str() {
                "listening" => stats.listening = mode_stats,
                _ => stats.reading = mode_stats,
            }
        }
        Ok(stats)
    }
}
