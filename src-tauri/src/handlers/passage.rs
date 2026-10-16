//! 短文练习命令：生成短文、列表 / 详情 / 删除、开始与提交作答、开放题重新评分、统计

use super::{agent_paths, finish};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::services::passage::PassageService;
use crate::types::passage::{
    GeneratePassageRequest, GenerateQuestionSetRequest, Passage, PassageAttempt, PassageStatistics,
    PassageSummary, PassageWordCandidate, PassageWordSources, QuestionSet,
    SubmitPassageAttemptRequest,
};
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

fn service(app: &AppHandle) -> PassageService {
    PassageService::new(
        Arc::new(app.state::<SqlitePool>().inner().clone()),
        Arc::new(app.state::<Logger>().inner().clone()),
    )
}

/// 候选词：按来源（词汇本、学习计划的难词 / 已学 / 到期复习）合并，标出难词与建议勾选的词
#[tauri::command]
pub async fn get_passage_word_candidates(
    app: AppHandle,
    request: PassageWordSources,
) -> AppResult<Vec<PassageWordCandidate>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passage_word_candidates",
        Some(&format!("{:?}", request)),
    );
    let result = service(&app).candidates(&request).await;
    finish(&logger, "get_passage_word_candidates", result)
}

/// 所选计划里每种取词策略能取到的词数
#[tauri::command]
pub async fn get_plan_scope_counts(
    app: AppHandle,
    plan_ids: Vec<i64>,
) -> AppResult<Vec<crate::types::passage::PlanScopeCount>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_plan_scope_counts",
        Some(&format!("plan_ids: {:?}", plan_ids)),
    );
    let result = service(&app).plan_scope_counts(&plan_ids).await;
    finish(&logger, "get_plan_scope_counts", result)
}

/// 内容规划（后台任务）：AI 提议写几篇、每篇的构思与用词（约 20–40 秒），立即返回任务 id；
/// 规划在 job.result（PassagePlan），不保存。离开新建页也会继续，可以取消。`feedback` 为对上一版规划的调整意见
#[tauri::command]
pub async fn start_passage_planning(
    app: AppHandle,
    request: GeneratePassageRequest,
    feedback: Option<String>,
) -> AppResult<String> {
    use crate::jobs::{JobLink, JobModule, JobSpec, Jobs, Lane};
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_passage_planning",
        Some(&format!(
            "feedback_chars: {}",
            feedback.as_deref().unwrap_or("").chars().count()
        )),
    );
    let result = async {
        // 先做请求校验与路径准备，错误直接返回给页面
        crate::services::passage::PassageService::validate_request(&request)?;
        if feedback.as_deref().unwrap_or("").chars().count() > crate::services::passage::TOPIC_MAX {
            return Err(AppError::ValidationError(format!(
                "调整意见最多 {} 个字",
                crate::services::passage::TOPIC_MAX
            )));
        }
        let paths = agent_paths(&app)?;
        let service = service(&app);
        let spec = JobSpec {
            kind: "passage_plan",
            module: Some(JobModule::Passages),
            title: "规划短文内容".to_string(),
            lane: Lane::Agent,
            detached: true,
            link: Some(JobLink::new("create-passage", serde_json::json!({}))),
        };
        Ok(app.state::<Jobs>().spawn(spec, move |ctx| async move {
            ctx.stage("正在规划内容");
            let cancel = ctx.clone();
            let plan = service
                .plan(
                    &request,
                    feedback.as_deref().unwrap_or(""),
                    &paths,
                    move || cancel.is_cancelled(),
                )
                .await?;
            serde_json::to_value(plan).map_err(|e| AppError::InternalError(e.to_string()))
        }))
    }
    .await;
    finish(&logger, "start_passage_planning", result)
}

