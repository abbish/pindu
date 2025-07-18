import { Id, Timestamp } from './common';

/// 主题标签
export interface ThemeTag {
  id: Id;
  name: string;
  icon: string;
  color: string;
  created_at: Timestamp;
}

/// 单词本
export interface WordBook {
  id: Id;
  title: string;
  description: string;
  icon: string;
  icon_color: string;
  total_words: number;
  linked_plans: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  last_used: Timestamp;
  deleted_at?: Timestamp;
  status: string;
  theme_tags?: ThemeTag[];
}

/// 创建单词本请求
export interface CreateWordBookRequest {
  title: string;
  description: string;
  icon: string;
  icon_color: string;
  theme_tag_ids?: Id[];
}

/// 更新单词本请求
export interface UpdateWordBookRequest {
  title?: string;
  description?: string;
  icon?: string;
  icon_color?: string;
  status?: string;
  theme_tag_ids?: Id[];
}

/// 单词本查询参数
export interface WordBookQuery {
  keyword?: string;
  icon_color?: string;
}

/// 单词
export interface Word {
  id: Id;
  word: string;
  meaning: string;
  description?: string;
  ipa?: string;
  syllables?: string;
  phonics_segments?: string;
  image_path?: string;
  audio_path?: string;
  part_of_speech?: string;
  category_id?: Id;
  word_book_id?: Id;
  // 新增自然拼读分析字段
  pos_abbreviation?: string;
  pos_english?: string;
  pos_chinese?: string;
  phonics_rule?: string;
  analysis_explanation?: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/// 创建单词请求
export interface CreateWordRequest {
  word: string;
  meaning: string;
  description?: string;
  ipa?: string;
  syllables?: string;
  phonics_segments?: string;
  part_of_speech?: string;
  category_id?: Id;
  // 新增自然拼读分析字段
  pos_abbreviation?: string;
  pos_english?: string;
  pos_chinese?: string;
  phonics_rule?: string;
  analysis_explanation?: string;
}

/// 更新单词请求
export interface UpdateWordRequest {
  word?: string;
  meaning?: string;
  description?: string;
  ipa?: string;
  syllables?: string;
  phonics_segments?: string;
  part_of_speech?: string;
  category_id?: Id;
  // 新增自然拼读分析字段
  pos_abbreviation?: string;
  pos_english?: string;
  pos_chinese?: string;
  phonics_rule?: string;
  analysis_explanation?: string;
}

/// 单词查询参数
export interface WordQuery {
  keyword?: string;
  difficulty_level?: number;
  category_id?: Id;
  part_of_speech?: string;
}

/// 单词分类
export interface Category {
  id: Id;
  name: string;
  description?: string;
  color: string;
  icon: string;
  word_count: number;
  created_at: Timestamp;
}

/// 单词本统计
export interface WordBookStatistics {
  total_books: number;
  total_words: number;
  word_types: WordTypeDistribution;
}

/// 单词类型分布
export interface WordTypeDistribution {
  nouns: number;
  verbs: number;
  adjectives: number;
  others: number;
}

/// 批量导入单词请求
export interface ImportWordsRequest {
  book_id: Id;
  words: CreateWordRequest[];
  overwrite_existing: boolean;
}

/// AI分析的单词信息
export interface AnalyzedWord {
  word: string;
  meaning: string;
  phonetic?: string;
  part_of_speech?: string;
  example_sentence?: string;
  // 新增自然拼读分析字段
  ipa?: string;
  syllables?: string;
  pos_abbreviation?: string;
  pos_english?: string;
  pos_chinese?: string;
  phonics_rule?: string;
  analysis_explanation?: string;
}

/// 文本分析结果
export interface TextAnalysisResult {
  words: AnalyzedWord[];
  total_count: number;
  difficulty_distribution: Record<number, number>;
  suggested_title: string;
  suggested_description: string;
}

/// 从分析结果创建单词本的请求
export interface CreateWordBookFromAnalysisRequest {
  title: string;
  description: string;
  icon?: string;
  icon_color?: string;
  words: AnalyzedWord[];
  status?: string;
  book_id?: Id; // 如果提供，则向现有单词本添加单词；否则创建新单词本
}

/// 单词保存结果统计
export interface WordSaveResult {
  book_id: Id;
  added_count: number;
  updated_count: number;
  skipped_count: number;
}

/// 单词提取模式
export type WordExtractionMode = 'all' | 'focus';

/// 分析进度状态
export interface AnalysisProgress {
  status: string;           // "analyzing", "completed", "error"
  current_step: string;     // 当前步骤描述
  chunks_received: number;  // 已接收的chunk数量
  total_chars: number;      // 已接收的总字符数
  elapsed_seconds: number;  // 已用时间（秒）
  error_message?: string;   // 错误信息
}

/// 单词本统计
export interface WordBookStatistics {
  total_books: number;
  total_words: number;
  word_types: WordTypeDistribution;
}

/// 单词类型分布
export interface WordTypeDistribution {
  nouns: number;
  verbs: number;
  adjectives: number;
  others: number;
}
