# 单词分析批量并行优化方案

## 一、现状分析

### 1.1 当前实现架构

#### 后端实现

**AI 服务层** (`src-tauri/src/ai_service.rs`)

```rust
// 当前实现：单一 LLM 调用
pub async fn analyze_phonics(
    &self,
    text: &str,
    model_name: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    extraction_mode: &str,
    logger: &Logger,
) -> Result<PhonicsAnalysisResult, Box<dyn std::error::Error>> {
    // 1. 构建完整的提示词（包含所有文本）
    // 2. 发送单一 LLM 请求（使用流式输出）
    // 3. 流式接收响应
    // 4. 解析完整的 JSON 响应（包含所有单词）
    // 5. 返回完整的单词列表
}
```

**当前流式输出的问题**

当前实现使用流式输出（`.stream(true)`），但这在批量分析场景中存在以下问题：

1. **JSON 完整性要求**：LLM 返回的是 JSON 格式的结构化数据，必须接收完整内容才能解析
2. **速度影响**：流式输出的 chunk 处理和拼接反而增加了处理时间
3. **进度跟踪冗余**：流式输出的 chunk 数量无法准确反映实际分析进度
4. **批量处理已足够**：通过批次划分已经提供了足够的进度反馈

**进度管理** (`AnalysisProgress`)

```rust
pub struct AnalysisProgress {
    pub status: String,           // "analyzing", "completed", "error"
    pub current_step: String,     // 当前步骤描述
    pub chunks_received: u32,     // 已接收的chunk数量
    pub total_chars: usize,       // 已接收的总字符数
    pub elapsed_seconds: f64,     // 已用时间（秒）
    pub error_message: Option<String>, // 错误信息
}
```

**为什么批量分析不使用流式输出**

在批量分析场景中，我们选择使用非流式输出（`.stream(false)`），原因如下：

1. **JSON 结构完整性要求**
   - LLM 返回的是 JSON 格式的结构化数据
   - 必须接收完整内容才能进行有效的 JSON 解析
   - 不完整的 JSON 会导致解析失败

2. **性能考虑**
   - 流式输出的 chunk 处理和拼接增加了处理开销
   - 非流式输出直接获取完整响应，速度更快
   - 批量分析本身已经提供了足够的性能优化

3. **进度跟踪已足够**
   - 批次划分提供了清晰的进度反馈（已完成批次 / 总批次）
   - 每个批次完成后更新进度，粒度已足够
   - 流式输出的 chunk 数量无法准确反映实际分析进度

4. **简化实现**
   - 非流式输出代码更简洁，减少错误处理复杂度
   - 直接获取完整响应，避免流式处理的异步复杂性
   - 更容易调试和维护

**对比总结**

| 特性 | 流式输出 | 非流式输出 |
|------|---------|-----------|
| 适用场景 | 实时对话、生成式文本 | 结构化数据、批量处理 |
| JSON 解析 | 需要拼接完整内容 | 直接获取完整内容 |
| 处理速度 | 较慢（chunk 处理） | 更快（直接返回） |
| 进度跟踪 | chunk 数量不准确 | 批次完成度准确 |
| 代码复杂度 | 高（异步流处理） | 低（直接调用） |
| 批量分析适用性 | ❌ 不适用 | ✅ 适用 |

**结论**

对于批量单词分析场景，使用非流式输出是更优的选择：
- ✅ 更快的处理速度
- ✅ 更简单的实现
- ✅ 准确的批次级别进度跟踪
- ✅ 完整的 JSON 结构保证

**提示词** (`src-tauri/src/prompts/phonics_agent.md`)

- 298 行的详细自然拼读规则库
- 一次性分析所有单词
- 返回完整的 JSON 格式单词列表

#### 前端实现

**服务层** (`src/services/wordbookService.ts`)

```typescript
// 单一调用分析 API
async analyzeTextForVocabulary(
    text: string,
    setLoading?: (state: LoadingState) => void
): Promise<ApiResult<any>> {
    return this.client.invoke<any>('analyze_text_for_vocabulary', { text });
}

// 轮询进度
async getAnalysisProgress(): Promise<ApiResult<AnalysisProgress | null>> {
    return this.client.invoke<AnalysisProgress | null>('get_analysis_progress');
}
```

**进度展示** (`WordImporterModal.tsx`)

- 显示分析进度
- 使用轮询获取进度更新
- 进度基于 chunk 数量展示

### 1.2 当前方案的问题

#### 问题 1：性能瓶颈

**单一 LLM 调用**
- 所有单词在一次请求中分析
- 受限于模型的输出 token 限制（通常 4096 或 8192）
- 大量文本（如 500+ 单词）会导致：
  - 超出 token 限制
  - 响应被截断
  - 分析不完整或失败

**处理时间线性增长**
- 10 个单词：~5-10 秒
- 50 个单词：~30-50 秒
- 100 个单词：~60-120 秒
- 500 个单词：可能超过 5 分钟或失败