/// 新建短文的场景建议：按所选词汇本的场景与要用的单词给 4–6 个场景（换一批时 exclude 已给过的）；
/// 没有词汇本也没有单词时返回空
#[tauri::command]
pub async fn suggest_passage_scenes(
    app: AppHandle,
    request: crate::types::passage::PassageSceneSuggestRequest,
) -> AppResult<Vec<String>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "suggest_passage_scenes",
        Some(&format!(
            "books: {}, word_ids: {}, words: {}, exclude: {}",
            request.book_ids.len(),
            request.word_ids.len(),
            request.words.len(),
            request.exclude.len()
        )),
    );
    let result = async {
        let paths = agent_paths(&app)?;
        service(&app).suggest_scenes(&request, &paths).await
    }
    .await;
    finish(&logger, "suggest_passage_scenes", result)
}

/// 按内容规划逐篇写短文（后台任务）：立即返回任务 id；逐篇状态在 job.detail.items，写好的短文 id 在 job.result.passageIds。
/// 一篇失败不影响其余；全部失败时任务失败
#[tauri::command]
pub async fn start_passage_generation(
    app: AppHandle,
    request: crate::types::passage::GeneratePassagesRequest,
) -> AppResult<String> {
    use crate::jobs::{JobLink, JobModule, JobSpec, Jobs, Lane};
    use crate::types::passage::PassageItemStatus;
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_passage_generation",
        Some(&format!("items: {}", request.items.len())),
    );
    let result = async {
        if request.items.is_empty() || request.items.len() > 10 {
            return Err(AppError::ValidationError("一次写 1–10 篇".to_string()));
        }
        PassageService::validate_request(&request.base)?;
        let paths = agent_paths(&app)?;
        let svc = service(&app);
        let count = request.items.len();
        let spec = JobSpec {
            kind: "passage_generate",
            module: Some(JobModule::Passages),
            title: if count == 1 && !request.items[0].title.trim().is_empty() {
                format!("写短文 · {}", request.items[0].title)
            } else if count == 1 {
                "写短文".to_string()
            } else {
                format!("写 {count} 篇短文")
            },
            lane: Lane::Agent,
            detached: true,
            link: Some(JobLink::new("passages", serde_json::Value::Null)),
        };
        Ok(app.state::<Jobs>().spawn(spec, move |ctx| async move {
            let mut items: Vec<PassageItemStatus> = (0..count)
                .map(|_| PassageItemStatus {
                    state: "waiting".into(),
                    passage_id: None,
                    title: None,
                    error: None,
                })
                .collect();
            let publish = |items: &[PassageItemStatus]| {
                let done = items
                    .iter()
                    .filter(|i| i.state == "done" || i.state == "failed")
                    .count();
                ctx.progress(done as u64, count as u64);
                ctx.detail(serde_json::json!({ "items": items }));
            };
            publish(&items);
            let mut ids = Vec::new();
            for (i, item) in request.items.iter().enumerate() {
                if ctx.is_cancelled() {
                    break;
                }
                ctx.stage(format!("第 {}/{} 篇 · {}", i + 1, count, item.title));
                items[i].state = "running".into();
                publish(&items);
                let mut one = request.base.clone();
                one.plan_item = Some(item.clone());
                match svc.generate(&one, &paths, || ctx.is_cancelled()).await {
                    Ok(passage) => {
                        items[i].state = "done".into();
                        items[i].passage_id = Some(passage.id);
                        items[i].title = Some(passage.title.clone());
                        ids.push(passage.id);
                    }
                    // 停止：正在写的这篇不保存，也不算失败
                    Err(_) if ctx.is_cancelled() => {
                        items[i].state = "waiting".into();
                    }
                    Err(e) => {
                        items[i].state = "failed".into();
                        items[i].error = Some(e.to_string());
                    }
                }
                publish(&items);
            }
            if ids.len() == 1 {
                ctx.set_link(JobLink::new(
                    "passage-detail",
                    serde_json::json!({ "passageId": ids[0] }),
                ));
            }
            if ids.is_empty() && !ctx.is_cancelled() {
                let reason = items
                    .iter()
                    .find_map(|i| i.error.clone())
                    .unwrap_or_else(|| "请再试一次".to_string());
                return Err(AppError::ExternalServiceError(format!(
                    "没有写成短文：{reason}"
                )));
            }
            Ok(serde_json::json!({ "passageIds": ids }))
        }))
    }
    .await;
    finish(&logger, "start_passage_generation", result)
}

