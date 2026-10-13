//! 设备互传：把收到的素材包导入成**新的**词汇本、短文、视频、计划（每次都是新的一份）。
//!
//! 全部数据库写入在一个事务里；视频文件在提交前移进 `videos/<新编号>/`，失败时删掉已建的视频目录并回滚，
//! 不留半套数据。写入复用各对象平时的写入方法（短文同时维护词索引，计划用同一套排日程规则）。

use crate::error::{AppError, AppResult};
use crate::lan::package::*;
use crate::logger::Logger;
use crate::repositories::lan_package_repository::{
    LanPackageRepository as Repo, NewVideo, RestoredPlan,
};
use crate::repositories::passage_repository::{NewPassage, NewQuestionSet, PassageRepository};
use crate::repositories::pronunciation_repository::{NewAttempt, PronunciationRepository};
use crate::repositories::tag_repository::TagRepository;
use crate::repositories::video_repository::VideoRepository;
use crate::repositories::word_repository::WordRepository;
use crate::repositories::wordbook_repository::WordBookRepository;
use crate::services::passage_rules::{
    english_word_count, GeneratedPassage, GeneratedQuestionSet, NewQuestion,
};
use crate::services::study_plan::StudyPlanService;
use crate::services::study_planning::{
    build_schedule, PlanParams, PlanWord, WordAssessment, DAILY_NEW_WORDS_RANGE,
};
use crate::services::tag::TagService;
use crate::services::video::video_dir;
use crate::types::common::Id;
use crate::types::material::MaterialKind;
use crate::types::passage::{PassageTargetWord, PlanPassageInput};
use crate::types::study::CreateStudyPlanWithScheduleRequest;
use crate::types::wordbook::Word;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 新建的一个对象（界面上列出收到了什么，可以点开）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedItem {
    pub id: Id,
    pub title: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub word_books: Vec<ImportedItem>,
    pub passages: Vec<ImportedItem>,
    pub videos: Vec<ImportedItem>,
    pub plans: Vec<ImportedItem>,
}

/// 没有设置每天新词数时的默认值
const DEFAULT_DAILY_NEW_WORDS: i32 = 10;

/// 导入过程中已经动过的文件（失败时还原）
#[derive(Default)]
struct Created {
    dirs: Vec<PathBuf>,
    moved: Vec<(PathBuf, PathBuf)>,
}

struct NewWordInfo {
    id: Id,
    word: String,
    meaning: String,
    book_id: Id,
}

