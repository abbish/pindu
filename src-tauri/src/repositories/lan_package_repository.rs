//! 素材包（设备互传）的数据访问：导出时按业务对象读出原始数据，导入时写入没有现成写入方法的表。
//! 能复用的写入（词汇本、单词与例句、短文含词索引、题组、短片、标签、计划）由 `services/lan_import.rs` 调用各自的 repository。

use crate::error::AppResult;
use crate::types::common::Id;
use sqlx::{Row, SqliteConnection, SqlitePool};

pub struct BookRow {
    pub title: String,
    pub description: String,
    pub icon: String,
    pub icon_color: String,
}

pub struct WordRow {
    pub id: Id,
    pub word: String,
    pub meaning: String,
    pub description: Option<String>,
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    pub phonics_segments: Option<String>,
    pub part_of_speech: Option<String>,
    pub pos_abbreviation: Option<String>,
    pub pos_english: Option<String>,
    pub pos_chinese: Option<String>,
    pub phonics_rule: Option<String>,
    pub analysis_explanation: Option<String>,
    pub phrase_type: Option<String>,
    pub separable: bool,
}

pub struct PassageRow {
    pub title: String,
    pub sentences: String,
    pub target_words: String,
    pub scene: Option<String>,
    pub level: String,
    pub origin: String,
    pub source_label: Option<String>,
}

pub struct SetRow {
    pub id: Id,
    pub name: String,
    pub mode: String,
    pub spec: String,
    pub cloze_distractors: Option<String>,
}

pub struct QuestionRow {
    pub kind: String,
    pub stem: String,
    pub options: Option<String>,
    pub answer: Option<String>,
    pub explanation: Option<String>,
    pub reference_answer: Option<String>,
    pub rubric: Option<String>,
    pub sentence_index: Option<i64>,
}

pub struct PlanRow {
    pub name: String,
    pub description: Option<String>,
    pub practice_content: String,
    pub daily_new_words: Option<i64>,
    pub passage_interval_days: i64,
}

/// 计划里的一个新词（按学习顺序）
pub struct PlanWordRow {
    pub word_id: Id,
    pub word_book_id: Option<Id>,
    pub difficulty: i64,
    pub priority: String,
}

pub struct PlanPassageRow {
    pub passage_id: Id,
    pub set_id: Option<Id>,
    pub mode: String,
}

pub struct LanPackageRepository;

