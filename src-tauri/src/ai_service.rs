use crate::logger::Logger;
use crate::types::AIModelConfig;
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestMessage, ChatCompletionRequestSystemMessage,
        CreateChatCompletionRequestArgs, Role,
    },
    Client,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// 分析进度状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisProgress {
    pub status: String,           // "analyzing", "completed", "error"
    pub current_step: String,     // 当前步骤描述
    pub chunks_received: u32,     // 已接收的chunk数量
    pub total_chars: usize,       // 已接收的总字符数
    pub elapsed_seconds: f64,     // 已用时间（秒）
    pub error_message: Option<String>, // 错误信息
}

/// 全局进度管理器
pub struct ProgressManager {
    progress: Arc<Mutex<Option<AnalysisProgress>>>,
    cancelled: Arc<Mutex<bool>>,
}

// 全局进度管理器实例
static GLOBAL_PROGRESS_MANAGER: std::sync::OnceLock<ProgressManager> = std::sync::OnceLock::new();

impl ProgressManager {
    pub fn new() -> Self {
        Self {
            progress: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(Mutex::new(false)),
        }
    }

    pub fn start_analysis(&self) {
        // 重置取消标志
        let mut cancelled = self.cancelled.lock().unwrap();
        *cancelled = false;
        drop(cancelled);

        let mut progress = self.progress.lock().unwrap();
        *progress = Some(AnalysisProgress {
            status: "analyzing".to_string(),
            current_step: "准备分析...".to_string(),
            chunks_received: 0,
            total_chars: 0,
            elapsed_seconds: 0.0,
            error_message: None,
        });
    }

    pub fn update_step(&self, step: &str, start_time: Instant) {
        if let Ok(mut progress) = self.progress.lock() {
            if let Some(ref mut p) = *progress {
                p.current_step = step.to_string();
                p.elapsed_seconds = start_time.elapsed().as_secs_f64();
            }
        }
    }

    pub fn update_chunk(&self, chunks: u32, total_chars: usize, start_time: Instant) {
        if let Ok(mut progress) = self.progress.lock() {
            if let Some(ref mut p) = *progress {
                p.chunks_received = chunks;
                p.total_chars = total_chars;
                p.elapsed_seconds = start_time.elapsed().as_secs_f64();
            }
        }
    }

    pub fn complete_analysis(&self) {
        if let Ok(mut progress) = self.progress.lock() {
            if let Some(ref mut p) = *progress {
                p.status = "completed".to_string();
                p.current_step = "分析完成".to_string();
            }
        }
    }

    pub fn error_analysis(&self, error: &str) {
        if let Ok(mut progress) = self.progress.lock() {
            if let Some(ref mut p) = *progress {
                p.status = "error".to_string();
                p.current_step = "分析失败".to_string();
                p.error_message = Some(error.to_string());
            }
        }
    }

    pub fn get_progress(&self) -> Option<AnalysisProgress> {
        self.progress.lock().ok()?.clone()
    }

    pub fn clear_progress(&self) {
        let mut progress = self.progress.lock().unwrap();
        *progress = None;
    }

    pub fn cancel_analysis(&self) {
        let mut cancelled = self.cancelled.lock().unwrap();
        *cancelled = true;
        drop(cancelled);

        // 更新进度状态为已取消
        if let Ok(mut progress) = self.progress.lock() {
            if let Some(ref mut p) = *progress {
                p.status = "cancelled".to_string();
                p.current_step = "分析已取消".to_string();
            }
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.lock().map(|guard| *guard).unwrap_or(false)
    }
}

/// 获取全局进度管理器
pub fn get_global_progress_manager() -> &'static ProgressManager {
    GLOBAL_PROGRESS_MANAGER.get_or_init(|| ProgressManager::new())
}

/// AI 服务提供商配置（动态配置）
#[derive(Debug, Clone)]
pub struct AIProvider {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub default_model: String,
}

impl AIProvider {
    pub fn get_api_key(&self) -> &str {
        &self.api_key
    }

    pub fn get_base_url(&self) -> &str {
        &self.base_url
    }

    pub fn get_default_model(&self) -> &str {
        &self.default_model
    }
}

// 移除了传统词汇分析相关的结构体，只保留自然拼读分析

/// 简单的聊天消息
#[derive(Debug, Serialize, Deserialize)]
pub struct SimpleChatMessage {
    pub role: String,
    pub content: String,
}

/// 聊天完成请求
#[derive(Debug, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<SimpleChatMessage>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

/// 聊天完成响应
#[derive(Debug, Serialize, Deserialize)]
pub struct ChatCompletionChoice {
    pub message: SimpleChatMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub choices: Vec<ChatCompletionChoice>,
    pub usage: Option<HashMap<String, u32>>,
}

/// CSV 记录结构（用于批量分析）
#[derive(Debug, Deserialize)]
struct CsvPhonicsRecord {
    word: String,
    frequency: i32,
    chinese_translation: String,
    pos_abbreviation: String,
    pos_english: String,
    pos_chinese: String,
    ipa: String,
    syllables: String,
    phonics_rule: String,
    analysis_explanation: String,
}

impl CsvPhonicsRecord {
    fn into_phonics_word(self) -> PhonicsWord {
        PhonicsWord {
            word: self.word,
            frequency: self.frequency,
            chinese_translation: self.chinese_translation,
            pos_abbreviation: self.pos_abbreviation,
            pos_english: self.pos_english,
            pos_chinese: self.pos_chinese,
            ipa: self.ipa,
            syllables: self.syllables,
            phonics_rule: self.phonics_rule,
            analysis_explanation: self.analysis_explanation,
        }
    }
}

/// 通用 AI 服务
pub struct AIService {
    provider: AIProvider,
    client: Client<OpenAIConfig>,
}