/// `files_dir` 里每个文件按 fileId 命名（接收时已按 sha256 校验）
pub async fn import(
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
    data_dir: &Path,
    pkg: &Package,
    files_dir: &Path,
) -> AppResult<ImportResult> {
    pkg.validate().map_err(AppError::ValidationError)?;
    let file_sizes: HashMap<&str, u64> =
        pkg.files.iter().map(|f| (f.id.as_str(), f.size)).collect();
    for f in &pkg.files {
        let len = std::fs::metadata(files_dir.join(&f.id))
            .map(|m| m.len())
            .ok();
        if len != Some(f.size) {
            return Err(AppError::ValidationError(
                "收到的文件不完整，请重新传送".into(),
            ));
        }
    }

    let mut created = Created::default();
    let result = import_inner(
        &pool,
        &logger,
        data_dir,
        pkg,
        files_dir,
        &file_sizes,
        &mut created,
    )
    .await;
    if result.is_err() {
        // 收到的文件放回原处（可以重试导入），再删掉新建的视频目录
        for (from, to) in &created.moved {
            let _ = std::fs::rename(to, from);
        }
        for dir in &created.dirs {
            if let Err(e) = std::fs::remove_dir_all(dir) {
                tracing::warn!(component = "LAN", dir = %dir.display(), error = %e, "导入失败后清理视频目录失败");
            }
        }
    }
    let result = result?;
    if !result.plans.is_empty() {
        StudyPlanService::new(pool.clone(), logger.clone())
            .refresh_wordbook_counts()
            .await;
    }
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
async fn import_inner(
    pool: &Arc<SqlitePool>,
    logger: &Arc<Logger>,
    data_dir: &Path,
    pkg: &Package,
    files_dir: &Path,
    file_sizes: &HashMap<&str, u64>,
    created: &mut Created,
) -> AppResult<ImportResult> {
    let mut out = ImportResult::default();
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;

    // 标签：按名字，本机有就用，没有就建
    let tag_service = TagService::new(pool.clone());
    let mut tags: HashMap<&str, Id> = HashMap::new();
    for t in &pkg.tags {
        if let Some(&id) = tag_service
            .ensure_names_conn(&mut tx, std::slice::from_ref(&t.name))
            .await?
            .first()
        {
            tags.insert(t.ref_.as_str(), id);
        }
    }
    let tag_ids = |refs: &[String]| -> Vec<Id> {
        refs.iter()
            .filter_map(|r| tags.get(r.as_str()).copied())
            .collect()
    };
    let tag_repo = TagRepository::new(pool.clone());

    // 词汇本与单词
    let book_repo = WordBookRepository::new(pool.clone(), logger.clone());
    let word_repo = WordRepository::new(pool.clone(), logger.clone());
    let mut words: HashMap<&str, NewWordInfo> = HashMap::new();
    let mut books: HashMap<&str, Id> = HashMap::new();
    for b in &pkg.word_books {
        let icon = if b.icon.is_empty() { "book" } else { &b.icon };
        let color = if b.icon_color.is_empty() {
            "blue"
        } else {
            &b.icon_color
        };
        let book_id = book_repo
            .insert_conn(
                &mut tx,
                b.title.trim(),
                &b.description,
                icon,
                color,
                "normal",
            )
            .await?;
        book_repo
            .add_tags_conn(&mut tx, book_id, &tag_ids(&b.tags))
            .await?;
        books.insert(b.ref_.as_str(), book_id);
        let rows: Vec<Word> = b
            .words
            .iter()
            .map(|w| Word {
                id: 0,
                word: w.word.trim().to_string(),
                meaning: w.meaning.clone(),
                description: w.description.clone(),
                ipa: w.ipa.clone(),
                syllables: w.syllables.clone(),
                phonics_segments: w.phonics_segments.clone(),
                image_path: None,
                audio_path: None,
                part_of_speech: w.part_of_speech.clone(),
                category_id: None,
                word_book_id: Some(book_id),
                pos_abbreviation: w.pos_abbreviation.clone(),
                pos_english: w.pos_english.clone(),
                pos_chinese: w.pos_chinese.clone(),
                phonics_rule: w.phonics_rule.clone(),
                analysis_explanation: w.analysis_explanation.clone(),
                examples: w.examples.clone(),
                kind: crate::types::wordbook::vocab_kind(&w.word).to_string(),
                phrase_type: w.phrase_type.clone(),
                separable: w.separable,
                created_at: String::new(),
                updated_at: String::new(),
            })
            .collect();
        let ids = word_repo.create_batch(&mut tx, &rows).await?;
        for (w, id) in b.words.iter().zip(ids) {
            words.insert(
                w.ref_.as_str(),
                NewWordInfo {
                    id,
                    word: w.word.trim().to_string(),
                    meaning: w.meaning.clone(),
                    book_id,
                },
            );
        }
        out.word_books.push(ImportedItem {
            id: book_id,
            title: b.title.trim().to_string(),
        });
    }

    // 单词卡与句子分析：本机已有的保留
    for card in &pkg.word_cards {
        if !card.word.trim().is_empty() {
            Repo::insert_word_card_if_absent_conn(&mut tx, card).await?;
        }
    }
    for a in &pkg.sentence_analyses {
        let json = serde_json::to_string(&a.analysis)
            .map_err(|e| AppError::InternalError(e.to_string()))?;
        Repo::insert_analysis_if_absent_conn(&mut tx, &a.sentence, &json).await?;
    }

    // 短文与题组（场景片段的短文一样写入，下面再挂到视频上）
    let clip_passages: HashSet<&str> = pkg
        .videos
        .iter()
        .flat_map(|v| v.clips.iter().map(|c| c.passage_ref.as_str()))
        .collect();
    let mut passages: HashMap<&str, Id> = HashMap::new();
    let mut sets: HashMap<&str, Id> = HashMap::new();
    for p in &pkg.passages {
        let target_words: Vec<PassageTargetWord> = p
            .target_words
            .iter()
            .map(|t| PassageTargetWord {
                word_id: t
                    .word_ref
                    .as_deref()
                    .and_then(|r| words.get(r))
                    .map(|w| w.id),
                word: t.word.clone(),
                required: t.required,
                meaning: t.meaning.clone(),
                forms: t.forms.clone(),
            })
            .collect();
        let origin = match p.origin.as_str() {
            "imported" => "imported",
            _ => "generated",
        };
        let level = if p.level.is_empty() { "A2" } else { &p.level };
        let generated = GeneratedPassage {
            title: p.title.trim().to_string(),
            word_count: english_word_count(&p.sentences),
            sentences: p.sentences.clone(),
            target_words,
            tags: Vec::new(),
        };
        let meta = NewPassage {
            origin,
            source_label: p.source_label.as_deref(),
            scene: p.scene.as_deref(),
            level,
            sources: &[],
            model_name: None,
            prompt_fingerprint: None,
        };
        let id = PassageRepository::insert_passage_conn(&mut tx, &meta, &generated).await?;
        tag_repo
            .add_conn(&mut tx, MaterialKind::Passage, id, &tag_ids(&p.tags))
            .await?;
        for qs in &p.question_sets {
            let set = GeneratedQuestionSet {
                questions: qs
                    .questions
                    .iter()
                    .map(|q| NewQuestion {
                        kind: q.kind.clone(),
                        stem: q.stem.clone(),
                        options: q.options.clone(),
                        answer: q.answer.clone(),
                        explanation: q.explanation.clone(),
                        reference_answer: q.reference_answer.clone(),
                        rubric: q.rubric.clone(),
                        sentence_index: q.sentence_index,
                    })
                    .collect(),
                cloze_distractors: qs.cloze_distractors.clone(),
            };
            let meta = NewQuestionSet {
                passage_id: id,
                name: &qs.name,
                mode: &qs.mode,
                spec: &qs.spec,
                model_name: None,
                prompt_fingerprint: None,
            };
            let set_id = PassageRepository::insert_set_conn(&mut tx, &meta, &set).await?;
            sets.insert(qs.ref_.as_str(), set_id);
        }
        passages.insert(p.ref_.as_str(), id);
        if !clip_passages.contains(p.ref_.as_str()) {
            out.passages.push(ImportedItem {
                id,
                title: generated.title.clone(),
            });
        }
    }

    // 视频：先建记录拿到编号，文件移进新目录，再挂规划与片段
    for v in &pkg.videos {
        let size_bytes = v
            .source_file
            .as_deref()
            .and_then(|p| v.files.iter().find(|f| f.path == p))
            .and_then(|f| file_sizes.get(f.file.as_str()).copied())
            .unwrap_or(0) as i64;
        let cues =
            serde_json::to_string(&v.cues).map_err(|e| AppError::InternalError(e.to_string()))?;
        let suggestions = v.plan_suggestions.as_ref().map(|s| s.to_string());
        let video_id = Repo::insert_video_conn(
            &mut tx,
            &NewVideo {
                title: v.title.trim(),
                source_name: &v.source_name,
                source_file: v.source_file.as_deref(),
                media_file: v.media_file.as_deref(),
                subtitle_name: v.subtitle_name.as_deref(),
                cues: &cues,
                duration_ms: v.duration_ms,
                width: v.width,
                height: v.height,
                size_bytes,
                status: if v.clips.is_empty() { "ready" } else { "done" },
                subtitle_offset_ms: v.subtitle_offset_ms,
                plan_suggestions: suggestions.as_deref(),
            },
        )
        .await?;
        tag_repo
            .add_conn(&mut tx, MaterialKind::Video, video_id, &tag_ids(&v.tags))
            .await?;

        let dir = video_dir(data_dir, video_id);
        if dir.exists() {
            // 编号刚分配，库里没有别的记录用它：这是以前删除没删干净、或导入中途退出留下的目录，清掉
            tracing::warn!(component = "LAN", dir = %dir.display(), "清理没有记录的旧视频目录");
            std::fs::remove_dir_all(&dir)
                .map_err(|e| AppError::InternalError(format!("无法清理旧的视频目录：{e}")))?;
        }
        created.dirs.push(dir.clone());
        for f in &v.files {
            let to = dir.join(&f.path);
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AppError::InternalError(format!("无法创建视频目录：{e}")))?;
            }
            let from = files_dir.join(&f.file);
            move_file(&from, &to)?;
            created.moved.push((from, to));
        }

        let mut plans: HashMap<&str, Id> = HashMap::new();
        for vp in &v.plans {
            let json = serde_json::to_string(&vp.plan)
                .map_err(|e| AppError::InternalError(e.to_string()))?;
            let id = Repo::insert_video_plan_conn(&mut tx, video_id, &vp.name, &json).await?;
            plans.insert(vp.ref_.as_str(), id);
        }
        for c in &v.clips {
            let passage_id = passages[c.passage_ref.as_str()];
            VideoRepository::insert_clip_conn(
                &mut tx,
                video_id,
                c.plan_ref.as_deref().and_then(|r| plans.get(r).copied()),
                passage_id,
                c.seq,
                c.start_ms,
                c.end_ms,
                &c.file,
                c.poster.as_deref(),
            )
            .await?;
        }
        out.videos.push(ImportedItem {
            id: video_id,
            title: v.title.trim().to_string(),
        });
    }

    // 学习计划：从头开始（待开始，按学习顺序和每天新词数重新排日程，开始日期 = 今天）
    let today = crate::time::format_date(crate::time::local_today());
    let plan_service = StudyPlanService::new(pool.clone(), logger.clone());
    for p in &pkg.plans {
        if let Some(progress) = &p.progress {
            let progress = canonical_instants(progress);
            let id = restore_plan(&mut tx, p, &progress, &words, &books, &passages, &sets).await?;
            out.plans.push(ImportedItem {
                id,
                title: p.name.trim().to_string(),
            });
            continue;
        }
        let ordered: Vec<(PlanWord, WordAssessment)> = p
            .words
            .iter()
            .filter_map(|w| {
                let info = words.get(w.word_ref.as_str())?;
                Some((
                    PlanWord {
                        word_id: info.id,
                        word: info.word.clone(),
                        wordbook_id: info.book_id,
                        meaning: Some(info.meaning.clone()),
                    },
                    WordAssessment {
                        word_id: info.id,
                        difficulty: w.difficulty.clamp(1, 5),
                        priority: w.priority.clone(),
                    },
                ))
            })
            .collect();
        let (ai_plan_data, end_date) = if p.practice_content == "passages" {
            (String::new(), today.clone())
        } else {
            let daily = p
                .daily_new_words
                .map(|d| d as i32)
                .filter(|d| DAILY_NEW_WORDS_RANGE.contains(d))
                .unwrap_or(DEFAULT_DAILY_NEW_WORDS);
            let schedule = build_schedule(
                &PlanParams {
                    daily_new_words: daily,
                    start_date: today.clone(),
                },
                &ordered,
            )?;
            let end = schedule.plan_metadata.end_date.clone();
            (
                serde_json::to_string(&schedule)
                    .map_err(|e| AppError::InternalError(e.to_string()))?,
                end,
            )
        };
        let mut book_ids: Vec<Id> = ordered.iter().map(|(w, _)| w.wordbook_id).collect();
        book_ids.sort();
        book_ids.dedup();
        let request = CreateStudyPlanWithScheduleRequest {
            name: p.name.trim().to_string(),
            description: p.description.clone(),
            intensity_level: String::new(),
            study_period_days: 0,
            review_frequency: 0,
            start_date: today.clone(),
            end_date,
            ai_plan_data,
            wordbook_ids: book_ids,
            status: Some("active".into()),
            practice_content: Some(p.practice_content.clone()),
            passages: p
                .passage_tasks
                .iter()
                .map(|t| PlanPassageInput {
                    passage_id: passages[t.passage_ref.as_str()],
                    set_id: t.set_ref.as_deref().and_then(|r| sets.get(r).copied()),
                    mode: t.mode.clone(),
                })
                .collect(),
            passage_interval_days: Some(p.passage_interval_days.max(1)),
        };
        let id = plan_service
            .create_with_schedule_conn(&mut tx, request)
            .await?;
        out.plans.push(ImportedItem {
            id,
            title: p.name.trim().to_string(),
        });
    }

    tx.commit().await?;
    logger.info(
        "LAN",
        &format!(
            "素材包已导入：词汇本 {}、短文 {}、视频 {}、计划 {}",
            out.word_books.len(),
            out.passages.len(),
            out.videos.len(),
            out.plans.len()
        ),
    );
    Ok(out)
}

