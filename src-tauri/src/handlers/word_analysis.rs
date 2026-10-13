//! 添加单词的两步：提词 / 按描述生成（直接返回）→ 分析并加入词汇本（后台任务，见 services/word_analysis_job.rs）

use crate::agent::tasks::PhonicsContext;
use crate::error::{AppError, AppResult};
use crate::jobs::{JobLink, JobModule, JobSpec, Jobs, Lane};
use crate::logger::Logger;
use crate::services::agent_settings::{AgentSettingsService, AgentTaskKind};
use crate::services::phonics_analysis::PhonicsBatchAnalyzer;
use crate::services::prompt_profile::PromptProfileService;
use crate::services::word_analysis_job::WordAnalysisJob;
use crate::services::word_extraction::WordExtractionService;
use crate::types::word_analysis::StartWordAnalysisRequest;
use crate::types::AIModelConfig;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// 提词服务（经 agent sidecar）
fn word_extraction_service(app: &AppHandle) -> AppResult<WordExtractionService> {
    let app_data_dir = crate::app_paths::dirs(app).data;
    WordExtractionService::new(
        Arc::new(app.state::<Logger>().inner().clone()),
        &app_data_dir,
    )
}

/// 给 AI 参考的已有标签名；读不到时不带（不影响提词）
async fn known_tags(pool: &SqlitePool) -> Vec<String> {
    crate::services::tag::TagService::new(Arc::new(pool.clone()))
        .known_names()
        .await
        .unwrap_or_else(|e| {
            tracing::warn!("读取已有标签失败，AI 不参考已有标签：{e}");
            Vec::new()
        })
}

/// 批量拼读分析器（经 agent sidecar）
pub(crate) fn phonics_analyzer(
    app: &AppHandle,
    model: &AIModelConfig,
    profile: crate::prompts::PromptProfile,
    context: PhonicsContext,
) -> AppResult<Arc<PhonicsBatchAnalyzer>> {
    let app_data_dir = crate::app_paths::dirs(app).data;
    Ok(Arc::new(PhonicsBatchAnalyzer::new(
        Arc::new(app.state::<Logger>().inner().clone()),
        &app_data_dir,
        model.clone(),
        profile,
        context,
    )?))
}

/// 提取单词（第一步）
#[tauri::command]
pub async fn extract_words_from_text(
    app: AppHandle,
    text: String,
    model_id: Option<i64>,
    mode: Option<String>,
    book_id: Option<i64>,
) -> AppResult<crate::types::word_analysis::WordExtractionResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    let model_config = get_model_config(AgentTaskKind::Extract, model_id, &pool, &logger).await?;
    let extraction = word_extraction_service(&app)?;
    let profile = PromptProfileService::load(pool.inner()).await?;
    let scene = PromptProfileService::book_scene(
        &Arc::new(pool.inner().clone()),
        &Arc::new(logger.inner().clone()),
        book_id,
    )
    .await?;

    logger.info(
        "WORD_ANALYSIS",
        &format!(
            "🚀 Starting word extraction from text (length: {})",
            text.len()
        ),
    );

    // 提取模式：focus 重点模式（默认，过滤基础功能词）/ all 全部模式
    let mode = mode.as_deref().unwrap_or("focus");
    if !matches!(mode, "focus" | "all") {
        return Err(AppError::ValidationError(format!(
            "提取模式应为 focus 或 all，收到 {}",
            mode
        )));
    }
    let result = extraction
        .extract(
            &model_config,
            &profile,
            &scene,
            &text,
            mode,
            &known_tags(&pool).await,
        )
        .await?;

    logger.api_response(
        "extract_words_from_text",
        true,
        Some(&format!(
            "Extracted {} unique words from {} total words",
            result.unique_count, result.total_count
        )),
    );

    Ok(result)
}

