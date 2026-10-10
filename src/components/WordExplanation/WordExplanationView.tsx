import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { wordExplanationService } from '../../services/wordExplanationService';
import type { WordExplanation } from '../../types';
import { useImeGuard } from '../../hooks/useImeGuard';
import { useTutorChat } from './useTutorChat';
import { GraduationCap, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface WordExplanationViewProps {
  /** 当前单词 ID */
  wordId: number;
  /** 所在页签是否可见：可见时才显示 / 生成讲解 */
  active: boolean;
  /**
   * 还没有讲解时是否自动生成：只在学生会停下来看的环节（看·说、查）为 true；
   * 一次答对后的短暂停留为 false，避免刚触发生成就跳到下一题。
   */
  autoGenerate: boolean;
  /** 占满所在容器的高度（侧边对话面板里用）；默认按内容高度、最高 56vh */
  fill?: boolean;
}

/** 页签停留多久才自动开始生成（毫秒），快速切换不触发 */
const AUTO_GENERATE_DELAY_MS = 1200;

/** AI 没给出推荐追问时的固定建议 */
const FALLBACK_SUGGESTIONS = ['为什么这样拼？', '能再举一个例子吗？', '有哪些易混淆词？'];
/** 让老师换一种讲法 */
const REPHRASE = '换个讲法';

/** 本次打开应用期间按单词保留生成的讲解（不落库；换词再回来不用重新生成） */
const explanationStore = new Map<number, WordExplanation>();

type Status = 'idle' | 'missing' | 'generating' | 'ready' | 'error';

interface ViewState {
  wordId: number | null;
  status: Status;
  /** 生成中为已收到的流式文本，完成后为最终 Markdown */
  content: string;
  meta?: WordExplanation;
  error?: string;
}

/**
 * AI 老师：围绕这个词的一段对话。老师先开口讲（讲解，agent 实时生成、流式显示、不落库），学生接着问（答疑）；
 * 讲解与答疑是同一个对话流，没有「生成 / 重新生成」——想换个讲法就直接说。每次回答后给出推荐追问。
 */
export const WordExplanationView: React.FC<WordExplanationViewProps> = ({
  wordId,
  active,
  autoGenerate,
  fill = false,
}) => {
  const [state, setState] = useState<ViewState>({ wordId: null, status: 'idle', content: '' });
  const chat = useTutorChat(wordId);
  const [question, setQuestion] = useState('');
  const { compositionHandlers, isImeEnter } = useImeGuard();
  const bodyRef = useRef<HTMLDivElement>(null);
  /** 当前生成请求；增量与结果只认这一次 */
  const requestRef = useRef<string | null>(null);
  /** 当前展示的单词（异步结果回来时校验是否已换词） */
  const wordRef = useRef(wordId);
  wordRef.current = wordId;
  const loadedWordRef = useRef<number | null>(null);

  // 订阅流式增量
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    wordExplanationService
      .onDelta(({ requestId, delta }) => {
        if (requestId !== requestRef.current) return;
        setState(prev => (prev.status === 'generating' ? { ...prev, content: prev.content + delta } : prev));
      })
      .then(fn => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // 事件不可用时仍可等最终结果
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const generate = useCallback(async (targetWordId: number) => {
    const requestId = `${targetWordId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    requestRef.current = requestId;
    setState({ wordId: targetWordId, status: 'generating', content: '' });
    const result = await wordExplanationService.generateExplanation(targetWordId, requestId);
    // 期间换词：结果先存起来，换回这个词时直接显示
    if (result.success) explanationStore.set(targetWordId, result.data);
    if (requestRef.current !== requestId) return;
    requestRef.current = null;
    setState(
      result.success
        ? { wordId: targetWordId, status: 'ready', content: result.data.content, meta: result.data }
        : { wordId: targetWordId, status: 'error', content: '', error: result.error }
    );
  }, []);

  const load = useCallback((targetWordId: number) => {
    requestRef.current = null;
    const kept = explanationStore.get(targetWordId);
    // 本次还没生成过：是否生成由下面的停留判断决定
    setState(
      kept
        ? { wordId: targetWordId, status: 'ready', content: kept.content, meta: kept }
        : { wordId: targetWordId, status: 'missing', content: '' }
    );
  }, []);

  // 还没有讲解且处在会停下来看的环节：页签停留一会儿再自动生成
  useEffect(() => {
    if (state.status !== 'missing' || state.wordId !== wordId || !active || !autoGenerate) return;
    const timer = setTimeout(() => generate(wordId), AUTO_GENERATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.status, state.wordId, wordId, active, autoGenerate, generate]);

  // 页签可见且换了单词：显示本次已生成的讲解，没有就等待生成
  useEffect(() => {
    if (!active || loadedWordRef.current === wordId) return;
    loadedWordRef.current = wordId;
    load(wordId);
  }, [active, wordId, load]);

  // 换词时清掉上一个词的内容（页签不可见时也要清，避免切回来先闪旧内容）
  useEffect(() => {
    setState(prev => (prev.wordId === wordId ? prev : { wordId: null, status: 'idle', content: '' }));
    if (loadedWordRef.current !== wordId) requestRef.current = null;
  }, [wordId]);


  // 推荐追问：有对话时用最近一次回答的，否则用讲解的；AI 没给时用固定建议（去掉问过的）
  const dynamicFollowUps = chat.messages.length > 0 ? chat.followUps : state.status === 'ready' ? (state.meta?.follow_ups ?? []) : [];
  const base = dynamicFollowUps.length > 0 ? dynamicFollowUps : FALLBACK_SUGGESTIONS.filter(q => !chat.asked.includes(q));
  // 讲完之后随时可以让老师换个讲法（作为一句话问，不是重新生成）
  const suggestions = state.status === 'ready' && !base.includes(REPHRASE) ? [...base, REPHRASE] : base;

  // 有新的对话内容时滚到底部
  useEffect(() => {
    if (chat.messages.length === 0 && chat.pendingText === null) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [chat.messages, chat.pendingText]);

  const ask = (text: string) => {
    if (!text.trim() || chat.busy) return;
    chat.send(text, state.status === 'ready' ? state.content : undefined);
    setQuestion('');
  };

  /** 老师的一条消息（开口讲解与答疑同一种样式） */
  const teacher = (content: React.ReactNode, key: React.Key, streaming = false, error = false) => (
    <div key={key} className="flex gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <GraduationCap className="size-4" />
      </span>
      <div
        className={cn(
          'min-w-0 max-w-[90%] rounded-xl bg-muted px-3 py-2 text-sm select-text',
          typeof content === 'string' && 'markdown-body',
          streaming && 'markdown-streaming',
          error && 'border border-destructive/40 text-destructive'
        )}
      >
        {typeof content === 'string' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown> : content}
      </div>
    </div>
  );

  return (
    <div className={cn('flex flex-col gap-3', fill && 'h-full min-h-0')}>
      <div className={cn('flex min-h-40 flex-col gap-3 overflow-y-auto pr-1', fill ? 'min-h-0 flex-1' : 'max-h-[56vh]')} ref={bodyRef}>
        {/* 老师先开口讲这个词，之后的问答接在同一段对话里 */}
        {state.status === 'missing'
          ? teacher(
              <span className="flex flex-wrap items-center gap-2">
                需要我讲讲这个词吗？
                <Button variant="outline" size="sm" className="h-7 rounded-full text-xs" onClick={() => generate(wordId)}>
                  讲讲这个词
                </Button>
              </span>,
              'intro'
            )
          : state.status === 'error'
            ? teacher(
                <span className="flex flex-wrap items-center gap-2">
                  这次没能讲解：{state.error}
                  <Button variant="outline" size="sm" className="h-7 rounded-full text-xs" onClick={() => generate(wordId)}>
                    再试一次
                  </Button>
                </span>,
                'intro',
                false,
                true
              )
            : state.content
              ? teacher(state.content, 'intro', state.status === 'generating')
              : teacher(<span className="text-muted-foreground">正在准备…</span>, 'intro')}

        {chat.messages.map((m, i) =>
          m.role === 'teacher' ? (
            teacher(m.content, i, false, m.error)
          ) : (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground select-text">{m.content}</div>
            </div>
          )
        )}
        {chat.pendingText !== null && teacher(chat.pendingText || <span className="text-muted-foreground">正在回答…</span>, 'pending', Boolean(chat.pendingText))}
      </div>

      {/* 推荐追问与提问 */}
      <div className="space-y-2">
        {chat.pendingText === null && state.status !== 'generating' && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((sug) => (
              <Button key={sug} variant="outline" size="sm" className="h-7 rounded-full text-xs" onClick={() => ask(sug)} disabled={chat.busy}>
                {sug}
              </Button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={question}
            maxLength={300}
            placeholder="问 AI 老师"
            aria-label="向 AI 老师提问"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeEnter(e)) ask(question);
            }}
            {...compositionHandlers}
          />
          <Button size="icon" onClick={() => ask(question)} disabled={!question.trim() || chat.busy} title="发送" aria-label="发送">
            {chat.busy ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    </div>
  );
};
