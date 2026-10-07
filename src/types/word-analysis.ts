import type { PhonicsWord } from './ai-model';

/**
 * 批量单词分析类型定义
 * 对应后端 src-tauri/src/types/word_analysis.rs
 */

/**
 * 提取的单词（带频率、词性和中文翻译）
 */
export interface ExtractedWord {
  word: string;
  frequency: number;
  partOfSpeech?: string; // 词性缩写（如 "n.", "v.", "adj." 等）
  meaning?: string; // 中文翻译
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
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
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
 * 批量分析结果
 */
export interface BatchAnalysisResult {
  words: PhonicsWord[];
  totalWords: number;
  completedWords: number;
  failedWords: number;
  elapsedSeconds: number;
}

