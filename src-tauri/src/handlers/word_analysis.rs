//! 批量文本分析管线命令：提词 → 分批并发拼读分析；进度写入 EnhancedProgressManager 并通过事件推送单词状态

use crate::agent::tasks::PhonicsContext;
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::progress_manager::{get_enhanced_progress_manager, EnhancedProgressManager};
use crate::services::agent_settings::{AgentSettingsService, AgentTaskKind};
use crate::services::phonics_analysis::PhonicsBatchAnalyzer;
use crate::services::prompt_profile::PromptProfileService;
use crate::services::word_extraction::WordExtractionService;
use crate::types::word_analysis::{
    BatchAnalysisConfig, BatchAnalysisProgress, BatchAnalysisResult,
};
use crate::types::AIModelConfig;
use futures::stream::{self, StreamExt};
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// 提词服务（经 agent sidecar）
fn word_extraction_service(app: &AppHandle) -> AppResult<WordExtractionService> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::InternalError(format!("无法获取应用数据目录：{}", e)))?;
    WordExtractionService::new(
        Arc::new(app.state::<Logger>().inner().clone()),
        &app_data_dir,
    )
}

/// 批量拼读分析器（经 agent sidecar）
fn phonics_analyzer(
    app: &AppHandle,
    model: &AIModelConfig,
    profile: crate::prompts::PromptProfile,
    context: PhonicsContext,
) -> AppResult<Arc<PhonicsBatchAnalyzer>> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::InternalError(format!("无法获取应用数据目录：{}", e)))?;
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
        .extract(&model_config, &profile, &scene, &text, mode)
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
/// 描述 1–500 字，数量 5–100；传 `book_id` 时避开单词本里已有的词。
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
            "请用 1–500 个字描述想要的单词本".to_string(),
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
        .generate(&model_config, &profile, &scene, &intent, count, &existing)
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

/// 批量分析已提取的单词（第二步）
#[tauri::command]
pub async fn analyze_extracted_words(
    app: AppHandle,
    words: Vec<String>,
    model_id: Option<i64>,
    config: Option<BatchAnalysisConfig>,
    book_id: Option<i64>,
    meanings: Option<Vec<String>>,
) -> AppResult<BatchAnalysisResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    // 1. 获取 AI 服务
    let model_config = get_model_config(AgentTaskKind::Phonics, model_id, &pool, &logger).await?;
    let profile = PromptProfileService::load(pool.inner()).await?;
    // 单词本场景 + 生成 / 提取时已确定的释义（与 words 一一对应，空字符串表示没有）
    if meanings.as_ref().is_some_and(|m| m.len() != words.len()) {
        return Err(AppError::ValidationError(
            "释义数量应与单词数量一致".to_string(),
        ));
    }
    let context = PhonicsContext {
        scene: PromptProfileService::book_scene(
            &Arc::new(pool.inner().clone()),
            &Arc::new(logger.inner().clone()),
            book_id,
        )
        .await?,
        meanings: words
            .iter()
            .zip(meanings.unwrap_or_default())
            .filter(|(_, m)| !m.trim().is_empty())
            .map(|(w, m)| (w.to_lowercase(), m.trim().to_string()))
            .collect(),
    };
    let analyzer = phonics_analyzer(&app, &model_config, profile, context)?;

    // 2. 获取进度管理器
    let progress_manager = get_enhanced_progress_manager();
    progress_manager.start_batch_analysis();

    // 3. 获取配置：每批词数与同时请求数以「设置 → AI 助手」为准（前端传的值不再生效）
    let mut config = config.unwrap_or_default();
    let agent_settings = AgentSettingsService::new(
        Arc::new(pool.inner().clone()),
        Arc::new(logger.inner().clone()),
    )
    .get()
    .await?;
    config.batch_size = agent_settings.batch_size as usize;
    config.max_concurrent_batches = agent_settings.max_concurrency as usize;

    logger.info(
        "WORD_ANALYSIS",
        &format!(
            "🚀 Starting batch analysis of {} words with config: batch_size={}, max_concurrent={}",
            words.len(),
            config.batch_size,
            config.max_concurrent_batches
        ),
    );

    // 4. 执行批量分析
    let result = analyze_words_parallel(
        analyzer,
        words,
        &logger,
        progress_manager,
        &config,
        app.clone(),
    )
    .await?;

    logger.api_response(
        "analyze_extracted_words",
        true,
        Some(&format!(
            "Analyzed {} words in {:.2}s",
            result.completed_words, result.elapsed_seconds
        )),
    );

    Ok(result)
}

/// 获取批量分析进度（新命令）
#[tauri::command]
pub async fn get_batch_analysis_progress(_app: AppHandle) -> AppResult<BatchAnalysisProgress> {
    let progress_manager = get_enhanced_progress_manager();
    Ok(progress_manager.get_full_progress())
}