/// 进度里的时刻统一成 UTC 规范格式（对方是同一套约定；格式不对或为空的用现在，避免写进读不出来的时间）
fn canonical_instants(pr: &PkgProgress) -> PkgProgress {
    use crate::time::{format_instant, now_utc, parse_instant};
    let fix = |s: &mut String| {
        *s = parse_instant(s).map(format_instant).unwrap_or_else(now_utc);
    };
    let fix_opt = |s: &mut Option<String>| {
        if let Some(v) = s {
            match parse_instant(v) {
                Some(t) => *v = format_instant(t),
                None => *s = None,
            }
        }
    };
    let mut pr = pr.clone();
    fix(&mut pr.created_at);
    fix_opt(&mut pr.actual_start_date);
    fix_opt(&mut pr.actual_end_date);
    fix_opt(&mut pr.actual_terminated_date);
    for s in &mut pr.schedules {
        fix(&mut s.created_at);
        fix(&mut s.updated_at);
        s.words.iter_mut().for_each(|w| fix(&mut w.created_at));
    }
    for s in &mut pr.sessions {
        fix(&mut s.start_time);
        fix_opt(&mut s.end_time);
        fix(&mut s.created_at);
        fix(&mut s.updated_at);
        for p in &mut s.pauses {
            fix(&mut p.start);
            fix_opt(&mut p.end);
            fix(&mut p.created_at);
        }
        s.records.iter_mut().for_each(|r| fix(&mut r.created_at));
    }
    for r in &mut pr.study_records {
        fix_opt(&mut r.started_at);
        fix_opt(&mut r.finished_at);
    }
    for a in &mut pr.attempts {
        fix(&mut a.started_at);
        fix_opt(&mut a.completed_at);
    }
    for t in &mut pr.passage_tasks {
        fix(&mut t.created_at);
        fix_opt(&mut t.completed_at);
    }
    pr.history.iter_mut().for_each(|h| fix(&mut h.at));
    pr.pronunciation
        .iter_mut()
        .for_each(|a| fix(&mut a.created_at));
    // 记忆等级的日期按日历日期核对；旧的时刻列（last_studied / next_review）能解析的统一格式，解析不了的保留原样
    let date = |s: &mut Option<String>| {
        if s.as_deref()
            .is_some_and(|v| crate::time::parse_date(v).is_none())
        {
            *s = None;
        }
    };
    let soft = |s: &mut Option<String>| {
        if let Some(t) = s.as_deref().and_then(parse_instant) {
            *s = Some(format_instant(t));
        }
    };
    for w in &mut pr.word_states {
        date(&mut w.srs_due);
        date(&mut w.srs_last);
        soft(&mut w.last_studied);
        soft(&mut w.next_review);
    }
    pr
}

