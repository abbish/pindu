//! 设备互传：把用户选中的素材 / 计划收齐依赖，生成素材包（manifest + 文件表），只读不改数据。
//!
//! 依赖：计划 → 用到的词汇本（整本）、短文、题组、场景片段；场景片段 → 所属视频（只带选中的片段）；
//! 短文 → 题组、句子分析、不在包内词汇本的目标词的单词卡。同一个对象只出现一次。

use crate::error::{AppError, AppResult};
use crate::lan::package::*;
use crate::repositories::lan_package_repository::LanPackageRepository as Repo;
use crate::repositories::pronunciation_repository::PronunciationRepository;
use crate::repositories::sentence_analysis_repository::SentenceAnalysisRepository;
use crate::repositories::tag_repository::TagRepository;
use crate::repositories::video_repository::VideoRepository;
use crate::repositories::word_card_repository::WordCardRepository;
use crate::repositories::word_repository::examples_by_word_ids;
use crate::services::video::video_dir;
use crate::types::common::Id;
use crate::types::material::MaterialKind;
use crate::types::passage::{PassageSentence, PassageTargetWord, QuestionSetSpec};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 要发送的一项：kind = word_book / passage / video / clip（短文编号）/ plan
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportItem {
    pub kind: String,
    pub id: Id,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    /// 视频带上原始视频（与编辑用的代理文件）
    #[serde(default)]
    pub include_source_video: bool,
    /// 计划连同学习进度（记忆等级、日程、练习与作答记录）
    #[serde(default)]
    pub include_progress: bool,
}

/// 生成好的素材包：manifest + 文件编号 → 本机路径
pub struct ExportedPackage {
    pub package: Package,
    pub files: HashMap<String, PathBuf>,
}

#[derive(Default)]
struct Builder {
    pkg: Package,
    files: HashMap<String, PathBuf>,
    seq: usize,
    tags: HashMap<String, String>,
    books: HashMap<Id, String>,
    plans: HashMap<Id, String>,
    words: HashMap<Id, String>,
    passages: HashMap<Id, String>,
    sets: HashMap<Id, String>,
    /// 视频编号 → 包里的位置
    videos: HashMap<Id, usize>,
    /// 视频编号 → 要带的片段（None = 全部）
    video_clips: HashMap<Id, Option<BTreeSet<Id>>>,
    card_words: BTreeSet<String>,
    analyzed: HashSet<String>,
}

impl Builder {
    fn next(&mut self, prefix: &str) -> String {
        self.seq += 1;
        format!("{prefix}{}", self.seq)
    }

    fn tag_refs(&mut self, names: Vec<String>) -> Vec<String> {
        names
            .into_iter()
            .map(|name| {
                if let Some(r) = self.tags.get(&name) {
                    return r.clone();
                }
                let r = self.next("t");
                self.pkg.tags.push(PkgTag {
                    ref_: r.clone(),
                    name: name.clone(),
                });
                self.tags.insert(name, r.clone());
                r
            })
            .collect()
    }
}