/// 短文列表（可按来源词汇本或计划筛选）
#[tauri::command]
pub async fn get_passages(
    app: AppHandle,
    book_id: Option<i64>,
    plan_id: Option<i64>,
    origin: Option<String>,
) -> AppResult<Vec<PassageSummary>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passages",
        Some(&format!(
            "book_id: {:?}, plan_id: {:?}, origin: {:?}",
            book_id, plan_id, origin
        )),
    );
    let result = service(&app)
        .list(book_id, plan_id, origin.as_deref())
        .await;
    finish(&logger, "get_passages", result)
}

#[tauri::command]
pub async fn get_passage(app: AppHandle, passage_id: i64) -> AppResult<Passage> {
    let logger = app.state::<Logger>();
    logger.api_request("get_passage", Some(&format!("passage_id: {}", passage_id)));
    let result = service(&app).get(passage_id).await;
    finish(&logger, "get_passage", result)
}

/// 目标词的完整资料（朗读时点词查看）
#[tauri::command]
pub async fn get_passage_words(
    app: AppHandle,
    passage_id: i64,
) -> AppResult<Vec<crate::types::wordbook::Word>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passage_words",
        Some(&format!("passage_id: {}", passage_id)),
    );
    let result = service(&app).target_word_details(passage_id).await;
    finish(&logger, "get_passage_words", result)
}

/// 删除短文（连同题组与作答记录）
#[tauri::command]
pub async fn delete_passage(app: AppHandle, passage_id: i64) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "delete_passage",
        Some(&format!("passage_id: {}", passage_id)),
    );
    let result = async {
        // 视频切片：记下短片文件，短文删掉后一起删（记录随短文级联删除）
        let pool = app.state::<SqlitePool>();
        let clip = crate::repositories::video_repository::VideoRepository::clip_of_passage(
            pool.inner(),
            passage_id,
        )
        .await?;
        service(&app).delete(passage_id).await?;
        if let Some(clip) = clip {
            let data = crate::app_paths::dirs(&app).data;
            for file in std::iter::once(&clip.file).chain(clip.poster_file.as_ref()) {
                let path = crate::services::video_processing::clip_path(&data, clip.video_id, file);
                if let Err(e) = std::fs::remove_file(&path) {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        tracing::warn!(
                            component = "VIDEO",
                            "删除短片文件失败（打开剪辑编辑器时会再清理）：{e}"
                        );
                    }
                }
            }
        }
        Ok(())
    }
    .await;
    finish(&logger, "delete_passage", result)
}

