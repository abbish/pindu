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
  /** AI 给这批单词（词汇本）定的标签，加入词汇本时一起打上 */
  tags: string[];
}

/** 「分析并加入词汇本」任务的请求（start_word_analysis） */
export interface StartWordAnalysisRequest {
  bookId: number;
  /** 生成 / 提取时 AI 给的标签，保存单词时给词汇本加上 */
  tags?: string[];
  words: string[];
  /** 生成 / 提取时定好的释义，与 words 一一对应（空字符串表示没有） */
  meanings?: string[];
  modelId?: number;
}

/** 单个单词的分析状态 */
export interface WordAnalysisStatus {
  word: string;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  /** 失败原因 */
  error: string | null;
}

/** 任务运行中的细节（job.detail）：逐词状态 */
export interface WordAnalysisDetail {
  words: WordAnalysisStatus[];
}

/** 任务结果（job.result） */
export interface WordAnalysisOutcome {
  bookId: number;
  addedCount: number;
  updatedCount: number;
  /** 没有分析成功的词（含停止时还没轮到的），可以再提交一次 */
  failed: WordAnalysisStatus[];
}
