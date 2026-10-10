import { Id, Timestamp } from './common';
import type { Tag } from './material';

/// 词汇本
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
  /** 标签（素材共用） */
  tags: Tag[];
  /** 词性分布（`get_word_books` 一次带出；其他返回词汇本的接口可能没有） */
  word_types?: WordTypeDistribution | null;
}

/// 创建词汇本请求
export interface CreateWordBookRequest {
  title: string;
  description: string;
  icon: string;
  icon_color: string;
  tag_ids?: Id[];
}

/// 更新词汇本请求
export interface UpdateWordBookRequest {
  title?: string;
  description?: string;
  icon?: string;
  icon_color?: string;
  status?: string;
  tag_ids?: Id[];
}

/// 单词例句
export interface WordExample {
  /** 英文例句 */
  sentence: string;
  /** 中文翻译 */
  translation: string;
}

/// AI 老师对话中的一条消息
export interface ChatTurn {
  /** student / teacher */
  role: 'student' | 'teacher';
  content: string;
}

/// 向 AI 老师提问
export interface WordTutorRequest {
  wordId: Id;
  /** 之前的对话（按时间顺序） */
  history: ChatTurn[];
  /** 本次问题 */
  question: string;
  /** 流式增量事件用于区分请求 */
  requestId: string;
  modelId?: Id;
  /** 学习者正在看的讲解（讲解不落库，由前端带上） */
  explanation?: string;
  /** 不在词汇本的目标词：按单词卡答疑（此时 wordId 为 0） */
  cardWord?: string | null;
}

/// 单词讲解（agent 实时生成的 Markdown，不落库）
export interface WordExplanation {
  word_id: Id;
  /** Markdown 正文 */
  content: string;
  /** 推荐追问（模型没给时为空） */
  follow_ups: string[];
  /** 生成所用模型 */
  model_name?: string | null;
  /** 生成时间 */
  generated_at: string;
}

/// AI 老师的回答
export interface TutorReply {
  /** Markdown 正文 */
  content: string;
  /** 结合这次对话推荐的追问（模型没给时为空） */
  follow_ups: string[];
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
  /** 例句（按顺序，第一句最简单） */
  examples?: WordExample[];
  /** word 单词 / phrase 词组（带空格的是词组，D45） */
  kind?: 'word' | 'phrase';
  /** 词组类型：phrasal_verb 短语动词 / collocation 固定搭配 / idiom 习语 / fixed 固定短语 */
  phrase_type?: string | null;
  /** 短语动词能否拆开用（pick it up） */
  separable?: boolean;
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
  /** 例句 */
  examples?: WordExample[];
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
  /** 例句（传入则整体替换） */
  examples?: WordExample[];
}

/// 单词查询参数
export interface WordQuery {
  keyword?: string;
  difficulty_level?: number;
  category_id?: Id;
  part_of_speech?: string;
  /** word 字母顺序（默认）/ newest 最近添加 / oldest 最早添加 */
  sortBy?: 'word' | 'newest' | 'oldest';
}

/// 词汇本统计
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

/// AI分析的单词信息
export interface AnalyzedWord {
  word: string;
  meaning: string;
  phonetic?: string;
  part_of_speech?: string;
  // 新增自然拼读分析字段
  ipa?: string;
  syllables?: string;
  pos_abbreviation?: string;
  pos_english?: string;
  pos_chinese?: string;
  phonics_rule?: string;
  analysis_explanation?: string;
  /** 例句（分析结果，至少 5 条） */
  examples?: WordExample[];
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

