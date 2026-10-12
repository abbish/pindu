//! 素材包往返：在一个库里建好词汇本、短文（题组、句子分析、单词卡）、视频片段、计划，
//! 导出后导入到另一个空库，逐项核对；再导入一次是新的一份；中途失败不留残留。

use super::*;
use crate::lan::package::Package;
use crate::repositories::word_card_repository::WordCardRepository;
use crate::services::lan_export::{export, ExportItem, ExportOptions};
use crate::services::passage_rules::GeneratedQuestionSet;
use crate::services::subtitle::Cue;
use crate::test_support::{memory_pool, test_logger};
use crate::types::material::WordCard;
use crate::types::passage::{PassageSentence, QuestionSetSpec, SentenceAnalysis};
use crate::types::video::VideoPlan;
use crate::types::wordbook::WordExample;
use sqlx::Row;

pub(crate) struct Source {
    pub pool: Arc<SqlitePool>,
    pub dir: PathBuf,
    pub plan_id: Id,
    pub video_id: Id,
    pub clip_passages: Vec<Id>,
}

pub(crate) fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pindu-pkg-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn word(w: &str, meaning: &str, book: Id) -> Word {
    Word {
        id: 0,
        word: w.into(),
        meaning: meaning.into(),
        description: None,
        ipa: Some(format!("/{w}/")),
        syllables: None,
        phonics_segments: None,
        image_path: None,
        audio_path: None,
        part_of_speech: None,
        category_id: None,
        word_book_id: Some(book),
        pos_abbreviation: Some("v.".into()),
        pos_english: None,
        pos_chinese: None,
        phonics_rule: Some("规则".into()),
        analysis_explanation: None,
        examples: vec![WordExample {
            sentence: format!("I {w} it."),
            translation: "例句".into(),
        }],
        kind: String::new(),
        phrase_type: (w.contains(' ')).then(|| "phrasal_verb".into()),
        separable: w.contains(' '),
        created_at: String::new(),
        updated_at: String::new(),
    }
}

fn sentences(texts: &[&str]) -> Vec<PassageSentence> {
    texts
        .iter()
        .map(|t| PassageSentence {
            en: t.to_string(),
            zh: "中文".into(),
            ..Default::default()
        })
        .collect()
}

async fn insert_passage(
    tx: &mut sqlx::SqliteConnection,
    title: &str,
    texts: &[&str],
    targets: Vec<PassageTargetWord>,
) -> Id {
    let s = sentences(texts);
    PassageRepository::insert_passage_conn(
        tx,
        &NewPassage {
            origin: "generated",
            source_label: None,
            scene: Some("机场"),
            level: "A2",
            sources: &[],
            model_name: Some("m"),
            prompt_fingerprint: None,
        },
        &GeneratedPassage {
            title: title.into(),
            word_count: english_word_count(&s),
            sentences: s,
            target_words: targets,
            tags: vec![],
        },
    )
    .await
    .unwrap()
}

