import { useCallback, useSyncExternalStore } from 'react';
import { wordExplanationService } from '../../services/wordExplanationService';
import type { ChatTurn } from '../../types';

/** 界面上的一条消息：出错的回答只显示、不作为上下文发给 AI */
export interface ChatMessage extends ChatTurn {
  error?: boolean;
  /** 老师回答附带的推荐追问 */
  followUps?: string[];
}

/** 一段对话：消息 + 正在回答的请求（流式文字） */
interface ChatState {
  messages: ChatMessage[];
  pending: { requestId: string; text: string } | null;
}

const EMPTY: ChatState = { messages: [], pending: null };

/**
 * 本次打开应用期间按单词 / 句子保留的对话（不落库）。放在组件外、可订阅：
 * 换词、切页签、面板重开后回到同一个词，进行中的回答与已有对话都还在；回答到达时写进它所属的对话。
 */
const chats = new Map<number, ChatState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const update = (id: number, fn: (prev: ChatState) => ChatState) => {
  chats.set(id, fn(chats.get(id) ?? EMPTY));
  emit();
};

/** 流式增量：按 requestId 找到所属对话（全局订阅一次） */
const requestOwner = new Map<string, number>();
let listening = false;
function listenDeltas() {
  if (listening) return;
  listening = true;
  wordExplanationService
    .onTutorDelta(({ requestId, delta }) => {
      const id = requestOwner.get(requestId);
      if (id === undefined) return;
      update(id, (prev) => (prev.pending?.requestId === requestId ? { ...prev, pending: { requestId, text: prev.pending.text + delta } } : prev));
    })
    .catch(() => {
      // 事件不可用时仍可等最终回答
      listening = false;
    });
}

/**
 * AI 老师对话：提问时带上之前的对话与正在看的讲解，回答流式显示。
 * 每个单词 / 句子各自一段对话，同一段对话里一次只回答一个问题。
 */
export function useTutorChat(wordId: number) {
  listenDeltas();
  const state = useSyncExternalStore(subscribe, () => chats.get(wordId) ?? EMPTY);

  /** `explanation`：学习者正在看的讲解（讲解不落库，随问题带给 AI 老师）。返回是否已发出 */
  const send = useCallback(
    async (raw: string, explanation?: string): Promise<boolean> => {
      const question = raw.trim();
      const current = chats.get(wordId) ?? EMPTY;
      if (!question || current.pending) return false;
      const history: ChatTurn[] = current.messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const requestId = `tutor-${wordId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      requestOwner.set(requestId, wordId);
      update(wordId, (prev) => ({ messages: [...prev.messages, { role: 'student', content: question }], pending: { requestId, text: '' } }));
      const result = await wordExplanationService.askTutor({ wordId, history, question, requestId, explanation });
      requestOwner.delete(requestId);
      // 在最新的对话上追加回答（期间可能已切走又回来）
      update(wordId, (prev) => ({
        messages: [
          ...prev.messages,
          result.success
            ? { role: 'teacher', content: result.data.content, followUps: result.data.follow_ups }
            : { role: 'teacher', content: `AI 老师这次没能回答：${result.error}`, error: true },
        ],
        pending: prev.pending?.requestId === requestId ? null : prev.pending,
      }));
      return true;
    },
    [wordId]
  );

  const { messages, pending } = state;
  const last = messages[messages.length - 1];
  return {
    messages,
    /** 最近一次回答推荐的追问（还没对话、回答出错或模型没给时为空） */
    followUps: last?.role === 'teacher' && !last.error ? (last.followUps ?? []) : [],
    /** 学习者已经问过的问题 */
    asked: messages.filter((m) => m.role === 'student').map((m) => m.content),
    /** 正在回答中的文字（null 表示没有进行中的回答） */
    pendingText: pending ? pending.text : null,
    /** 这段对话正在回答时不能再发 */
    busy: pending !== null,
    send,
  };
}