/// 出一套阅读理解题（后台任务）：立即返回任务 id；完成后题组已保存，job.result 为 `{ setId, name, count }`
#[tauri::command]
pub async fn start_question_set_generation(
    app: AppHandle,
    request: GenerateQuestionSetRequest,
) -> AppResult<String> {
    use crate::jobs::{JobLink, JobSpec, Jobs, Lane};
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_question_set_generation",
        Some(&format!("{:?}", request)),
    );
    let result = async {
        let paths = agent_paths(&app)?;
        let svc = service(&app);
        let passage = svc.get(request.passage_id).await?;
        // 名称不合适的提交时就拒绝，不等 AI 出完题才报错
        svc.check_new_set_name(&request).await?;
        let listening = request.mode.as_deref() == Some("listening");
        let (module, clip) = passage_job_place(&app, request.passage_id).await?;
        // 任务带上方式：页面按它把进度放进「阅读理解」/「听力练习」页签，任务面板点开也到那个页签
        let spec = JobSpec {
            kind: "question_set",
            module: Some(module),
            title: format!(
                "{} · {}",
                if listening { "出听力题" } else { "出阅读理解题" },
                passage.title
            ),
            lane: Lane::Agent,
            detached: true,
            link: Some(JobLink::new(
                "passage-detail",
                serde_json::json!({
                    "passageId": request.passage_id,
                    "mode": if listening { "listening" } else { "reading" },
                    "tab": if listening { "listening" } else { "sets" },
                    "clip": clip,
                }),
            )),
        };
        // 这套题的名称（空 = 保存时自动编号）、题量与难度：排队时页面就能把它显示成一套题组
        let detail = serde_json::json!({
            "name": request.name.as_deref().map(str::trim).filter(|n| !n.is_empty()),
            "spec": request.spec,
        });
        let jobs = app.state::<Jobs>();
        let id = jobs.spawn(spec, move |ctx| async move {
            let set = svc
                .generate_question_set(&request, &paths, || ctx.is_cancelled())
                .await?;
            Ok(serde_json::json!({ "setId": set.id, "name": set.name, "count": set.questions.len() }))
        });
        jobs.set_detail(&id, detail);
        Ok(id)
    }
    .await;
    finish(&logger, "start_question_set_generation", result)
}

/// 题组详情（题目、答案与选词填空词库）
#[tauri::command]
pub async fn get_question_set(app: AppHandle, set_id: i64) -> AppResult<QuestionSet> {
    let logger = app.state::<Logger>();
    logger.api_request("get_question_set", Some(&format!("set_id: {}", set_id)));
    let result = service(&app).get_set(set_id).await;
    finish(&logger, "get_question_set", result)
}

/// 题组改名；返回改名后的题组
#[tauri::command]
pub async fn rename_question_set(
    app: AppHandle,
    set_id: i64,
    name: String,
) -> AppResult<crate::types::passage::QuestionSet> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "rename_question_set",
        Some(&format!(
            "set_id: {set_id}, chars: {}",
            name.chars().count()
        )),
    );
    let result = service(&app).rename_set(set_id, &name).await;
    finish(&logger, "rename_question_set", result)
}

/// 删除题组（连同它的作答记录）
#[tauri::command]
pub async fn delete_question_set(app: AppHandle, set_id: i64) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("delete_question_set", Some(&format!("set_id: {}", set_id)));
    let result = service(&app).delete_set(set_id).await;
    finish(&logger, "delete_question_set", result)
}

/// 开始练习某套题（mode：reading / listening）；有未提交的同模式作答时接着用。
/// `plan_id`：从计划里的短文任务进入（完成后计入计划）
#[tauri::command]
pub async fn start_passage_attempt(
    app: AppHandle,
    set_id: i64,
    mode: String,
    plan_id: Option<i64>,
) -> AppResult<PassageAttempt> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_passage_attempt",
        Some(&format!(
            "set_id: {}, mode: {}, plan_id: {:?}",
            set_id, mode, plan_id
        )),
    );
    let result = service(&app).start_attempt(set_id, &mode, plan_id).await;
    finish(&logger, "start_passage_attempt", result)
}

/// 提交作答：客观题即时判分，开放题 AI 评分（失败时可用 regrade_passage_open 重试）
#[tauri::command]
pub async fn submit_passage_attempt(
    app: AppHandle,
    request: SubmitPassageAttemptRequest,
) -> AppResult<PassageAttempt> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "submit_passage_attempt",
        Some(&format!(
            "attempt_id: {}, answers: {}",
            request.attempt_id,
            request.answers.len()
        )),
    );
    let result = async {
        let paths = agent_paths(&app)?;
        service(&app).submit_attempt(&request, &paths).await
    }
    .await;
    finish(&logger, "submit_passage_attempt", result)
}

