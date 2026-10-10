import type { Id, Timestamp } from './common';
import type { WordExample } from './wordbook';

/// AI提供商（对应 Rust `AIProviderSafe`：后端不返回 API Key 本身）
export interface AIProvider {
  id: Id;
  name: string;
  displayName: string;
  baseUrl: string;
  /** 是否已配置 API Key */
  hasApiKey: boolean;
  /** API Key 前 4 位脱敏预览 */
  apiKeyPreview?: string | null;
  description?: string;
  /** 映射的 pi 内置提供商 id（如 moonshotai-cn）；空 = 自定义端点 */
  piProvider?: string | null;
  /** 自定义端点的接口类型：openai-completions / openai-responses / anthropic-messages */
  api: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/// AI模型配置（包含提供商信息）
export interface AIModelConfig {
  id: Id;
  name: string;
  displayName: string;
  modelId: string;
  description?: string;
  maxTokens?: number;
  temperature?: number;
  /** 思考档：off / minimal / low / medium / high / xhigh / max；空 = 任务默认 */
  thinkingLevel?: string | null;
  /** 额外采样参数（如 { top_p: 0.95 }） */
  extraParams?: Record<string, unknown> | null;
  /** 上下文窗口（仅自定义模型需要） */
  contextWindow?: number | null;
  /** 是否推理模型（仅自定义模型需要） */
  reasoning?: boolean | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  provider: AIProvider;
}

/// 提供商 `/models` 接口返回的远端模型（对应 Rust `RemoteModelInfo`）
export interface RemoteModelInfo {
  /** 调用时使用的模型 ID */
  id: string;
  /** 提供商给出的展示名 */
  name?: string | null;
  /** 上下文长度（token） */
  contextLength?: number | null;
  /** 该提供商下是否已添加 */
  alreadyAdded: boolean;
  /** 是否在 pi 内置目录中 */
  inCatalog?: boolean;
  /** pi 目录给出的支持思考档 */
  thinkingLevels?: string[];
  reasoning?: boolean | null;
  /** 价格：美元 / 百万 token */
  costInput?: number | null;
  costOutput?: number | null;
}

/// 模型生成参数（对应 Rust `ModelGenerationSettings`；保存时整体替换，空 = 不发送 / 使用默认）
export interface ModelGenerationSettings {
  maxTokens?: number | null;
  temperature?: number | null;
  thinkingLevel?: string | null;
  extraParams?: Record<string, unknown> | null;
  contextWindow?: number | null;
  reasoning?: boolean | null;
}

/// pi 内置提供商摘要（对应 Rust `CatalogProviderSummary`）
export interface CatalogProviderSummary {
  id: string;
  /** pi 给出的展示名称 */
  name: string;
  baseUrl: string;
  api: string;
  /** pi 对 API 密钥的说明（如 "DeepSeek API key"）；不支持密钥鉴权时为 null */
  apiKeyLabel: string | null;
  /** 支持登录授权（OAuth） */
  supportsOAuth: boolean;
  /** 只填 API 密钥就能用 */
  keyOnly: boolean;
  modelCount: number;
}

/// pi 内置目录中的模型（对应 Rust `CatalogModel`）
export interface CatalogModel {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  input: string[];
  /** 美元 / 百万 token */
  costInput: number;
  costOutput: number;
  thinkingLevels: string[];
}

/// 创建AI提供商请求
export interface CreateAIProviderRequest {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  description?: string;
  piProvider?: string | null;
  api?: string;
}

/// 更新AI提供商请求
export interface UpdateAIProviderRequest {
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  description?: string;
  isActive?: boolean;
  /** 空字符串 = 清除映射（改为自定义端点） */
  piProvider?: string;
  api?: string;
}

/// 创建AI模型请求
export interface CreateAIModelRequest {
  providerId: Id;
  name: string;
  displayName: string;
  modelId: string;
  description?: string;
  generation?: ModelGenerationSettings;
}

/// 更新AI模型请求
export interface UpdateAIModelRequest {
  displayName?: string;
  modelId?: string;
  description?: string;
  isActive?: boolean;
  isDefault?: boolean;
  /** 给出时六项生成参数整体替换 */
  generation?: ModelGenerationSettings;
}

/// AI模型查询参数
export interface AIModelQuery {
  providerId?: Id;
  isActive?: boolean;
  isDefault?: boolean;
}

/// 单词的自然拼读分析（对应 Rust `types::word_analysis::PhonicsWord`，无 rename_all，字段为 snake_case）
export interface PhonicsWord {
  word: string;
  frequency: number;
  chinese_translation: string;
  pos_abbreviation: string;
  pos_english: string;
  pos_chinese: string;
  ipa: string;
  syllables: string;
  phonics_rule: string;
  analysis_explanation: string;
  /** 例句（5 条以上，第一句最简单） */
  examples: WordExample[];
  /** 词组类型：phrasal_verb / collocation / idiom / fixed（单词为空） */
  phrase_type: string;
  /** 短语动词能否拆开用 */
  separable: boolean;
}

/// test_ai_model 的返回（对应 Rust `TestAIModelResult`，camelCase）
export interface TestAIModelResult {
  /** 后端成功时恒为 true（失败走错误返回） */
  success: boolean;
  /** 模型的回复 */
  message: string;
}

/// AI模型测试结果（前端在 TestAIModelResult 上补响应时间）
export interface AIModelTestResult {
  success: boolean;
  responseTime: number; // 响应时间（毫秒）
  message: string; // 响应消息或错误信息
  error?: string; // 错误详情
}