pub(crate) async fn seed() -> Source {
    let pool = memory_pool().await;
    let logger = test_logger();
    let dir = temp_dir("src");
    let mut tx = pool.begin().await.unwrap();

    let tags = TagService::new(pool.clone())
        .ensure_names_conn(&mut tx, &["旅行".to_string()])
        .await
        .unwrap();
    let books = WordBookRepository::new(pool.clone(), logger.clone());
    let book = books
        .insert_conn(&mut tx, "旅行词汇", "出门用", "plane", "green", "normal")
        .await
        .unwrap();
    books.add_tags_conn(&mut tx, book, &tags).await.unwrap();
    let ids = WordRepository::new(pool.clone(), logger.clone())
        .create_batch(
            &mut tx,
            &[
                word("ticket", "票", book),
                word("pick up", "接", book),
                word("gate", "登机口", book),
            ],
        )
        .await
        .unwrap();

    // 文字短文：一个词汇指向词汇本里的词，一个不在词汇本（带单词卡）
    let text = insert_passage(
        &mut tx,
        "在机场",
        &["I pick up my ticket.", "The airport is big."],
        vec![
            PassageTargetWord {
                word_id: Some(ids[1]),
                word: "pick up".into(),
                required: true,
                meaning: None,
                forms: vec!["pick up".into()],
            },
            PassageTargetWord {
                word_id: None,
                word: "airport".into(),
                required: false,
                meaning: Some("机场".into()),
                forms: vec![],
            },
        ],
    )
    .await;
    TagRepository::new(pool.clone())
        .add_conn(&mut tx, MaterialKind::Passage, text, &tags)
        .await
        .unwrap();
    let set = PassageRepository::insert_set_conn(
        &mut tx,
        &NewQuestionSet {
            passage_id: text,
            name: "第 1 套",
            mode: "reading",
            spec: &QuestionSetSpec {
                cloze: 0,
                choice: 1,
                true_false: 1,
                open: 0,
                difficulty: "basic".into(),
            },
            model_name: None,
            prompt_fingerprint: None,
        },
        &GeneratedQuestionSet {
            questions: vec![
                NewQuestion {
                    kind: "choice".into(),
                    stem: "What is big?".into(),
                    options: vec!["The airport".into(), "The ticket".into()],
                    answer: Some("0".into()),
                    explanation: Some("第二句".into()),
                    reference_answer: None,
                    rubric: vec![],
                    sentence_index: Some(1),
                },
                NewQuestion {
                    kind: "true_false".into(),
                    stem: "I pick up my ticket.".into(),
                    options: vec![],
                    answer: Some("true".into()),
                    explanation: None,
                    reference_answer: None,
                    rubric: vec![],
                    sentence_index: Some(0),
                },
            ],
            cloze_distractors: vec![],
        },
    )
    .await
    .unwrap();

    // 视频：两段场景片段
    let video_id = Repo::insert_video_conn(
        &mut tx,
        &NewVideo {
            title: "机场对话",
            source_name: "airport.mp4",
            source_file: Some("source.mp4"),
            media_file: Some("source.mp4"),
            subtitle_name: Some("airport.srt"),
            cues: &serde_json::to_string(&vec![Cue {
                start_ms: 0,
                end_ms: 2000,
                en: "Where is the gate?".into(),
                zh: "登机口在哪？".into(),
                join: None,
            }])
            .unwrap(),
            duration_ms: 60_000,
            width: Some(1280),
            height: Some(720),
            size_bytes: 11,
            status: "done",
            subtitle_offset_ms: 120,
            plan_suggestions: None,
        },
    )
    .await
    .unwrap();
    let vplan = Repo::insert_video_plan_conn(
        &mut tx,
        video_id,
        "规划 1",
        &serde_json::to_string(&VideoPlan {
            requirements: "按场景".into(),
            ..Default::default()
        })
        .unwrap(),
    )
    .await
    .unwrap();
    let vdir = video_dir(&dir, video_id);
    std::fs::create_dir_all(vdir.join("thumbs")).unwrap();
    std::fs::create_dir_all(vdir.join("clips")).unwrap();
    for (path, body) in [
        ("source.mp4", "SOURCE-DATA"),
        ("cover.jpg", "cover"),
        ("peaks.json", "[1,2,3]"),
        ("thumbs/thumb_0001.jpg", "t1"),
        ("clips/1-a.mp4", "clip-a"),
        ("clips/1-a.jpg", "poster-a"),
        ("clips/1-b.mp4", "clip-b"),
    ] {
        std::fs::write(vdir.join(path), body).unwrap();
    }
    let mut clip_passages = Vec::new();
    for (seq, file, poster) in [
        (1, "clips/1-a.mp4", Some("clips/1-a.jpg")),
        (2, "clips/1-b.mp4", None),
    ] {
        let p = insert_passage(
            &mut tx,
            &format!("片段 {seq}"),
            &["Where is the gate?"],
            vec![],
        )
        .await;
        VideoRepository::insert_clip_conn(
            &mut tx,
            video_id,
            Some(vplan),
            p,
            seq,
            0,
            2000,
            file,
            poster,
        )
        .await
        .unwrap();
        clip_passages.push(p);
    }
    tx.commit().await.unwrap();

    WordCardRepository::new(pool.clone())
        .upsert(&WordCard {
            word: "airport".into(),
            meaning: "机场".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    crate::repositories::sentence_analysis_repository::SentenceAnalysisRepository::new(
        pool.clone(),
    )
    .upsert(
        "The airport is big.",
        &SentenceAnalysis {
            pattern: "主语 + be + 形容词".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // 计划：学习顺序 gate → ticket → pick up，每天 2 个；短文任务带题组，还有一段场景片段
    let today = crate::time::format_date(crate::time::local_today());
    let order = [2usize, 0, 1];
    let words = ["ticket", "pick up", "gate"];
    let ordered: Vec<(PlanWord, WordAssessment)> = order
        .iter()
        .map(|&i| {
            (
                PlanWord {
                    word_id: ids[i],
                    word: words[i].into(),
                    wordbook_id: book,
                    meaning: None,
                },
                WordAssessment {
                    word_id: ids[i],
                    difficulty: 2,
                    priority: "high".into(),
                },
            )
        })
        .collect();
    let schedule = build_schedule(
        &PlanParams {
            daily_new_words: 2,
            start_date: today.clone(),
        },
        &ordered,
    )
    .unwrap();
    let plan_id = StudyPlanService::new(pool.clone(), logger.clone())
        .create_study_plan_with_schedule(CreateStudyPlanWithScheduleRequest {
            name: "出国前".into(),
            description: "两周".into(),
            intensity_level: String::new(),
            study_period_days: 0,
            review_frequency: 0,
            start_date: today,
            end_date: schedule.plan_metadata.end_date.clone(),
            ai_plan_data: serde_json::to_string(&schedule).unwrap(),
            wordbook_ids: vec![book],
            status: Some("active".into()),
            practice_content: Some("both".into()),
            passages: vec![
                PlanPassageInput {
                    passage_id: text,
                    set_id: Some(set),
                    mode: "reading".into(),
                },
                PlanPassageInput {
                    passage_id: clip_passages[1],
                    set_id: None,
                    mode: "reading".into(),
                },
            ],
            passage_interval_days: Some(3),
        })
        .await
        .unwrap();

    Source {
        pool,
        dir,
        plan_id,
        video_id,
        clip_passages,
    }
}

/// 模拟传送：按 fileId 把文件放进接收方的临时目录
fn deliver(exported: &crate::services::lan_export::ExportedPackage) -> PathBuf {
    let incoming = temp_dir("incoming");
    for (id, path) in &exported.files {
        std::fs::copy(path, incoming.join(id)).unwrap();
    }
    incoming
}

async fn count(pool: &SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
        .fetch_one(pool)
        .await
        .unwrap()
}

/// 计划的新词顺序（按日程）
async fn plan_order(pool: &SqlitePool, plan_id: Id) -> Vec<String> {
    sqlx::query(
        "SELECT w.word FROM study_plan_schedule_words sw
         JOIN study_plan_schedules s ON s.id = sw.schedule_id JOIN words w ON w.id = sw.word_id
         WHERE s.plan_id = ? AND sw.is_review = 0 ORDER BY s.day_number, sw.id",
    )
    .bind(plan_id)
    .fetch_all(pool)
    .await
    .unwrap()
    .iter()
    .map(|r| r.get("word"))
    .collect()
}

fn strip_refs(p: &Package) -> serde_json::Value {
    // 比对业务内容：去掉 ref / fileId / 创建时间（每次导出都不同）
    let mut v = serde_json::to_value(p).unwrap();
    fn walk(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Object(m) => {
                for k in [
                    "ref",
                    "wordRef",
                    "passageRef",
                    "setRef",
                    "planRef",
                    "file",
                    "createdAt",
                    "id",
                    "sha256",
                ] {
                    m.remove(k);
                }
                m.values_mut().for_each(walk);
            }
            serde_json::Value::Array(a) => a.iter_mut().for_each(walk),
            _ => {}
        }
    }
    walk(&mut v);
    v
}

#[tokio::test]
async fn round_trip_plan_and_video_into_another_database() {
    let src = seed().await;
    let items = vec![
        ExportItem {
            kind: "plan".into(),
            id: src.plan_id,
        },
        ExportItem {
            kind: "video".into(),
            id: src.video_id,
        },
    ];
    let exported = export(
        src.pool.clone(),
        &src.dir,
        &items,
        &ExportOptions::default(),
        "0.0.0",
    )
    .await
    .unwrap();
    let pkg = &exported.package;
    let summary = pkg.summary();
    assert_eq!(
        (
            summary.word_books,
            summary.words,
            summary.passages,
            summary.videos,
            summary.clips,
            summary.plans
        ),
        (1, 3, 1, 1, 2, 1)
    );
    assert!(!summary.with_source_video);
    assert_eq!(pkg.roots.len(), 2);
    // 不勾选原始视频：没有 source.mp4，其余文件都在
    let video = &pkg.videos[0];
    let paths: Vec<&str> = video.files.iter().map(|f| f.path.as_str()).collect();
    assert!(!paths.contains(&"source.mp4"));
    for p in [
        "cover.jpg",
        "peaks.json",
        "thumbs/thumb_0001.jpg",
        "clips/1-a.mp4",
        "clips/1-a.jpg",
        "clips/1-b.mp4",
    ] {
        assert!(paths.contains(&p), "{p}");
    }
    assert_eq!(pkg.word_cards.len(), 1);
    assert_eq!(pkg.sentence_analyses.len(), 1);
    // 包里没有本机编号：JSON 里不出现 wordId / passageId 之类的键
    let raw = serde_json::to_string(pkg).unwrap();
    assert!(!raw.contains("\"wordId\"") && !raw.contains("\"passageId\""));

    // 导入到另一个库（迁移自带的示例数据不算）
    let dst = memory_pool().await;
    let base_books = count(&dst, "word_books").await;
    let dst_dir = temp_dir("dst");
    let incoming = deliver(&exported);
    let result = import(dst.clone(), test_logger(), &dst_dir, pkg, &incoming)
        .await
        .unwrap();
    assert_eq!(result.word_books[0].title, "旅行词汇");
    assert_eq!(result.passages.len(), 1, "场景片段的短文不单独列出");
    assert_eq!(result.videos[0].title, "机场对话");
    let new_plan = result.plans[0].id;

    // 计划：待开始、学习顺序不变、短文任务（带题组）与间隔保留
    let status: String = sqlx::query_scalar("SELECT unified_status FROM study_plans WHERE id = ?")
        .bind(new_plan)
        .fetch_one(dst.as_ref())
        .await
        .unwrap();
    assert_eq!(status, "Pending");
    assert_eq!(
        plan_order(&dst, new_plan).await,
        vec!["gate", "ticket", "pick up"]
    );
    assert_eq!(
        plan_order(&src.pool, src.plan_id).await,
        vec!["gate", "ticket", "pick up"]
    );
    let tasks: Vec<(Option<i64>, String)> = sqlx::query_as(
        "SELECT set_id, mode FROM study_plan_passages WHERE plan_id = ? ORDER BY sort_order",
    )
    .bind(new_plan)
    .fetch_all(dst.as_ref())
    .await
    .unwrap();
    assert_eq!(tasks.len(), 2);
    assert!(tasks[0].0.is_some() && tasks[1].0.is_none());

    // 短文的词汇指向新库里的词；词索引照常建立
    let (targets, passage_id): (String, Id) =
        sqlx::query_as("SELECT target_words, id FROM passages WHERE title = '在机场'")
            .fetch_one(dst.as_ref())
            .await
            .unwrap();
    let targets: Vec<PassageTargetWord> = serde_json::from_str(&targets).unwrap();
    let pick_up: Id = sqlx::query_scalar("SELECT id FROM words WHERE word = 'pick up'")
        .fetch_one(dst.as_ref())
        .await
        .unwrap();
    assert_eq!(targets[0].word_id, Some(pick_up));
    assert_eq!(targets[1].word_id, None);
    let indexed: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM passage_words WHERE passage_id = ?")
            .bind(passage_id)
            .fetch_one(dst.as_ref())
            .await
            .unwrap();
    assert!(indexed > 0);

    // 视频：没有原始视频、片段与文件在新目录、状态 done
    let (media, status): (Option<String>, String) =
        sqlx::query_as("SELECT media_file, status FROM videos WHERE id = ?")
            .bind(result.videos[0].id)
            .fetch_one(dst.as_ref())
            .await
            .unwrap();
    assert_eq!((media, status.as_str()), (None, "done"));
    let vdir = video_dir(&dst_dir, result.videos[0].id);
    assert_eq!(
        std::fs::read_to_string(vdir.join("clips/1-a.mp4")).unwrap(),
        "clip-a"
    );
    assert!(vdir.join("thumbs/thumb_0001.jpg").is_file() && !vdir.join("source.mp4").exists());

    // 再从新库导出，业务内容与原来的一致（只差编号）
    let new_items = vec![
        ExportItem {
            kind: "plan".into(),
            id: new_plan,
        },
        ExportItem {
            kind: "video".into(),
            id: result.videos[0].id,
        },
    ];
    let again = export(
        dst.clone(),
        &dst_dir,
        &new_items,
        &ExportOptions::default(),
        "0.0.0",
    )
    .await
    .unwrap();
    assert_eq!(strip_refs(&again.package), strip_refs(pkg));

    // 再导入一次：又是新的一份
    let incoming = deliver(&exported);
    import(dst.clone(), test_logger(), &dst_dir, pkg, &incoming)
        .await
        .unwrap();
    assert_eq!(
        (count(&dst, "word_books").await, count(&dst, "videos").await),
        (base_books + 2, 2)
    );
    crate::time::assert_instants_canonical(&dst).await;
}

#[tokio::test]
async fn selected_clips_and_source_video() {
    let src = seed().await;
    // 只选一段片段：视频只带这一段
    let items = vec![ExportItem {
        kind: "clip".into(),
        id: src.clip_passages[0],
    }];
    let pkg = export(
        src.pool.clone(),
        &src.dir,
        &items,
        &ExportOptions::default(),
        "0",
    )
    .await
    .unwrap()
    .package;
    assert_eq!(pkg.videos[0].clips.len(), 1);
    assert_eq!(pkg.passages.len(), 1);
    assert_eq!(pkg.roots[0].kind, "clip");

    // 勾选原始视频
    let exported = export(
        src.pool.clone(),
        &src.dir,
        &[ExportItem {
            kind: "video".into(),
            id: src.video_id,
        }],
        &ExportOptions {
            include_source_video: true,
            ..Default::default()
        },
        "0",
    )
    .await
    .unwrap();
    assert_eq!(
        exported.package.videos[0].source_file.as_deref(),
        Some("source.mp4")
    );
    assert_eq!(
        exported.package.videos[0].media_file.as_deref(),
        Some("source.mp4")
    );
    let dst = memory_pool().await;
    let dst_dir = temp_dir("dst2");
    let result = import(
        dst.clone(),
        test_logger(),
        &dst_dir,
        &exported.package,
        &deliver(&exported),
    )
    .await
    .unwrap();
    let (media, size): (Option<String>, i64) =
        sqlx::query_as("SELECT media_file, size_bytes FROM videos WHERE id = ?")
            .bind(result.videos[0].id)
            .fetch_one(dst.as_ref())
            .await
            .unwrap();
    assert_eq!((media.as_deref(), size), (Some("source.mp4"), 11));
    assert_eq!(
        std::fs::read_to_string(video_dir(&dst_dir, result.videos[0].id).join("source.mp4"))
            .unwrap(),
        "SOURCE-DATA"
    );
}

#[tokio::test]
async fn failure_rolls_back_and_puts_files_back() {
    let src = seed().await;
    let mut exported = export(
        src.pool.clone(),
        &src.dir,
        &[
            ExportItem {
                kind: "video".into(),
                id: src.video_id,
            },
            ExportItem {
                kind: "plan".into(),
                id: src.plan_id,
            },
        ],
        &ExportOptions::default(),
        "0",
    )
    .await
    .unwrap();
    // 计划没有单词却要练单词：排日程时失败（视频文件已经移过去了）
    exported.package.plans[0].words.clear();
    exported.package.plans[0].practice_content = "words".into();
    let dst = memory_pool().await;
    let dst_dir = temp_dir("dst3");
    let tables = [
        "word_books",
        "words",
        "passages",
        "videos",
        "video_clips",
        "study_plans",
        "tags",
        "word_cards",
    ];
    let mut before = Vec::new();
    for t in tables {
        before.push(count(&dst, t).await);
    }
    let incoming = deliver(&exported);
    assert!(import(
        dst.clone(),
        test_logger(),
        &dst_dir,
        &exported.package,
        &incoming
    )
    .await
    .is_err());
    for (t, n) in tables.iter().zip(before) {
        assert_eq!(count(&dst, t).await, n, "{t} 不应该有新数据");
    }
    assert!(
        !dst_dir.join("videos").exists()
            || std::fs::read_dir(dst_dir.join("videos"))
                .unwrap()
                .next()
                .is_none()
    );
    // 收到的文件还在，可以重试
    for f in &exported.package.files {
        assert!(incoming.join(&f.id).is_file());
    }

    // 文件不完整：在写入之前就拒绝
    let incoming = deliver(&exported);
    std::fs::write(incoming.join(&exported.package.files[0].id), "x").unwrap();
    exported.package.plans.clear();
    let err = import(
        dst.clone(),
        test_logger(),
        &dst_dir,
        &exported.package,
        &incoming,
    )
    .await
    .unwrap_err();
    assert!(err.to_string().contains("不完整"), "{err}");
}

/// 在源计划上模拟学过一天：第 1 天练完、记忆等级、练习会话与作答、短文任务完成、状态历史
async fn practice_some(src: &Source) {
    let pool = src.pool.as_ref();
    let now = crate::time::now_utc();
    let today = crate::time::format_date(crate::time::local_today());
    sqlx::query(
        "UPDATE study_plans SET unified_status = 'Active', actual_start_date = ? WHERE id = ?",
    )
    .bind(&now)
    .bind(src.plan_id)
    .execute(pool)
    .await
    .unwrap();
    let (schedule_id,): (Id,) =
        sqlx::query_as("SELECT id FROM study_plan_schedules WHERE plan_id = ? AND day_number = 1")
            .bind(src.plan_id)
            .fetch_one(pool)
            .await
            .unwrap();
    sqlx::query("UPDATE study_plan_schedules SET status = 'completed', completed_words_count = 2 WHERE id = ?")
        .bind(schedule_id)
        .execute(pool)
        .await
        .unwrap();
    let (pw, word_id): (Id, Id) = sqlx::query_as(
        "SELECT pw.id, pw.word_id FROM study_plan_words pw JOIN words w ON w.id = pw.word_id
         WHERE pw.plan_id = ? AND w.word = 'gate'",
    )
    .bind(src.plan_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE study_plan_words SET learned = 1, srs_box = 2, srs_due = ?, srs_last = ?, srs_reviews = 1 WHERE id = ?")
        .bind(&today)
        .bind(&today)
        .bind(pw)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO practice_sessions (id, plan_id, schedule_id, schedule_date, start_time, end_time, total_time,
             active_time, pause_count, completed, created_at, updated_at)
         VALUES ('sess-1', ?, ?, ?, ?, ?, 300, 280, 1, 1, ?, ?)",
    )
    .bind(src.plan_id)
    .bind(schedule_id)
    .bind(&today)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO practice_pause_records (session_id, pause_start, pause_end, created_at) VALUES ('sess-1', ?, ?, ?)")
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO word_practice_records (session_id, word_id, plan_word_id, step, user_input, is_correct, time_spent, attempts, kind, created_at)
         VALUES ('sess-1', ?, ?, 1, 'gate', 1, 5, 1, 'learn', ?)",
    )
    .bind(word_id)
    .bind(pw)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO study_sessions (plan_id, started_at, finished_at, words_studied, correct_answers, total_time_seconds) VALUES (?, ?, ?, 2, 2, 280)")
        .bind(src.plan_id)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
    let (set_id, passage_id, q1): (Id, Id, Id) = sqlx::query_as(
        "SELECT qs.id, qs.passage_id, MIN(q.id) FROM passage_question_sets qs JOIN passage_questions q ON q.set_id = qs.id
         JOIN passages p ON p.id = qs.passage_id WHERE p.title = '在机场' GROUP BY qs.id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let answers = serde_json::json!({"clozeResults": [], "questionResults": [{"questionId": q1, "given": "0", "correct": true, "score": null, "feedback": null, "suggestion": null}]});
    let attempt = sqlx::query(
        "INSERT INTO passage_attempts (set_id, passage_id, plan_id, schedule_id, mode, status, answers, objective_correct,
             objective_total, active_time, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'reading', 'completed', ?, 1, 2, 60, ?, ?)",
    )
    .bind(set_id)
    .bind(passage_id)
    .bind(src.plan_id)
    .bind(schedule_id)
    .bind(answers.to_string())
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap()
    .last_insert_rowid();
    sqlx::query("UPDATE study_plan_passages SET completed_at = ?, attempt_id = ? WHERE plan_id = ? AND passage_id = ?")
        .bind(&now)
        .bind(attempt)
        .bind(src.plan_id)
        .bind(passage_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO study_plan_status_history (plan_id, from_status, to_status, reason, created_at) VALUES (?, 'Pending', 'Active', '第一次练习', ?)")
        .bind(src.plan_id)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn plan_with_progress_is_restored_as_is() {
    let src = seed().await;
    practice_some(&src).await;
    let options = ExportOptions {
        include_progress: true,
        ..Default::default()
    };
    let items = [ExportItem {
        kind: "plan".into(),
        id: src.plan_id,
    }];
    let exported = export(src.pool.clone(), &src.dir, &items, &options, "0")
        .await
        .unwrap();
    let progress = exported.package.plans[0].progress.as_ref().unwrap();
    assert_eq!(progress.status, "Active");
    assert_eq!((progress.sessions.len(), progress.attempts.len()), (1, 1));
    assert_eq!(progress.passage_tasks[0].attempt, Some(0));
    // 作答里的题目编号换成了顺序
    assert_eq!(
        progress.attempts[0].answers.as_ref().unwrap()["questionResults"][0]["questionId"],
        0
    );

    let dst = memory_pool().await;
    let dst_dir = temp_dir("dst-progress");
    let result = import(
        dst.clone(),
        test_logger(),
        &dst_dir,
        &exported.package,
        &deliver(&exported),
    )
    .await
    .unwrap();
    let plan = result.plans[0].id;

    // 原样恢复：再导出一次，进度与原来逐项一致（只差编号）
    let again = export(
        dst.clone(),
        &dst_dir,
        &[ExportItem {
            kind: "plan".into(),
            id: plan,
        }],
        &options,
        "0",
    )
    .await
    .unwrap();
    assert_eq!(strip_refs(&again.package), strip_refs(&exported.package));

    // 作答指向新库的题目；练习记录指向新计划的单词
    let (answers, q1): (String, Id) = sqlx::query_as(
        "SELECT a.answers, (SELECT MIN(id) FROM passage_questions WHERE set_id = a.set_id)
         FROM passage_attempts a WHERE a.plan_id = ?",
    )
    .bind(plan)
    .fetch_one(dst.as_ref())
    .await
    .unwrap();
    let answers: serde_json::Value = serde_json::from_str(&answers).unwrap();
    assert_eq!(answers["questionResults"][0]["questionId"], q1);
    let orphan: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM word_practice_records r LEFT JOIN study_plan_words pw ON pw.id = r.plan_word_id
         WHERE pw.id IS NULL OR pw.word_id != r.word_id",
    )
    .fetch_one(dst.as_ref())
    .await
    .unwrap();
    assert_eq!(orphan, 0);
    let srs: i64 = sqlx::query_scalar(
        "SELECT pw.srs_box FROM study_plan_words pw JOIN words w ON w.id = pw.word_id WHERE pw.plan_id = ? AND w.word = 'gate'",
    )
    .bind(plan)
    .fetch_one(dst.as_ref())
    .await
    .unwrap();
    assert_eq!(srs, 2);
    crate::time::assert_instants_canonical(&dst).await;
}