**示例场景**
```
输入文本："The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog..." (重复 50 次)

当前方案：
1. 构建提示词：包含所有 500 个单词
2. 单次 LLM 调用
3. 等待响应（可能被截断）
4. 解析 JSON（可能不完整）

问题：
- 提示词长度可能超过输入 token 限制
- 输出长度可能超过输出 token 限制
- 用户需要等待整个分析完成才能看到任何结果
```

#### 问题 2：进度反馈不精确

**当前进度指标**
```typescript
AnalysisProgress {
    chunks_received: 45,      // 只知道收到了多少个 chunk
    total_chars: 12345,      // 总字符数
    current_step: "接收AI分析结果..."
}
```

**用户视角**
- 看到的是"接收 AI 分析结果..."
- 无法知道具体分析了多少个单词
- 无法知道哪些单词已经完成
- 无法知道剩余多少单词
- 无法看到单词级别的进度

**对比期望**
```
用户期望：
✅ 已提取单词列表：150 个
✅ 正在分析：45/150 (30%)
✅ 已完成：apple, banana, cherry...
⏳ 分析中：date, egg, fig...
⏸️ 待处理：grape, honey...

当前实现：
📡 接收 AI 分析结果... (45 chunks, 12345 chars)
```

#### 问题 3：无法处理大规模数据

**Token 限制问题**
```
典型模型限制：
- GPT-3.5-turbo: 输入 4096, 输出 4096
- GPT-4: 输入 8192, 输出 4096
- Claude: 输入 100000, 输出 4096

场景分析：
输入：1000 个单词（约 5000 tokens）
输出：每个单词约 200 tokens × 1000 = 200,000 tokens

问题：输出远超限制，无法完成分析
```

**文本长度限制**
```typescript
if (text.length > 10000) {
    throw new Error('文本内容过长，请限制在10000字符以内');
}
```

- 前端限制在 10000 字符
- 对于大量单词场景（如整本书章节）不适用

#### 问题 4：错误恢复能力弱

**当前错误处理**
```rust
// 单一失败点
match self.parse_phonics_json(&full_content) {
    Ok(result) => Ok(result),
    Err(e) => {
        // 整个分析失败，所有单词丢失
        Err(error_msg.into())
    }
}
```

**问题场景**
- 如果 JSON 解析失败，所有单词都丢失
- 如果网络中断，需要重新开始
- 无法部分保存已分析的结果

---

## 二、优化方案设计

### 2.1 核心设计理念

**三阶段架构**
```
阶段 1：单词提取（快速、轻量）
  ↓
阶段 2：批量并行分析（可扩展、高效）
  ↓
阶段 3：结果合并与保存（可靠、完整）
```

**关键优势**
1. **解耦提取和分析**：提取可以快速完成，分析可以并行
2. **批量处理**：每批 10-20 个单词，充分利用并发
3. **细粒度进度**：每个单词都有独立状态
4. **容错性强**：单个单词失败不影响其他单词
5. **可扩展性**：支持 1000+ 单词的大规模场景

### 2.2 详细技术方案

#### 阶段 1：单词提取

**目标**：快速从文本中提取单词列表，不进行详细分析

**新的提示词**：`src-tauri/src/prompts/word_extraction_agent.md`

```markdown
# 单词提取专家 Agent

## 身份定义
您是一个快速、准确的单词提取系统。您的任务是从英文文本中提取所有独立的单词。

## 工作流程

### 第一步：文本预处理
1. **分词**：将文本分解为独立单词
2. **标准化**：
   - 转换为小写
   - 移除标点符号
   - 移除数字
   - 移除特殊字符
3. **去重统计**：统计每个单词的出现频率

### 第二步：单词筛选
根据以下规则筛选单词：
- 最小长度：2 个字符
- 最大长度：20 个字符
- 仅包含：英文字母
- 排除：纯数字、纯标点、单个字母

### 第三步：输出格式
严格按照以下 JSON 格式输出：

```json
{
  "words": [
    {
      "word": "单词原文",
      "frequency": 出现次数
    }
  ]
}
```

## 重要要求
1. **只返回单词列表**：不进行任何自然拼读分析
2. **快速响应**：优先速度而非详细分析
3. **完整提取**：不要遗漏任何符合条件的单词
4. **频率准确**：准确统计每个单词的出现次数
5. **保持原样**：保留单词的原始大小写（用于后续排序）

## 示例
输入文本：
"The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog."

输出：
```json
{
  "words": [
    {"word": "The", "frequency": 2},
    {"word": "quick", "frequency": 2},
    {"word": "brown", "frequency": 2},
    {"word": "fox", "frequency": 2},
    {"word": "jumps", "frequency": 2},
    {"word": "over", "frequency": 2},
    {"word": "the", "frequency": 2},
    {"word": "lazy", "frequency": 2},
    {"word": "dog", "frequency": 2},
    {"word": ".", "frequency": 2}
  ]
}
```

## 执行指令
请对以下文本进行单词提取：
{original_text}
```

