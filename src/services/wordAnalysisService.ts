/**
 * 批量单词分析服务
 * 对应后端 src-tauri/src/word_analysis_handlers.rs
 */

import { apiClient } from '../api/client';
import type {
  BatchAnalysisRequest,
  BatchAnalysisResult,
  BatchAnalysisProgress,
  BatchAnalysisOptions,
  WordExtractionResult,
} from '../types/word-analysis';

/**
 * 批量单词分析服务
 */
export class WordAnalysisService {
  /**
   * 从文本中提取单词（第一步）
   * @param text 输入文本
   * @param modelId 可选的模型 ID
   * @returns 提取结果
   */
  async extractWordsFromText(
    text: string,
    modelId?: number
  ): Promise<WordExtractionResult> {
    console.log('WordAnalysisService: Starting word extraction', { textLength: text.length, modelId });

    try {
      const result = await apiClient.invoke<WordExtractionResult>(
        'extract_words_from_text',
        {
          text,
          modelId,
        }
      );

      if (!result.success) {
        throw new Error((result as any).error || '单词提取失败');
      }
      if (!result.data) {
        throw new Error('单词提取返回数据为空');
      }

      console.log('WordAnalysisService: Word extraction completed', result.data);

      return result.data;
    } catch (error) {
      console.error('WordAnalysisService: Word extraction failed', error);
      throw error;
    }
  }

  /**
   * 批量分析已提取的单词（第二步）
   * @param words 单词列表
   * @param modelId 可选的模型 ID
   * @param config 批量分析配置
   * @param options 可选配置（进度回调等）
   * @returns 分析结果
   */
  async analyzeExtractedWords(
    words: string[],
    modelId?: number,
    config?: {
      batchSize?: number;
      maxConcurrentBatches?: number;
      retryFailedWords?: boolean;
      maxRetries?: number;
      timeoutPerBatch?: number;
    },
    options?: BatchAnalysisOptions
  ): Promise<BatchAnalysisResult> {
    console.log('WordAnalysisService: Starting batch analysis of extracted words', { wordCount: words.length, modelId, config });

    // 如果提供了进度回调，启动轮询
    if (options?.onProgress) {
      this.startProgressPolling(options.onProgress, options.onError);
    }

    try {
      const result = await apiClient.invoke<BatchAnalysisResult>(
        'analyze_extracted_words',
        {
          words,
          modelId,
          config: config || {
            batchSize: 10,
            maxConcurrentBatches: 3,
            retryFailedWords: true,
            maxRetries: 2,
            timeoutPerBatch: 60,
          },
        }
      );

      if (!result.success) {
        throw new Error((result as any).error || '批量分析失败');
      }
      if (!result.data) {
        throw new Error('批量分析返回数据为空');
      }

      console.log('WordAnalysisService: Batch analysis completed', result.data);

      // 停止进度轮询
      this.stopProgressPolling();

      // 调用完成回调
      if (options?.onComplete) {
        options.onComplete(result.data);
      }

      return result.data;
    } catch (error) {
      // 停止进度轮询
      this.stopProgressPolling();

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('WordAnalysisService: Batch analysis failed', error);

      // 调用错误回调
      if (options?.onError) {
        options.onError(error instanceof Error ? error : new Error(errorMessage));
      }

      throw error;
    }
  }

  /**
   * 批量分析文本（一次性完成提取和分析）- 保留用于向后兼容
   * @param request 分析请求参数
   * @param options 可选配置（进度回调等）
   * @returns 分析结果
   */
  async analyzeTextWithBatching(
    request: BatchAnalysisRequest,
    options?: BatchAnalysisOptions
  ): Promise<BatchAnalysisResult> {
    console.log('WordAnalysisService: Starting batch analysis', request);

    // 如果提供了进度回调，启动轮询
    if (options?.onProgress) {
      this.startProgressPolling(options.onProgress, options.onError);
    }

    try {
      const result = await apiClient.invoke<BatchAnalysisResult>(
        'analyze_text_with_batching',
        {
          text: request.text,
          modelId: request.modelId,
          extractionMode: request.extractionMode || 'focus',
          config: request.config || {
            batchSize: 10,
            maxConcurrentBatches: 3,
          },
        }
      );

      if (!result.success) {
        throw new Error((result as any).error || '批量分析失败');
      }
      if (!result.data) {
        throw new Error('批量分析返回数据为空');
      }

      console.log('WordAnalysisService: Batch analysis completed', result.data);

      // 停止进度轮询
      this.stopProgressPolling();

      // 调用完成回调
      if (options?.onComplete) {
        options.onComplete(result.data);
      }

      return result.data;
    } catch (error) {
      // 停止进度轮询
      this.stopProgressPolling();

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('WordAnalysisService: Batch analysis failed', error);

      // 调用错误回调
      if (options?.onError) {
        options.onError(error instanceof Error ? error : new Error(errorMessage));
      }

      throw error;
    }
  }

  /**
   * 获取批量分析进度
   * @returns 当前进度
   */
  async getBatchAnalysisProgress(): Promise<BatchAnalysisProgress> {
    const result = await apiClient.invoke<BatchAnalysisProgress>(
      'get_batch_analysis_progress'
    );

    if (!result.success) {
      throw new Error((result as any).error || '获取进度失败');
    }
    if (!result.data) {
      throw new Error('进度数据为空');
    }

    return result.data;
  }