/// 开放题重新评分
#[tauri::command]
pub async fn regrade_passage_open(app: AppHandle, attempt_id: i64) -> AppResult<PassageAttempt> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "regrade_passage_open",
        Some(&format!("attempt_id: {}", attempt_id)),
    );
    let result = async {
        let paths = agent_paths(&app)?;
        service(&app).regrade(attempt_id, &paths).await
    }
    .await;
    finish(&logger, "regrade_passage_open", result)
}

/// 短文练习统计（不传 plan_id 为全部）
#[tauri::command]
pub async fn get_passage_statistics(
    app: AppHandle,
    plan_id: Option<i64>,
) -> AppResult<PassageStatistics> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passage_statistics",
        Some(&format!("plan_id: {:?}", plan_id)),
    );
    let result = service(&app).statistics(plan_id).await;
    finish(&logger, "get_passage_statistics", result)
}

// ==================== 单词卡（不在词汇本的目标词） ====================

fn word_cards(app: &AppHandle) -> crate::services::word_cards::WordCardService {
    crate::services::word_cards::WordCardService::new(
        Arc::new(app.state::<SqlitePool>().inner().clone()),
        Arc::new(app.state::<Logger>().inner().clone()),
    )
}

/// 短文里不在词汇本的目标词已有的单词卡（还没生成的不在结果里，用 start_word_cards 补）
#[tauri::command]
pub async fn get_passage_word_cards(
    app: AppHandle,
    passage_id: i64,
) -> AppResult<Vec<crate::types::material::WordCard>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "get_passage_word_cards",
        Some(&format!("passage {passage_id}")),
    );
    let result = word_cards(&app).passage_cards(passage_id).await;
    finish(&logger, "get_passage_word_cards", result)
}

/// 读原文时把选中的词加成目标词（指定单词）；返回更新后的短文
#[tauri::command]
pub async fn add_passage_target_word(
    app: AppHandle,
    passage_id: i64,
    word: String,
    form: Option<String>,
) -> AppResult<crate::types::passage::Passage> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "add_passage_target_word",
        Some(&format!("passage {passage_id} word {word}")),
    );
    let result = word_cards(&app)
        .add_target_word(passage_id, &word, form.as_deref())
        .await;
    finish(&logger, "add_passage_target_word", result)
}

/// 移除一个目标词；返回更新后的短文
#[tauri::command]
pub async fn remove_passage_target_word(
    app: AppHandle,
    passage_id: i64,
    word: String,
) -> AppResult<crate::types::passage::Passage> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "remove_passage_target_word",
        Some(&format!("passage {passage_id} word {word}")),
    );
    let result = word_cards(&app).remove_target_word(passage_id, &word).await;
    finish(&logger, "remove_passage_target_word", result)
}

/// 重新挑选目标词：AI 按条件从原文里挑一组建议（不保存）
#[tauri::command]
pub async fn suggest_passage_target_words(
    app: AppHandle,
    request: crate::types::passage::SuggestTargetWordsRequest,
) -> AppResult<Vec<crate::types::passage::TargetWordSuggestion>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "suggest_passage_target_words",
        Some(&format!(
            "passage {} count {} difficulty {:?} frequency {:?} statuses {:?} instruction_chars {}",
            request.passage_id,
            request.count,
            request.difficulty,
            request.frequency,
            request.statuses,
            request
                .instruction
                .as_deref()
                .map_or(0, |t| t.chars().count())
        )),
    );
    let result = async {
        let paths = agent_paths(&app)?;
        service(&app).suggest_target_words(&request, &paths).await
    }
    .await;
    finish(&logger, "suggest_passage_target_words", result)
}

/// 把目标词整体换成确认的这组；返回更新后的短文
#[tauri::command]
pub async fn set_passage_target_words(
    app: AppHandle,
    request: crate::types::passage::SetPassageTargetWordsRequest,
) -> AppResult<crate::types::passage::Passage> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "set_passage_target_words",
        Some(&format!(
            "passage {} words {}",
            request.passage_id,
            request.words.len()
        )),
    );
    let result = word_cards(&app)
        .replace_target_words(request.passage_id, &request.words)
        .await;
    finish(&logger, "set_passage_target_words", result)
}