**新的数据结构**

```rust
// src-tauri/src/types/word_analysis.rs
/// 提取的单词信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedWord {
    pub word: String,           // 单词原文
    pub frequency: i32,         // 出现频率
}

/// 单词提取结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordExtractionResult {
    pub words: Vec<ExtractedWord>,
    pub total_count: usize,
    pub unique_count: usize,
}

/// 批量分析状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchAnalysisProgress {
    pub status: String,                    // "extracting", "analyzing", "completed", "error"
    pub current_step: String,                // 当前步骤描述
    pub extraction_progress: ExtractionProgress,
    pub analysis_progress: AnalysisProgress,
}

/// 提取进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionProgress {
    pub total_words: usize,                 // 总单词数
    pub extracted_words: usize,              // 已提取单词数
    pub elapsed_seconds: f64,                // 已用时间
}

/// 分析进度（细化）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisProgress {
    pub total_words: usize,                 // 总单词数
    pub completed_words: usize,              // 已完成单词数
    pub failed_words: usize,                 // 失败单词数
    pub current_word: Option<String>,          // 当前正在分析的单词
    pub batch_info: BatchInfo,               // 批次信息
    pub elapsed_seconds: f64,                // 已用时间
}

/// 批次信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchInfo {
    pub total_batches: usize,                 // 总批次数
    pub completed_batches: usize,              // 已完成批次数
    pub current_batch: usize,                 // 当前批次（从 0 开始）
    pub batch_size: usize,                   // 每批单词数
}

/// 单词分析状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordAnalysisStatus {
    pub word: String,                       // 单词
    pub status: String,                      // "pending", "analyzing", "completed", "failed"
    pub error: Option<String>,               // 错误信息（如果失败）
    pub result: Option<PhonicsWord>,        // 分析结果（如果完成）
}
```

**新的 AI 服务方法**

```rust
// src-tauri/src/ai_service.rs

impl AIService {
    /// 步骤 1：提取单词列表
    pub async fn extract_words(
        &self,
        text: &str,
        logger: &Logger,
    ) -> Result<WordExtractionResult, Box<dyn std::error::Error>> {
        // 1. 读取单词提取提示词
        let extraction_prompt = include_str!("prompts/word_extraction_agent.md");
        
        // 2. 构建请求（使用小 max_tokens，因为只需要单词列表）
        let request = CreateChatCompletionRequestArgs::default()
            .model(self.provider.get_default_model())
            .messages([ChatCompletionRequestMessage::System(
                ChatCompletionRequestSystemMessage {
                    content: extraction_prompt.replace("{original_text}", text),
                    role: Role::System,
                    name: None,
                },
            )])
            .max_tokens(2000)  // 限制输出长度
            .temperature(0.1)    // 低温度保证稳定性
            .stream(false)         // 非流式，快速获取结果
            .build()?;
        
        // 3. 发送请求
        let response = self.client.chat().create(request).await?;
        
        // 4. 解析 JSON 响应
        let json_response: serde_json::Value = serde_json::from_str(&response.choices[0].message.content.unwrap())?;
        let words_array = json_response["words"].as_array().ok_or("Invalid words array")?;
        
        // 5. 转换为 ExtractedWord
        let words: Vec<ExtractedWord> = words_array
            .iter()
            .map(|v| ExtractedWord {
                word: v["word"].as_str().unwrap().to_string(),
                frequency: v["frequency"].as_i64().unwrap() as i32,
            })
            .collect();
        
        Ok(WordExtractionResult {
            total_count: words.len(),
            unique_count: words.len(),
            words,
        })
    }
    
    /// 步骤 2：批量分析单词
    pub async fn analyze_words_batch(
        &self,
        words: Vec<String>,
        batch_index: usize,
        total_batches: usize,
        logger: &Logger,
    ) -> Result<Vec<PhonicsWord>, Box<dyn std::error::Error>> {
        // 1. 读取自然拼读分析提示词
        let phonics_prompt_template = include_str!("prompts/phonics_agent.md");
        
        // 2. 构建批量分析提示词
        let words_json = serde_json::to_string(&words)?;
        let batch_prompt = format!(
            "{}\n\n请分析以下 {} 个单词：\n{}",
            phonics_prompt_template.replace("{original_text}", ""),
            words.len(),
            words_json
        );
        
        // 3. 构建请求
        let request = CreateChatCompletionRequestArgs::default()
            .model(self.provider.get_default_model())
            .messages([ChatCompletionRequestMessage::System(
                ChatCompletionRequestSystemMessage {
                    content: batch_prompt,
                    role: Role::System,
                    name: None,
                },
            )])
            .max_tokens(8000)  // 每批 10-20 个单词
            .temperature(0.1)
            .stream(false)        // 使用非流式输出，直接获取完整 JSON
            .build()?;
        
        // 4. 发送请求并获取完整响应
        let response = self.client.chat().create(request).await?;
        
        // 5. 提取响应内容
        let content = response.choices.first()?.message.content.as_ref().ok_or("No content")?;
        
        // 6. 解析 JSON 响应
        let json_response: JsonPhonicsResponse = serde_json::from_str(content)?;
        
        Ok(json_response.words.into_iter().map(|w| w.into()).collect())
    }
}
```

