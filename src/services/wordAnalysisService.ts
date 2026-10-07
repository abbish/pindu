/**
 * 单词获取与拼读分析（handlers/word_analysis.rs）：按描述生成、从材料提取、批量拼读分析（轮询进度）、取消。
 * 与其它服务一致：永远返回 ApiResult，不抛异常。
 */

import { apiClient } from '../api/client';
import type { ApiResult } from '../types';
import type { BatchAnalysisProgress, BatchAnalysisResult, WordExtractionResult } from '../types/word-analysis';
import type { WordExtractionMode } from '../types/wordbook';

/** 进度轮询间隔 */
const PROGRESS_POLL_MS = 500;

class WordAnalysisService {
  private progressTimer: number | null = null;

  /** 按学习意图生成单词；传 bookId 时避开单词本里已有的词（模型按「设置 → AI 助手」） */
  async generateWordsFromIntent(intent: string, count: number, bookId?: number): Promise<ApiResult<WordExtractionResult>> {
    return apiClient.invoke<WordExtractionResult>('generate_words_from_intent', { intent, count, bookId });
  }

  /**
   * 从材料里提取单词。mode：focus 值得学的词（默认）/ all 全部；
   * bookId：目标单词本的标题、描述与主题标签作为场景，帮助 AI 选对词义。
   */
  async extractWordsFromText(text: string, mode: WordExtractionMode = 'focus', bookId?: number): Promise<ApiResult<WordExtractionResult>> {
    return apiClient.invoke<WordExtractionResult>('extract_words_from_text', { text, mode, bookId });
  }

  /**
   * 批量拼读分析。context：目标单词本（释义与例句的场景）与生成 / 提取时定好的释义（与 words 一一对应，空串表示没有）；
   * onProgress：每 500ms 轮询一次进度，分析返回时停止。每批词数与并发数以「设置 → AI 助手」为准。
   */
  async analyzeExtractedWords(
    words: string[],
    context?: { bookId?: number; meanings?: string[] },
    onProgress?: (progress: BatchAnalysisProgress) => void
  ): Promise<ApiResult<BatchAnalysisResult>> {
    if (onProgress) this.startPolling(onProgress);
    const result = await apiClient.invoke<BatchAnalysisResult>('analyze_extracted_words', {
      words,
      bookId: context?.bookId,
      meanings: context?.meanings,
    });
    this.stopPolling();
    return result;
  }

  /** 停止分析：已开始的批次会跑完（进度继续更新到分析调用返回为止） */
  async cancelBatchAnalysis(): Promise<ApiResult<void>> {
    return apiClient.invoke<void>('cancel_batch_analysis');
  }

  private startPolling(onProgress: (progress: BatchAnalysisProgress) => void): void {
    this.stopPolling();
    this.progressTimer = window.setInterval(async () => {
      const result = await apiClient.invoke<BatchAnalysisProgress>('get_batch_analysis_progress');
      // 进度只是展示：读取失败时停止轮询，分析本身的成败以 analyze 的返回为准
      if (!result.success) return this.stopPolling();
      onProgress(result.data);
      if (result.data.status === 'completed' || result.data.status === 'error') this.stopPolling();
    }, PROGRESS_POLL_MS);
  }

  private stopPolling(): void {
    if (this.progressTimer !== null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }
}

export const wordAnalysisService = new WordAnalysisService();

/** 估算剩余秒数（按已分析词的平均用时）；还没开始或无法估算返回 null */
export function estimateRemainingTime(progress: BatchAnalysisProgress): number | null {
  if (progress.status !== 'analyzing' || !progress.analysisProgress) return null;
  const { totalWords, completedWords, failedWords, elapsedSeconds } = progress.analysisProgress;
  const analyzed = completedWords + failedWords;
  if (analyzed === 0 || totalWords === 0) return null;
  return (totalWords - analyzed) * (elapsedSeconds / analyzed);
}
