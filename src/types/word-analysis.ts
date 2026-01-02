/**
 * 批量单词分析类型定义
 * 对应后端 src-tauri/src/types/word_analysis.rs
 */

/**
 * 提取的单词（带频率）
 */
export interface ExtractedWord {
  word: string;
  frequency: number;
}

/**
 * 单词提取结果
 */
export interface WordExtractionResult {
  words: ExtractedWord[];
  totalCount: number;
  uniqueCount: number;
}

/**
 * 批次信息
 */
export interface BatchInfo {
  totalBatches: number;
  completedBatches: number;
  currentBatch: number;
  batchSize: number;
}

/**
 * 提取进度
 */
export interface ExtractionProgress {
  totalWords: number;
  extractedWords: number;
  elapsedSeconds: number;
}

/**
 * 分析进度
 */
export interface AnalysisProgress {
  totalWords: number;
  completedWords: number;
  failedWords: number;
  currentWord: string | null;
  batchInfo: BatchInfo;
  elapsedSeconds: number;
}

/**
 * 单词分析状态
 */
export interface WordAnalysisStatus {
  word: string;
  status: string; // "pending", "analyzing", "completed", "failed"
  error: string | null;
  result: PhonicsWord | null;
}

/**
 * 批量分析进度
 */
export interface BatchAnalysisProgress {
  status: string; // "extracting", "analyzing", "completed", "error"
  currentStep: string; // 当前步骤描述
  extractionProgress: ExtractionProgress | null;
  analysisProgress: AnalysisProgress | null;
  wordStatuses: WordAnalysisStatus[] | null;
}

/**
 * 批量分析配置
 */
export interface BatchAnalysisConfig {
  batchSize: number;
  maxConcurrentBatches: number;
  retryFailedWords: boolean;
  maxRetries: number;
  timeoutPerBatch: number;
}

/**
 * 批量分析结果
 */
export interface BatchAnalysisResult {
  words: PhonicsWord[];
  totalWords: number;
  completedWords: number;
  failedWords: number;
  elapsedSeconds: number;
}

/**
 * 音标单词
 */
export interface PhonicsWord {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  definitions: string[];
  examples: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  frequency: number;
  relatedWords: string[];
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  idioms: string[];
}

/**
 * 批量分析请求参数
 */
export interface BatchAnalysisRequest {
  text: string;
  modelId?: number;
  extractionMode?: string;
  config?: BatchAnalysisConfig;
}

/**
 * 进度更新回调
 */
export type ProgressCallback = (progress: BatchAnalysisProgress) => void;

/**
 * 批量分析选项
 */
export interface BatchAnalysisOptions {
  onProgress?: ProgressCallback;
  onError?: (error: Error) => void;
  onComplete?: (result: BatchAnalysisResult) => void;
}