#### 阶段 2：批量并行分析

**批处理策略**

```rust
// src-tauri/src/word_analysis_service.rs

pub struct WordAnalysisService {
    ai_service: Arc<AIService>,
    batch_size: usize,              // 每批单词数（默认 10）
    max_concurrent_batches: usize,    // 最大并发批次数（默认 3）
}

impl WordAnalysisService {
    /// 批量分析单词（主入口）
    pub async fn analyze_text_with_batching(
        &self,
        text: &str,
        model_config: &AIModelConfig,
        extraction_mode: &str,
        logger: &Logger,
    ) -> Result<BatchAnalysisResult, Box<dyn std::error::Error>> {
        let start_time = std::time::Instant::now();
        
        // 步骤 1：提取单词列表
        logger.info("WORD_ANALYSIS", "🚀 步骤 1：开始提取单词...");
        let extraction_result = self.ai_service.extract_words(text, logger).await?;
        
        // 更新提取进度
        self.update_extraction_progress(&ExtractionProgress {
            total_words: extraction_result.total_count,
            extracted_words: extraction_result.total_count,
            elapsed_seconds: start_time.elapsed().as_secs_f64(),
        }, logger);
        
        // 步骤 2：分批并并行分析
        logger.info("WORD_ANALYSIS", &format!("📦 步骤 2：提取到 {} 个单词，开始批量分析...", extraction_result.unique_count));
        
        let words: Vec<String> = extraction_result.words
            .into_iter()
            .map(|w| w.word)
            .collect();
        
        let total_batches = (words.len() + self.batch_size - 1) / self.batch_size;
        
        // 使用 tokio 的并发工具
        let mut analysis_results: Vec<PhonicsWord> = Vec::new();
        let mut failed_words: Vec<String> = Vec::new();
        
        // 分批处理
        for (batch_index, batch) in words.chunks(self.batch_size).enumerate() {
            let batch_words: Vec<String> = batch.to_vec();
            
            // 更新分析进度
            self.update_analysis_progress(&AnalysisProgress {
                total_words: words.len(),
                completed_words: analysis_results.len(),
                failed_words: failed_words.len(),
                current_word: Some(batch_words.first().cloned().unwrap_or_default()),
                batch_info: BatchInfo {
                    total_batches,
                    completed_batches: batch_index,
                    current_batch: batch_index,
                    batch_size: self.batch_size,
                },
                elapsed_seconds: start_time.elapsed().as_secs_f64(),
            }, logger);
            
            // 并发处理批次
            match self.ai_service.analyze_words_batch(
                batch_words,
                batch_index,
                total_batches,
                logger
            ).await {
                Ok(batch_words) => {
                    analysis_results.extend(batch_words);
                    // 更新每个单词的状态
                    for word in &batch_words {
                        self.update_word_status(&WordAnalysisStatus {
                            word: word.word.clone(),
                            status: "completed".to_string(),
                            error: None,
                            result: Some(word.clone()),
                        }, logger);
                    }
                }
                Err(e) => {
                    // 批次失败，标记所有单词为失败
                    for word in &batch_words {
                        failed_words.push(word.clone());
                        self.update_word_status(&WordAnalysisStatus {
                            word: word.clone(),
                            status: "failed".to_string(),
                            error: Some(e.to_string()),
                            result: None,
                        }, logger);
                    }
                }
            }
        }
        
        // 步骤 3：合并结果
        logger.info("WORD_ANALYSIS", "✅ 步骤 3：批量分析完成，开始合并结果...");
        
        Ok(BatchAnalysisResult {
            words: analysis_results,
            total_words: words.len(),
            completed_words: analysis_results.len(),
            failed_words: failed_words.len(),
            elapsed_seconds: start_time.elapsed().as_secs_f64(),
        })
    }
}
```

**并发控制**