/// 改短文的标题 / 难度；返回更新后的短文
#[tauri::command]
pub async fn update_passage_info(
    app: AppHandle,
    request: crate::types::passage::UpdatePassageInfoRequest,
) -> AppResult<crate::types::passage::Passage> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "update_passage_info",
        Some(&format!(
            "passage {} title_chars {:?} level {:?}",
            request.passage_id,
            request.title.as_ref().map(|t| t.chars().count()),
            request.level
        )),
    );
    let result = service(&app)
        .update_info(
            request.passage_id,
            request.title.as_deref(),
            request.level.as_deref(),
            request.scene.as_deref(),
        )
        .await;
    finish(&logger, "update_passage_info", result)
}

/// 改一句的中文译文（`index` 从 0 开始）；返回更新后的短文
#[tauri::command]
pub async fn update_passage_translation(
    app: AppHandle,
    passage_id: i64,
    index: i64,
    zh: String,
) -> AppResult<crate::types::passage::Passage> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "update_passage_translation",
        Some(&format!(
            "passage {passage_id} sentence {index} chars {}",
            zh.chars().count()
        )),
    );
    let result = service(&app)
        .update_translation(passage_id, index, &zh)
        .await;
    finish(&logger, "update_passage_translation", result)
}

/// 提交单词卡任务时加锁：同一篇短文同时只跑一个
static WORD_CARD_SPAWN: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 这篇短文正在跑的单词卡任务
/// 这篇短文正在跑的单词卡任务：任务编号与它负责的词（小写；没记的是旧任务，当作全都负责）
fn word_card_jobs(
    jobs: &crate::jobs::Jobs,
    passage_id: i64,
) -> Vec<(String, Option<std::collections::HashSet<String>>)> {
    jobs.list()
        .into_iter()
        .filter(|j| {
            j.kind == "word_cards"
                && j.status.is_active()
                && j.link.as_ref().is_some_and(|l| {
                    // 一篇短文的任务记 passageId；切分后给一批片段生成的记 passageIds
                    l.params.get("passageId").and_then(|v| v.as_i64()) == Some(passage_id)
                        || l.params
                            .get("passageIds")
                            .and_then(|v| v.as_array())
                            .is_some_and(|a| a.iter().any(|v| v.as_i64() == Some(passage_id)))
                })
        })
        .map(|j| {
            let words = j
                .link
                .as_ref()
                .and_then(|l| l.params.get("words"))
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|w| w.as_str().map(str::to_lowercase))
                        .collect()
                });
            (j.id, words)
        })
        .collect()
}

/// 缺单词卡的词里，还没有任务在做的那些（新加的词不能交给一个早已开始、不负责它的任务）
fn uncovered_words(
    running: &[(String, Option<std::collections::HashSet<String>>)],
    missing: &[String],
) -> Vec<String> {
    if running.iter().any(|(_, w)| w.is_none()) {
        return Vec::new();
    }
    missing
        .iter()
        .filter(|w| {
            !running.iter().any(|(_, covered)| {
                covered
                    .as_ref()
                    .is_some_and(|c| c.contains(&w.to_lowercase()))
            })
        })
        .cloned()
        .collect()
}

/// 短文任务归哪个模块：视频切出的场景片段在视频库里看，任务也记在视频库，「打开」带上 clip（面包屑与侧边栏在视频库下）
async fn passage_job_place(
    app: &AppHandle,
    passage_id: i64,
) -> AppResult<(crate::jobs::JobModule, bool)> {
    let clip = crate::repositories::video_repository::VideoRepository::clip_of_passage(
        app.state::<SqlitePool>().inner(),
        passage_id,
    )
    .await?
    .is_some();
    Ok(if clip {
        (crate::jobs::JobModule::Videos, true)
    } else {
        (crate::jobs::JobModule::Passages, false)
    })
}

