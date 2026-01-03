use crate::ai_service::AIService;
use crate::error::AppResult;
use crate::logger::Logger;
use crate::progress_manager::{get_enhanced_progress_manager, EnhancedProgressManager};
use crate::types::word_analysis::{
    BatchAnalysisProgress, BatchAnalysisConfig, BatchAnalysisResult,
};
use crate::types::AIModelConfig;
use sqlx::{SqlitePool, Row};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use futures::stream::{self, StreamExt};

/// 提取单词（第一步）
#[tauri::command]
pub async fn extract_words_from_text(
    app: AppHandle,
    text: String,
    model_id: Option<i64>,
) -> AppResult<crate::types::word_analysis::WordExtractionResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    // 获取 AI 服务
    let model_config = get_model_config(model_id, &pool, &logger).await?;
    let ai_service = Arc::new(AIService::from_model_config(&model_config)?);

    logger.info(
        "WORD_ANALYSIS",
        &format!("🚀 Starting word extraction from text (length: {})", text.len()),
    );

    // 执行单词提取
    let result = ai_service.extract_words(&text, &logger).await?;

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

/// 批量分析已提取的单词（第二步）
#[tauri::command]
pub async fn analyze_extracted_words(
    app: AppHandle,
    words: Vec<String>,
    model_id: Option<i64>,
    config: Option<BatchAnalysisConfig>,
) -> AppResult<BatchAnalysisResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    // 1. 获取 AI 服务
    let model_config = get_model_config(model_id, &pool, &logger).await?;
    let ai_service = Arc::new(AIService::from_model_config(&model_config)?);

    // 2. 获取进度管理器
    let progress_manager = get_enhanced_progress_manager();
    progress_manager.start_batch_analysis();

    // 3. 获取配置
    let config = config.unwrap_or_default();

    logger.info(
        "WORD_ANALYSIS",
        &format!(
            "🚀 Starting batch analysis of {} words with config: batch_size={}, max_concurrent={}",
            words.len(), config.batch_size, config.max_concurrent_batches
        ),
    );

    // 4. 执行批量分析
    let result = analyze_words_parallel(
        Arc::clone(&ai_service),
        words,
        &model_config,
        &logger,
        &progress_manager,
        &config,
        app.clone(),
    )
    .await?;

    logger.api_response(
        "analyze_extracted_words",
        true,
        Some(&format!(
            "Analyzed {} words in {:.2}s",
            result.completed_words,
            result.elapsed_seconds
        )),
    );

    Ok(result)
}

/// 批量分析文本（新命令）- 保留用于向后兼容
#[tauri::command]
pub async fn analyze_text_with_batching(
    app: AppHandle,
    text: String,
    model_id: Option<i64>,
    extraction_mode: Option<String>,
    config: Option<BatchAnalysisConfig>,
) -> AppResult<BatchAnalysisResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();

    // 1. 获取 AI 服务
    let model_config = get_model_config(model_id, &pool, &logger).await?;
    let ai_service = Arc::new(AIService::from_model_config(&model_config)?);

    // 2. 获取进度管理器
    let progress_manager = get_enhanced_progress_manager();
    progress_manager.start_batch_analysis();

    // 3. 获取配置
    let config = config.unwrap_or_default();

    logger.info(
        "WORD_ANALYSIS",
        &format!(
            "🚀 Starting batch analysis with config: batch_size={}, max_concurrent={}",
            config.batch_size, config.max_concurrent_batches
        ),
    );

    // 4. 执行批量分析
    let result = analyze_text_with_batching_impl(
        Arc::clone(&ai_service),
        &text,
        &model_config,
        extraction_mode.as_deref().unwrap_or("focus"),
        &logger,
        &progress_manager,
        &config,
    )
    .await?;

    logger.api_response(
        "analyze_text_with_batching",
        true,
        Some(&format!(
            "Analyzed {} words in {:.2}s",
            result.completed_words,
            result.elapsed_seconds
        )),
    );

    Ok(result)
}

/// 获取批量分析进度（新命令）
#[tauri::command]
pub async fn get_batch_analysis_progress(
    app: AppHandle,
) -> AppResult<BatchAnalysisProgress> {
    let progress_manager = get_enhanced_progress_manager();
    Ok(progress_manager.get_full_progress())
}

/// 取消批量分析（新命令）
#[tauri::command]
pub async fn cancel_batch_analysis(app: AppHandle) -> AppResult<()> {
    let progress_manager = get_enhanced_progress_manager();
    progress_manager.cancel_analysis();
    Ok(())
}