pub async fn export(
    pool: Arc<SqlitePool>,
    data_dir: &Path,
    items: &[ExportItem],
    options: &ExportOptions,
    app_version: &str,
) -> AppResult<ExportedPackage> {
    if items.is_empty() {
        return Err(AppError::ValidationError("请选择要发送的内容".into()));
    }
    let mut b = Builder::default();

    // 第一步：从选中的对象出发收齐要带的词汇本、短文、视频片段、计划（先收齐词汇本，短文的词汇才能指向包里的词）
    let mut book_ids: BTreeSet<Id> = BTreeSet::new();
    let mut passage_ids: Vec<Id> = Vec::new();
    let mut plan_ids: Vec<Id> = Vec::new();
    let mut roots: Vec<(String, Id)> = Vec::new();
    for item in items {
        match item.kind.as_str() {
            "word_book" => {
                book_ids.insert(item.id);
            }
            "passage" | "clip" => passage_ids.push(item.id),
            "video" => {
                b.video_clips.insert(item.id, None);
            }
            "plan" => {
                let Some(_) = Repo::plan(&pool, item.id).await? else {
                    return Err(AppError::NotFound("学习计划不存在，可能已被删除".into()));
                };
                for w in Repo::plan_words(&pool, item.id).await? {
                    if let Some(book) = w.word_book_id {
                        book_ids.insert(book);
                    }
                }
                for t in Repo::plan_passages(&pool, item.id).await? {
                    passage_ids.push(t.passage_id);
                }
                plan_ids.push(item.id);
            }
            other => {
                return Err(AppError::ValidationError(format!(
                    "不支持发送这种内容：{other}"
                )))
            }
        }
        roots.push((item.kind.clone(), item.id));
    }
    // 片段归到所属视频
    let mut plain_passages = Vec::new();
    for id in passage_ids {
        match Repo::clip_video_of_passage(&pool, id).await? {
            Some(video) => {
                let entry = b.video_clips.entry(video).or_insert(Some(BTreeSet::new()));
                if let Some(set) = entry {
                    set.insert(id);
                }
            }
            None => plain_passages.push(id),
        }
    }

    // 第二步：按依赖顺序写进包
    for id in book_ids {
        add_book(&mut b, &pool, id).await?;
    }
    for id in plain_passages {
        add_passage(&mut b, &pool, id).await?;
    }
    let videos: Vec<(Id, Option<BTreeSet<Id>>)> = b.video_clips.clone().into_iter().collect();
    for (id, clips) in videos {
        add_video(&mut b, &pool, data_dir, id, clips, options).await?;
    }
    for id in plan_ids {
        add_plan(&mut b, &pool, id, options.include_progress).await?;
    }
    add_cards_and_analyses(&mut b, &pool).await?;

    for (kind, id) in roots {
        let r = match kind.as_str() {
            "word_book" => b.books.get(&id).cloned(),
            "passage" | "clip" => b.passages.get(&id).cloned(),
            "video" => b.videos.get(&id).map(|&i| b.pkg.videos[i].ref_.clone()),
            "plan" => b.plans.get(&id).cloned(),
            _ => None,
        };
        if let Some(r) = r {
            if !b.pkg.roots.iter().any(|x| x.ref_ == r) {
                b.pkg.roots.push(Root { kind, ref_: r });
            }
        }
    }

    b.pkg.format = FORMAT.into();
    b.pkg.version = VERSION;
    b.pkg.app = AppInfo {
        version: app_version.to_string(),
        schema: crate::database::MIGRATOR.iter().count() as i64,
    };
    b.pkg.created_at = crate::time::now_utc();
    b.pkg
        .validate()
        .map_err(|e| AppError::InternalError(format!("生成的素材包不完整：{e}")))?;
    Ok(ExportedPackage {
        package: b.pkg,
        files: b.files,
    })
}

async fn tags_of(pool: &Arc<SqlitePool>, kind: MaterialKind, id: Id) -> AppResult<Vec<String>> {
    Ok(TagRepository::new(pool.clone())
        .tags_of(kind, id)
        .await?
        .into_iter()
        .map(|t| t.name)
        .collect())
}

async fn add_book(b: &mut Builder, pool: &Arc<SqlitePool>, id: Id) -> AppResult<()> {
    if b.books.contains_key(&id) {
        return Ok(());
    }
    let book = Repo::book(pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound("词汇本不存在，可能已被删除".into()))?;
    let rows = Repo::words_of_book(pool, id).await?;
    let ids: Vec<Id> = rows.iter().map(|w| w.id).collect();
    let mut examples = examples_by_word_ids(pool, &ids).await?;
    let mut words = Vec::with_capacity(rows.len());
    for w in rows {
        let r = b.next("w");
        b.words.insert(w.id, r.clone());
        words.push(PkgWord {
            ref_: r,
            word: w.word,
            meaning: w.meaning,
            description: w.description,
            ipa: w.ipa,
            syllables: w.syllables,
            phonics_segments: w.phonics_segments,
            part_of_speech: w.part_of_speech,
            pos_abbreviation: w.pos_abbreviation,
            pos_english: w.pos_english,
            pos_chinese: w.pos_chinese,
            phonics_rule: w.phonics_rule,
            analysis_explanation: w.analysis_explanation,
            phrase_type: w.phrase_type,
            separable: w.separable,
            examples: examples.remove(&w.id).unwrap_or_default(),
        });
    }
    let tags = tags_of(pool, MaterialKind::WordBook, id).await?;
    let tags = b.tag_refs(tags);
    let r = b.next("wb");
    b.books.insert(id, r.clone());
    b.pkg.word_books.push(PkgWordBook {
        ref_: r,
        title: book.title,
        description: book.description,
        icon: book.icon,
        icon_color: book.icon_color,
        tags,
        words,
    });
    Ok(())
}

