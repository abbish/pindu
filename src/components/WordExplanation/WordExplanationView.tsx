import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { dropUnpairedBold } from '@/utils/markdownText';
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
  /** 单词（老师打招呼时用） */
  word: string;
  /** 所在页签 / 面板是否可见 */
  active: boolean;
  /** 占满所在容器的高度（侧边对话面板里用）；默认按内容高度、最高 56vh */
  fill?: boolean;
  /** 围绕一句话聊（wordId 为 sentenceChatId）：没有「讲讲这个词」，打招呼与建议问题换成句子的 */
  sentence?: boolean;
}

/** AI 没给出推荐追问时的固定建议 */
const FALLBACK_SUGGESTIONS = ['为什么这样拼？', '怎么记住它？', '有哪些易混淆词？'];
const SENTENCE_SUGGESTIONS = ['这句话的结构怎么理解？', '为什么用这个时态？', '还能怎么说？'];
/** 让老师系统地讲一讲这个词（讲解任务） */
const EXPLAIN = '讲讲这个词';
/** 讲解出现在对话里的位置（第几条消息之后）：本次打开应用期间按单词记 */
const explainAt = new Map<number, number>();
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
 * AI 老师：围绕这个词的一段对话。打开时老师只打个招呼、等学生提问；推荐问题里第一条是「讲讲这个词」
 * （讲解任务，流式、不落库），其余是答疑。没有「生成 / 重新生成」——想换个讲法就直接说。每次回答后给出推荐追问。
 */
export const WordExplanationView: React.FC<WordExplanationViewProps> = ({
  wordId,
  word,
  active,
  fill = false,
  sentence = false,
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
  const explained = state.status === 'ready' || state.status === 'generating' || state.status === 'error';
  const dynamicFollowUps = chat.messages.length > 0 ? chat.followUps : state.status === 'ready' ? (state.meta?.follow_ups ?? []) : [];
  const base = dynamicFollowUps.length > 0 ? dynamicFollowUps : (sentence ? SENTENCE_SUGGESTIONS : FALLBACK_SUGGESTIONS).filter(q => !chat.asked.includes(q));
  // 还没讲过：第一条是「讲讲这个词」；讲过之后可以让老师换个讲法（都是对话里的一句，不是重新生成）
  const suggestions = sentence ? base : !explained ? [EXPLAIN, ...base.filter((q) => q !== EXPLAIN)] : state.status === 'ready' && !base.includes(REPHRASE) ? [...base, REPHRASE] : base;

  // 有新的对话内容时滚到底部
  useEffect(() => {
    if (chat.messages.length === 0 && chat.pendingText === null && !state.content) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [chat.messages, chat.pendingText, state.content]);

  const ask = (text: string) => {
    if (!text.trim() || chat.busy) return;
    if (!sentence && text === EXPLAIN && !explained) {
      explainAt.set(wordId, chat.messages.length);
      void generate(wordId);
      return;
    }
    // busy 按这段对话判断（见上），能走到这里就一定会发出
    void chat.send(text, state.status === 'ready' ? state.content : undefined);
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
        {typeof content === 'string' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{dropUnpairedBold(content)}</ReactMarkdown> : content}
      </div>
    </div>
  );

  /** 讲解（学生的「讲讲这个词」+ 老师的讲解） */
  const explanationTurn = explained ? (
    <React.Fragment key="explain">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">{EXPLAIN}</div>
      </div>
      {state.status === 'error'
        ? teacher(
            <span className="flex flex-wrap items-center gap-2">
              这次没能讲解：{state.error}
              <Button variant="outline" size="sm" className="h-7 rounded-full text-xs" onClick={() => generate(wordId)}>
                再试一次
              </Button>
            </span>,
            'explain-reply',
            false,
            true
          )
        : state.content
          ? teacher(state.content, 'explain-reply', state.status === 'generating')
          : teacher(<span className="text-muted-foreground">正在准备…</span>, 'explain-reply')}
    </React.Fragment>
  ) : null;
  /** 对话：问答按顺序，讲解插在提出它的位置 */
  const thread = () => {
    const at = Math.min(explainAt.get(wordId) ?? 0, chat.messages.length);
    const rows: React.ReactNode[] = chat.messages.map((m, i) =>
      m.role === 'teacher' ? (
        teacher(m.content, i, false, m.error)
      ) : (
        <div key={i} className="flex justify-end">
          <div className="max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground select-text">{m.content}</div>
        </div>
      )
    );
    if (explanationTurn) rows.splice(at, 0, explanationTurn);
    return rows;
  };

  return (
    <div className={cn('flex flex-col gap-3', fill && 'h-full min-h-0')}>
      {/* 面板里滚动区域占满宽度、内容两侧留白：滚动条落在留白里，不压在消息上 */}
      <div className={cn('flex min-h-40 flex-col gap-3 overflow-y-auto', fill ? 'min-h-0 flex-1 px-4' : 'max-h-[56vh] pr-2')} ref={bodyRef}>
        {/* 老师先打个招呼，等学生提问；「讲讲这个词」的讲解按提出的位置插在对话里 */}
        {teacher(sentence ? '这句话哪里想多了解一点？可以直接问我。' : `我们来聊聊 **${word}**。想从哪里开始？`, 'greeting')}
        {thread()}
        {chat.pendingText !== null && teacher(chat.pendingText || <span className="text-muted-foreground">正在回答…</span>, 'pending', Boolean(chat.pendingText))}
      </div>

      {/* 推荐追问与提问 */}
      <div className={cn('space-y-2', fill && 'px-4')}>
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