/// 给这篇短文里还没有单词卡的未收录目标词生成单词卡（后台任务）。都有了返回 None；
/// 这篇已经有在跑的同类任务时返回它的 id
#[tauri::command]
pub async fn start_word_cards(app: AppHandle, passage_id: i64) -> AppResult<Option<String>> {
    use crate::jobs::{JobLink, JobSpec, Jobs, Lane};
    use crate::services::agent_settings::{AgentSettingsService, AgentTaskKind};
    use crate::services::prompt_profile::PromptProfileService;
    let logger = app.state::<Logger>();
    logger.api_request("start_word_cards", Some(&format!("passage {passage_id}")));
    let result = async {
        let service = word_cards(&app);
        let (passage, missing) = service.missing(passage_id).await?;
        let running = word_card_jobs(&app.state::<Jobs>(), passage_id);
        let all: Vec<String> = missing.iter().map(|t| t.word.clone()).collect();
        // 缺的词都已经有任务在做：给界面那个任务看进度；都不缺了也一样（任务还在收尾）
        let todo = uncovered_words(&running, &all);
        if todo.is_empty() {
            return Ok(running.first().map(|(id, _)| id.clone()));
        }
        let missing: Vec<_> = missing
            .into_iter()
            .filter(|t| todo.contains(&t.word))
            .collect();
        let pool = Arc::new(app.state::<SqlitePool>().inner().clone());
        let logger_arc = Arc::new(logger.inner().clone());
        let settings = AgentSettingsService::new(pool.clone(), logger_arc.clone());
        let model = settings.model_for(AgentTaskKind::Phonics, None).await?;
        let batch_size = settings.get().await?.batch_size.max(1) as usize;
        let profile = PromptProfileService::load(&pool).await?;
        let context = crate::agent::tasks::PhonicsContext {
            scene: crate::prompts::topic_scene(passage.scene.as_deref().unwrap_or(&passage.title)),
            meanings: missing
                .iter()
                .filter_map(|t| {
                    t.meaning
                        .as_ref()
                        .map(|m| (t.word.to_lowercase(), m.trim().to_string()))
                })
                .filter(|(_, m)| !m.is_empty())
                .collect(),
        };
        let meanings = context.meanings.clone();
        let analyzer = super::word_analysis::phonics_analyzer(&app, &model, profile, context)?;
        let words: Vec<String> = missing.into_iter().map(|t| t.word).collect();
        let (module, clip) = passage_job_place(&app, passage_id).await?;
        let spec = JobSpec {
            kind: "word_cards",
            module: Some(module),
            title: format!("生成单词卡 · {}", passage.title),
            lane: Lane::Agent,
            detached: true,
            // words：这个任务负责哪些词（后加的词另起任务）
            link: Some(JobLink::new(
                "passage-detail",
                serde_json::json!({ "passageId": passage_id, "clip": clip, "words": words.iter().map(|w| w.to_lowercase()).collect::<Vec<_>>() }),
            )),
        };
        // 检查与提交之间不能有 await：几乎同时的两次请求（如页面重复挂载）只提交一个任务
        let _guard = WORD_CARD_SPAWN.lock().unwrap_or_else(|e| e.into_inner());
        let jobs = app.state::<Jobs>();
        let running = word_card_jobs(&jobs, passage_id);
        if uncovered_words(&running, &words).is_empty() {
            return Ok(running.first().map(|(id, _)| id.clone()));
        }
        Ok(Some(jobs.spawn(spec, move |ctx| async move {
            let saved = service
                .generate(
                    &analyzer,
                    &words,
                    &meanings,
                    batch_size,
                    &ctx,
                    |done, total| ctx.progress(done, total),
                )
                .await?;
            Ok(serde_json::json!({ "saved": saved }))
        })))
    }
    .await;
    finish(&logger, "start_word_cards", result)
}