```rust
// 使用信号量限制并发
use tokio::sync::Semaphore;

pub struct WordAnalysisService {
    ai_service: Arc<AIService>,
    batch_size: usize,
    max_concurrent_batches: usize,
    semaphore: Arc<Semaphore>,  // 并发控制
}

impl WordAnalysisService {
    pub fn new(ai_service: AIService) -> Self {
        Self {
            ai_service: Arc::new(ai_service),
            batch_size: 10,
            max_concurrent_batches: 3,
            semaphore: Arc::new(Semaphore::new(3)),  // 最多 3 个并发批次
        }
    }
    
    /// 并发处理多个批次
    async fn process_batches_concurrently(
        &self,
        batches: Vec<Vec<String>>,
        logger: &Logger,
    ) -> Result<Vec<PhonicsWord>, Box<dyn std::error::Error>> {
        let mut tasks = Vec::new();
        
        for (batch_index, batch) in batches.into_iter().enumerate() {
            let ai_service = Arc::clone(&self.ai_service);
            let semaphore = Arc::clone(&self.semaphore);
            let logger_clone = logger.clone();
            
            let task = tokio::spawn(async move {
                let _permit = semaphore.acquire().await.unwrap();  // 获取信号量
                ai_service.analyze_words_batch(batch, batch_index, batches.len(), &logger_clone).await
            });
            
            tasks.push(task);
        }
        
        // 等待所有任务完成
        let mut results = Vec::new();
        for task in tasks {
            match task.await {
                Ok(Ok(words)) => results.extend(words),
                Ok(Err(e)) => logger.error("BATCH", &format!("Batch failed: {}", e)),
                Err(e) => logger.error("BATCH", &format!("Task join error: {}", e)),
            }
        }
        
        Ok(results)
    }
}
```

#### 阶段 3：进度管理与前端集成

**增强的进度管理器**

```rust
// src-tauri/src/progress_manager.rs

pub struct EnhancedProgressManager {
    extraction_progress: Arc<Mutex<Option<ExtractionProgress>>>,
    analysis_progress: Arc<Mutex<Option<AnalysisProgress>>>,
    word_statuses: Arc<Mutex<HashMap<String, WordAnalysisStatus>>>,
    cancelled: Arc<Mutex<bool>>,
}

impl EnhancedProgressManager {
    /// 更新提取进度
    pub fn update_extraction_progress(&self, progress: &ExtractionProgress) {
        let mut guard = self.extraction_progress.lock().unwrap();
        *guard = Some(progress.clone());
    }
    
    /// 更新分析进度
    pub fn update_analysis_progress(&self, progress: &AnalysisProgress) {
        let mut guard = self.analysis_progress.lock().unwrap();
        *guard = Some(progress.clone());
    }
    
    /// 更新单个单词状态
    pub fn update_word_status(&self, status: &WordAnalysisStatus) {
        let mut guard = self.word_statuses.lock().unwrap();
        guard.insert(status.word.clone(), status.clone());
    }
    
    /// 获取完整进度信息
    pub fn get_full_progress(&self) -> BatchAnalysisProgress {
        let extraction = self.extraction_progress.lock().unwrap().clone();
        let analysis = self.analysis_progress.lock().unwrap().clone();
        let word_statuses = self.word_statuses.lock().unwrap().clone();
        
        BatchAnalysisProgress {
            extraction_progress: extraction,
            analysis_progress: analysis,
            word_statuses,
        }
    }
}
```

**新的 Tauri 命令**

```rust
// src-tauri/src/word_analysis_handlers.rs

/// 批量分析文本（新命令）
#[tauri::command]
pub async fn analyze_text_with_batching(
    app: AppHandle,
    text: String,
    model_id: Option<i64>,
    extraction_mode: Option<String>,
) -> AppResult<BatchAnalysisResult> {
    let pool = app.state::<SqlitePool>();
    let logger = app.state::<Logger>();
    
    // 1. 获取 AI 服务
    let model_config = get_model_config(model_id, &pool, &logger).await?;
    let ai_service = AIService::from_model_config(&model_config)?;
    
    // 2. 创建批量分析服务
    let analysis_service = WordAnalysisService::new(ai_service);
    
    // 3. 执行批量分析
    let result = analysis_service.analyze_text_with_batching(
        &text,
        &model_config,
        extraction_mode.as_deref().unwrap_or("focus"),
        &logger,
    ).await?;
    
    logger.api_response("analyze_text_with_batching", true, Some(&format!("Analyzed {} words", result.completed_words)));
    
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
pub async fn cancel_batch_analysis(
    app: AppHandle,
) -> AppResult<()> {
    let progress_manager = get_enhanced_progress_manager();
    progress_manager.cancel_analysis();
    Ok(())
}
```

**前端类型定义**

```typescript
// src/types/word-analysis.ts

export interface ExtractedWord {
  word: string;
  frequency: number;
}

export interface WordExtractionResult {
  words: ExtractedWord[];
  total_count: number;
  unique_count: number;
}

export interface ExtractionProgress {
  total_words: number;
  extracted_words: number;
  elapsed_seconds: number;
}

export interface BatchInfo {
  total_batches: number;
  completed_batches: number;
  current_batch: number;
  batch_size: number;
}

export interface AnalysisProgress {
  total_words: number;
  completed_words: number;
  failed_words: number;
  current_word: string | null;
  batch_info: BatchInfo;
  elapsed_seconds: number;
}

export interface WordAnalysisStatus {
  word: string;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  error: string | null;
  result: PhonicsWord | null;
}

export interface BatchAnalysisProgress {
  extraction_progress: ExtractionProgress | null;
  analysis_progress: AnalysisProgress | null;
  word_statuses: Map<string, WordAnalysisStatus>;
}

export interface BatchAnalysisResult {
  words: PhonicsWord[];
  total_words: number;
  completed_words: number;
  failed_words: number;
  elapsed_seconds: number;
}
```

