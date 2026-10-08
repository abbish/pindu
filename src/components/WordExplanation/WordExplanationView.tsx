import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { wordExplanationService } from '../../services/wordExplanationService';
import type { WordExplanation } from '../../types';
import { formatDateTime } from '../../utils/datetime';
import { PanelToolbar } from '../WordSidePanel/PanelToolbar';
import { useImeGuard } from '../../hooks/useImeGuard';
import { useTutorChat } from './useTutorChat';
import { AlertCircle, Bot, GraduationCap, Loader2, PenLine, RotateCw, Send } from 'lucide-react';
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
}

/** 页签停留多久才自动开始生成（毫秒），快速切换不触发 */
const AUTO_GENERATE_DELAY_MS = 1200;

/** AI 没给出推荐追问时的固定建议 */
const FALLBACK_SUGGESTIONS = ['为什么这样拼？', '能再举一个例子吗？', '它和哪个词容易搞混？'];

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

const formatTime = (value: string): string => formatDateTime(value) || value;

/**
 * 单词讲解：由 agent 实时生成（流式显示，不落库），可重新生成；
 * 讲解与每次答疑后显示 AI 结合上下文推荐的追问。
 */
export const WordExplanationView: React.FC<WordExplanationViewProps> = ({
  wordId,
  active,
  autoGenerate,
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

  const busy = state.status === 'generating';

  // 推荐追问：有对话时用最近一次回答的，否则用讲解的；AI 没给时用固定建议（去掉问过的）
  const dynamicFollowUps = chat.messages.length > 0 ? chat.followUps : state.status === 'ready' ? (state.meta?.follow_ups ?? []) : [];
  const suggestions = dynamicFollowUps.length > 0 ? dynamicFollowUps : FALLBACK_SUGGESTIONS.filter(q => !chat.asked.includes(q));

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

  return (
    <div className="flex flex-col gap-3">
      <div className="max-h-[56vh] min-h-40 overflow-y-auto pr-1" ref={bodyRef}>
        {state.status === 'missing' ? (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center">
            <GraduationCap className="size-6 text-muted-foreground" />
            <p className="font-medium">这个单词还没有讲解</p>
            <span className="text-sm text-muted-foreground">{autoGenerate && active ? 'AI 老师马上开始讲…' : '需要的话，让 AI 老师讲一讲'}</span>
            <Button size="sm" className="mt-1" onClick={() => generate(wordId)}>
              让 AI 老师讲一讲
            </Button>
          </div>
        ) : state.status === 'error' ? (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <p className="font-medium">讲解生成失败</p>
            <span className="text-sm text-muted-foreground">{state.error}</span>
            <Button variant="outline" size="sm" className="mt-1" onClick={() => generate(wordId)}>
              <RotateCw />
              重试
            </Button>
          </div>
        ) : state.content ? (
          <div className={cn('markdown-body select-text', state.status === 'generating' && 'markdown-streaming')}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.content}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="font-medium">{state.status === 'generating' ? 'AI 老师正在思考怎么讲…' : '正在加载…'}</p>
            {state.status === 'generating' && <span className="text-sm text-muted-foreground">讲解需要十几秒，写好的部分会先显示出来</span>}
          </div>
        )}

        {/* 和 AI 老师的对话 */}
        {(chat.messages.length > 0 || chat.pendingText !== null) && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
              和 AI 老师的对话
            </div>
            {chat.messages.map((m, i) => (
              <div key={i} className={cn('flex gap-2', m.role === 'student' && 'justify-end')}>
                {m.role === 'teacher' && (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <GraduationCap className="size-4" />
                  </span>
                )}
                <div
                  className={cn(
                    'max-w-[85%] rounded-xl px-3 py-2 text-sm select-text',
                    m.role === 'student' ? 'bg-primary text-primary-foreground' : 'markdown-body bg-muted',
                    m.error && 'border border-destructive/40 text-destructive'
                  )}
                >
                  {m.role === 'teacher' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown> : m.content}
                </div>
              </div>
            ))}
            {chat.pendingText !== null && (
              <div className="flex gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <GraduationCap className="size-4" />
                </span>
                <div className="markdown-body markdown-streaming max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm">
                  {chat.pendingText ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{chat.pendingText}</ReactMarkdown>
                  ) : (
                    <span className="text-muted-foreground">AI 老师正在想…</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 提问输入框 */}
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
            placeholder="有不懂的地方？问问 AI 老师…"
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

      <PanelToolbar
        meta={
          state.status === 'generating' ? (
            <span className="inline-flex items-center gap-1">
              <PenLine className="size-3.5" /> AI 老师正在写讲解…
            </span>
          ) : state.status === 'ready' && state.meta ? (
            <span className="inline-flex items-center gap-1">
              <Bot className="size-3.5" />
              {state.meta.model_name ? `${state.meta.model_name} 生成` : 'AI 生成'} · {formatTime(state.meta.generated_at)}
            </span>
          ) : null
        }
        actions={[
          {
            key: 'regenerate',
            label: state.status === 'missing' ? '生成讲解' : '重新生成',
            icon: RotateCw,
            onClick: () => generate(wordId),
            disabled: busy,
            spinning: state.status === 'generating',
            title: '重新生成讲解',
          },
        ]}
      />
    </div>
  );
};
