import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { BaseService } from './baseService';
import type { ApiResult, TutorReply, WordExplanation, WordTutorRequest } from '../types';
import type { SentenceRef } from '../types/passage';

/** 生成过程中的流式增量（后端事件 `word-explanation-delta`） */
export interface WordExplanationDelta {
  requestId: string;
  wordId: number;
  delta: string;
}

/**
 * 不在词汇本的目标词（单词卡）在讲解 / 答疑里用一个负数 id 代表（讲解与对话的缓存按 id 记），
 * 调用后端时换成 wordId 0 + cardWord。
 */
const cardWords = new Map<number, string>();
export function cardWordId(word: string): number {
  let hash = 0;
  for (const ch of word.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const id = -(Math.abs(hash) + 1);
  cardWords.set(id, word);
  return id;
}
/** 围绕短文里一句话的对话：同样用负数 id（与单词卡的 id 范围错开），调用后端时换成 wordId 0 + sentence */
const sentenceRefs = new Map<number, SentenceRef>();
export function sentenceChatId(passageId: number, sentenceIndex: number): number {
  const id = -(2 ** 32 + passageId * 100_000 + sentenceIndex);
  sentenceRefs.set(id, { passageId, sentenceIndex });
  return id;
}
const target = (wordId: number) => {
  const sentence = sentenceRefs.get(wordId);
  if (sentence) return { wordId: 0, cardWord: null, sentence };
  return wordId < 0 ? { wordId: 0, cardWord: cardWords.get(wordId) ?? null } : { wordId, cardWord: null };
};

/**
 * 单词讲解：由 agent 实时生成（Markdown，可流式显示，不落库）与 AI 老师答疑
 */
export class WordExplanationService extends BaseService {
  /** 生成讲解与推荐追问；`requestId` 用于在事件流里认出本次请求的增量 */
  async generateExplanation(
    wordId: number,
    requestId: string,
    modelId?: number
  ): Promise<ApiResult<WordExplanation>> {
    return this.executeWithLoading(() =>
      this.client.invoke<WordExplanation>('generate_word_explanation', { ...target(wordId), modelId, requestId })
    );
  }

  /** 订阅流式增量；返回取消订阅函数 */
  onDelta(handler: (delta: WordExplanationDelta) => void): Promise<UnlistenFn> {
    return listen<WordExplanationDelta>('word-explanation-delta', event => handler(event.payload));
  }

  /** 向 AI 老师提问，返回完整回答与推荐追问；回答过程中的增量见 onTutorDelta */
  async askTutor(request: WordTutorRequest): Promise<ApiResult<TutorReply>> {
    return this.executeWithLoading(() => this.client.invoke<TutorReply>('ask_word_tutor', { request: { ...request, ...target(request.wordId) } }));
  }

  /** 订阅 AI 老师回答的流式增量；返回取消订阅函数 */
  onTutorDelta(handler: (delta: WordExplanationDelta) => void): Promise<UnlistenFn> {
    return listen<WordExplanationDelta>('word-tutor-delta', event => handler(event.payload));
  }
}

export const wordExplanationService = new WordExplanationService();