impl LanPackageRepository {
    pub async fn book(pool: &SqlitePool, id: Id) -> AppResult<Option<BookRow>> {
        Ok(sqlx::query(
            // 已结束的计划可能用着已删除（软删除）的词汇本：照样能带上，对方收到的是正常的词汇本
            "SELECT title, description, icon, icon_color FROM word_books WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(|r| BookRow {
            title: r.get("title"),
            description: r.get("description"),
            icon: r.get("icon"),
            icon_color: r.get("icon_color"),
        }))
    }

    pub async fn words_of_book(pool: &SqlitePool, book_id: Id) -> AppResult<Vec<WordRow>> {
        let rows = sqlx::query(
            "SELECT id, word, meaning, description, ipa, syllables, phonics_segments, part_of_speech,
                    pos_abbreviation, pos_english, pos_chinese, phonics_rule, analysis_explanation,
                    phrase_type, separable
             FROM words WHERE word_book_id = ? ORDER BY id",
        )
        .bind(book_id)
        .fetch_all(pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| WordRow {
                id: r.get("id"),
                word: r.get("word"),
                meaning: r.get("meaning"),
                description: r.get("description"),
                ipa: r.get("ipa"),
                syllables: r.get("syllables"),
                phonics_segments: r.get("phonics_segments"),
                part_of_speech: r.get("part_of_speech"),
                pos_abbreviation: r.get("pos_abbreviation"),
                pos_english: r.get("pos_english"),
                pos_chinese: r.get("pos_chinese"),
                phonics_rule: r.get("phonics_rule"),
                analysis_explanation: r.get("analysis_explanation"),
                phrase_type: r.get("phrase_type"),
                separable: r.get::<i64, _>("separable") != 0,
            })
            .collect())
    }

    pub async fn passage(pool: &SqlitePool, id: Id) -> AppResult<Option<PassageRow>> {
        Ok(sqlx::query(
            "SELECT title, sentences, target_words, scene, level, origin, source_label FROM passages WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(|r| PassageRow {
            title: r.get("title"),
            sentences: r.get("sentences"),
            target_words: r.get("target_words"),
            scene: r.get("scene"),
            level: r.get("level"),
            origin: r.get("origin"),
            source_label: r.get("source_label"),
        }))
    }

    /// 短文的题组（阅读在前，各自按创建顺序）
    pub async fn sets_of_passage(pool: &SqlitePool, passage_id: Id) -> AppResult<Vec<SetRow>> {
        let rows = sqlx::query(
            "SELECT id, name, mode, spec, cloze_distractors FROM passage_question_sets
             WHERE passage_id = ? ORDER BY mode DESC, created_at, id",
        )
        .bind(passage_id)
        .fetch_all(pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| SetRow {
                id: r.get("id"),
                name: r.get("name"),
                mode: r.get("mode"),
                spec: r.get("spec"),
                cloze_distractors: r.get("cloze_distractors"),
            })
            .collect())
    }

    pub async fn questions_of_set(pool: &SqlitePool, set_id: Id) -> AppResult<Vec<QuestionRow>> {
        let rows = sqlx::query(
            "SELECT kind, stem, options, answer, explanation, reference_answer, rubric, sentence_index
             FROM passage_questions WHERE set_id = ? ORDER BY sort_order, id",
        )
        .bind(set_id)
        .fetch_all(pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| QuestionRow {
                kind: r.get("kind"),
                stem: r.get("stem"),
                options: r.get("options"),
                answer: r.get("answer"),
                explanation: r.get("explanation"),
                reference_answer: r.get("reference_answer"),
                rubric: r.get("rubric"),
                sentence_index: r.get("sentence_index"),
            })
            .collect())
    }

    /// 短文是哪个视频的片段（不是片段为 None）
    pub async fn clip_video_of_passage(pool: &SqlitePool, passage_id: Id) -> AppResult<Option<Id>> {
        Ok(
            sqlx::query_scalar("SELECT video_id FROM video_clips WHERE passage_id = ?")
                .bind(passage_id)
                .fetch_optional(pool)
                .await?,
        )
    }

    pub async fn plan(pool: &SqlitePool, id: Id) -> AppResult<Option<PlanRow>> {
        Ok(sqlx::query(
            "SELECT name, description, practice_content, daily_new_words, passage_interval_days
             FROM study_plans WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(|r| PlanRow {
            name: r.get("name"),
            description: r.get("description"),
            practice_content: r.get("practice_content"),
            daily_new_words: r.get("daily_new_words"),
            passage_interval_days: r.get("passage_interval_days"),
        }))
    }

    /// 计划的单词，按学习顺序：先按新词日的顺序，再补上不在新词日里的（理论上没有）
    pub async fn plan_words(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<PlanWordRow>> {
        let rows = sqlx::query(
            "SELECT pw.word_id, w.word_book_id,
                    COALESCE(sw.difficulty_level, 1) AS difficulty, COALESCE(sw.priority, 'medium') AS priority
             FROM study_plan_words pw
             JOIN words w ON w.id = pw.word_id
             LEFT JOIN study_plan_schedule_words sw ON sw.id = (
                 SELECT sw2.id FROM study_plan_schedule_words sw2
                 JOIN study_plan_schedules s2 ON s2.id = sw2.schedule_id
                 WHERE s2.plan_id = pw.plan_id AND sw2.word_id = pw.word_id AND sw2.is_review = 0
                 ORDER BY s2.day_number, sw2.id LIMIT 1)
             LEFT JOIN study_plan_schedules s ON s.id = sw.schedule_id
             WHERE pw.plan_id = ?
             ORDER BY s.day_number IS NULL, s.day_number, sw.id, pw.id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| PlanWordRow {
                word_id: r.get("word_id"),
                word_book_id: r.get("word_book_id"),
                difficulty: r.get("difficulty"),
                priority: r.get("priority"),
            })
            .collect())
    }

    pub async fn plan_passages(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<PlanPassageRow>> {
        let rows = sqlx::query(
            "SELECT passage_id, set_id, mode FROM study_plan_passages WHERE plan_id = ? ORDER BY sort_order, id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| PlanPassageRow {
                passage_id: r.get("passage_id"),
                set_id: r.get("set_id"),
                mode: r.get("mode"),
            })
            .collect())
    }

    // ---- 导入 ----

    /// 单词卡：本机没有才写入（已有的是本机生成的，保留）
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_word_card_if_absent_conn(
        conn: &mut SqliteConnection,
        card: &crate::types::material::WordCard,
    ) -> AppResult<()> {
        let now = crate::time::now_utc();
        sqlx::query(
            "INSERT INTO word_cards (word_key, word, meaning, pos_abbreviation, pos_chinese, ipa, syllables,
                                     phonics_rule, analysis_explanation, examples, kind, phrase_type, separable,
                                     created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(word_key) DO NOTHING",
        )
        .bind(card.word.trim().to_lowercase())
        .bind(card.word.trim())
        .bind(&card.meaning)
        .bind(&card.pos_abbreviation)
        .bind(&card.pos_chinese)
        .bind(&card.ipa)
        .bind(&card.syllables)
        .bind(&card.phonics_rule)
        .bind(&card.analysis_explanation)
        .bind(serde_json::to_string(&card.examples).unwrap_or_else(|_| "[]".into()))
        .bind(crate::types::wordbook::vocab_kind(&card.word))
        .bind(&card.phrase_type)
        .bind(card.separable)
        .bind(&now)
        .bind(&now)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 句子分析：本机没有才写入
    pub async fn insert_analysis_if_absent_conn(
        conn: &mut SqliteConnection,
        sentence: &str,
        analysis_json: &str,
    ) -> AppResult<()> {
        let now = crate::time::now_utc();
        sqlx::query(
            "INSERT INTO sentence_analyses (sentence_key, sentence, analysis, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?) ON CONFLICT(sentence_key) DO NOTHING",
        )
        .bind(crate::repositories::sentence_analysis_repository::sentence_key(sentence))
        .bind(sentence.trim())
        .bind(analysis_json)
        .bind(&now)
        .bind(&now)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// 视频（导入完成的状态：有片段为 done，否则 ready）
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_video_conn(conn: &mut SqliteConnection, v: &NewVideo<'_>) -> AppResult<Id> {
        let now = crate::time::now_utc();
        Ok(sqlx::query(
            "INSERT INTO videos (title, source_name, source_file, media_file, subtitle_name, cues, duration_ms,
                                 width, height, size_bytes, status, created_at, updated_at, subtitle_offset_ms, plan_suggestions)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(v.title)
        .bind(v.source_name)
        .bind(v.source_file)
        .bind(v.media_file)
        .bind(v.subtitle_name)
        .bind(v.cues)
        .bind(v.duration_ms)
        .bind(v.width)
        .bind(v.height)
        .bind(v.size_bytes)
        .bind(v.status)
        .bind(&now)
        .bind(&now)
        .bind(v.subtitle_offset_ms)
        .bind(v.plan_suggestions)
        .execute(&mut *conn)
        .await?
        .last_insert_rowid())
    }

    pub async fn insert_video_plan_conn(
        conn: &mut SqliteConnection,
        video_id: Id,
        name: &str,
        plan_json: &str,
    ) -> AppResult<Id> {
        let now = crate::time::now_utc();
        Ok(sqlx::query(
            "INSERT INTO video_plans (video_id, name, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(video_id)
        .bind(name)
        .bind(plan_json)
        .bind(&now)
        .bind(&now)
        .execute(&mut *conn)
        .await?
        .last_insert_rowid())
    }
}

/// 导入的视频行
pub struct NewVideo<'a> {
    pub title: &'a str,
    pub source_name: &'a str,
    pub source_file: Option<&'a str>,
    pub media_file: Option<&'a str>,
    pub subtitle_name: Option<&'a str>,
    pub cues: &'a str,
    pub duration_ms: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub size_bytes: i64,
    pub status: &'a str,
    pub subtitle_offset_ms: i64,
    pub plan_suggestions: Option<&'a str>,
}

// ==================== 学习进度（「连同进度」） ====================

#[derive(sqlx::FromRow)]
pub struct PlanStateRow {
    pub unified_status: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub actual_start_date: Option<String>,
    pub actual_end_date: Option<String>,
    pub actual_terminated_date: Option<String>,
    pub intensity_level: Option<String>,
    pub study_period_days: Option<i64>,
    pub review_frequency: Option<i64>,
    pub mastery_level: Option<i64>,
    pub ai_plan_data: Option<String>,
    pub created_at: Option<String>,
}

#[derive(sqlx::FromRow)]
pub struct ScheduleRow {
    pub id: Id,
    pub day_number: i64,
    pub schedule_date: String,
    pub status: Option<String>,
    pub new_words_count: Option<i64>,
    pub review_words_count: Option<i64>,
    pub total_words_count: Option<i64>,
    pub completed_words_count: Option<i64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(sqlx::FromRow)]
pub struct ScheduleWordRow {
    pub schedule_id: Id,
    pub word_id: Id,
    pub is_review: bool,
    pub review_count: Option<i64>,
    pub priority: String,
    pub difficulty_level: i64,
    pub created_at: Option<String>,
}

#[derive(sqlx::FromRow)]
pub struct WordStateRow {
    pub word_id: Id,
    pub learned: bool,
    pub correct_count: i64,
    pub total_attempts: i64,
    pub last_studied: Option<String>,
    pub next_review: Option<String>,
    pub mastery_score: f64,
    pub srs_box: i64,
    pub srs_due: Option<String>,
    pub srs_last: Option<String>,
    pub srs_lapses: i64,
    pub srs_reviews: i64,
}

#[derive(sqlx::FromRow)]
pub struct SessionRow {
    pub id: String,
    pub schedule_id: Id,
    pub schedule_date: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub total_time: Option<i64>,
    pub active_time: Option<i64>,
    pub pause_count: Option<i64>,
    pub completed: Option<bool>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(sqlx::FromRow)]
pub struct PauseRow {
    pub session_id: String,
    pub pause_start: String,
    pub pause_end: Option<String>,
    pub created_at: Option<String>,
}

#[derive(sqlx::FromRow)]
pub struct RecordRow {
    pub session_id: String,
    pub word_id: Id,
    pub step: i64,
    pub user_input: String,
    pub is_correct: bool,
    pub time_spent: i64,
    pub attempts: Option<i64>,
    pub kind: String,
    pub created_at: Option<String>,
}

#[derive(sqlx::FromRow)]
pub struct StudyRecordRow {
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub words_studied: i64,
    pub correct_answers: i64,
    pub total_time_seconds: i64,
}

#[derive(sqlx::FromRow)]
pub struct PlanPassageStateRow {
    pub scheduled_date: String,
    pub completed_at: Option<String>,
    pub attempt_id: Option<Id>,
    pub created_at: String,
}

#[derive(sqlx::FromRow)]
pub struct AttemptRow {
    pub id: Id,
    pub set_id: Id,
    pub passage_id: Id,
    pub schedule_id: Option<Id>,
    pub mode: String,
    pub status: String,
    pub answers: Option<String>,
    pub objective_correct: i64,
    pub objective_total: i64,
    pub open_score: Option<i64>,
    pub open_total: Option<i64>,
    pub active_time: i64,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(sqlx::FromRow)]
pub struct HistoryRow {
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub from_lifecycle_status: Option<String>,
    pub to_lifecycle_status: Option<String>,
    pub reason: Option<String>,
    pub created_at: Option<String>,
}

/// 恢复的计划行
pub struct RestoredPlan<'a> {
    pub name: &'a str,
    pub description: &'a str,
    pub unified_status: &'a str,
    pub total_words: i64,
    pub mastery_level: i64,
    pub intensity_level: Option<&'a str>,
    pub study_period_days: Option<i64>,
    pub review_frequency: Option<i64>,
    pub start_date: Option<&'a str>,
    pub end_date: Option<&'a str>,
    pub actual_start_date: Option<&'a str>,
    pub actual_end_date: Option<&'a str>,
    pub actual_terminated_date: Option<&'a str>,
    pub ai_plan_data: Option<&'a str>,
    pub daily_new_words: Option<i64>,
    pub practice_content: &'a str,
    pub passage_interval_days: i64,
    pub created_at: &'a str,
}