**前端服务层**

```typescript
// src/services/wordAnalysisService.ts

export class WordAnalysisService {
  /**
   * 批量分析文本
   */
  async analyzeTextWithBatching(
    text: string,
    modelId?: number,
    extractionMode?: string,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<BatchAnalysisResult>> {
    return this.executeWithLoading(async () => {
      if (!text || text.trim().length === 0) {
        throw new Error('文本内容不能为空');
      }
      
      // 移除长度限制或大幅提高
      if (text.length > 50000) {
        throw new Error('文本内容过长，请限制在50000字符以内');
      }
      
      return this.client.invoke<BatchAnalysisResult>('analyze_text_with_batching', {
        text,
        model_id: modelId,
        extraction_mode: extractionMode
      });
    }, setLoading);
  }
  
  /**
   * 获取批量分析进度
   */
  async getBatchAnalysisProgress(): Promise<ApiResult<BatchAnalysisProgress>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<BatchAnalysisProgress>('get_batch_analysis_progress');
    });
  }
  
  /**
   * 取消批量分析
   */
  async cancelBatchAnalysis(): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('cancel_batch_analysis');
    });
  }
}
```

**前端 UI 组件**

```typescript
// src/components/WordAnalysisProgressModal.tsx

export function WordAnalysisProgressModal({ isOpen, onClose }: Props) {
  const [progress, setProgress] = useState<BatchAnalysisProgress | null>(null);
  const [pollInterval, setPollInterval] = useState<number | null>(null);
  
  // 轮询进度
  useEffect(() => {
    if (isOpen) {
      // 启动轮询
      const interval = setInterval(async () => {
        const result = await wordAnalysisService.getBatchAnalysisProgress();
        if (result.success && result.data) {
          setProgress(result.data);
          
          // 检查是否完成
          if (result.data.analysis_progress?.completed_words === result.data.analysis_progress?.total_words) {
            clearInterval(interval);
          }
        }
      }, 500);  // 每 500ms 轮询一次
      
      setPollInterval(interval);
    }
    
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [isOpen]);
  
  // 计算进度百分比
  const getProgressPercentage = () => {
    if (!progress?.analysis_progress) return 0;
    const { completed_words, total_words } = progress.analysis_progress;
    return total_words > 0 ? Math.round((completed_words / total_words) * 100) : 0;
  };
  
  // 获取单词状态列表
  const getWordStatusList = () => {
    if (!progress?.word_statuses) return [];
    
    return Array.from(progress.word_statuses.entries())
      .map(([word, status]) => ({ word, ...status }))
      .sort((a, b) => {
        // 按状态排序：completed > analyzing > pending > failed
        const statusOrder = { completed: 0, analyzing: 1, pending: 2, failed: 3 };
        return statusOrder[a.status] - statusOrder[b.status];
      });
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="word-analysis-progress">
        {/* 提取阶段 */}
        {progress?.extraction_progress && (
          <div className="extraction-phase">
            <h3>📝 步骤 1：提取单词</h3>
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${getProgressPercentage()}%` }}
              />
            </div>
            <div className="progress-text">
              {progress.extraction_progress.extracted_words} / {progress.extraction_progress.total_words} 个单词
            </div>
          </div>
          <div className="time-elapsed">
            ⏱️ 已用时间：{Math.round(progress.extraction_progress.elapsed_seconds)} 秒
          </div>
        </div>
        )}
        
        {/* 分析阶段 */}
        {progress?.analysis_progress && (
          <div className="analysis-phase">
            <h3>🔍 步骤 2：批量分析</h3>
            <div className="batch-info">
              <div>批次：{progress.analysis_progress.batch_info.current_batch} / {progress.analysis_progress.batch_info.total_batches}</div>
              <div>每批：{progress.analysis_progress.batch_info.batch_size} 个单词</div>
              <div>已完成：{progress.analysis_progress.completed_words} / {progress.analysis_progress.total_words} 个单词</div>
              <div>失败：{progress.analysis_progress.failed_words} 个单词</div>
            </div>
            
            {/* 当前正在分析的单词 */}
            {progress.analysis_progress.current_word && (
              <div className="current-word">
                正在分析：<strong>{progress.analysis_progress.current_word}</strong>
              </div>
            )}
            
            {/* 单词状态列表 */}
            <div className="word-status-list">
              <h4>单词分析状态</h4>
              {getWordStatusList().slice(0, 50).map(({ word, status, error }) => (
                <div key={word} className={`word-status-item ${status}`}>
                  <span className="word">{word}</span>
                  <span className="status">
                    {status === 'completed' && '✅'}
                    {status === 'analyzing' && '⏳'}
                    {status === 'pending' && '⏸️'}
                    {status === 'failed' && '❌'}
                  </span>
                  {error && <span className="error">{error}</span>}
                </div>
              ))}
              {getWordStatusList().length > 50 && (
                <div className="more-items">
                  ... 还有 {getWordStatusList().length - 50} 个单词
                </div>
              )}
            </div>
            
            <div className="time-elapsed">
              ⏱️ 已用时间：{Math.round(progress.analysis_progress.elapsed_seconds)} 秒
            </div>
          </div>
        )}
        
        {/* 操作按钮 */}
        <div className="actions">
          <Button onClick={handleCancel} variant="secondary">
            取消分析
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

