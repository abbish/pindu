import type { Id, Timestamp } from './common';

/// AI提供商
export interface AIProvider {
  id: Id;
  name: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  description?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/// AI模型
export interface AIModel {
  id: Id;
  providerId: Id;
  name: string;
  displayName: string;
  modelId: string;
  description?: string;
  maxTokens?: number;
  temperature?: number;
  isActive: boolean;
  isDefault: boolean;
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
  isActive: boolean;
  isDefault: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  provider: AIProvider;
}

/// 创建AI提供商请求
export interface CreateAIProviderRequest {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  description?: string;
}

/// 更新AI提供商请求
export interface UpdateAIProviderRequest {
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  description?: string;
  isActive?: boolean;
}

/// 创建AI模型请求
export interface CreateAIModelRequest {
  providerId: Id;
  name: string;
  displayName: string;
  modelId: string;
  description?: string;
  maxTokens?: number;
  temperature?: number;
}

/// 更新AI模型请求
export interface UpdateAIModelRequest {
  displayName?: string;
  modelId?: string;
  description?: string;
  maxTokens?: number;
  temperature?: number;
  isActive?: boolean;
  isDefault?: boolean;
}

/// AI模型查询参数
export interface AIModelQuery {
  providerId?: Id;
  isActive?: boolean;
  isDefault?: boolean;
}

/// 自然拼读分析结果
export interface PhonicsAnalysisResult {
  words: PhonicsWord[];
}

/// 单词的自然拼读分析
export interface PhonicsWord {
  word: string;
  frequency: number;
  chineseTranslation: string;
  posAbbreviation: string;
  posEnglish: string;
  posChinese: string;
  ipa: string;
  syllables: string;
  phonicsRule: string;
  analysisExplanation: string;
}