fn parse<T: serde::de::DeserializeOwned>(raw: &str, what: &str) -> AppResult<T> {
    serde_json::from_str(raw).map_err(|e| AppError::InternalError(format!("{what}格式不对：{e}")))
}

/// 写入短文（含题组），返回 ref；已在包里直接返回
async fn add_passage(b: &mut Builder, pool: &Arc<SqlitePool>, id: Id) -> AppResult<String> {
    if let Some(r) = b.passages.get(&id) {
        return Ok(r.clone());
    }
    let p = Repo::passage(pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound("短文不存在，可能已被删除".into()))?;
    let sentences: Vec<PassageSentence> = parse(&p.sentences, "短文句子")?;
    let targets: Vec<PassageTargetWord> = parse(&p.target_words, "短文词汇")?;
    let target_words = targets
        .into_iter()
        .map(|t| {
            let word_ref = t.word_id.and_then(|wid| b.words.get(&wid).cloned());
            if word_ref.is_none() {
                b.card_words.insert(t.word.clone());
            }
            PkgTargetWord {
                word: t.word,
                word_ref,
                required: t.required,
                meaning: t.meaning,
                forms: t.forms,
            }
        })
        .collect();
    let mut question_sets = Vec::new();
    for set in Repo::sets_of_passage(pool, id).await? {
        let spec: QuestionSetSpec = parse(&set.spec, "题组参数")?;
        let questions = Repo::questions_of_set(pool, set.id)
            .await?
            .into_iter()
            .map(|q| -> AppResult<PkgQuestion> {
                Ok(PkgQuestion {
                    kind: q.kind,
                    stem: q.stem,
                    options: q
                        .options
                        .as_deref()
                        .map(|o| parse(o, "选项"))
                        .transpose()?
                        .unwrap_or_default(),
                    answer: q.answer,
                    explanation: q.explanation,
                    reference_answer: q.reference_answer,
                    rubric: q
                        .rubric
                        .as_deref()
                        .map(|o| parse(o, "评分要点"))
                        .transpose()?
                        .unwrap_or_default(),
                    sentence_index: q.sentence_index,
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        let r = b.next("qs");
        b.sets.insert(set.id, r.clone());
        question_sets.push(PkgQuestionSet {
            ref_: r,
            name: set.name,
            mode: set.mode,
            spec,
            cloze_distractors: set
                .cloze_distractors
                .as_deref()
                .map(|o| parse(o, "干扰词"))
                .transpose()?
                .unwrap_or_default(),
            questions,
        });
    }
    for s in &sentences {
        b.analyzed.insert(s.en.clone());
    }
    let tags = tags_of(pool, MaterialKind::Passage, id).await?;
    let tags = b.tag_refs(tags);
    let r = b.next("ps");
    b.passages.insert(id, r.clone());
    b.pkg.passages.push(PkgPassage {
        ref_: r.clone(),
        title: p.title,
        scene: p.scene,
        level: p.level,
        origin: p.origin,
        source_label: p.source_label,
        sentences,
        target_words,
        tags,
        question_sets,
    });
    Ok(r)
}

/// 视频目录里的一个文件放进文件表（不存在的跳过），返回是否放入
async fn add_file(
    b: &mut Builder,
    files: &mut Vec<PkgVideoFile>,
    dir: &Path,
    rel: &str,
    kind: &str,
) -> AppResult<bool> {
    let path = dir.join(rel);
    if !safe_video_path(rel) || !path.is_file() {
        return Ok(false);
    }
    let (size, sha256) = hash_file(path.clone()).await?;
    let id = b.next("f");
    b.pkg.files.push(PkgFile {
        id: id.clone(),
        size,
        sha256,
        kind: kind.to_string(),
    });
    b.files.insert(id.clone(), path);
    files.push(PkgVideoFile {
        path: rel.to_string(),
        file: id,
    });
    Ok(true)
}

/// 文件大小与 SHA-256（大文件放到阻塞线程算）
pub async fn hash_file(path: PathBuf) -> AppResult<(u64, String)> {
    tokio::task::spawn_blocking(move || -> std::io::Result<(u64, String)> {
        use std::io::Read;
        let mut f = std::fs::File::open(&path)?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1024 * 1024];
        let mut size = 0u64;
        loop {
            let n = f.read(&mut buf)?;
            if n == 0 {
                break;
            }
            size += n as u64;
            hasher.update(&buf[..n]);
        }
        Ok((size, crate::lan::identity::hex(&hasher.finalize())))
    })
    .await
    .map_err(|e| AppError::InternalError(e.to_string()))?
    .map_err(|e| AppError::InternalError(format!("读取文件失败：{e}")))
}

async fn add_video(
    b: &mut Builder,
    pool: &Arc<SqlitePool>,
    data_dir: &Path,
    id: Id,
    only: Option<BTreeSet<Id>>,
    options: &ExportOptions,
) -> AppResult<()> {
    let v = VideoRepository::get(pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".into()))?;
    let dir = video_dir(data_dir, id);
    let mut files = Vec::new();
    add_file(b, &mut files, &dir, "cover.jpg", "image").await?;
    add_file(b, &mut files, &dir, "peaks.json", "json").await?;
    let mut thumbs: Vec<String> = std::fs::read_dir(dir.join("thumbs"))
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .map(|n| format!("thumbs/{n}"))
                .collect()
        })
        .unwrap_or_default();
    thumbs.sort();
    for t in thumbs {
        add_file(b, &mut files, &dir, &t, "image").await?;
    }
    let (mut source_file, mut media_file) = (None, None);
    if options.include_source_video {
        if let Some(src) = v.source_file.as_deref() {
            if add_file(b, &mut files, &dir, src, "video").await? {
                source_file = Some(src.to_string());
            }
        }
        match v.media_file.as_deref() {
            Some(m) if Some(m) == source_file.as_deref() => media_file = source_file.clone(),
            Some(m) if add_file(b, &mut files, &dir, m, "video").await? => {
                media_file = Some(m.to_string());
            }
            _ => {}
        }
    }

    let mut plan_refs = HashMap::new();
    let mut plans = Vec::new();
    for p in VideoRepository::plans(pool, id).await? {
        let r = b.next("vp");
        plan_refs.insert(p.id, r.clone());
        plans.push(PkgVideoPlan {
            ref_: r,
            name: p.name.clone(),
            plan: p.plan(),
        });
    }

    let mut clips = Vec::new();
    for c in VideoRepository::clips(pool, id).await? {
        if only
            .as_ref()
            .is_some_and(|set| !set.contains(&c.passage_id))
        {
            continue;
        }
        if !add_file(b, &mut files, &dir, &c.file, "video").await? {
            return Err(AppError::NotFound(format!(
                "视频「{}」的场景片段文件不见了",
                v.title
            )));
        }
        let poster = match c.poster_file.as_deref() {
            Some(p) if add_file(b, &mut files, &dir, p, "image").await? => Some(p.to_string()),
            _ => None,
        };
        let passage_ref = add_passage(b, pool, c.passage_id).await?;
        clips.push(PkgClip {
            passage_ref,
            seq: c.seq,
            start_ms: c.start_ms,
            end_ms: c.end_ms,
            plan_ref: c.plan_id.and_then(|p| plan_refs.get(&p).cloned()),
            file: c.file,
            poster,
        });
    }
    if media_file.is_none() && clips.is_empty() {
        return Err(AppError::ValidationError(format!(
            "视频「{}」还没有切出场景片段，请勾选「包括原始视频」再发送",
            v.title
        )));
    }

    let tags = tags_of(pool, MaterialKind::Video, id).await?;
    let tags = b.tag_refs(tags);
    let r = b.next("v");
    b.videos.insert(id, b.pkg.videos.len());
    b.pkg.videos.push(PkgVideo {
        ref_: r,
        title: v.title.clone(),
        source_name: v.source_name.clone(),
        subtitle_name: v.subtitle_name.clone(),
        cues: parse(&v.cues, "字幕")?,
        subtitle_offset_ms: v.subtitle_offset_ms,
        duration_ms: v.duration_ms,
        width: v.width,
        height: v.height,
        plan_suggestions: v
            .plan_suggestions
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok()),
        tags,
        plans,
        files,
        source_file,
        media_file,
        clips,
    });
    Ok(())
}

async fn add_plan(
    b: &mut Builder,
    pool: &Arc<SqlitePool>,
    id: Id,
    with_progress: bool,
) -> AppResult<()> {
    let plan = Repo::plan(pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound("学习计划不存在，可能已被删除".into()))?;
    let words = Repo::plan_words(pool, id)
        .await?
        .into_iter()
        .filter_map(|w| {
            Some(PkgPlanWord {
                word_ref: b.words.get(&w.word_id)?.clone(),
                difficulty: w.difficulty as i32,
                priority: w.priority,
            })
        })
        .collect();
    let mut passage_tasks = Vec::new();
    for t in Repo::plan_passages(pool, id).await? {
        let passage_ref = add_passage(b, pool, t.passage_id).await?;
        passage_tasks.push(PkgPlanPassage {
            passage_ref,
            set_ref: t.set_id.and_then(|s| b.sets.get(&s).cloned()),
            mode: t.mode,
        });
    }
    let progress = if with_progress {
        Some(progress_of(b, pool, id).await?)
    } else {
        None
    };
    let r = b.next("p");
    b.plans.insert(id, r.clone());
    b.pkg.plans.push(PkgPlan {
        ref_: r,
        name: plan.name,
        description: plan.description.unwrap_or_default(),
        practice_content: plan.practice_content,
        daily_new_words: plan.daily_new_words,
        passage_interval_days: plan.passage_interval_days,
        words,
        passage_tasks,
        progress,
    });
    Ok(())
}

/// 把作答 JSON 里的题目编号换成题目在题组里的顺序（导出）或反过来（导入）
pub fn remap_question_ids(
    answers: &mut serde_json::Value,
    map: &dyn Fn(i64) -> Option<i64>,
) -> bool {
    let mut ok = true;
    for key in ["clozeResults", "questionResults"] {
        if let Some(items) = answers.get_mut(key).and_then(|v| v.as_array_mut()) {
            for item in items {
                let mapped = item
                    .get("questionId")
                    .and_then(|q| q.as_i64())
                    .and_then(map);
                match mapped {
                    Some(n) => item["questionId"] = serde_json::json!(n),
                    None => ok = false,
                }
            }
        }
    }
    ok
}

/// 日程 JSON（StudyPlanAIResult）里的单词与词汇本编号换掉（导出换成引用，导入换成新编号）；解析不了返回 None
pub fn remap_plan_data(
    raw: &str,
    word: &dyn Fn(&str) -> Option<String>,
    book: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    let mut v: serde_json::Value = serde_json::from_str(raw).ok()?;
    for day in v.get_mut("dailyPlans")?.as_array_mut()? {
        for w in day.get_mut("words")?.as_array_mut()? {
            let id = w.get("wordId")?.as_str()?.to_string();
            w["wordId"] = serde_json::json!(word(&id)?);
            if let Some(b) = w
                .get("wordbookId")
                .and_then(|b| b.as_str())
                .map(str::to_string)
            {
                w["wordbookId"] = serde_json::json!(book(&b)?);
            }
        }
    }
    Some(v.to_string())
}

async fn progress_of(b: &mut Builder, pool: &Arc<SqlitePool>, id: Id) -> AppResult<PkgProgress> {
    let state = Repo::plan_state(pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound("学习计划不存在，可能已被删除".into()))?;
    let word_ref = |b: &Builder, wid: Id| -> AppResult<String> {
        b.words
            .get(&wid)
            .cloned()
            .ok_or_else(|| AppError::InternalError("学习进度里有不在词汇本里的单词".into()))
    };

    let schedules = Repo::schedules(pool, id).await?;
    let day_of: HashMap<Id, i64> = schedules.iter().map(|s| (s.id, s.day_number)).collect();
    let mut words_of: HashMap<Id, Vec<PkgScheduleWord>> = HashMap::new();
    for w in Repo::schedule_words(pool, id).await? {
        words_of
            .entry(w.schedule_id)
            .or_default()
            .push(PkgScheduleWord {
                word_ref: word_ref(b, w.word_id)?,
                review: w.is_review,
                review_count: w.review_count,
                priority: w.priority,
                difficulty: w.difficulty_level,
                created_at: w.created_at.unwrap_or_default(),
            });
    }
    let schedules = schedules
        .into_iter()
        .map(|s| PkgSchedule {
            words: words_of.remove(&s.id).unwrap_or_default(),
            day: s.day_number,
            date: s.schedule_date,
            status: s.status.unwrap_or_else(|| "not-started".into()),
            new_words_count: s.new_words_count.unwrap_or(0),
            review_words_count: s.review_words_count.unwrap_or(0),
            total_words_count: s.total_words_count.unwrap_or(0),
            completed_words_count: s.completed_words_count.unwrap_or(0),
            created_at: s.created_at.unwrap_or_default(),
            updated_at: s.updated_at.unwrap_or_default(),
        })
        .collect();

    let mut word_states = Vec::new();
    for w in Repo::word_states(pool, id).await? {
        word_states.push(PkgWordState {
            word_ref: word_ref(b, w.word_id)?,
            learned: w.learned,
            correct_count: w.correct_count,
            total_attempts: w.total_attempts,
            last_studied: w.last_studied,
            next_review: w.next_review,
            mastery_score: w.mastery_score,
            srs_box: w.srs_box,
            srs_due: w.srs_due,
            srs_last: w.srs_last,
            srs_lapses: w.srs_lapses,
            srs_reviews: w.srs_reviews,
        });
    }

    let mut pauses: HashMap<String, Vec<PkgPause>> = HashMap::new();
    for p in Repo::pauses(pool, id).await? {
        pauses.entry(p.session_id).or_default().push(PkgPause {
            start: p.pause_start,
            end: p.pause_end,
            created_at: p.created_at.unwrap_or_default(),
        });
    }
    let mut records: HashMap<String, Vec<PkgRecord>> = HashMap::new();
    for r in Repo::records(pool, id).await? {
        records.entry(r.session_id).or_default().push(PkgRecord {
            word_ref: word_ref(b, r.word_id)?,
            step: r.step,
            user_input: r.user_input,
            correct: r.is_correct,
            time_spent: r.time_spent,
            attempts: r.attempts.unwrap_or(1),
            kind: r.kind,
            created_at: r.created_at.unwrap_or_default(),
        });
    }
    let mut session_index: HashMap<String, usize> = HashMap::new();
    let sessions: Vec<PkgSession> = Repo::sessions(pool, id)
        .await?
        .into_iter()
        .filter_map(|s| {
            let day = *day_of.get(&s.schedule_id)?;
            session_index.insert(s.id.clone(), session_index.len());
            Some(PkgSession {
                day,
                pauses: pauses.remove(&s.id).unwrap_or_default(),
                records: records.remove(&s.id).unwrap_or_default(),
                schedule_date: s.schedule_date,
                start_time: s.start_time,
                end_time: s.end_time,
                total_time: s.total_time.unwrap_or(0),
                active_time: s.active_time.unwrap_or(0),
                pause_count: s.pause_count.unwrap_or(0),
                completed: s.completed.unwrap_or(false),
                created_at: s.created_at.unwrap_or_default(),
                updated_at: s.updated_at.unwrap_or_default(),
            })
        })
        .collect();

    let study_records = Repo::study_records(pool, id)
        .await?
        .into_iter()
        .map(|r| PkgStudyRecord {
            started_at: r.started_at,
            finished_at: r.finished_at,
            words_studied: r.words_studied,
            correct_answers: r.correct_answers,
            total_time_seconds: r.total_time_seconds,
        })
        .collect();

    // 计划里的短文作答（题组都随短文进了包）
    let plan_attempts = Repo::plan_attempts(pool, id).await?;
    let mut conn = pool.acquire().await?;
    let mut attempts = Vec::new();
    let mut attempt_index: HashMap<Id, usize> = HashMap::new();
    for a in plan_attempts {
        let (Some(passage_ref), Some(set_ref)) = (
            b.passages.get(&a.passage_id).cloned(),
            b.sets.get(&a.set_id).cloned(),
        ) else {
            continue;
        };
        let order = Repo::question_ids_conn(&mut conn, a.set_id).await?;
        let answers = match a
            .answers
            .as_deref()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        {
            Some(mut v) => {
                remap_question_ids(&mut v, &|q| {
                    order.iter().position(|&x| x == q).map(|i| i as i64)
                });
                Some(v)
            }
            None => None,
        };
        attempt_index.insert(a.id, attempts.len());
        attempts.push(PkgAttempt {
            passage_ref,
            set_ref,
            day: a.schedule_id.and_then(|s| day_of.get(&s).copied()),
            mode: a.mode,
            status: a.status,
            answers,
            objective_correct: a.objective_correct,
            objective_total: a.objective_total,
            open_score: a.open_score,
            open_total: a.open_total,
            active_time: a.active_time,
            started_at: a.started_at,
            completed_at: a.completed_at,
        });
    }
    drop(conn);
    let passage_tasks = Repo::plan_passage_states(pool, id)
        .await?
        .into_iter()
        .map(|t| PkgPassageTaskState {
            scheduled_date: t.scheduled_date,
            completed_at: t.completed_at,
            attempt: t.attempt_id.and_then(|a| attempt_index.get(&a).copied()),
            created_at: t.created_at,
        })
        .collect();
    let history = Repo::history(pool, id)
        .await?
        .into_iter()
        .map(|h| PkgStatusChange {
            from: h.from_status,
            to: h.to_status,
            from_lifecycle: h.from_lifecycle_status,
            to_lifecycle: h.to_lifecycle_status,
            reason: h.reason,
            at: h.created_at.unwrap_or_default(),
        })
        .collect();

    // 跟读评估：单词不在包里的不带编号（统计照样用逐音记录）
    let pronunciation = PronunciationRepository::list_full_by_plan(pool, id)
        .await?
        .into_iter()
        .map(|a| PkgPronunciation {
            session: a
                .session_id
                .as_ref()
                .and_then(|s| session_index.get(s).copied()),
            source: a.source,
            word_ref: a.word_id.and_then(|w| b.words.get(&w).cloned()),
            passage_ref: a.passage_id.and_then(|p| b.passages.get(&p).cloned()),
            text: a.text,
            score: a.score,
            detail: a.detail,
            created_at: a.created_at,
        })
        .collect();

    let ai_plan_data = state.ai_plan_data.as_deref().and_then(|raw| {
        remap_plan_data(
            raw,
            &|wid| {
                wid.parse::<Id>()
                    .ok()
                    .and_then(|w| b.words.get(&w).cloned())
            },
            &|bid| {
                bid.parse::<Id>()
                    .ok()
                    .and_then(|x| b.books.get(&x).cloned())
            },
        )
    });
    Ok(PkgProgress {
        // 草稿 / 已删除的计划按「待开始」传（界面上已没有草稿）
        status: match state.unified_status.as_deref() {
            Some(s @ ("Active" | "Paused" | "Completed" | "Terminated")) => s.to_string(),
            _ => "Pending".into(),
        },
        start_date: state.start_date,
        end_date: state.end_date,
        actual_start_date: state.actual_start_date,
        actual_end_date: state.actual_end_date,
        actual_terminated_date: state.actual_terminated_date,
        intensity_level: state.intensity_level,
        study_period_days: state.study_period_days,
        review_frequency: state.review_frequency,
        mastery_level: state.mastery_level.unwrap_or(1),
        ai_plan_data,
        created_at: state.created_at.unwrap_or_default(),
        schedules,
        word_states,
        sessions,
        study_records,
        passage_tasks,
        attempts,
        history,
        pronunciation,
    })
}

async fn add_cards_and_analyses(b: &mut Builder, pool: &Arc<SqlitePool>) -> AppResult<()> {
    let words: Vec<String> = b.card_words.iter().cloned().collect();
    let cards = WordCardRepository::new(pool.clone())
        .find_many(&words)
        .await?;
    let mut cards: Vec<_> = cards.into_values().collect();
    cards.sort_by(|a, c| a.word.cmp(&c.word));
    b.pkg.word_cards = cards;

    let repo = SentenceAnalysisRepository::new(pool.clone());
    let mut sentences: Vec<String> = b.analyzed.iter().cloned().collect();
    sentences.sort();
    for s in sentences {
        if let Some(analysis) = repo.find(&s).await? {
            b.pkg.sentence_analyses.push(PkgSentenceAnalysis {
                sentence: s,
                analysis,
            });
        }
    }
    Ok(())
}