---

## 三、性能对比分析

### 3.1 处理时间对比

| 场景 | 当前方案（单次调用） | 优化方案（批量并行） | 提升 |
|--------|---------------------|---------------------|------|
| 10 个单词 | 5-10 秒 | 3-5 秒 | 2x |
| 50 个单词 | 30-50 秒 | 10-15 秒 | 3-4x |
| 100 个单词 | 60-120 秒 | 15-25 秒 | 4-5x |
| 500 个单词 | 失败或 >300 秒 | 60-90 秒 | 3-5x |
| 1000 个单词 | 失败 | 120-180 秒 | 可行 |

### 3.2 Token 使用对比

| 场景 | 当前方案 | 优化方案 | 节省 |
|--------|---------|---------|------|
| 输入 Token | 所有单词一次性 | 分批处理，每批独立 | ~50% |
| 输出 Token | 所有单词一次性 | 分批处理，每批独立 | ~70% |
| 总 Token | 1000 个单词：~200,000 | 1000 个单词：~60,000 | ~70% |

### 3.3 可靠性对比

| 指标 | 当前方案 | 优化方案 |
|--------|---------|---------|
| 单点故障 | 所有数据丢失 | 仅影响当前批次 |
| 网络中断 | 需要重新开始 | 已完成批次保留 |
| 部分失败 | 无法恢复 | 失败单词可重试 |
| 进度可见性 | 粗粒度（chunk） | 细粒度（单词级别） |

---

## 四、实施计划

### 阶段 1：后端基础设施（优先级：高）

#### 任务 1.1：创建新类型定义
- [ ] 创建 `src-tauri/src/types/word_analysis.rs`
- [ ] 定义 `ExtractedWord`, `WordExtractionResult`
- [ ] 定义 `BatchAnalysisProgress`, `ExtractionProgress`, `AnalysisProgress`
- [ ] 定义 `WordAnalysisStatus`, `BatchInfo`

#### 任务 1.2：创建单词提取提示词
- [ ] 创建 `src-tauri/src/prompts/word_extraction_agent.md`
- [ ] 设计快速、轻量的提取逻辑
- [ ] 定义 JSON 输出格式

#### 任务 1.3：实现单词提取功能
- [ ] 在 `AIService` 中添加 `extract_words` 方法
- [ ] 使用非流式 API 快速获取结果
- [ ] 解析提取结果

#### 任务 1.4：实现批量分析功能
- [ ] 创建 `WordAnalysisService` 结构
- [ ] 实现 `analyze_words_batch` 方法
- [ ] 实现并发控制（使用 Semaphore）

#### 任务 1.5：创建增强的进度管理器
- [ ] 创建 `src-tauri/src/progress_manager.rs`
- [ ] 实现细粒度的进度跟踪
- [ ] 支持单词级别的状态更新

#### 任务 1.6：创建新的 Tauri 命令
- [ ] `analyze_text_with_batching`
- [ ] `get_batch_analysis_progress`
- [ ] `cancel_batch_analysis`
- [ ] 在 `lib.rs` 中注册命令

### 阶段 2：前端实现（优先级：高）

#### 任务 2.1：创建前端类型定义
- [ ] 创建 `src/types/word-analysis.ts`
- [ ] 导出所有新类型

#### 任务 2.2：创建前端服务
- [ ] 创建 `src/services/wordAnalysisService.ts`
- [ ] 实现批量分析 API 调用
- [ ] 实现进度轮询

#### 任务 2.3：创建进度展示组件
- [ ] 创建 `src/components/WordAnalysisProgressModal.tsx`
- [ ] 实现细粒度的进度展示
- [ ] 实现单词状态列表
- [ ] 添加取消功能

#### 任务 2.4：集成到现有页面
- [ ] 更新 `WordImporterModal.tsx`
- [ ] 替换为新的批量分析流程

### 阶段 3：测试与优化（优先级：中）

#### 任务 3.1：单元测试
- [ ] 测试单词提取功能
- [ ] 测试批量分析功能
- [ ] 测试并发控制

#### 任务 3.2：集成测试
- [ ] 测试完整流程（提取 -> 分析 -> 合并）
- [ ] 测试进度更新
- [ ] 测试取消功能

#### 任务 3.3：性能测试
- [ ] 测试不同规模的数据集（10, 50, 100, 500, 1000 单词）
- [ ] 测量处理时间
- [ ] 优化批大小和并发数

