/**
 * 添加单词（handlers/word_analysis.rs）：按描述生成、从材料提取（直接返回）；分析并加入词汇本（后台任务）。
 * 与其它服务一致：永远返回 ApiResult，不抛异常。
 */

import { apiClient } from '../api/client';
import type { ApiResult } from '../types';
import type { PhonicsWord } from '../types/ai-model';
import type { StartWordAnalysisRequest, WordExtractionResult } from '../types/word-analysis';
import type { WordExtractionMode } from '../types/wordbook';

class WordAnalysisService {
  /** 按学习意图生成单词；传 bookId 时避开词汇本里已有的词（模型按「设置 → AI 助手」） */
  async generateWordsFromIntent(intent: string, count: number, bookId?: number): Promise<ApiResult<WordExtractionResult>> {
    return apiClient.invoke<WordExtractionResult>('generate_words_from_intent', { intent, count, bookId });
  }

  /**
   * 从材料里提取单词。mode：focus 值得学的词（默认）/ all 全部；
   * bookId：目标词汇本的标题、描述与主题标签作为场景，帮助 AI 选对词义。
   */
  async extractWordsFromText(text: string, mode: WordExtractionMode = 'focus', bookId?: number): Promise<ApiResult<WordExtractionResult>> {
    return apiClient.invoke<WordExtractionResult>('extract_words_from_text', { text, mode, bookId });
  }

  /** 分析一个单词，只返回结果不保存（编辑单词时的「AI 补全」） */
  async analyzeWord(word: string, meaning?: string, bookId?: number): Promise<ApiResult<PhonicsWord>> {
    return apiClient.invoke<PhonicsWord>('analyze_word', { word, meaning, bookId });
  }

  /**
   * 分析单词并加入词汇本（后台任务）：返回任务 id，进度与逐词状态用 useJob 订阅（job.detail: WordAnalysisDetail，
   * job.result: WordAnalysisOutcome）。关掉弹窗也会继续，完成后成功的词已在词汇本里。每批词数与并发以「设置 → AI 助手」为准。
   */
  async startWordAnalysis(request: StartWordAnalysisRequest): Promise<ApiResult<string>> {
    return apiClient.invoke<string>('start_word_analysis', { request });
  }
}

export const wordAnalysisService = new WordAnalysisService();

/** 估算剩余秒数（按已结束的词的平均用时）；还没有词结束时返回 null */
export function estimateRemainingSeconds(total: number, done: number, elapsedSeconds: number): number | null {
  if (done === 0 || total === 0 || done >= total) return null;
  return (total - done) * (elapsedSeconds / done);
}