impl LanPackageRepository {
    pub async fn plan_state(pool: &SqlitePool, plan_id: Id) -> AppResult<Option<PlanStateRow>> {
        Ok(sqlx::query_as(
            "SELECT unified_status, start_date, end_date, actual_start_date, actual_end_date, actual_terminated_date,
                    intensity_level, study_period_days, review_frequency, mastery_level, ai_plan_data, created_at
             FROM study_plans WHERE id = ?",
        )
        .bind(plan_id)
        .fetch_optional(pool)
        .await?)
    }

    pub async fn schedules(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<ScheduleRow>> {
        Ok(sqlx::query_as(
            "SELECT id, day_number, schedule_date, status, new_words_count, review_words_count, total_words_count,
                    completed_words_count, created_at, updated_at
             FROM study_plan_schedules WHERE plan_id = ? ORDER BY day_number",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }

    pub async fn schedule_words(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<ScheduleWordRow>> {
        Ok(sqlx::query_as(
            "SELECT sw.schedule_id, sw.word_id, sw.is_review, sw.review_count, sw.priority, sw.difficulty_level, sw.created_at
             FROM study_plan_schedule_words sw JOIN study_plan_schedules s ON s.id = sw.schedule_id
             WHERE s.plan_id = ? ORDER BY s.day_number, sw.id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }

    pub async fn word_states(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<WordStateRow>> {
        Ok(sqlx::query_as(
            "SELECT word_id, learned, correct_count, total_attempts, last_studied, next_review, mastery_score,
                    srs_box, srs_due, srs_last, srs_lapses, srs_reviews
             FROM study_plan_words WHERE plan_id = ? ORDER BY id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }

    pub async fn sessions(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<SessionRow>> {
        Ok(sqlx::query_as(
            "SELECT id, schedule_id, schedule_date, start_time, end_time, total_time, active_time, pause_count,
                    completed, created_at, updated_at
             FROM practice_sessions WHERE plan_id = ? ORDER BY start_time, id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }

    pub async fn pauses(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<PauseRow>> {
        Ok(sqlx::query_as(
            "SELECT p.session_id, p.pause_start, p.pause_end, p.created_at
             FROM practice_pause_records p JOIN practice_sessions s ON s.id = p.session_id
             WHERE s.plan_id = ? ORDER BY p.id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }

    pub async fn records(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<RecordRow>> {
        Ok(sqlx::query_as(
            "SELECT r.session_id, r.word_id, r.step, r.user_input, r.is_correct, r.time_spent, r.attempts, r.kind, r.created_at
             FROM word_practice_records r JOIN practice_sessions s ON s.id = r.session_id
             WHERE s.plan_id = ? ORDER BY r.id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }

    pub async fn study_records(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<StudyRecordRow>> {
        Ok(sqlx::query_as(
            "SELECT started_at, finished_at, words_studied, correct_answers, total_time_seconds
             FROM study_sessions WHERE plan_id = ? ORDER BY id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }

    pub async fn plan_passage_states(
        pool: &SqlitePool,
        plan_id: Id,
    ) -> AppResult<Vec<PlanPassageStateRow>> {
        Ok(sqlx::query_as(
            "SELECT scheduled_date, completed_at, attempt_id, created_at
             FROM study_plan_passages WHERE plan_id = ? ORDER BY sort_order, id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }

    pub async fn plan_attempts(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<AttemptRow>> {
        Ok(sqlx::query_as(
            "SELECT id, set_id, passage_id, schedule_id, mode, status, answers, objective_correct, objective_total,
                    open_score, open_total, active_time, started_at, completed_at
             FROM passage_attempts WHERE plan_id = ? ORDER BY started_at, id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }

    pub async fn history(pool: &SqlitePool, plan_id: Id) -> AppResult<Vec<HistoryRow>> {
        Ok(sqlx::query_as(
            "SELECT from_status, to_status, from_lifecycle_status, to_lifecycle_status, reason, created_at
             FROM study_plan_status_history WHERE plan_id = ? ORDER BY created_at, id",
        )
        .bind(plan_id)
        .fetch_all(pool)
        .await?)
    }

    /// 题组里的题目编号（按顺序）
    pub async fn question_ids_conn(conn: &mut SqliteConnection, set_id: Id) -> AppResult<Vec<Id>> {
        Ok(sqlx::query_scalar(
            "SELECT id FROM passage_questions WHERE set_id = ? ORDER BY sort_order, id",
        )
        .bind(set_id)
        .fetch_all(&mut *conn)
        .await?)
    }

    // ---- 恢复 ----

    pub async fn insert_plan_conn(
        conn: &mut SqliteConnection,
        p: &RestoredPlan<'_>,
    ) -> AppResult<Id> {
        let legacy = match p.unified_status {
            "Draft" => "draft",
            _ => "normal",
        };
        Ok(sqlx::query(
            "INSERT INTO study_plans (name, description, status, unified_status, total_words, mastery_level,
                 intensity_level, study_period_days, review_frequency, start_date, end_date,
                 actual_start_date, actual_end_date, actual_terminated_date, ai_plan_data,
                 daily_new_words, practice_content, passage_interval_days, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(p.name)
        .bind(p.description)
        .bind(legacy)
        .bind(p.unified_status)
        .bind(p.total_words)
        .bind(p.mastery_level)
        .bind(p.intensity_level)
        .bind(p.study_period_days)
        .bind(p.review_frequency)
        .bind(p.start_date)
        .bind(p.end_date)
        .bind(p.actual_start_date)
        .bind(p.actual_end_date)
        .bind(p.actual_terminated_date)
        .bind(p.ai_plan_data)
        .bind(p.daily_new_words)
        .bind(p.practice_content)
        .bind(p.passage_interval_days)
        .bind(p.created_at)
        .bind(crate::time::now_utc())
        .execute(&mut *conn)
        .await?
        .last_insert_rowid())
    }

    pub async fn insert_schedule_conn(
        conn: &mut SqliteConnection,
        plan_id: Id,
        s: &crate::lan::package::PkgSchedule,
    ) -> AppResult<Id> {
        Ok(sqlx::query(
            "INSERT INTO study_plan_schedules (plan_id, day_number, schedule_date, status, new_words_count,
                 review_words_count, total_words_count, completed_words_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(plan_id)
        .bind(s.day)
        .bind(&s.date)
        .bind(&s.status)
        .bind(s.new_words_count)
        .bind(s.review_words_count)
        .bind(s.total_words_count)
        .bind(s.completed_words_count)
        .bind(&s.created_at)
        .bind(&s.updated_at)
        .execute(&mut *conn)
        .await?
        .last_insert_rowid())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_schedule_word_conn(
        conn: &mut SqliteConnection,
        schedule_id: Id,
        word_id: Id,
        wordbook_id: Id,
        w: &crate::lan::package::PkgScheduleWord,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO study_plan_schedule_words (schedule_id, word_id, wordbook_id, is_review, review_count,
                 priority, difficulty_level, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(schedule_id)
        .bind(word_id)
        .bind(wordbook_id)
        .bind(w.review)
        .bind(w.review_count)
        .bind(&w.priority)
        .bind(w.difficulty)
        .bind(&w.created_at)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    pub async fn insert_word_state_conn(
        conn: &mut SqliteConnection,
        plan_id: Id,
        word_id: Id,
        s: &crate::lan::package::PkgWordState,
    ) -> AppResult<Id> {
        Ok(sqlx::query(
            "INSERT INTO study_plan_words (plan_id, word_id, learned, correct_count, total_attempts, last_studied,
                 next_review, mastery_score, srs_box, srs_due, srs_last, srs_lapses, srs_reviews)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(plan_id)
        .bind(word_id)
        .bind(s.learned)
        .bind(s.correct_count)
        .bind(s.total_attempts)
        .bind(&s.last_studied)
        .bind(&s.next_review)
        .bind(s.mastery_score)
        .bind(s.srs_box)
        .bind(&s.srs_due)
        .bind(&s.srs_last)
        .bind(s.srs_lapses)
        .bind(s.srs_reviews)
        .execute(&mut *conn)
        .await?
        .last_insert_rowid())
    }

    pub async fn insert_session_conn(
        conn: &mut SqliteConnection,
        id: &str,
        plan_id: Id,
        schedule_id: Id,
        s: &crate::lan::package::PkgSession,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO practice_sessions (id, plan_id, schedule_id, schedule_date, start_time, end_time, total_time,
                 active_time, pause_count, completed, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(plan_id)
        .bind(schedule_id)
        .bind(&s.schedule_date)
        .bind(&s.start_time)
        .bind(&s.end_time)
        .bind(s.total_time)
        .bind(s.active_time)
        .bind(s.pause_count)
        .bind(s.completed)
        .bind(&s.created_at)
        .bind(&s.updated_at)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    pub async fn insert_pause_conn(
        conn: &mut SqliteConnection,
        session_id: &str,
        p: &crate::lan::package::PkgPause,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO practice_pause_records (session_id, pause_start, pause_end, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(session_id)
        .bind(&p.start)
        .bind(&p.end)
        .bind(&p.created_at)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    pub async fn insert_record_conn(
        conn: &mut SqliteConnection,
        session_id: &str,
        word_id: Id,
        plan_word_id: Id,
        r: &crate::lan::package::PkgRecord,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO word_practice_records (session_id, word_id, plan_word_id, step, user_input, is_correct,
                 time_spent, attempts, kind, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(session_id)
        .bind(word_id)
        .bind(plan_word_id)
        .bind(r.step)
        .bind(&r.user_input)
        .bind(r.correct)
        .bind(r.time_spent)
        .bind(r.attempts)
        .bind(&r.kind)
        .bind(&r.created_at)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    pub async fn insert_study_record_conn(
        conn: &mut SqliteConnection,
        plan_id: Id,
        r: &crate::lan::package::PkgStudyRecord,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO study_sessions (plan_id, started_at, finished_at, words_studied, correct_answers, total_time_seconds)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(plan_id)
        .bind(&r.started_at)
        .bind(&r.finished_at)
        .bind(r.words_studied)
        .bind(r.correct_answers)
        .bind(r.total_time_seconds)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_attempt_conn(
        conn: &mut SqliteConnection,
        set_id: Id,
        passage_id: Id,
        plan_id: Id,
        schedule_id: Option<Id>,
        answers: Option<&str>,
        a: &crate::lan::package::PkgAttempt,
    ) -> AppResult<Id> {
        Ok(sqlx::query(
            "INSERT INTO passage_attempts (set_id, passage_id, plan_id, schedule_id, mode, status, answers,
                 objective_correct, objective_total, open_score, open_total, active_time, started_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(set_id)
        .bind(passage_id)
        .bind(plan_id)
        .bind(schedule_id)
        .bind(&a.mode)
        .bind(&a.status)
        .bind(answers)
        .bind(a.objective_correct)
        .bind(a.objective_total)
        .bind(a.open_score)
        .bind(a.open_total)
        .bind(a.active_time)
        .bind(&a.started_at)
        .bind(&a.completed_at)
        .execute(&mut *conn)
        .await?
        .last_insert_rowid())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_plan_passage_conn(
        conn: &mut SqliteConnection,
        plan_id: Id,
        passage_id: Id,
        set_id: Option<Id>,
        mode: &str,
        sort_order: i64,
        attempt_id: Option<Id>,
        t: &crate::lan::package::PkgPassageTaskState,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO study_plan_passages (plan_id, passage_id, set_id, mode, sort_order, scheduled_date,
                 completed_at, attempt_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(plan_id)
        .bind(passage_id)
        .bind(set_id)
        .bind(mode)
        .bind(sort_order)
        .bind(&t.scheduled_date)
        .bind(&t.completed_at)
        .bind(attempt_id)
        .bind(&t.created_at)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    pub async fn insert_history_conn(
        conn: &mut SqliteConnection,
        plan_id: Id,
        h: &crate::lan::package::PkgStatusChange,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO study_plan_status_history (plan_id, from_status, to_status, from_lifecycle_status,
                 to_lifecycle_status, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(plan_id)
        .bind(&h.from)
        .bind(&h.to)
        .bind(&h.from_lifecycle)
        .bind(&h.to_lifecycle)
        .bind(&h.reason)
        .bind(&h.at)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }
}
