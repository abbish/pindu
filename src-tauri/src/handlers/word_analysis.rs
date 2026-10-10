//! 添加单词的两步：提词 / 按描述生成（直接返回）→ 分析并加入词汇本（后台任务，见 services/word_analysis_job.rs）

use crate::agent::tasks::PhonicsContext;
use crate::error::{AppError, AppResult};
use crate::jobs::{JobLink, JobSpec, Jobs, Lane};
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

/// 按学习意图生成单词（“AI 生成”入口，替代提取的第一步）：
/// 描述 1–500 字，数量 5–100；传 `book_id` 时避开词汇本里已有的词。
#[tauri::command]
pub async fn generate_words_from_intent(
    app: AppHandle,
    intent: String,
    count: i64,
    book_id: Option<i64>,
    model_id: Option<i64>,
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

    let intent_len = intent.trim().chars().count();
    if intent_len == 0 || intent_len > 500 {
        return Err(AppError::ValidationError(
            "请用 1–500 个字描述想要的词汇本".to_string(),
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
        // 每批词数与同时请求数以「设置 → AI 助手」为准
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
        outcome
            .analyzed
            .into_iter()
            .next()
            .ok_or_else(|| AppError::ExternalServiceError("AI 没有返回这个单词的分析".to_string()))
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
    // 显式指定的模型 > 「设置 → AI 助手」里该任务的模型 > 默认模型
    let config = AgentSettingsService::new(Arc::new(pool.clone()), Arc::new(logger.clone()))
        .model_for(task, model_id)
        .await?;

    logger.info(
        "WORD_ANALYSIS",
        &format!("Using AI model: {} ({})", config.name, config.model_id),
    );

    Ok(config)
}