#### 任务 3.4：错误处理测试
- [ ] 测试网络中断恢复
- [ ] 测试部分失败场景
- [ ] 测试超时处理

### 阶段 4：文档与部署（优先级：低）

#### 任务 4.1：更新文档
- [ ] 更新 API 文档
- [ ] 更新用户指南
- [ ] 添加故障排除指南

#### 任务 4.2：监控与日志
- [ ] 添加性能监控
- [ ] 添加错误追踪
- [ ] 优化日志输出

---

## 五、配置参数

### 5.1 批处理配置

```rust
// 可配置的参数
pub struct BatchAnalysisConfig {
    pub batch_size: usize,              // 每批单词数（默认 10，范围 5-20）
    pub max_concurrent_batches: usize,    // 最大并发批次数（默认 3，范围 1-5）
    pub retry_failed_words: bool,         // 是否重试失败的单词（默认 true）
    pub max_retries: usize,              // 最大重试次数（默认 2）
    pub timeout_per_batch: u64,           // 每批超时时间（默认 60 秒）
}

impl Default for BatchAnalysisConfig {
    fn default() -> Self {
        Self {
            batch_size: 10,
            max_concurrent_batches: 3,
            retry_failed_words: true,
            max_retries: 2,
            timeout_per_batch: 60,
        }
    }
}
```

### 5.2 性能调优建议

**小规模（< 50 单词）**
- 批大小：5
- 并发数：2
- 优先速度

**中等规模（50-200 单词）**
- 批大小：10
- 并发数：3
- 平衡速度和稳定性

**大规模（200-1000 单词）**
- 批大小：15
- 并发数：3-4
- 优先稳定性

**超大规模（> 1000 单词）**
- 批大小：20
- 并发数：4-5
- 优先稳定性

---

## 六、风险评估与缓解

### 6.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| API 限流 | 分析变慢 | 中 | 实现指数退避重试 |
| 内存占用高 | 应用崩溃 | 低 | 限制并发数，使用流式处理 |
| Token 超限 | 批次失败 | 中 | 动态调整批大小 |
| 网络不稳定 | 批次超时 | 中 | 实现重试机制 |
| JSON 解析失败 | 单词丢失 | 低 | 增强错误处理和日志 |

### 6.2 实施风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 开发周期长 | 延迟上线 | 中 | 分阶段实施，保持向后兼容 |
| 兼容性问题 | 现有功能受影响 | 低 | 保留旧 API，逐步迁移 |
| 测试覆盖不足 | 线上问题 | 中 | 充分的集成测试 |
| 性能不达预期 | 用户体验差 | 低 | 性能测试，参数调优 |

---

## 七、成功指标

### 7.1 性能指标

- **处理时间**：500 个单词 < 90 秒（目标：< 60 秒）
- **并发效率**：3 个并发批次，CPU 利用率 > 70%
- **内存使用**：峰值内存 < 500MB
- **API 调用次数**：1000 个单词 < 100 次调用

### 7.2 可靠性指标

- **成功率**：> 95% 的单词成功分析
- **恢复率**：网络中断后 > 90% 已完成数据保留
- **进度准确性**：进度误差 < 5%
- **错误恢复**：失败单词自动重试成功率 > 80%

### 7.3 用户体验指标

- **进度可见性**：用户能实时看到每个单词的状态
- **取消响应时间**：< 1 秒
- **错误信息清晰度**：用户能理解错误原因
- **总体满意度**：用户满意度 > 4.5/5.0

---

## 八、附录

### 8.1 技术栈

- **后端**：Rust, Tauri, tokio, sqlx
- **前端**：React, TypeScript, Tauri API
- **AI 服务**：OpenAI 兼容 API（async-openai）
- **数据库**：SQLite

### 8.2 参考资源

- [Rust 并发编程](https://tokio.rs/)
- [Tauri 最佳实践](https://tauri.app/v1/guides/)
- [OpenAI API 文档](https://platform.openai.com/docs)
- [批量处理模式](https://en.wikipedia.org/wiki/Batch_processing)

### 8.3 术语表

- **Batch（批次）**：一组同时处理的单词
- **Concurrent（并发）**：同时进行的多个操作
- **Semaphore（信号量）**：控制并发数量的机制
- **Stream（流式）**：逐步接收数据的方式
- **Extraction（提取）**：从文本中获取单词列表
- **Phonics（自然拼读）**：英语发音规则系统

---

## 总结

本方案通过**三阶段架构**（提取 -> 批量并行分析 -> 合并）解决了当前单一 LLM 调用的核心问题：

1. **性能提升 3-5 倍**：通过批量并行处理
2. **支持大规模数据**：通过分批处理突破 token 限制
3. **细粒度进度**：每个单词都有独立状态
4. **强容错性**：单个失败不影响整体
5. **可扩展性**：支持 1000+ 单词场景

建议采用**分阶段实施**策略，优先实现后端基础设施，然后更新前端，最后进行充分测试。