/// 取消批量分析（新命令）
#[tauri::command]
pub async fn cancel_batch_analysis(_app: AppHandle) -> AppResult<()> {
    let progress_manager = get_enhanced_progress_manager();
    progress_manager.cancel_analysis();
    Ok(())
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

/// 只批量分析单词（不包含提取步骤）- 并行版本
async fn analyze_words_parallel(
    analyzer: Arc<PhonicsBatchAnalyzer>,
    words: Vec<String>,
    logger: &Logger,
    progress_manager: &EnhancedProgressManager,
    config: &BatchAnalysisConfig,
    app_handle: AppHandle,
) -> Result<BatchAnalysisResult, Box<dyn std::error::Error>> {
    let start_time = std::time::Instant::now();

    logger.info(
        "WORD_ANALYSIS",
        &format!(
            "📦 开始批量分析 {} 个单词 (batch_size={}, max_concurrent_batches={})",
            words.len(),
            config.batch_size,
            config.max_concurrent_batches
        ),
    );

    let total_batches = words.len().div_ceil(config.batch_size);

    // 将单词分成批次
    let batches: Vec<Vec<String>> = words
        .chunks(config.batch_size)
        .map(|chunk| chunk.to_vec())
        .collect();

    logger.info(
        "WORD_ANALYSIS",
        &format!(
            "📊 共分为 {} 个批次，每批最多 {} 个单词",
            batches.len(),
            config.batch_size
        ),
    );

    // 并行处理批次，限制并发数
    let mut analysis_results: Vec<crate::types::word_analysis::PhonicsWord> = Vec::new();
    let mut failed_words: Vec<String> = Vec::new();
    let mut completed_batches = 0;

    // 初始化分析进度：先登记全部单词（等待中），完成 / 失败数由进度管理器按逐词状态计算
    let total_words_count = words.len();
    progress_manager.register_words(&words);

    progress_manager.update_analysis_progress(&crate::types::word_analysis::AnalysisProgress {
        total_words: total_words_count,
        completed_words: 0,
        failed_words: 0,
        current_word: None,
        batch_info: crate::types::word_analysis::BatchInfo {
            total_batches,
            completed_batches: 0,
            current_batch: 0,
            batch_size: config.batch_size,
        },
        elapsed_seconds: start_time.elapsed().as_secs_f64(),
    });

    // 使用 futures stream 来限制并发数
    let batches_stream = stream::iter(batches.into_iter().enumerate())
        .map(|(batch_index, batch_words)| {
            let analyzer = Arc::clone(&analyzer);
            let logger = logger.clone();
            let batch_index_clone = batch_index;
            let batch_words_clone = batch_words.clone();
            let app_handle = app_handle.clone();

            async move {
                // 检查是否已取消
                if progress_manager.is_cancelled() {
                    logger.info("WORD_ANALYSIS", "🚫 批量分析已取消");
                    return (batch_index, None, batch_words_clone);
                }

                // 发送批次开始事件
                if let Err(e) = app_handle.emit_to(
                    "main",
                    "batch-start",
                    crate::types::word_analysis::BatchStartEvent {
                        batch_index: batch_index_clone,
                        total_batches,
                        words: batch_words_clone.clone(),
                    },
                ) {
                    logger.error(
                        "WORD_ANALYSIS",
                        &format!("Failed to emit batch-start event: {}", e),
                        None,
                    );
                }

                // 更新批次开始状态 - 立即更新单词状态为"analyzing"
                for word in &batch_words_clone {
                    progress_manager.update_word_status(
                        &crate::types::word_analysis::WordAnalysisStatus {
                            word: word.clone(),
                            status: "analyzing".to_string(),
                            error: None,
                            result: None,
                        },
                    );

                    // 发送单词状态更新事件
                    if let Err(e) = app_handle.emit_to(
                        "main",
                        "word-status-update",
                        crate::types::word_analysis::WordStatusUpdateEvent {
                            word: word.clone(),
                            status: "analyzing".to_string(),
                            error: None,
                        },
                    ) {
                        logger.error(
                            "WORD_ANALYSIS",
                            &format!(
                                "Failed to emit word-status-update event for word '{}': {}",
                                word, e
                            ),
                            None,
                        );
                    }
                }

                // 处理批次
                match analyzer
                    .analyze_batch(&batch_words_clone, batch_index_clone, total_batches)
                    .await
                {
                    Ok(outcome) => {
                        // 模型没有返回的单词按失败处理（不再停留在“分析中”）
                        for word in &outcome.missing {
                            let error = "模型没有返回该单词的分析".to_string();
                            progress_manager.update_word_status(
                                &crate::types::word_analysis::WordAnalysisStatus {
                                    word: word.clone(),
                                    status: "failed".to_string(),
                                    error: Some(error.clone()),
                                    result: None,
                                },
                            );
                            if let Err(e) = app_handle.emit_to(
                                "main",
                                "word-status-update",
                                crate::types::word_analysis::WordStatusUpdateEvent {
                                    word: word.clone(),
                                    status: "failed".to_string(),
                                    error: Some(error),
                                },
                            ) {
                                logger.error(
                                    "WORD_ANALYSIS",
                                    &format!("Failed to emit word-status-update event: {}", e),
                                    None,
                                );
                            }
                        }
                        let missing = outcome.missing;
                        let batch_results = outcome.analyzed;
                        // 更新每个单词的状态为完成
                        for word in &batch_results {
                            progress_manager.update_word_status(
                                &crate::types::word_analysis::WordAnalysisStatus {
                                    word: word.word.clone(),
                                    status: "completed".to_string(),
                                    error: None,
                                    result: Some(word.clone()),
                                },
                            );

                            // 发送单词状态更新事件
                            if let Err(e) = app_handle.emit_to(
                                "main",
                                "word-status-update",
                                crate::types::word_analysis::WordStatusUpdateEvent {
                                    word: word.word.clone(),
                                    status: "completed".to_string(),
                                    error: None,
                                },
                            ) {
                                logger.error(
                                    "WORD_ANALYSIS",
                                    &format!(
                                        "Failed to emit word-status-update event for word '{}': {}",
                                        word.word, e
                                    ),
                                    None,
                                );
                            }
                        }

                        // 发送批次完成事件
                        if let Err(e) = app_handle.emit_to(
                            "main",
                            "batch-complete",
                            crate::types::word_analysis::BatchCompleteEvent {
                                batch_index: batch_index_clone,
                                completed_words: batch_results.len(),
                                failed_words: missing.len(),
                            },
                        ) {
                            logger.error(
                                "WORD_ANALYSIS",
                                &format!(
                                    "Failed to emit batch-complete event for batch {}: {}",
                                    batch_index_clone, e
                                ),
                                None,
                            );
                        }

                        (batch_index, Some(batch_results), missing)
                    }
                    Err(e) => {
                        // 批次失败，标记所有单词为失败
                        for word in &batch_words_clone {
                            progress_manager.update_word_status(
                                &crate::types::word_analysis::WordAnalysisStatus {
                                    word: word.clone(),
                                    status: "failed".to_string(),
                                    error: Some(e.to_string()),
                                    result: None,
                                },
                            );

                            // 发送单词状态更新事件
                            if let Err(e) = app_handle.emit_to(
                                "main",
                                "word-status-update",
                                crate::types::word_analysis::WordStatusUpdateEvent {
                                    word: word.clone(),
                                    status: "failed".to_string(),
                                    error: Some(e.to_string()),
                                },
                            ) {
                                logger.error(
                                    "WORD_ANALYSIS",
                                    &format!(
                                        "Failed to emit word-status-update event for word '{}': {}",
                                        word, e
                                    ),
                                    None,
                                );
                            }
                        }

                        (batch_index, None, batch_words_clone)
                    }
                }
            }
        })
        .buffer_unordered(config.max_concurrent_batches);

    // 处理所有批次
    let mut batch_results_stream = Box::pin(batches_stream);

    while let Some((batch_index, batch_result, failed_batch_words)) =
        batch_results_stream.next().await
    {
        completed_batches += 1;

        // 批次信息（完成 / 失败数与用时由进度管理器按逐词状态计算）
        progress_manager.update_analysis_progress(&crate::types::word_analysis::AnalysisProgress {
            total_words: total_words_count,
            completed_words: 0,
            failed_words: 0,
            current_word: None,
            batch_info: crate::types::word_analysis::BatchInfo {
                total_batches,
                completed_batches,
                current_batch: batch_index,
                batch_size: config.batch_size,
            },
            elapsed_seconds: start_time.elapsed().as_secs_f64(),
        });

        if let Some(results) = batch_result {
            let result_len = results.len();
            analysis_results.extend(results);
            // 模型漏掉的单词计入失败
            failed_words.extend(failed_batch_words);
            logger.info(
                "WORD_ANALYSIS",
                &format!(
                    "✅ 批次 {}/{} 完成，分析了 {} 个单词",
                    batch_index + 1,
                    total_batches,
                    result_len
                ),
            );
        } else {
            failed_words.extend(failed_batch_words);
            logger.error(
                "WORD_ANALYSIS",
                &format!("❌ 批次 {}/{} 失败", batch_index + 1, total_batches),
                None,
            );
        }
    }

    logger.info("WORD_ANALYSIS", "✅ 批量分析完成");

    let total_words_count = words.len();
    let completed_words_count = analysis_results.len();
    let failed_words_count = failed_words.len();

    // 发送分析完成事件
    if let Err(e) = app_handle.emit_to(
        "main",
        "analysis-complete",
        crate::types::word_analysis::AnalysisCompleteEvent {
            total_words: total_words_count,
            completed_words: completed_words_count,
            failed_words: failed_words_count,
            elapsed_seconds: start_time.elapsed().as_secs_f64(),
        },
    ) {
        logger.error(
            "WORD_ANALYSIS",
            &format!("Failed to emit analysis-complete event: {}", e),
            None,
        );
    }

    Ok(BatchAnalysisResult {
        words: analysis_results,
        total_words: total_words_count,
        completed_words: completed_words_count,
        failed_words: failed_words_count,
        elapsed_seconds: start_time.elapsed().as_secs_f64(),
    })
}