// ==================== 句子分析 ====================

/// 片段讲解的流式增量：前端按 requestId 过滤（重新生成后旧请求的增量被忽略）
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipGuideDelta {
    request_id: String,
    passage_id: i64,
    delta: String,
}

fn clip_guide_service(app: &AppHandle) -> crate::services::clip_guide::ClipGuideService {
    crate::services::clip_guide::ClipGuideService::new(
        Arc::new(app.state::<SqlitePool>().inner().clone()),
        Arc::new(app.state::<Logger>().inner().clone()),
    )
}

/// 场景片段已有的内容讲解（还没生成过为 null）
#[tauri::command]
pub async fn get_clip_guide(
    app: AppHandle,
    passage_id: i64,
) -> AppResult<Option<crate::types::passage::ClipGuide>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_clip_guide", Some(&format!("passage {}", passage_id)));
    let result = clip_guide_service(&app).cached(passage_id).await;
    finish(&logger, "get_clip_guide", result)
}

/// 生成场景片段的内容讲解并保存（覆盖已有的）；生成过程中推送 `clip-guide-delta` 事件
#[tauri::command]
pub async fn generate_clip_guide(
    app: AppHandle,
    passage_id: i64,
    request_id: String,
) -> AppResult<crate::types::passage::ClipGuide> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "generate_clip_guide",
        Some(&format!("passage {}", passage_id)),
    );
    let result = async {
        let paths = agent_paths(&app)?;
        let emitter = app.clone();
        clip_guide_service(&app)
            .generate(passage_id, &paths, |delta| {
                let _ = tauri::Emitter::emit(
                    &emitter,
                    "clip-guide-delta",
                    ClipGuideDelta {
                        request_id: request_id.clone(),
                        passage_id,
                        delta: delta.to_string(),
                    },
                );
            })
            .await
    }
    .await;
    finish(&logger, "generate_clip_guide", result)
}

/// 分析短文 / 视频片段里的一句（句式、成分、语法点、交际功能、词组、发音要点）。
/// 这句已经分析过且不要求重新分析时直接返回保存的结果
#[tauri::command]
pub async fn analyze_sentence(
    app: AppHandle,
    request: crate::types::passage::AnalyzeSentenceRequest,
) -> AppResult<crate::types::passage::SentenceAnalysis> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "analyze_sentence",
        Some(&format!(
            "passage {} sentence {} refresh {}",
            request.passage_id, request.sentence_index, request.refresh
        )),
    );
    let result = async {
        crate::services::sentence_analysis::SentenceAnalysisService::new(
            Arc::new(app.state::<SqlitePool>().inner().clone()),
            Arc::new(logger.inner().clone()),
        )
        .analyze(&request, &super::agent_paths(&app)?)
        .await
    }
    .await;
    finish(&logger, "analyze_sentence", result)
}

#[cfg(test)]
mod word_card_job_tests {
    use super::uncovered_words;
    use std::collections::HashSet;

    #[test]
    fn new_words_are_not_handed_to_a_job_that_does_not_cover_them() {
        let set = |w: &[&str]| Some(w.iter().map(|s| s.to_string()).collect::<HashSet<_>>());
        let missing = vec!["father".to_string(), "Your".to_string()];
        // 正在跑的任务只负责 father：后加的 your 要另起任务
        assert_eq!(
            uncovered_words(&[("j1".into(), set(&["father"]))], &missing),
            ["Your"]
        );
        // 都有任务在做（大小写不论）：复用
        assert!(uncovered_words(
            &[
                ("j1".into(), set(&["father"])),
                ("j2".into(), set(&["your"]))
            ],
            &missing
        )
        .is_empty());
        // 没有任务：全都要做
        assert_eq!(uncovered_words(&[], &missing), missing);
        // 没记负责哪些词的旧任务：当作全都负责
        assert!(uncovered_words(&[("old".into(), None)], &missing).is_empty());
    }
}