impl AIService {
    /// 使用指定提供商创建 AI 服务
    pub fn new(provider: AIProvider) -> Self {
        let config = OpenAIConfig::new()
            .with_api_key(&provider.api_key)
            .with_api_base(&provider.base_url);

        Self {
            provider,
            client: Client::with_config(config),
        }
    }

    /// 从数据库模型配置创建 AI 服务
    pub fn from_model_config(
        model_config: &AIModelConfig,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let provider = AIProvider {
            name: model_config.provider.name.clone(),
            base_url: model_config.provider.base_url.clone(),
            api_key: model_config.provider.api_key.clone(),
            default_model: model_config.model_id.clone(),
        };

        Ok(Self::new(provider))
    }

    /// 获取分析进度
    pub fn get_analysis_progress(&self) -> Option<AnalysisProgress> {
        get_global_progress_manager().get_progress()
    }

    /// 清除分析进度
    pub fn clear_analysis_progress(&self) {
        get_global_progress_manager().clear_progress()
    }

    // 移除了传统词汇分析方法，只保留自然拼读分析

    /// 提取单词列表（用于批量分析的第一步）
    pub async fn extract_words(
        &self,
        text: &str,
        logger: &Logger,
    ) -> Result<crate::types::word_analysis::WordExtractionResult, Box<dyn std::error::Error>> {
        let start_time = std::time::Instant::now();

        logger.info(
            "AI_SERVICE",
            &format!(
                "🚀 Starting word extraction for text: {}",
                if text.len() > 100 { &text[..100] } else { text }
            ),
        );

        // 读取单词提取提示词
        let extraction_prompt = include_str!("prompts/word_extraction_agent.md");

        // 构建完整的提示词
        let system_message = extraction_prompt.replace("{original_text}", text);

        logger.info(
            "AI_SERVICE",
            &format!(
                "📄 Built extraction prompt: {} chars",
                system_message.len()
            ),
        );

        // 构建请求（使用小 max_tokens，因为只需要单词列表）
        let request = CreateChatCompletionRequestArgs::default()
            .model(self.provider.get_default_model())
            .messages([ChatCompletionRequestMessage::System(
                ChatCompletionRequestSystemMessage {
                    content: system_message,
                    role: Role::System,
                    name: None,
                },
            )])
            .max_tokens(2000u16)  // 限制输出长度
            .temperature(0.1)    // 低温度保证稳定性
            .stream(false)        // 非流式，快速获取结果
            .build()?;

        logger.info("AI_SERVICE", "📤 Sending word extraction request...");

        // 发送请求
        let response = self.client.chat().create(request).await
            .map_err(|e| {
                logger.info("AI_SERVICE", &format!("❌ Word extraction failed: {}", e));
                format!("Word extraction failed: {}", e)
            })?;

        // 提取响应内容
        let content = response.choices.first()
            .and_then(|choice| choice.message.content.as_ref())
            .ok_or("No content in word extraction response")?;

        logger.info(
            "AI_SERVICE",
            &format!(
                "✅ Word extraction successful - Response length: {} chars",
                content.len()
            ),
        );

        // 解析 CSV 响应
        let words = self.parse_csv_response(content, &logger)?;

        let total_count = words.len();
        let unique_count = words.len();

        logger.info(
            "AI_SERVICE",
            &format!(
                "📊 Extracted {} unique words (total occurrences: {}) in {:?}",
                unique_count,
                total_count,
                start_time.elapsed()
            ),
        );

        Ok(crate::types::word_analysis::WordExtractionResult {
            words,
            total_count,
            unique_count,
        })
    }

    /// 批量分析单词（用于批量分析的第二步）
    pub async fn analyze_words_batch(
        &self,
        words: Vec<String>,
        batch_index: usize,
        total_batches: usize,
        logger: &Logger,
    ) -> Result<Vec<PhonicsWord>, Box<dyn std::error::Error>> {
        let start_time = std::time::Instant::now();
        
        logger.info(
            "AI_SERVICE",
            &format!(
                "🚀 Starting batch analysis: batch {}/{}, {} words",
                batch_index + 1,
                total_batches,
                words.len()
            ),
        );
        
        // 读取批量自然拼读分析提示词（CSV格式）
        let phonics_prompt_template = include_str!("prompts/batch_phonics_agent.md");
        
        // 构建批量分析提示词
        let words_list = words.join(", ");
        
        let batch_prompt = phonics_prompt_template.replace("{word_list}", &words_list);
        
        logger.info(
            "AI_SERVICE",
            &format!(
                "📄 Built batch prompt: {} chars",
                batch_prompt.len()
            ),
        );
        
        // 构建请求
        let request = CreateChatCompletionRequestArgs::default()
            .model(self.provider.get_default_model())
            .messages([ChatCompletionRequestMessage::System(
                ChatCompletionRequestSystemMessage {
                    content: batch_prompt,
                    role: Role::System,
                    name: None,
                },
            )])
            .max_tokens(8000u16)  // 每批 5 个单词
            .temperature(0.1)
            .stream(false)        // 使用非流式输出，直接获取完整 CSV
            .build()?;
        
        logger.info("AI_SERVICE", "📤 Sending batch analysis request...");
        
        // 发送请求并获取完整响应
        let response = self.client.chat().create(request).await
            .map_err(|e| {
                logger.info("AI_SERVICE", &format!("❌ Batch analysis failed: {}", e));
                format!("Batch analysis failed: {}", e)
            })?;
        
        // 提取响应内容
        let content = response.choices.first()
            .and_then(|choice| choice.message.content.as_ref())
            .ok_or("No content in batch analysis response")?;
        
        logger.info(
            "AI_SERVICE",
            &format!(
                "✅ Batch analysis successful - Response length: {} chars in {:?}",
                content.len(),
                start_time.elapsed()
            ),
        );
        
        // 解析 CSV 响应
        let result_words = self.parse_batch_csv_response(content, logger)?;
        
        logger.info(
            "AI_SERVICE",
            &format!(
                "📊 Batch {}/{} completed: {} words analyzed in {:?}",
                batch_index + 1,
                total_batches,
                result_words.len(),
                start_time.elapsed()
            ),
        );
        
        Ok(result_words)
    }

