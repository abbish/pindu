import type { Id, Timestamp } from './common';

/// AI提供商
export interface AIProvider {
  id: Id;
  name: string;
  display_name: string;
  base_url: string;
  api_key: string;
  description?: string;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/// AI模型
export interface AIModel {
  id: Id;
  provider_id: Id;
  name: string;
  display_name: string;
  model_id: string;
  description?: string;
  max_tokens?: number;
  temperature?: number;
  is_active: boolean;
  is_default: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/// AI模型配置（包含提供商信息）
export interface AIModelConfig {
  id: Id;
  name: string;
  display_name: string;
  model_id: string;
  description?: string;
  max_tokens?: number;
  temperature?: number;
  is_active: boolean;
  is_default: boolean;
  provider: AIProvider;
}

/// 创建AI提供商请求
export interface CreateAIProviderRequest {
  name: string;
  display_name: string;
  base_url: string;
  api_key: string;
  description?: string;
}

/// 更新AI提供商请求
export interface UpdateAIProviderRequest {
  display_name?: string;
  base_url?: string;
  api_key?: string;
  description?: string;
  is_active?: boolean;
}

/// 创建AI模型请求
export interface CreateAIModelRequest {
  provider_id: Id;
  name: string;
  display_name: string;
  model_id: string;
  description?: string;
  max_tokens?: number;
  temperature?: number;
}

/// 更新AI模型请求
export interface UpdateAIModelRequest {
  display_name?: string;
  model_id?: string;
  description?: string;
  max_tokens?: number;
  temperature?: number;
  is_active?: boolean;
  is_default?: boolean;
}

/// AI模型查询参数
export interface AIModelQuery {
  provider_id?: Id;
  is_active?: boolean;
  is_default?: boolean;
}

/// 自然拼读分析结果
export interface PhonicsAnalysisResult {
  words: PhonicsWord[];
}

/// 单词的自然拼读分析
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
}
