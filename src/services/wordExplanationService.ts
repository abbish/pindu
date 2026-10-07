import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { BaseService } from './baseService';
import type { ApiResult, WordExplanation, WordTutorRequest } from '../types';

/** 生成过程中的流式增量（后端事件 `word-explanation-delta`） */
export interface WordExplanationDelta {
  requestId: string;
  wordId: number;
  delta: string;
}

/**
 * 单词讲解：读缓存 / 由 agent 实时生成（Markdown，可流式显示）
 */
export class WordExplanationService extends BaseService {
  /** 缓存的讲解；没有时 data 为 null */
  async getExplanation(wordId: number): Promise<ApiResult<WordExplanation | null>> {
    return this.executeWithLoading(() =>
      this.client.invoke<WordExplanation | null>('get_word_explanation', { wordId })
    );
  }

  /** 生成（或重新生成）讲解；`requestId` 用于在事件流里认出本次请求的增量 */
  async generateExplanation(
    wordId: number,
    requestId: string,
    modelId?: number
  ): Promise<ApiResult<WordExplanation>> {
    return this.executeWithLoading(() =>
      this.client.invoke<WordExplanation>('generate_word_explanation', { wordId, modelId, requestId })
    );
  }

  /** 订阅流式增量；返回取消订阅函数 */
  onDelta(handler: (delta: WordExplanationDelta) => void): Promise<UnlistenFn> {
    return listen<WordExplanationDelta>('word-explanation-delta', event => handler(event.payload));
  }

  /** 向 AI 老师提问，返回完整回答；回答过程中的增量见 onTutorDelta */
  async askTutor(request: WordTutorRequest): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('ask_word_tutor', { request }));
  }

  /** 订阅 AI 老师回答的流式增量；返回取消订阅函数 */
  onTutorDelta(handler: (delta: WordExplanationDelta) => void): Promise<UnlistenFn> {
    return listen<WordExplanationDelta>('word-tutor-delta', event => handler(event.payload));
  }
}

export const wordExplanationService = new WordExplanationService();
