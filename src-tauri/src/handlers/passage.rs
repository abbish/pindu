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

/// 内容规划：AI 提议写几篇、每篇的构思与用词（约 20–40 秒；不保存）。`feedback` 为对上一版规划的调整意见
#[tauri::command]
pub async fn plan_passages(
    app: AppHandle,
    request: GeneratePassageRequest,
    feedback: Option<String>,
) -> AppResult<crate::types::passage::PassagePlan> {
    let logger = app.state::<Logger>();
    logger.api_request("plan_passages", Some(&format!("{:?}", request)));
    let result = async {
        let paths = agent_paths(&app)?;
        service(&app)
            .plan(&request, feedback.as_deref().unwrap_or(""), &paths)
            .await
    }
    .await;
    finish(&logger, "plan_passages", result)
}

/// 按内容规划逐篇写短文（后台任务）：立即返回任务 id；逐篇状态在 job.detail.items，写好的短文 id 在 job.result.passageIds。
/// 一篇失败不影响其余；全部失败时任务失败
#[tauri::command]
pub async fn start_passage_generation(
    app: AppHandle,
    request: crate::types::passage::GeneratePassagesRequest,
) -> AppResult<String> {
    use crate::jobs::{JobLink, JobSpec, Jobs, Lane};
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
                match svc.generate(&one, &paths).await {
                    Ok(passage) => {
                        items[i].state = "done".into();
                        items[i].passage_id = Some(passage.id);
                        items[i].title = Some(passage.title.clone());
                        ids.push(passage.id);
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
        let spec = JobSpec {
            kind: "question_set",
            title: format!("出阅读理解题 · {}", passage.title),
            lane: Lane::Agent,
            detached: true,
            link: Some(JobLink::new(
                "passage-detail",
                serde_json::json!({ "passageId": request.passage_id }),
            )),
        };
        Ok(app.state::<Jobs>().spawn(spec, move |_ctx| async move {
            let set = svc.generate_question_set(&request, &paths).await?;
            Ok(serde_json::json!({ "setId": set.id, "name": set.name, "count": set.questions.len() }))
        }))
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
) -> AppResult<crate::types::passage::Passage> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "add_passage_target_word",
        Some(&format!("passage {passage_id} word {word}")),
    );
    let result = word_cards(&app).add_target_word(passage_id, &word).await;
    finish(&logger, "add_passage_target_word", result)
}

/// 提交单词卡任务时加锁：同一篇短文同时只跑一个
static WORD_CARD_SPAWN: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 这篇短文正在跑的单词卡任务
fn running_word_cards(jobs: &crate::jobs::Jobs, passage_id: i64) -> Option<String> {
    jobs.list()
        .into_iter()
        .find(|j| {
            j.kind == "word_cards"
                && j.status.is_active()
                && j.link
                    .as_ref()
                    .and_then(|l| l.params.get("passageId"))
                    .and_then(|v| v.as_i64())
                    == Some(passage_id)
        })
        .map(|j| j.id)
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
        if let Some(id) = running_word_cards(&app.state::<Jobs>(), passage_id) {
            return Ok(Some(id));
        }
        let service = word_cards(&app);
        let (passage, missing) = service.missing(passage_id).await?;
        if missing.is_empty() {
            return Ok(None);
        }
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
        let analyzer = super::word_analysis::phonics_analyzer(&app, &model, profile, context)?;
        let words: Vec<String> = missing.into_iter().map(|t| t.word).collect();
        let spec = JobSpec {
            kind: "word_cards",
            title: format!("生成单词卡 · {}", passage.title),
            lane: Lane::Agent,
            detached: true,
            link: Some(JobLink::new(
                "passage-detail",
                serde_json::json!({ "passageId": passage_id }),
            )),
        };
        // 检查与提交之间不能有 await：几乎同时的两次请求（如页面重复挂载）只提交一个任务
        let _guard = WORD_CARD_SPAWN.lock().unwrap_or_else(|e| e.into_inner());
        let jobs = app.state::<Jobs>();
        if let Some(id) = running_word_cards(&jobs, passage_id) {
            return Ok(Some(id));
        }
        Ok(Some(jobs.spawn(spec, move |ctx| async move {
            ctx.stage("AI 正在生成单词卡");
            let batches: Vec<Vec<String>> = words.chunks(batch_size).map(|c| c.to_vec()).collect();
            let total = words.len() as u64;
            let mut done = 0u64;
            let mut saved = 0usize;
            let mut last_error = None;
            ctx.progress(0, total);
            for (i, batch) in batches.iter().enumerate() {
                if ctx.is_cancelled() {
                    break;
                }
                match analyzer.analyze_batch(batch, i, batches.len()).await {
                    Ok(outcome) => saved += service.save(&outcome.analyzed).await?,
                    Err(e) => last_error = Some(e),
                }
                done += batch.len() as u64;
                ctx.progress(done, total);
            }
            if saved == 0 && !ctx.is_cancelled() {
                return Err(last_error.unwrap_or_else(|| {
                    AppError::ExternalServiceError("没有生成单词卡，请再试一次".into())
                }));
            }
            Ok(serde_json::json!({ "saved": saved }))
        })))
    }
    .await;
    finish(&logger, "start_word_cards", result)
}

// ==================== 句子分析 ====================

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