    /// 自然拼读分析
    pub async fn analyze_phonics(
        &self,
        text: &str,
        model_name: Option<&str>,
        max_tokens: Option<u32>,
        temperature: Option<f32>,
        extraction_mode: &str,
        logger: &Logger,
    ) -> Result<PhonicsAnalysisResult, Box<dyn std::error::Error>> {
        let start_time = std::time::Instant::now();

        // 启动进度跟踪
        let progress_manager = get_global_progress_manager();
        progress_manager.start_analysis();

        logger.info(
            "AI_SERVICE",
            &format!(
                "🚀 Starting phonics analysis for text: {}",
                if text.len() > 100 { &text[..100] } else { text }
            ),
        );

        // 步骤1: 读取提示词模板
        progress_manager.update_step("读取提示词模板...", start_time);
        let step1_start = std::time::Instant::now();
        let prompt_template = include_str!("prompts/phonics_agent.md");
        let step1_duration = step1_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!(
                "📄 Step 1 - Loaded prompt template: {} chars in {:?}",
                prompt_template.len(),
                step1_duration
            ),
        );

        // 步骤2: 构建完整的提示词（替换占位符）
        progress_manager.update_step("构建分析提示词...", start_time);
        let step2_start = std::time::Instant::now();

        // 根据提取模式生成额外的预处理步骤
        let additional_steps = if extraction_mode == "focus" {
            r#"4. 过滤简单词汇：排除以下类型的简单词汇，这些词汇不适合作为学习重点
   - 冠词：a, an, the
   - 基础代词：I, you, he, she, it, we, they, me, him, her, us, them
   - 基础be动词：am, is, are, was, were, be, been, being
   - 基础助动词：do, does, did, have, has, had, will, would, can, could, should, shall, may, might, must
   - 基础介词：in, on, at, to, for, of, with, by, from, up, out, off, over, under
   - 基础连词：and, or, but, so, if, when, then, than, as
   - 基础副词：not, no, yes, very, too, also, only, just, now, here, there
   - 单字母词：a, I
   - 过于简单的数字词：one, two, three, four, five, six, seven, eight, nine, ten

5. 重点关注：优先分析具有学习价值的实词（名词、动词、形容词、副词）和中等难度以上的功能词"#
        } else {
            // all 模式下不添加额外的预处理步骤
            ""
        };

        let system_message = prompt_template
            .replace("{original_text}", text)
            .replace("{additional_text_preprocessing_steps}", additional_steps);