/// 从 PDF / 图片 / Word（单词海报、词汇表、课本页）提取单词（后台任务，kind material_read）：
/// AI 自主阅读素材，词汇表与画线词组直接成为候选（释义照材料）；素材只有文章、没有词汇表时，再按正文提取。
/// 结果（与 extract_words_from_text 同结构）放在 job.result；只给发起的弹窗用，关闭时由前端取消
#[tauri::command]
pub async fn start_material_words(
    app: AppHandle,
    request: crate::types::material::MaterialWordsRequest,
) -> AppResult<String> {
    use crate::jobs::{JobModule, JobSpec, Jobs, Lane};
    use crate::services::material_read::{self, MaterialPurpose};
    use crate::types::word_analysis::WordExtractionResult;
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_material_words",
        Some(&format!(
            "file: {}, base64 chars: {}, mode: {:?}, book_id: {:?}",
            request.file_name,
            request.file_base64.len(),
            request.mode,
            request.book_id
        )),
    );
    let result = async {
        let mode = request.mode.clone().unwrap_or_else(|| "focus".to_string());
        if !matches!(mode.as_str(), "focus" | "all") {
            return Err(AppError::ValidationError(format!(
                "提取模式应为 focus 或 all，收到 {}",
                mode
            )));
        }
        let paths = super::agent_paths(&app)?;
        let model = get_model_config(AgentTaskKind::Extract, None, &pool, &logger).await?;
        material_read::check_can_read(&paths, &model, &request.file_name, "提取 / 生成单词")
            .await?;
        let upload = material_read::save_upload(
            &paths.root.join("materials"),
            &request.file_name,
            &request.file_base64,
        )?;
        let profile = PromptProfileService::load(pool.inner()).await?;
        let scene = PromptProfileService::book_scene(
            &Arc::new(pool.inner().clone()),
            &Arc::new(logger.inner().clone()),
            request.book_id,
        )
        .await?;
        let tags = known_tags(&pool).await;
        let extraction = word_extraction_service(&app)?;
        let logger_arc = Arc::new(logger.inner().clone());
        let name = request.file_name.trim().to_string();
        let spec = JobSpec {
            kind: "material_read",
            module: Some(JobModule::WordBooks),
            title: format!("读取素材 · {name}"),
            lane: Lane::Agent,
            detached: false,
            link: None,
        };
        Ok(app.state::<Jobs>().spawn(spec, move |ctx| async move {
            ctx.stage("正在准备");
            let content = material_read::read_material(
                &paths,
                &model,
                &profile,
                &upload,
                MaterialPurpose::Words,
                &logger_arc,
                || ctx.is_cancelled(),
                |stage| ctx.stage(stage),
            )
            .await;
            let _ = std::fs::remove_file(&upload);
            let content = content?;
            let words = material_read::to_extracted_words(&content);
            let result = if !words.is_empty() {
                WordExtractionResult {
                    total_count: words.len(),
                    unique_count: words.len(),
                    words,
                    tags: Vec::new(),
                }
            } else {
                let text = material_read::passage_text(&content);
                if text.trim().is_empty() {
                    return Err(AppError::ValidationError(
                        content
                            .note
                            .clone()
                            .unwrap_or_else(|| "这份素材里没有找到英文单词".to_string()),
                    ));
                }
                ctx.stage("正在从正文提取单词");
                extraction
                    .extract(&model, &profile, &scene, &text, &mode, &tags)
                    .await?
            };
            serde_json::to_value(result).map_err(|e| AppError::InternalError(e.to_string()))
        }))
    }
    .await;
    super::finish(&logger, "start_material_words", result)
}

/// 按学习意图生成单词（“AI 生成”入口，替代提取的第一步）：
/// 描述 1–500 字，数量 5–100；传 `book_id` 时避开词汇本里已有的词。
#[tauri::command]
pub async fn generate_words_from_intent(
    app: AppHandle,
    intent: String,
    count: i64,
    book_id: Option<i64>,
    model_id: Option<i64>,
    exclude: Option<Vec<String>>,
) -> AppResult<crate::types::word_analysis::WordExtractionResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "generate_words_from_intent",
        Some(&format!(
            "intent_len: {}, count: {}, book_id: {:?}",
            intent.chars().count(),
            count,
            book_id
        )),
    );

    // 词汇需求可以不填：词汇本有场景描述时按场景生成
    let intent_len = intent.trim().chars().count();
    if intent_len > 500 {
        return Err(AppError::ValidationError(
            "词汇需求最多 500 个字".to_string(),
        ));
    }
    if intent_len == 0 && !has_scene_description(&pool, &logger, book_id).await? {
        return Err(AppError::ValidationError(
            "请描述想要的词汇，或先设置词汇本的场景描述".to_string(),
        ));
    }
    let count = usize::try_from(count).unwrap_or(0);
    if !crate::agent::tasks::GENERATE_COUNT_RANGE.contains(&count) {
        return Err(AppError::ValidationError(
            "单词数量需在 5–100 之间".to_string(),
        ));
    }
    let existing: std::collections::HashSet<String> = match book_id {
        Some(id) => crate::repositories::word_repository::WordRepository::new(
            Arc::new(pool.inner().clone()),
            Arc::new(logger.inner().clone()),
        )
        .word_texts_by_book(id)
        .await?
        .into_iter()
        .collect(),
        None => Default::default(),
    };
    // 换一批时已经给过的词也不要再选
    let existing: std::collections::HashSet<String> = existing
        .into_iter()
        .chain(
            exclude
                .unwrap_or_default()
                .into_iter()
                .map(|w| w.trim().to_lowercase()),
        )
        .collect();

    let model_config = get_model_config(AgentTaskKind::Extract, model_id, &pool, &logger).await?;
    let profile = PromptProfileService::load(pool.inner()).await?;
    let scene = PromptProfileService::book_scene(
        &Arc::new(pool.inner().clone()),
        &Arc::new(logger.inner().clone()),
        book_id,
    )
    .await?;
    let result = word_extraction_service(&app)?
        .generate(
            &model_config,
            &profile,
            &scene,
            &intent,
            count,
            &existing,
            &known_tags(&pool).await,
        )
        .await;
    logger.api_response(
        "generate_words_from_intent",
        result.is_ok(),
        Some(&match &result {
            Ok(r) => format!("Generated {} words", r.unique_count),
            Err(e) => e.to_string(),
        }),
    );
    result
}