  /**
   * 取消批量分析
   */
  async cancelBatchAnalysis(): Promise<void> {
    const result = await apiClient.invoke<void>('cancel_batch_analysis');

    if (!result.success) {
      throw new Error((result as any).error || '取消分析失败');
    }

    // 停止进度轮询
    this.stopProgressPolling();
  }

  /**
   * 进度轮询定时器
   */
  private progressPollingTimer: number | null = null;

  /**
   * 启动进度轮询
   * @param onProgress 进度回调
   * @param onError 错误回调
   */
  private startProgressPolling(
    onProgress: (progress: BatchAnalysisProgress) => void,
    onError?: (error: Error) => void
  ): void {
    // 清除之前的定时器
    this.stopProgressPolling();

    // 立即获取一次进度
    this.getBatchAnalysisProgress()
      .then(progress => {
        onProgress(progress);

        // 如果还在运行，启动轮询
        if (progress.status === 'extracting' || progress.status === 'analyzing') {
          this.progressPollingTimer = window.setInterval(async () => {
            try {
              const currentProgress = await this.getBatchAnalysisProgress();
              onProgress(currentProgress);

              // 如果分析完成或取消，停止轮询
              if (
                currentProgress.status === 'completed' ||
                currentProgress.status === 'error'
              ) {
                this.stopProgressPolling();
              }
            } catch (error) {
              console.error('WordAnalysisService: Progress polling error', error);
              this.stopProgressPolling();
              if (onError) {
                onError(error instanceof Error ? error : new Error(String(error)));
              }
            }
          }, 500); // 每 500ms 轮询一次
        }
      })
      .catch(error => {
        console.error('WordAnalysisService: Initial progress fetch failed', error);
        if (onError) {
          onError(error instanceof Error ? error : new Error(String(error)));
        }
      });
  }

  /**
   * 停止进度轮询
   */
  private stopProgressPolling(): void {
    if (this.progressPollingTimer !== null) {
      clearInterval(this.progressPollingTimer);
      this.progressPollingTimer = null;
    }
  }

  /**
   * 计算总体进度百分比
   * @param progress 进度信息
   * @returns 进度百分比（0-100）
   */
  calculateOverallProgress(progress: BatchAnalysisProgress): number {
    if (progress.status === 'idle') {
      return 0;
    }

    if (progress.status === 'extracting') {
      // 提取阶段：根据提取进度计算
      if (!progress.extractionProgress) {
        return 0;
      }
      const { totalWords, extractedWords } = progress.extractionProgress;
      if (totalWords === 0) return 0;
      // 提取阶段占 10%
      return (extractedWords / totalWords) * 10;
    }

    if (progress.status === 'analyzing') {
      // 分析阶段：根据分析进度计算
      if (!progress.analysisProgress) {
        return 10; // 提取已完成，分析还未开始
      }
      const { totalWords, completedWords, failedWords } = progress.analysisProgress;
      if (totalWords === 0) return 10;
      // 分析阶段占 90%
      const analyzedCount = completedWords + failedWords;
      return 10 + (analyzedCount / totalWords) * 90;
    }

    if (progress.status === 'completed') {
      return 100;
    }

    return 0;
  }

  /**
   * 格式化进度文本
   * @param progress 进度信息
   * @returns 格式化的进度文本
   */
  formatProgressText(progress: BatchAnalysisProgress): string {
    const phaseTexts: Record<string, string> = {
      idle: '准备中',
      extracting: '提取单词',
      analyzing: '分析单词',
      completed: '已完成',
      error: '失败',
    };

    const phaseText = phaseTexts[progress.status] || progress.status;

    if (progress.status === 'extracting' && progress.extractionProgress) {
      const { totalWords, extractedWords } = progress.extractionProgress;
      return `${phaseText}: ${extractedWords}/${totalWords}`;
    }

    if (progress.status === 'analyzing' && progress.analysisProgress) {
      const { totalWords, completedWords, failedWords, batchInfo } = progress.analysisProgress;
      const analyzed = completedWords + failedWords;
      return `${phaseText}: ${analyzed}/${totalWords} (批次 ${batchInfo.completedBatches + 1}/${batchInfo.totalBatches})`;
    }

    return phaseText;
  }

  /**
   * 估算剩余时间（秒）
   * @param progress 进度信息
   * @returns 估算的剩余时间（秒），如果无法估算则返回 null
   */
  estimateRemainingTime(progress: BatchAnalysisProgress): number | null {
    if (progress.status !== 'analyzing' || !progress.analysisProgress) {
      return null;
    }

    const { totalWords, completedWords, failedWords, elapsedSeconds } = progress.analysisProgress;
    const analyzed = completedWords + failedWords;

    if (analyzed === 0 || totalWords === 0) {
      return null;
    }

    const remaining = totalWords - analyzed;
    const avgTimePerWord = elapsedSeconds / analyzed;
    return remaining * avgTimePerWord;
  }
}

// 创建全局服务实例
export const wordAnalysisService = new WordAnalysisService();
