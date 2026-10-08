import { useCallback, useEffect, useRef, useState } from 'react';
import { wordExplanationService } from '../../services/wordExplanationService';
import type { ChatTurn } from '../../types';

/** 界面上的一条消息：出错的回答只显示、不作为上下文发给 AI */
export interface ChatMessage extends ChatTurn {
  error?: boolean;
  /** 老师回答附带的推荐追问 */
  followUps?: string[];
}

/** 本次打开应用期间按单词保留对话（换词再回来还在；不落库） */
const chatStore = new Map<number, ChatMessage[]>();

/**
 * AI 老师对话：按单词保存消息，提问时带上之前的对话与正在看的讲解，回答流式显示。
 */
export function useTutorChat(wordId: number) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => chatStore.get(wordId) ?? []);
  /** 正在回答的请求与已收到的文字 */
  const [pending, setPending] = useState<{ requestId: string; wordId: number; text: string } | null>(null);
  const pendingRef = useRef<string | null>(null);
  const wordRef = useRef(wordId);
  wordRef.current = wordId;

  // 换词：显示该词的对话；进行中的回答继续在后台完成并存入原单词
  useEffect(() => {
    setMessages(chatStore.get(wordId) ?? []);
    setPending(prev => (prev && prev.wordId === wordId ? prev : null));
  }, [wordId]);

  // 订阅流式增量
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    wordExplanationService
      .onTutorDelta(({ requestId, delta }) => {
        if (requestId !== pendingRef.current) return;
        setPending(prev => (prev && prev.requestId === requestId ? { ...prev, text: prev.text + delta } : prev));
      })
      .then(fn => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // 事件不可用时仍可等最终回答
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const save = (targetWordId: number, next: ChatMessage[]) => {
    chatStore.set(targetWordId, next);
    if (wordRef.current === targetWordId) setMessages(next);
  };

  /** `explanation`：学习者正在看的讲解（讲解不落库，随问题带给 AI 老师） */
  const send = useCallback(async (raw: string, explanation?: string) => {
    const question = raw.trim();
    if (!question || pendingRef.current) return;
    const targetWordId = wordRef.current;
    const before = chatStore.get(targetWordId) ?? [];
    const history: ChatTurn[] = before.filter(m => !m.error).map(({ role, content }) => ({ role, content }));
    const withQuestion: ChatMessage[] = [...before, { role: 'student', content: question }];
    save(targetWordId, withQuestion);

    const requestId = `tutor-${targetWordId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingRef.current = requestId;
    setPending({ requestId, wordId: targetWordId, text: '' });
    const result = await wordExplanationService.askTutor({ wordId: targetWordId, history, question, requestId, explanation });
    pendingRef.current = null;
    setPending(null);
    save(
      targetWordId,
      result.success
        ? [...withQuestion, { role: 'teacher', content: result.data.content, followUps: result.data.follow_ups }]
        : [...withQuestion, { role: 'teacher', content: `AI 老师这次没能回答：${result.error}`, error: true }]
    );
  }, []);

  const last = messages[messages.length - 1];
  return {
    messages,
    /** 最近一次回答推荐的追问（还没对话、回答出错或模型没给时为空） */
    followUps: last?.role === 'teacher' && !last.error ? (last.followUps ?? []) : [],
    /** 学习者已经问过的问题 */
    asked: messages.filter(m => m.role === 'student').map(m => m.content),
    /** 当前单词正在回答中的文字（null 表示没有进行中的回答） */
    pendingText: pending && pending.wordId === wordId ? pending.text : null,
    /** 任一单词有进行中的回答时不能再发 */
    busy: pending !== null,
    send,
  };
}