/// 词汇本写了场景描述吗
async fn has_scene_description(
    pool: &SqlitePool,
    logger: &Logger,
    book_id: Option<i64>,
) -> AppResult<bool> {
    let Some(id) = book_id else {
        return Ok(false);
    };
    Ok(
        crate::repositories::wordbook_repository::WordBookRepository::new(
            Arc::new(pool.clone()),
            Arc::new(logger.clone()),
        )
        .find_by_id(id)
        .await?
        .is_some_and(|b| !b.description.trim().is_empty()),
    )
}

/// 按词汇本的场景描述给 4–6 条词汇需求的建议（场景下的子话题）；没有场景描述时返回空。
/// `exclude`：已经给过的建议（换一批时新的不重复）
#[tauri::command]
pub async fn suggest_vocab_topics(
    app: AppHandle,
    book_id: i64,
    exclude: Option<Vec<String>>,
) -> AppResult<Vec<String>> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request("suggest_vocab_topics", Some(&format!("book_id: {book_id}")));
    let result = async {
        if !has_scene_description(&pool, &logger, Some(book_id)).await? {
            return Ok(Vec::new());
        }
        let pool_arc = Arc::new(pool.inner().clone());
        let logger_arc = Arc::new(logger.inner().clone());
        let scene = PromptProfileService::book_scene(&pool_arc, &logger_arc, Some(book_id)).await?;
        let existing = crate::repositories::word_repository::WordRepository::new(
            pool_arc.clone(),
            logger_arc.clone(),
        )
        .word_texts_by_book(book_id)
        .await?;
        let model = get_model_config(AgentTaskKind::Extract, None, &pool, &logger).await?;
        let profile = PromptProfileService::load(pool.inner()).await?;
        crate::agent::tasks::suggest_vocab_topics(
            &super::agent_paths(&app)?,
            &model,
            &profile,
            &crate::agent::tasks::vocab_suggest_message(
                &scene,
                &existing,
                &exclude.unwrap_or_default(),
            ),
            &logger,
        )
        .await
    }
    .await;
    super::finish(&logger, "suggest_vocab_topics", result)
}