/// 「连同进度」：按原样恢复计划、日程、记忆等级、练习与作答记录、短文任务与状态历史（编号换成新的）
async fn restore_plan(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    p: &PkgPlan,
    pr: &PkgProgress,
    words: &HashMap<&str, NewWordInfo>,
    books: &HashMap<&str, Id>,
    passages: &HashMap<&str, Id>,
    sets: &HashMap<&str, Id>,
) -> AppResult<Id> {
    use crate::services::lan_export::{remap_plan_data, remap_question_ids};
    let word = |r: &str| -> AppResult<&NewWordInfo> {
        words
            .get(r)
            .ok_or_else(|| AppError::ValidationError("学习进度里的单词不在素材包里".into()))
    };
    let ai_plan_data = pr.ai_plan_data.as_deref().and_then(|raw| {
        remap_plan_data(raw, &|r| words.get(r).map(|w| w.id.to_string()), &|r| {
            books.get(r).map(|id| id.to_string())
        })
    });
    let plan_id = Repo::insert_plan_conn(
        &mut *tx,
        &RestoredPlan {
            name: p.name.trim(),
            description: &p.description,
            unified_status: &pr.status,
            total_words: p.words.len() as i64,
            mastery_level: pr.mastery_level,
            intensity_level: pr.intensity_level.as_deref(),
            study_period_days: pr.study_period_days,
            review_frequency: pr.review_frequency,
            start_date: pr.start_date.as_deref(),
            end_date: pr.end_date.as_deref(),
            actual_start_date: pr.actual_start_date.as_deref(),
            actual_end_date: pr.actual_end_date.as_deref(),
            actual_terminated_date: pr.actual_terminated_date.as_deref(),
            ai_plan_data: ai_plan_data.as_deref(),
            daily_new_words: p.daily_new_words,
            practice_content: &p.practice_content,
            passage_interval_days: p.passage_interval_days.max(1),
            created_at: &pr.created_at,
        },
    )
    .await?;

    let mut schedule_of_day: HashMap<i64, Id> = HashMap::new();
    for s in &pr.schedules {
        let sid = Repo::insert_schedule_conn(&mut *tx, plan_id, s).await?;
        schedule_of_day.insert(s.day, sid);
        for w in &s.words {
            let info = word(&w.word_ref)?;
            Repo::insert_schedule_word_conn(&mut *tx, sid, info.id, info.book_id, w).await?;
        }
    }

    // 计划单词与记忆等级（没有记录的按初始状态）
    // 按原来的顺序写，计划里没有状态记录的词按初始状态补上
    let mut plan_word: HashMap<&str, Id> = HashMap::new();
    let has_state: HashSet<&str> = pr.word_states.iter().map(|s| s.word_ref.as_str()).collect();
    let fresh: Vec<PkgWordState> = p
        .words
        .iter()
        .filter(|w| !has_state.contains(w.word_ref.as_str()))
        .map(|w| PkgWordState {
            word_ref: w.word_ref.clone(),
            ..Default::default()
        })
        .collect();
    for state in pr.word_states.iter().chain(&fresh) {
        if plan_word.contains_key(state.word_ref.as_str()) {
            continue;
        }
        let info = word(&state.word_ref)?;
        let id = Repo::insert_word_state_conn(&mut *tx, plan_id, info.id, state).await?;
        plan_word.insert(state.word_ref.as_str(), id);
    }

    let mut session_ids: Vec<String> = Vec::with_capacity(pr.sessions.len());
    for s in &pr.sessions {
        let session_id = uuid::Uuid::new_v4().to_string();
        session_ids.push(session_id.clone());
        Repo::insert_session_conn(&mut *tx, &session_id, plan_id, schedule_of_day[&s.day], s)
            .await?;
        for pause in &s.pauses {
            Repo::insert_pause_conn(&mut *tx, &session_id, pause).await?;
        }
        for r in &s.records {
            let info = word(&r.word_ref)?;
            let pw = *plan_word
                .get(r.word_ref.as_str())
                .ok_or_else(|| AppError::ValidationError("练习记录里的单词不在计划里".into()))?;
            Repo::insert_record_conn(&mut *tx, &session_id, info.id, pw, r).await?;
        }
    }
    for r in &pr.study_records {
        Repo::insert_study_record_conn(&mut *tx, plan_id, r).await?;
    }

    let mut attempt_ids = Vec::with_capacity(pr.attempts.len());
    for a in &pr.attempts {
        let set_id = sets[a.set_ref.as_str()];
        let order = Repo::question_ids_conn(&mut *tx, set_id).await?;
        let answers = match &a.answers {
            Some(v) => {
                let mut v = v.clone();
                remap_question_ids(&mut v, &|i| {
                    usize::try_from(i).ok().and_then(|i| order.get(i).copied())
                });
                Some(v.to_string())
            }
            None => None,
        };
        let id = Repo::insert_attempt_conn(
            &mut *tx,
            set_id,
            passages[a.passage_ref.as_str()],
            plan_id,
            a.day.and_then(|d| schedule_of_day.get(&d).copied()),
            answers.as_deref(),
            a,
        )
        .await?;
        attempt_ids.push(id);
    }
    for (i, (task, state)) in p.passage_tasks.iter().zip(&pr.passage_tasks).enumerate() {
        Repo::insert_plan_passage_conn(
            &mut *tx,
            plan_id,
            passages[task.passage_ref.as_str()],
            task.set_ref.as_deref().and_then(|r| sets.get(r).copied()),
            &task.mode,
            i as i64,
            state.attempt.map(|a| attempt_ids[a]),
            state,
        )
        .await?;
    }
    for h in &pr.history {
        Repo::insert_history_conn(&mut *tx, plan_id, h).await?;
    }
    for a in &pr.pronunciation {
        PronunciationRepository::insert_restored_conn(
            &mut *tx,
            &NewAttempt {
                plan_id,
                session_id: a
                    .session
                    .and_then(|i| session_ids.get(i))
                    .map(String::as_str),
                source: &a.source,
                word_id: a
                    .word_ref
                    .as_deref()
                    .and_then(|r| words.get(r))
                    .map(|w| w.id),
                passage_id: a
                    .passage_ref
                    .as_deref()
                    .and_then(|r| passages.get(r).copied()),
                text: &a.text,
                score: a.score,
                detail: &a.detail,
            },
            &a.created_at,
        )
        .await?;
    }
    Ok(plan_id)
}

/// 移动文件（同一磁盘直接改名，否则复制后删除）
fn move_file(from: &Path, to: &Path) -> AppResult<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to)
        .map_err(|e| AppError::InternalError(format!("无法保存收到的文件：{e}")))?;
    let _ = std::fs::remove_file(from);
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests;