/// 批量分析实现
async fn analyze_text_with_batching_impl(
    ai_service: Arc<AIService>,
    text: &str,
    _model_config: &AIModelConfig,
    _extraction_mode: &str,
    logger: &Logger,
    progress_manager: &EnhancedProgressManager,
    config: &BatchAnalysisConfig,
) -> Result<BatchAnalysisResult, Box<dyn std::error::Error>> {
    let start_time = std::time::Instant::now();

    // 步骤 1：提取单词列表
    logger.info("WORD_ANALYSIS", "🚀 步骤 1：开始提取单词...");
    let extraction_result = ai_service.extract_words(text, logger).await?;

    // 更新提取进度
    progress_manager.update_extraction_progress(
        &crate::types::word_analysis::ExtractionProgress {
            total_words: extraction_result.total_count,
            extracted_words: extraction_result.total_count,
            elapsed_seconds: start_time.elapsed().as_secs_f64(),
        },
    );

    logger.info(
        "WORD_ANALYSIS",
        &format!(
            "✅ 步骤 1 完成：提取到 {} 个单词",
            extraction_result.unique_count
        ),
    );

    // 步骤 2：分批并并行分析
    logger.info(
        "WORD_ANALYSIS",
        &format!(
            "📦 步骤 2：开始批量分析 {} 个单词...",
            extraction_result.unique_count
        ),
    );

    let words: Vec<String> = extraction_result
        .words
        .into_iter()
        .map(|w| w.word)
        .collect();

    let total_batches = (words.len() + config.batch_size - 1) / config.batch_size;

    // 使用 tokio 的并发工具
    let mut analysis_results: Vec<crate::ai_service::PhonicsWord> = Vec::new();
    let mut failed_words: Vec<String> = Vec::new();

    // 分批处理
    for (batch_index, batch) in words.chunks(config.batch_size).enumerate() {
        // 检查是否已取消
        if progress_manager.is_cancelled() {
            logger.info("WORD_ANALYSIS", "🚫 批量分析已取消");
            break;
        }

        let batch_words: Vec<String> = batch.to_vec();

        // 更新分析进度
        progress_manager.update_analysis_progress(
            &crate::types::word_analysis::AnalysisProgress {
                total_words: words.len(),
                completed_words: analysis_results.len(),
                failed_words: failed_words.len(),
                current_word: Some(batch_words.first().cloned().unwrap_or_default()),
                batch_info: crate::types::word_analysis::BatchInfo {
                    total_batches,
                    completed_batches: batch_index,
                    current_batch: batch_index,
                    batch_size: config.batch_size,
                },
                elapsed_seconds: start_time.elapsed().as_secs_f64(),
            },
        );

        // 并发处理批次
        match ai_service
            .analyze_words_batch(
                batch_words.clone(),
                batch_index,
                total_batches,
                logger,
            )
            .await
        {
            Ok(batch_words) => {
                analysis_results.extend(batch_words.clone());
                // 更新每个单词的状态
                for word in &batch_words {
                    progress_manager.update_word_status(
                        &crate::types::word_analysis::WordAnalysisStatus {
                            word: word.word.clone(),
                            status: "completed".to_string(),
                            error: None,
                            result: Some(word.clone()),
                        },
                    );
                }
            }
            Err(e) => {
                // 批次失败，标记所有单词为失败
                for word in &batch_words {
                    failed_words.push(word.clone());
                    progress_manager.update_word_status(
                        &crate::types::word_analysis::WordAnalysisStatus {
                            word: word.clone(),
                            status: "failed".to_string(),
                            error: Some(e.to_string()),
                            result: None,
                        },
                    );
                }
            }
        }
    }

    // 步骤 3：合并结果
    logger.info(
        "WORD_ANALYSIS",
        "✅ 步骤 3：批量分析完成",
    );

    let total_words_count = words.len();
    let completed_words_count = analysis_results.len();
    let failed_words_count = failed_words.len();

    Ok(BatchAnalysisResult {
        words: analysis_results,
        total_words: total_words_count,
        completed_words: completed_words_count,
        failed_words: failed_words_count,
        elapsed_seconds: start_time.elapsed().as_secs_f64(),
    })
}