/// 分析单词并加入词汇本（第二步，后台任务）：立即返回任务 id，进度与逐词状态经 job-updated 推送，
/// 完成后成功的词已写进词汇本（见 services/word_analysis_job.rs）
#[tauri::command]
pub async fn start_word_analysis(
    app: AppHandle,
    request: StartWordAnalysisRequest,
) -> AppResult<String> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request(
        "start_word_analysis",
        Some(&format!(
            "book_id: {}, words: {}",
            request.book_id,
            request.words.len()
        )),
    );
    let result = async {
        let words: Vec<String> = request
            .words
            .iter()
            .map(|w| w.trim().to_string())
            .filter(|w| !w.is_empty())
            .collect();
        if words.is_empty() {
            return Err(AppError::ValidationError("请至少选一个单词".to_string()));
        }
        if request
            .meanings
            .as_ref()
            .is_some_and(|m| m.len() != request.words.len())
        {
            return Err(AppError::ValidationError(
                "释义数量应与单词数量一致".to_string(),
            ));
        }
        let pool_arc = Arc::new(pool.inner().clone());
        let logger_arc = Arc::new(logger.inner().clone());
        let book = crate::repositories::wordbook_repository::WordBookRepository::new(
            pool_arc.clone(),
            logger_arc.clone(),
        )
        .find_by_id(request.book_id)
        .await?
        .ok_or_else(|| AppError::NotFound("词汇本不存在，可能已被删除".to_string()))?;

        let model_config =
            get_model_config(AgentTaskKind::Phonics, request.model_id, &pool, &logger).await?;
        let profile = PromptProfileService::load(pool.inner()).await?;
        // 词汇本场景 + 生成 / 提取时已确定的释义
        let context = PhonicsContext {
            scene: PromptProfileService::book_scene(&pool_arc, &logger_arc, Some(request.book_id))
                .await?,
            meanings: request
                .words
                .iter()
                .zip(request.meanings.clone().unwrap_or_default())
                .filter(|(_, m)| !m.trim().is_empty())
                .map(|(w, m)| (w.to_lowercase(), m.trim().to_string()))
                .collect(),
        };
        let analyzer = phonics_analyzer(&app, &model_config, profile, context)?;
        // 每批词数与同时请求数以「设置 → AI 任务」为准
        let settings = AgentSettingsService::new(pool_arc.clone(), logger_arc.clone())
            .get()
            .await?;

        let job = WordAnalysisJob {
            pool: pool_arc,
            logger: logger_arc,
            analyzer,
            book_id: request.book_id,
            book_title: book.title.clone(),
            words,
            tags: request
                .tags
                .as_ref()
                .map(|t| {
                    crate::services::tag::tags_from_submission(&serde_json::json!({ "tags": t }))
                })
                .unwrap_or_default(),
            batch_size: settings.batch_size as usize,
            concurrency: settings.max_concurrency as usize,
        };
        let spec = JobSpec {
            kind: "word_analysis",
            module: Some(JobModule::WordBooks),
            title: format!("分析 {} 个单词 · {}", job.words.len(), book.title),
            lane: Lane::Agent,
            detached: true,
            link: Some(JobLink::new(
                "wordbook-detail",
                serde_json::json!({ "id": request.book_id }),
            )),
        };
        Ok(app.state::<Jobs>().spawn(spec, move |ctx| async move {
            let outcome = job.run(ctx).await?;
            Ok(serde_json::to_value(outcome).unwrap_or_default())
        }))
    }
    .await;
    super::finish(&logger, "start_word_analysis", result)
}

/// 分析一个单词，只返回结果不保存（编辑单词时的「AI 补全」，几秒内完成，不做成后台任务）
#[tauri::command]
pub async fn analyze_word(
    app: AppHandle,
    word: String,
    meaning: Option<String>,
    book_id: Option<i64>,
) -> AppResult<crate::types::word_analysis::PhonicsWord> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    logger.api_request("analyze_word", Some(&format!("word: {word}")));
    let result = async {
        let word = word.trim().to_string();
        if word.is_empty() {
            return Err(AppError::ValidationError("先填写单词".to_string()));
        }
        let model_config = get_model_config(AgentTaskKind::Phonics, None, &pool, &logger).await?;
        let profile = PromptProfileService::load(pool.inner()).await?;
        let context = PhonicsContext {
            scene: PromptProfileService::book_scene(
                &Arc::new(pool.inner().clone()),
                &Arc::new(logger.inner().clone()),
                book_id,
            )
            .await?,
            meanings: meaning
                .filter(|m| !m.trim().is_empty())
                .map(|m| (word.to_lowercase(), m.trim().to_string()))
                .into_iter()
                .collect(),
        };
        let outcome = phonics_analyzer(&app, &model_config, profile, context)?
            .analyze_batch(std::slice::from_ref(&word), 0, 1)
            .await?;
        // 模型把词改了（多为纠正拼写）时返回改后的分析，word 与输入不同，由界面提示用户是否改用
        let corrected = (outcome.corrected.len() == 1)
            .then(|| outcome.corrected.into_iter().next())
            .flatten();
        outcome
            .analyzed
            .into_iter()
            .next()
            .or(corrected)
            .ok_or_else(|| {
                AppError::ExternalServiceError("这个单词没有分析出来，请再试一次".to_string())
            })
    }
    .await;
    super::finish(&logger, "analyze_word", result)
}

/// 获取模型配置：指定模型或默认模型（须启用且已配置 API Key），与生成学习计划共用同一路径
async fn get_model_config(
    task: AgentTaskKind,
    model_id: Option<i64>,
    pool: &SqlitePool,
    logger: &Logger,
) -> AppResult<AIModelConfig> {
    // 显式指定的模型 > 「设置 → AI 任务」里该任务的模型 > 默认模型
    let config = AgentSettingsService::new(Arc::new(pool.clone()), Arc::new(logger.clone()))
        .model_for(task, model_id)
        .await?;

    logger.info(
        "WORD_ANALYSIS",
        &format!("Using AI model: {} ({})", config.name, config.model_id),
    );

    Ok(config)
}