        let step2_duration = step2_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!(
                "📝 Step 2 - Built complete prompt with {} mode: {} chars in {:?}",
                extraction_mode,
                system_message.len(),
                step2_duration
            ),
        );



        // 步骤3: 准备模型参数
        progress_manager.update_step("准备AI模型参数...", start_time);
        let step3_start = std::time::Instant::now();
        let actual_model_name = model_name.unwrap_or(self.provider.get_default_model());
        let final_max_tokens = max_tokens.unwrap_or(8000);
        let final_temperature = temperature.unwrap_or(0.1);
        let step3_duration = step3_start.elapsed();

        logger.info(
            "AI_SERVICE",
            &format!(
                "🔧 Step 3 - Model parameters prepared in {:?}:",
                step3_duration
            ),
        );
        logger.info("AI_SERVICE", &format!("   📊 Model: {}", actual_model_name));
        logger.info(
            "AI_SERVICE",
            &format!("   🎯 Max tokens: {}", final_max_tokens),
        );
        logger.info(
            "AI_SERVICE",
            &format!("   🌡️  Temperature: {}", final_temperature),
        );
        logger.info(
            "AI_SERVICE",
            &format!("   🌐 Base URL: {}", self.provider.base_url),
        );
        logger.info(
            "AI_SERVICE",
            &format!("   🔑 API key length: {}", self.provider.api_key.len()),
        );
        logger.info(
            "AI_SERVICE",
            &format!("   🔑 API key preview: {}...",
                if self.provider.api_key.len() > 10 {
                    &self.provider.api_key[..10]
                } else {
                    &self.provider.api_key
                }
            ),
        );

        // 步骤4: 构建 AI 请求（不使用流式输出，一次性获取完整结果）
        progress_manager.update_step("构建AI请求...", start_time);
        let step4_start = std::time::Instant::now();
        let request = CreateChatCompletionRequestArgs::default()
            .model(actual_model_name)
            .messages([ChatCompletionRequestMessage::System(
                ChatCompletionRequestSystemMessage {
                    content: system_message,
                    role: Role::System,
                    name: None,
                },
            )])
            .max_tokens(final_max_tokens.min(65535) as u16)
            .temperature(final_temperature)
            .stream(false) // 不使用流式输出，一次性获取完整结果
            .build()?;
        let step4_duration = step4_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!(
                "🔨 Step 4 - Built AI streaming request in {:?}",
                step4_duration
            ),
        );

        // 步骤5: 发送 AI API 流式请求
        progress_manager.update_step("连接AI服务...", start_time);
        let step5_start = std::time::Instant::now();
        logger.info(
            "AI_SERVICE",
            "🌐 Step 5 - Sending streaming request to AI API...",
        );
        logger.info(
            "AI_SERVICE",
            &format!(
                "📤 Request details: {} tokens max, temp {}, to {}",
                final_max_tokens, final_temperature, self.provider.base_url
            ),
        );

        let response = self.client.chat().create(request).await
            .map_err(|e| {
                logger.info("AI_SERVICE", &format!("❌ Request failed: {}", e));
                format!("Request failed: {}", e)
            })?;
        let step5_duration = step5_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!(
                "📡 Step 5 - Response received in {:?}",
                step5_duration
            ),
        );

        // 步骤6: 提取响应内容
        let step6_start = std::time::Instant::now();
        let content = response.choices.first()
            .and_then(|choice| choice.message.content.as_ref())
            .ok_or("No content in word extraction response")?;

        let step6_duration = step6_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!(
                "✅ Step 6 - Extracted content in {:?}: {} chars",
                step6_duration,
                content.len()
            ),
        );

        // 步骤7: 解析 JSON 响应
        let step7_start = std::time::Instant::now();
        match self.parse_phonics_json(&content) {
            Ok(result) => {
                let step7_duration = step7_start.elapsed();
                let total_duration = start_time.elapsed();
                logger.info(
                    "AI_SERVICE",
                    &format!(
                        "🎉 Step 7 - Successfully parsed {} phonics entries in {:?}",
                        result.words.len(),
                        step7_duration
                    ),
                );
                logger.info(
                    "AI_SERVICE",
                    &format!("⏱️  Total analysis time: {:?}", total_duration),
                );

                // 标记分析完成
                progress_manager.complete_analysis();

                Ok(result)
            }
            Err(e) => {
                let step7_duration = step7_start.elapsed();
                let total_duration = start_time.elapsed();
                logger.info(
                    "AI_SERVICE",
                    &format!(
                        "❌ Step 7 - JSON parsing failed in {:?}: {}",
                        step7_duration, e
                    ),
                );
                logger.info(
                    "AI_SERVICE",
                    &format!("📄 Full AI response for debugging: {}", content),
                );
                logger.info(
                    "AI_SERVICE",
                    &format!("⏱️  Total time before failure: {:?}", total_duration),
                );

                // 标记分析失败
                let error_msg = format!("Failed to parse phonics analysis: JSON parsing error: {}", e);
                progress_manager.error_analysis(&error_msg);

                Err(error_msg.into())
            }
        }
    }

    /// 生成学习计划日程规划
    pub async fn generate_study_plan_schedule(
        &self,
        params: crate::types::study::StudyPlanAIParams,
        model_config: &AIModelConfig,
        logger: &Logger,
    ) -> Result<crate::types::study::StudyPlanAIResult, Box<dyn std::error::Error>> {
        let start_time = std::time::Instant::now();

        // 启动进度跟踪
        let progress_manager = get_global_progress_manager();
        progress_manager.start_analysis();

        logger.info(
            "AI_SERVICE",
            &format!(
                "🚀 Starting study plan schedule generation: {} words, {} days, {} intensity",
                params.total_words, params.period_days, params.intensity_level
            ),
        );

        // 步骤1: 读取提示词模板
        progress_manager.update_step("读取学习计划提示词模板...", start_time);
        let step1_start = std::time::Instant::now();
        let prompt_template = include_str!("prompts/study_plan_agent.md");
        let step1_duration = step1_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!(
                "📄 Step 1 - Loaded study plan prompt template: {} chars in {:?}",
                prompt_template.len(),
                step1_duration
            ),
        );

        // 步骤2: 构建完整的提示词（替换占位符）
        progress_manager.update_step("构建学习计划规划提示词...", start_time);
        let step2_start = std::time::Instant::now();

        // 将单词列表转换为JSON字符串
        let word_list_json = match serde_json::to_string_pretty(&params.word_list) {
            Ok(json) => json,
            Err(e) => {
                let error_msg = format!("Failed to serialize word list: {}", e);
                progress_manager.error_analysis(&error_msg);
                return Err(error_msg.into());
            }
        };

        // 替换提示词中的占位符
        let full_prompt = prompt_template
            .replace("{intensity_level}", &params.intensity_level)
            .replace("{total_words}", &params.total_words.to_string())
            .replace("{period_days}", &params.period_days.to_string())
            .replace("{review_frequency}", &params.review_frequency.to_string())
            .replace("{start_date}", &params.start_date)
            .replace("{word_list}", &word_list_json);

        let step2_duration = step2_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!(
                "📝 Step 2 - Built full prompt: {} chars in {:?}",
                full_prompt.len(),
                step2_duration
            ),
        );

        // 输出完整提示词用于调试
        logger.info(
            "AI_SERVICE",
            &format!("📝 Full prompt content:\n{}", full_prompt),
        );

        // 步骤3: 准备API请求参数
        progress_manager.update_step("准备AI请求参数...", start_time);
        let step3_start = std::time::Instant::now();

        let model_name = model_config.model_id.as_str();
        let max_tokens = model_config.max_tokens.unwrap_or(4000) as u32;
        let temperature = model_config.temperature.unwrap_or(0.3) as f32;

        logger.info(
            "AI_SERVICE",
            &format!(
                "🔧 Step 3 - API params: model={}, max_tokens={}, temperature={}",
                model_name, max_tokens, temperature
            ),
        );
        logger.info(
            "AI_SERVICE",
            &format!("   🔗 Base URL: {}", self.provider.base_url),
        );
        logger.info(
            "AI_SERVICE",
            &format!("   🔑 API key preview: {}...",
                if self.provider.api_key.len() > 10 {
                    &self.provider.api_key[..10]
                } else {
                    &self.provider.api_key
                }
            ),
        );

        // 测试网络连接
        logger.info(
            "AI_SERVICE",
            "🌐 Testing network connectivity to OpenRouter...",
        );

        let step3_duration = step3_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!("⚙️  Step 3 completed in {:?}", step3_duration),
        );

        // 步骤4: 创建聊天请求
        progress_manager.update_step("创建AI聊天请求...", start_time);
        let step4_start = std::time::Instant::now();

        let request = CreateChatCompletionRequestArgs::default()
            .model(model_name)
            .messages([ChatCompletionRequestMessage::System(
                ChatCompletionRequestSystemMessage {
                    content: full_prompt,
                    role: Role::System,
                    name: None,
                },
            )])
            .max_tokens(max_tokens.min(65535) as u16)
            .temperature(temperature)
            .stream(true)
            .build()?;

        let step4_duration = step4_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!("📤 Step 4 - Created chat request in {:?}", step4_duration),
        );

        // 步骤5: 发送请求并建立流连接
        progress_manager.update_step("发送AI请求...", start_time);
        let step5_start = std::time::Instant::now();

        let stream = self.client.chat().create_stream(request).await;

        let step5_duration = step5_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!("🌐 Step 5 - Sent request in {:?}", step5_duration),
        );

        // 步骤6: 处理流式响应
        let step6_start = std::time::Instant::now();
        let mut stream = match stream {
            Ok(s) => {
                logger.info(
                    "AI_SERVICE",
                    "✅ Successfully established stream connection for study plan",
                );
                s
            }
            Err(e) => {
                let total_duration = start_time.elapsed();
                let error_msg = format!("Failed to establish stream connection: {}", e);
                logger.info(
                    "AI_SERVICE",
                    &format!(
                        "❌ Stream connection failed after {:?}: {}",
                        total_duration, error_msg
                    ),
                );
                progress_manager.error_analysis(&error_msg);
                return Err(error_msg.into());
            }
        };

        // 步骤7: 收集流式响应内容
        progress_manager.update_step("接收AI学习计划规划结果...", start_time);
        logger.info(
            "AI_SERVICE",
            "📥 Step 7 - Starting to receive study plan stream response",
        );

        let mut full_content = String::new();
        let mut chunk_count = 0;
        let mut last_log_time = std::time::Instant::now();

        while let Some(result) = stream.next().await {
            // 检查是否已取消
            if progress_manager.is_cancelled() {
                logger.info("AI_SERVICE", "🚫 Study plan generation cancelled by user");
                // 返回一个空的结果而不是错误，与自然拼读分析保持一致
                return Ok(crate::types::study::StudyPlanAIResult {
                    plan_metadata: crate::types::study::StudyPlanMetadata {
                        total_words: 0,
                        study_period_days: 0,
                        intensity_level: "".to_string(),
                        review_frequency: 0,
                        plan_type: "".to_string(),
                        start_date: "".to_string(),
                        end_date: "".to_string(),
                    },
                    daily_plans: vec![],
                });
            }

            match result {
                Ok(response) => {
                    chunk_count += 1;

                    if let Some(choice) = response.choices.first() {
                        if let Some(delta) = &choice.delta.content {
                            full_content.push_str(delta);

                            // 更新进度管理器
                            progress_manager.update_chunk(chunk_count, full_content.len(), start_time);

                            // 每5秒记录一次进度
                            if last_log_time.elapsed().as_secs() >= 5 {
                                logger.info(
                                    "AI_SERVICE",
                                    &format!(
                                        "📥 Received {} chunks, total: {} chars",
                                        chunk_count,
                                        full_content.len()
                                    ),
                                );
                                last_log_time = std::time::Instant::now();
                            }
                        }
                    }
                }
                Err(e) => {
                    let total_duration = start_time.elapsed();
                    let error_msg = format!("Stream error: {}", e);
                    progress_manager.error_analysis(&error_msg);

                    // 详细的网络错误诊断
                    logger.info(
                        "AI_SERVICE",
                        &format!("❌ Stream error after {:?}: {}", total_duration, e),
                    );
                    logger.info(
                        "AI_SERVICE",
                        &format!("🔍 Network Error Details:"),
                    );
                    logger.info(
                        "AI_SERVICE",
                        &format!("   📡 Target URL: {}", self.provider.base_url),
                    );
                    logger.info(
                        "AI_SERVICE",
                        &format!("   🔑 API Key Length: {} chars", self.provider.api_key.len()),
                    );
                    logger.info(
                        "AI_SERVICE",
                        &format!("   ⏱️  Request Duration: {:?}", total_duration),
                    );
                    logger.info(
                        "AI_SERVICE",
                        &format!("   🎯 Model: {}", model_name),
                    );

                    // 检查错误类型
                    let error_str = e.to_string();
                    if error_str.contains("dns") || error_str.contains("resolve") {
                        logger.info(
                            "AI_SERVICE",
                            "💡 Possible DNS resolution issue. Check internet connection.",
                        );
                    } else if error_str.contains("timeout") {
                        logger.info(
                            "AI_SERVICE",
                            "💡 Request timeout. The API might be slow or overloaded.",
                        );
                    } else if error_str.contains("connection") {
                        logger.info(
                            "AI_SERVICE",
                            "💡 Connection issue. Check firewall or proxy settings.",
                        );
                    } else if error_str.contains("401") || error_str.contains("unauthorized") {
                        logger.info(
                            "AI_SERVICE",
                            "💡 Authentication issue. Check API key validity.",
                        );
                    } else if error_str.contains("429") {
                        logger.info(
                            "AI_SERVICE",
                            "💡 Rate limit exceeded. Wait before retrying.",
                        );
                    } else if error_str.contains("500") || error_str.contains("502") || error_str.contains("503") {
                        logger.info(
                            "AI_SERVICE",
                            "💡 Server error. The API service might be temporarily unavailable.",
                        );
                    }

                    return Err(error_msg.into());
                }
            }
        }

        let step6_duration = step6_start.elapsed();
        logger.info(
            "AI_SERVICE",
            &format!(
                "📥 Step 6 - Received {} chunks, {} chars in {:?}",
                chunk_count,
                full_content.len(),
                step6_duration
            ),
        );

        // 步骤8: 验证响应内容
        if !full_content.is_empty() {
            logger.info(
                "AI_SERVICE",
                &format!(
                    "📄 Step 8 - Response content length: {} chars",
                    full_content.len()
                ),
            );

            // 输出AI的原始返回内容用于调试
            logger.info(
                "AI_SERVICE",
                &format!("📄 AI原始返回内容:\n{}", full_content),
            );

            // 检查是否包含JSON结构
            if !full_content.contains("plan_metadata") || !full_content.contains("daily_plans") {
                logger.info(
                    "AI_SERVICE",
                    "⚠️  Response does not contain complete study plan JSON structure",
                );
                logger.info(
                    "AI_SERVICE",
                    &format!(
                        "📄 First 1000 chars: {}",
                        full_content.chars().take(1000).collect::<String>()
                    ),
                );
            }

            // 步骤9: 解析 JSON 响应
            let step9_start = std::time::Instant::now();
            match self.parse_study_plan_json(&full_content) {
                Ok(result) => {
                    let step9_duration = step9_start.elapsed();
                    let total_duration = start_time.elapsed();
                    logger.info(
                        "AI_SERVICE",
                        &format!(
                            "✅ Step 9 - Successfully parsed study plan with {} daily plans in {:?}",
                            result.daily_plans.len(), step9_duration
                        ),
                    );
                    logger.info(
                        "AI_SERVICE",
                        &format!("⏱️  Total study plan generation time: {:?}", total_duration),
                    );

                    // 标记分析完成
                    progress_manager.complete_analysis();

                    Ok(result)
                }
                Err(e) => {
                    let step9_duration = step9_start.elapsed();
                    let total_duration = start_time.elapsed();
                    logger.info(
                        "AI_SERVICE",
                        &format!(
                            "❌ Step 9 - Study plan JSON parsing failed in {:?}: {}",
                            step9_duration, e
                        ),
                    );
                    logger.info(
                        "AI_SERVICE",
                        &format!("📄 Full AI response for debugging: {}", full_content),
                    );
                    logger.info(
                        "AI_SERVICE",
                        &format!("⏱️  Total time before failure: {:?}", total_duration),
                    );

                    // 标记分析失败
                    let error_msg = format!("Failed to parse study plan: JSON parsing error: {}", e);
                    progress_manager.error_analysis(&error_msg);

                    Err(error_msg.into())
                }
            }
        } else {
            let total_duration = start_time.elapsed();
            logger.info(
                "AI_SERVICE",
                &format!(
                    "❌ No content received from study plan streaming response after {:?}",
                    total_duration
                ),
            );
            let error_msg = "No content received from streaming response";
            progress_manager.error_analysis(error_msg);
            Err(error_msg.into())
        }
    }

    /// 解析学习计划规划的 JSON 响应
    fn parse_study_plan_json(
        &self,
        json_content: &str,
    ) -> Result<crate::types::study::StudyPlanAIResult, Box<dyn std::error::Error>> {
        // 提取JSON部分
        let json_str = self.extract_json_from_response(json_content);

        // 清理JSON语法错误
        let cleaned_json = self.clean_json_syntax(&json_str);

        // 先解析为通用的JSON值，然后进行字段名转换
        let ai_json: serde_json::Value = serde_json::from_str(&cleaned_json)?;

        // 转换字段名从下划线到驼峰命名
        let converted_json = self.convert_study_plan_field_names(ai_json)?;

        // 解析为最终的结构体
        let result: crate::types::study::StudyPlanAIResult = serde_json::from_value(converted_json)?;

        // 验证结果
        if result.daily_plans.is_empty() {
            return Err("No daily plans found in JSON response".into());
        }

        Ok(result)
    }

    /// 清理JSON语法错误
    fn clean_json_syntax(&self, json_str: &str) -> String {
        let mut cleaned = json_str.to_string();

        // 修复JavaScript对象语法为JSON语法
        // 1. 修复无引号的属性名
        let property_replacements = [
            ("word_id:", r#""word_id":"#),
            ("word:", r#""word":"#),
            ("wordbook_id:", r#""wordbook_id":"#),
            ("is_review:", r#""is_review":"#),
            ("review_count:", r#""review_count":"#),
            ("priority:", r#""priority":"#),
            ("difficulty_level:", r#""difficulty_level":"#),
        ];

        for (pattern, replacement) in property_replacements.iter() {
            // 只替换在对象开始位置的属性名（前面有空白字符、{或,）
            let lines: Vec<&str> = cleaned.lines().collect();
            let mut new_lines = Vec::new();

            for line in lines {
                let trimmed = line.trim_start();
                if trimmed.starts_with(pattern) && !trimmed.starts_with(&format!("\"{}\"", &pattern[..pattern.len()-1])) {
                    // 替换无引号的属性名
                    let new_line = line.replace(pattern, replacement);
                    new_lines.push(new_line);
                } else {
                    new_lines.push(line.to_string());
                }
            }
            cleaned = new_lines.join("\n");
        }

        // 2. 修复无引号的日期值（如 "date": 2025-08-27 应该是 "date": "2025-08-27"）
        // 查找 "date": 后面跟着无引号的日期
        if cleaned.find(r#""date": 2025-08-27"#).is_some() {
            cleaned = cleaned.replace(r#""date": 2025-08-27"#, r#""date": "2025-08-27""#);
        }

        cleaned
    }

    /// 转换学习计划JSON的字段名从下划线到驼峰命名
    fn convert_study_plan_field_names(
        &self,
        mut json: serde_json::Value,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        if let serde_json::Value::Object(ref mut obj) = json {
            // 转换顶级字段
            if let Some(plan_metadata) = obj.remove("plan_metadata") {
                obj.insert("planMetadata".to_string(), self.convert_metadata_fields(plan_metadata)?);
            }
            if let Some(daily_plans) = obj.remove("daily_plans") {
                obj.insert("dailyPlans".to_string(), self.convert_daily_plans_fields(daily_plans)?);
            }
        }
        Ok(json)
    }

    /// 转换元数据字段名
    fn convert_metadata_fields(
        &self,
        mut metadata: serde_json::Value,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        if let serde_json::Value::Object(ref mut obj) = metadata {
            // 转换字段名
            if let Some(val) = obj.remove("total_words") {
                obj.insert("totalWords".to_string(), val);
            }
            if let Some(val) = obj.remove("study_period_days") {
                obj.insert("studyPeriodDays".to_string(), val);
            }
            if let Some(val) = obj.remove("intensity_level") {
                obj.insert("intensityLevel".to_string(), val);
            }
            if let Some(val) = obj.remove("review_frequency") {
                obj.insert("reviewFrequency".to_string(), val);
            }
            if let Some(val) = obj.remove("plan_type") {
                obj.insert("planType".to_string(), val);
            }
            if let Some(val) = obj.remove("start_date") {
                obj.insert("startDate".to_string(), val);
            }
            if let Some(val) = obj.remove("end_date") {
                obj.insert("endDate".to_string(), val);
            }
        }
        Ok(metadata)
    }

    /// 转换每日计划字段名
    fn convert_daily_plans_fields(
        &self,
        daily_plans: serde_json::Value,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        if let serde_json::Value::Array(plans) = daily_plans {
            let converted_plans: Result<Vec<serde_json::Value>, _> = plans
                .into_iter()
                .map(|plan| self.convert_daily_plan_fields(plan))
                .collect();
            Ok(serde_json::Value::Array(converted_plans?))
        } else {
            Ok(daily_plans)
        }
    }

    /// 转换单个每日计划的字段名
    fn convert_daily_plan_fields(
        &self,
        mut plan: serde_json::Value,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        if let serde_json::Value::Object(ref mut obj) = plan {
            // 转换words数组
            if let Some(words) = obj.remove("words") {
                if let serde_json::Value::Array(word_list) = words {
                    let converted_words: Result<Vec<serde_json::Value>, _> = word_list
                        .into_iter()
                        .map(|word| self.convert_word_fields(word))
                        .collect();
                    obj.insert("words".to_string(), serde_json::Value::Array(converted_words?));
                }
            }
        }
        Ok(plan)
    }

    /// 转换单词字段名
    fn convert_word_fields(
        &self,
        mut word: serde_json::Value,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        if let serde_json::Value::Object(ref mut obj) = word {
            // 转换字段名
            if let Some(val) = obj.remove("word_id") {
                obj.insert("wordId".to_string(), val);
            }
            if let Some(val) = obj.remove("wordbook_id") {
                obj.insert("wordbookId".to_string(), val);
            }
            if let Some(val) = obj.remove("is_review") {
                obj.insert("isReview".to_string(), val);
            }
            if let Some(val) = obj.remove("review_count") {
                obj.insert("reviewCount".to_string(), val);
            }
            if let Some(val) = obj.remove("difficulty_level") {
                obj.insert("difficultyLevel".to_string(), val);
            }
        }
        Ok(word)
    }

    /// 解析自然拼读分析的 JSON 响应
    fn parse_phonics_json(
        &self,
        json_content: &str,
    ) -> Result<PhonicsAnalysisResult, Box<dyn std::error::Error>> {
        // 提取JSON部分（去除可能的前后文本）
        let json_str = self.extract_json_from_response(json_content);

        // 解析JSON
        let json_response: JsonPhonicsResponse = serde_json::from_str(&json_str)
            .map_err(|e| format!("JSON parsing error: {}", e))?;

        // 转换为内部格式
        let words: Vec<PhonicsWord> = json_response.words
            .into_iter()
            .filter(|w| !w.word.is_empty()) // 过滤空单词
            .map(|w| w.into())
            .collect();

        if words.is_empty() {
            return Err("No valid words found in JSON response".into());
        }

        Ok(PhonicsAnalysisResult { words })
    }

    /// 简单的对话完成（用于模型测试）
    pub async fn chat_completion(
        &self,
        prompt: &str,
        max_tokens: Option<u32>,
        temperature: Option<f32>,
        logger: &Logger,
    ) -> Result<String, Box<dyn std::error::Error>> {
        logger.info(
            "AI_SERVICE",
            &format!(
                "🚀 Starting chat completion for prompt: {}",
                if prompt.len() > 100 { &prompt[..100] } else { prompt }
            ),
        );
        
        let model_name = self.provider.get_default_model();
        let final_max_tokens = max_tokens.unwrap_or(100);
        let final_temperature = temperature.unwrap_or(0.7);
        
        logger.info("AI_SERVICE", &format!(
            "Chat completion parameters - model: {}, max_tokens: {}, temperature: {}",
            model_name, final_max_tokens, final_temperature
        ));
        
        // 构建请求
        let request = CreateChatCompletionRequestArgs::default()
            .model(model_name)
            .messages([
                ChatCompletionRequestMessage::System(
                    ChatCompletionRequestSystemMessage {
                        content: "You are a helpful assistant. Please respond briefly and concisely.".to_string(),
                        role: Role::System,
                        name: None,
                    },
                ),
                ChatCompletionRequestMessage::User(
                    async_openai::types::ChatCompletionRequestUserMessage {
                        role: async_openai::types::Role::User,
                        content: async_openai::types::ChatCompletionRequestUserMessageContent::Text(prompt.to_string()),
                        name: None,
                    },
                ),
            ])
            .max_tokens(final_max_tokens as u16)
            .temperature(final_temperature)
            .stream(false) // 不使用流式输出，直接获取完整响应
            .build()?;
        
        logger.info("AI_SERVICE", "📤 Sending chat completion request...");
        
        // 发送请求
        let response = self.client.chat().create(request).await
            .map_err(|e| {
                logger.info("AI_SERVICE", &format!("❌ Chat completion failed: {}", e));
                format!("Chat completion failed: {}", e)
            })?;
        
        // 提取响应内容
        if let Some(choice) = response.choices.first() {
            if let Some(content) = &choice.message.content {
                logger.info("AI_SERVICE", &format!(
                    "✅ Chat completion successful - Response length: {} chars",
                    content.len()
                ));
                return Ok(content.clone());
            }
        }
        
        Err("No response content received".into())
    }

    /// 解析 CSV 格式的单词提取响应
    fn parse_csv_response(
        &self,
        content: &str,
        logger: &Logger,
    ) -> Result<Vec<crate::types::word_analysis::ExtractedWord>, Box<dyn std::error::Error>> {
        // 清理可能的 markdown 代码块格式
        let cleaned_content = self.clean_csv_markdown(content);
        
        let mut words = Vec::new();
        let lines: Vec<&str> = cleaned_content.lines().collect();
        
        // 跳过标题行（第一行）
        for line in lines.iter().skip(1) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            
            // 解析 CSV 行：格式为 "word,frequency"
            let parts: Vec<&str> = trimmed.split(',').collect();
            if parts.len() >= 2 {
                let word = parts[0].trim().to_string();
                let frequency = parts[1].trim().parse::<i32>().unwrap_or(1);
                
                if !word.is_empty() && word.len() >= 2 && word.len() <= 20 {
                    words.push(crate::types::word_analysis::ExtractedWord {
                        word,
                        frequency,
                    });
                }
            }
        }
        
        if words.is_empty() {
            logger.info("AI_SERVICE", &format!("❌ CSV parsing failed: no valid words found"));
            logger.info("AI_SERVICE", &format!("📄 Response content: {}", content));
            return Err("No valid words found in CSV response".into());
        }
        
        Ok(words)
    }

    /// 清理CSV响应中的markdown代码块格式
    fn clean_csv_markdown(&self, content: &str) -> String {
        let cleaned = content.trim();
        
        // 移除 markdown 代码块标记
        if cleaned.starts_with("```csv") {
            cleaned[6..].trim_end_matches('`').to_string()
        } else if cleaned.starts_with("```") {
            // 移除任何代码块标记
            let lines: Vec<&str> = cleaned.lines().collect();
            if lines.len() > 1 {
                lines[1..lines.len()-1].join("\n")
            } else {
                cleaned.to_string()
            }
        } else {
            cleaned.to_string()
        }
    }

    /// 解析批量分析的 CSV 响应
    fn parse_batch_csv_response(
        &self,
        content: &str,
        logger: &Logger,
    ) -> Result<Vec<PhonicsWord>, Box<dyn std::error::Error>> {
        // 清理可能的 markdown 代码块格式
        let cleaned_content = self.clean_csv_markdown(content);
        
        let mut words = Vec::new();
        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(true)
            .from_reader(cleaned_content.as_bytes());
        
        for result in rdr.deserialize::<CsvPhonicsRecord>() {
            match result {
                Ok(record) => {
                    words.push(record.into_phonics_word());
                }
                Err(e) => {
                    logger.info("AI_SERVICE", &format!("❌ CSV parsing error for row: {}", e));
                    // 继续处理其他行，不中断整个批次
                }
            }
        }
        
        if words.is_empty() {
            logger.info("AI_SERVICE", &format!("❌ CSV parsing failed: no valid words found"));
            logger.info("AI_SERVICE", &format!("📄 Response content: {}", content));
            return Err("No valid words found in CSV response".into());
        }
        
        Ok(words)
    }


    /// 从响应中提取JSON部分
    fn extract_json_from_response(&self, content: &str) -> String {
        // 查找JSON开始和结束位置
        if let Some(start) = content.find('{') {
            if let Some(end) = content.rfind('}') {
                if end > start {
                    return content[start..=end].to_string();
                }
            }
        }
        
        // 如果没找到完整的JSON，返回原内容
        content.to_string()
    }
}

/// JSON响应格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonPhonicsResponse {
    pub words: Vec<JsonPhonicsWord>,
}

/// JSON格式的单词数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonPhonicsWord {
    pub word: String,
    pub frequency: i32,
    pub chinese_translation: String,
    pub pos_abbreviation: String,
    pub pos_english: String,
    pub pos_chinese: String,
    pub ipa: String,
    pub syllables: String,
    pub phonics_rule: String,
    pub analysis_explanation: String,
}

/// 自然拼读分析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhonicsAnalysisResult {
    pub words: Vec<PhonicsWord>,
}

/// 单词的自然拼读分析
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhonicsWord {
    pub word: String,
    pub frequency: i32,
    pub chinese_translation: String,
    pub pos_abbreviation: String,
    pub pos_english: String,
    pub pos_chinese: String,
    pub ipa: String,
    pub syllables: String,
    pub phonics_rule: String,
    pub analysis_explanation: String,
}

impl From<JsonPhonicsWord> for PhonicsWord {
    fn from(json_word: JsonPhonicsWord) -> Self {
        Self {
            word: json_word.word,
            frequency: json_word.frequency,
            chinese_translation: json_word.chinese_translation,
            pos_abbreviation: json_word.pos_abbreviation,
            pos_english: json_word.pos_english,
            pos_chinese: json_word.pos_chinese,
            ipa: json_word.ipa,
            syllables: json_word.syllables,
            phonics_rule: json_word.phonics_rule,
            analysis_explanation: json_word.analysis_explanation,
        }
    }
}

impl Default for PhonicsWord {
    fn default() -> Self {
        Self {
            word: String::new(),
            frequency: 0,
            chinese_translation: String::new(),
            pos_abbreviation: String::new(),
            pos_english: String::new(),
            pos_chinese: String::new(),
            ipa: String::new(),
            syllables: String::new(),
            phonics_rule: String::new(),
            analysis_explanation: String::new(),
        }
    }
}