/// 获取模型配置
async fn get_model_config(
    model_id: Option<i64>,
    pool: &SqlitePool,
    logger: &Logger,
) -> Result<AIModelConfig, Box<dyn std::error::Error>> {
    let config = if let Some(id) = model_id {
        // 使用指定的模型
        let row = sqlx::query("SELECT * FROM ai_models WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|e| format!("Failed to fetch AI model: {}", e))?;

        let provider_id: i64 = row.get("provider_id");
        let provider_row = sqlx::query("SELECT * FROM ai_providers WHERE id = ?")
            .bind(provider_id)
            .fetch_one(pool)
            .await
            .map_err(|e| format!("Failed to fetch AI provider: {}", e))?;

        AIModelConfig {
            id: id,
            name: row.get("name"),
            display_name: row.get("display_name"),
            model_id: row.get("model_id"),
            description: row.get("description"),
            max_tokens: row.get("max_tokens"),
            temperature: row.get("temperature"),
            is_active: row.get("is_active"),
            is_default: row.get("is_default"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            provider: crate::types::AIProvider {
                id: provider_id,
                name: provider_row.get("name"),
                display_name: provider_row.get("display_name"),
                base_url: provider_row.get("base_url"),
                api_key: provider_row.get("api_key"),
                description: provider_row.get("description"),
                is_active: provider_row.get("is_active"),
                created_at: provider_row.get("created_at"),
                updated_at: provider_row.get("updated_at"),
            },
        }
    } else {
        // 使用默认模型
        let row = sqlx::query("SELECT * FROM ai_models WHERE is_default = 1 LIMIT 1")
            .fetch_one(pool)
            .await
            .map_err(|e| format!("Failed to fetch default AI model: {}", e))?;

        let provider_id: i64 = row.get("provider_id");
        let provider_row = sqlx::query("SELECT * FROM ai_providers WHERE id = ?")
            .bind(provider_id)
            .fetch_one(pool)
            .await
            .map_err(|e| format!("Failed to fetch AI provider: {}", e))?;

        AIModelConfig {
            id: row.get("id"),
            name: row.get("name"),
            display_name: row.get("display_name"),
            model_id: row.get("model_id"),
            description: row.get("description"),
            max_tokens: row.get("max_tokens"),
            temperature: row.get("temperature"),
            is_active: row.get("is_active"),
            is_default: row.get("is_default"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            provider: crate::types::AIProvider {
                id: provider_id,
                name: provider_row.get("name"),
                display_name: provider_row.get("display_name"),
                base_url: provider_row.get("base_url"),
                api_key: provider_row.get("api_key"),
                description: provider_row.get("description"),
                is_active: provider_row.get("is_active"),
                created_at: provider_row.get("created_at"),
                updated_at: provider_row.get("updated_at"),
            },
        }
    };

    logger.info(
        "WORD_ANALYSIS",
        &format!(
            "Using AI model: {} ({})",
            config.name, config.model_id
        ),
    );

    Ok(config)
}

/// 只批量分析单词（不包含提取步骤）- 并行版本
async fn analyze_words_parallel(
    ai_service: Arc<AIService>,
    words: Vec<String>,
    _model_config: &AIModelConfig,
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

    let total_batches = (words.len() + config.batch_size - 1) / config.batch_size;
    
    // 将单词分成批次
    let batches: Vec<Vec<String>> = words
        .chunks(config.batch_size)
        .map(|chunk| chunk.to_vec())
        .collect();

    logger.info(
        "WORD_ANALYSIS",
        &format!("📊 共分为 {} 个批次，每批最多 {} 个单词", batches.len(), config.batch_size),
    );

    // 并行处理批次，限制并发数
    let mut analysis_results: Vec<crate::ai_service::PhonicsWord> = Vec::new();
    let mut failed_words: Vec<String> = Vec::new();
    let mut completed_batches = 0;
    
    // 初始化分析进度
    let total_words_count = words.len();
    
    progress_manager.update_analysis_progress(
        &crate::types::word_analysis::AnalysisProgress {
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
        },
    );
    
    // 克隆 total_words_count 以便在闭包中使用
    let total_words_count_for_closure = total_words_count;
    
    // 使用 futures stream 来限制并发数
    let batches_stream = stream::iter(batches.into_iter().enumerate())
        .map(|(batch_index, batch_words)| {
            let ai_service = Arc::clone(&ai_service);
            let logger = logger.clone();
            let batch_index_clone = batch_index;
            let batch_words_clone = batch_words.clone();
            let total_words_count = total_words_count_for_closure;
            let app_handle = app_handle.clone();
            
            async move {
                // 检查是否已取消
                if progress_manager.is_cancelled() {
                    logger.info("WORD_ANALYSIS", "🚫 批量分析已取消");
                    return (batch_index, None, batch_words_clone);
                }

                // 发送批次开始事件
                if let Err(e) = app_handle.emit_to("main", "batch-start", crate::types::word_analysis::BatchStartEvent {
                    batch_index: batch_index_clone,
                    total_batches,
                    words: batch_words_clone.clone(),
                }) {
                    logger.error("WORD_ANALYSIS", &format!("Failed to emit batch-start event: {}", e), None);
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
                    if let Err(e) = app_handle.emit_to("main", "word-status-update", crate::types::word_analysis::WordStatusUpdateEvent {
                        word: word.clone(),
                        status: "analyzing".to_string(),
                        error: None,
                    }) {
                        logger.error("WORD_ANALYSIS", &format!("Failed to emit word-status-update event for word '{}': {}", word, e), None);
                    }
                }
                
                // 在批次开始时更新进度，让进度条能够移动
                progress_manager.update_analysis_progress(
                    &crate::types::word_analysis::AnalysisProgress {
                        total_words: total_words_count,
                        completed_words: batch_index_clone * config.batch_size,
                        failed_words: 0,
                        current_word: None,
                        batch_info: crate::types::word_analysis::BatchInfo {
                            total_batches,
                            completed_batches: batch_index_clone,
                            current_batch: batch_index_clone,
                            batch_size: config.batch_size,
                        },
                        elapsed_seconds: start_time.elapsed().as_secs_f64(),
                    },
                );

                // 处理批次
                match ai_service
                    .analyze_words_batch(
                        batch_words_clone.clone(),
                        batch_index_clone,
                        total_batches,
                        &logger,
                    )
                    .await
                {
                    Ok(batch_results) => {
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
                            if let Err(e) = app_handle.emit_to("main", "word-status-update", crate::types::word_analysis::WordStatusUpdateEvent {
                                word: word.word.clone(),
                                status: "completed".to_string(),
                                error: None,
                            }) {
                                logger.error("WORD_ANALYSIS", &format!("Failed to emit word-status-update event for word '{}': {}", word.word, e), None);
                            }
                        }

                        // 发送批次完成事件
                        if let Err(e) = app_handle.emit_to("main", "batch-complete", crate::types::word_analysis::BatchCompleteEvent {
                            batch_index: batch_index_clone,
                            completed_words: batch_results.len(),
                            failed_words: 0,
                        }) {
                            logger.error("WORD_ANALYSIS", &format!("Failed to emit batch-complete event for batch {}: {}", batch_index_clone, e), None);
                        }

                        (batch_index, Some(batch_results), Vec::new())
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
                            if let Err(e) = app_handle.emit_to("main", "word-status-update", crate::types::word_analysis::WordStatusUpdateEvent {
                                word: word.clone(),
                                status: "failed".to_string(),
                                error: Some(e.to_string()),
                            }) {
                                logger.error("WORD_ANALYSIS", &format!("Failed to emit word-status-update event for word '{}': {}", word, e), None);
                            }
                        }

                        (batch_index, None, batch_words_clone)
                    }
                }
            }
        })
        .buffer_unordered(config.max_concurrent_batches as usize);
    
    // 处理所有批次
    let mut batch_results_stream = Box::pin(batches_stream);
    
    while let Some((batch_index, batch_result, failed_batch_words)) = batch_results_stream.next().await {
        completed_batches += 1;
        
        // 立即更新分析进度 - 在批次完成时更新
        progress_manager.update_analysis_progress(
            &crate::types::word_analysis::AnalysisProgress {
                total_words: total_words_count,
                completed_words: analysis_results.len(),
                failed_words: failed_words.len(),
                current_word: None,
                batch_info: crate::types::word_analysis::BatchInfo {
                    total_batches,
                    completed_batches,
                    current_batch: batch_index,
                    batch_size: config.batch_size,
                },
                elapsed_seconds: start_time.elapsed().as_secs_f64(),
            },
        );

        if let Some(results) = batch_result {
            let result_len = results.len();
            analysis_results.extend(results);
            logger.info(
                "WORD_ANALYSIS",
                &format!("✅ 批次 {}/{} 完成，分析了 {} 个单词", batch_index + 1, total_batches, result_len),
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

    logger.info(
        "WORD_ANALYSIS",
        "✅ 批量分析完成",
    );
    
    let total_words_count = words.len();
    let completed_words_count = analysis_results.len();
    let failed_words_count = failed_words.len();

    // 发送分析完成事件
    if let Err(e) = app_handle.emit_to("main", "analysis-complete", crate::types::word_analysis::AnalysisCompleteEvent {
        total_words: total_words_count,
        completed_words: completed_words_count,
        failed_words: failed_words_count,
        elapsed_seconds: start_time.elapsed().as_secs_f64(),
    }) {
        logger.error("WORD_ANALYSIS", &format!("Failed to emit analysis-complete event: {}", e), None);
    }
    
    Ok(BatchAnalysisResult {
        words: analysis_results,
        total_words: total_words_count,
        completed_words: completed_words_count,
        failed_words: failed_words_count,
        elapsed_seconds: start_time.elapsed().as_secs_f64(),
    })
}
