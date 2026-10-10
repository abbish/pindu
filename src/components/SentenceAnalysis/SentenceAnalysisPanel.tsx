import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, GraduationCap, Plus, RefreshCw, ScanText, X } from 'lucide-react';
import { AiWorking } from '@/components/AiWorking';
import { InlineError } from '@/components/InlineError';
import { WordExplanationView } from '@/components/WordExplanation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { passageService } from '@/services/passageService';
import { sentenceChatId } from '@/services/wordExplanationService';
import { cn } from '@/lib/utils';
import type { PassageSentence, SentenceAnalysis } from '@/types/passage';
import type { ApiResult } from '@/types';
import { canAddTarget } from '@/utils/passage';

export interface SentenceAnalysisPanelProps {
  passageId: number;
  sentences: PassageSentence[];
  /** 正在看的句子 */
  index: number;
  /** 换一句（上一句 / 下一句） */
  onIndexChange: (index: number) => void;
  /** 这篇的目标词（已是目标词的词组不再显示「加入目标词」） */
  targets: string[];
  /** 把词组加成这篇的目标词；不传则不显示按钮 */
  onAddTarget?: (word: string) => void;
  onClose: () => void;
}

/** 本次打开应用期间按句子保留分析结果（后端也有缓存，这里只省去切换时的闪烁） */
const store = new Map<string, SentenceAnalysis>();
/** 进行中的分析请求（同一句只发一次；快速翻句后回来接着等同一个结果） */
const inflight = new Map<string, Promise<ApiResult<SentenceAnalysis>>>();

type Tab = 'analysis' | 'teacher';

/**
 * 句子分析面板：固定在窗口右侧（与 AI 老师面板同一位置）。分析页签讲句式、成分、语法点、交际功能、词组与发音要点；
 * 「问老师」页签围绕这句话和 AI 老师对话。上一句 / 下一句可以逐句精读。
 */
export const SentenceAnalysisPanel: React.FC<SentenceAnalysisPanelProps> = ({ passageId, sentences, index, onIndexChange, targets, onAddTarget, onClose }) => {
  const [tab, setTab] = useState<Tab>('analysis');
  const sentence = sentences[index];
  const key = `${passageId}:${index}`;
  const [state, setState] = useState<{ key: string; analysis?: SentenceAnalysis; error?: string; loading: boolean; refresh?: boolean }>({ key, loading: false });

  /** 加载这句的分析；`refresh` 重新分析。失败时保留已有的分析，只提示原因 */
  const load = async (refresh: boolean) => {
    const k = key;
    setState({ key: k, loading: true, analysis: store.get(k), refresh });
    const flightKey = `${k}:${refresh ? 'r' : ''}`;
    let request = inflight.get(flightKey);
    if (!request) {
      request = passageService.analyzeSentence({ passageId, sentenceIndex: index, refresh });
      inflight.set(flightKey, request);
      void request.finally(() => inflight.delete(flightKey));
    }
    const result = await request;
    if (result.success) store.set(k, result.data);
    setState((prev) =>
      prev.key !== k ? prev : result.success ? { key: k, loading: false, analysis: result.data } : { key: k, loading: false, analysis: store.get(k), error: result.error, refresh }
    );
  };

  useEffect(() => {
    const kept = store.get(key);
    if (kept) setState({ key, loading: false, analysis: kept });
    else void load(false);
    // 换句时加载；load 依赖的值都在 key 里
  }, [key]);

  // Esc 关闭：输入框里、已被其它浮层处理（选词气泡、下拉、弹窗）时不关
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!sentence) return null;
  /** 已经是目标词（含变形：gave up 与 give up 视为同一个） */
  const isTarget = (w: string) => !canAddTarget(w, targets);
  const current = state.key === key ? state : { key, loading: true };

  return createPortal(
    <Card className="fixed top-[calc(3rem+0.75rem)] right-3 bottom-3 z-30 w-[400px] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden py-0 shadow-xl duration-200 animate-in fade-in slide-in-from-right-4">
      <header className="space-y-2 border-b px-4 pt-3 pb-2">
        <div className="flex items-center gap-1">
          <ScanText className="size-4 text-primary" />
          <span className="flex-1 text-sm font-medium">句子分析</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {index + 1} / {sentences.length}
          </span>
          <Button variant="ghost" size="icon" className="size-7" aria-label="上一句" disabled={index === 0} onClick={() => onIndexChange(index - 1)}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label="下一句" disabled={index >= sentences.length - 1} onClick={() => onIndexChange(index + 1)}>
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label="关闭句子分析" onClick={onClose}>
            <X />
          </Button>
        </div>
        <p className="text-[15px] leading-snug font-medium select-text">{sentence.en}</p>
        {sentence.zh && <p className="text-sm text-muted-foreground select-text">{sentence.zh}</p>}
        <div className="inline-flex gap-0.5 rounded-lg bg-muted p-[3px]" role="tablist" aria-label="句子分析">
          {(
            [
              ['analysis', '分析', ScanText],
              ['teacher', '问老师', GraduationCap],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                tab === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </header>

      {tab === 'analysis' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" role="tabpanel">
          {current.error && current.analysis && (
            <InlineError className="mb-4" title={current.refresh ? '无法重新分析' : '无法分析这句'}>
              {current.error}
            </InlineError>
          )}
          {current.analysis ? (
            <AnalysisView analysis={current.analysis} isTarget={isTarget} onAddTarget={onAddTarget} onRefresh={() => void load(true)} refreshing={current.loading} />
          ) : current.error ? (
            <InlineError
              title="无法分析这句"
              actions={
                <Button variant="outline" size="sm" className="h-7" onClick={() => void load(current.refresh ?? false)}>
                  再试一次
                </Button>
              }
            >
              {current.error}
            </InlineError>
          ) : (
            <AiWorking key={key} title="AI 正在分析这句话" />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 pt-4 pb-4" role="tabpanel">
          <WordExplanationView key={key} wordId={sentenceChatId(passageId, index)} word={sentence.en} active fill sentence />
        </div>
      )}
    </Card>,
    document.body
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
    {children}
  </section>
);

const AnalysisView: React.FC<{
  analysis: SentenceAnalysis;
  isTarget: (word: string) => boolean;
  onAddTarget?: (word: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}> = ({ analysis: a, isTarget, onAddTarget, onRefresh, refreshing }) => (
  <div className={cn('space-y-5 text-sm select-text', refreshing && 'opacity-60')}>
    <Section title="句式">
      <div className="rounded-lg bg-accent px-3 py-2 font-medium text-accent-foreground">{a.pattern}</div>
      {a.patternNote && <p className="leading-relaxed text-muted-foreground">{a.patternNote}</p>}
    </Section>

    {a.chunks.length > 0 && (
      <Section title="成分">
        <div className="flex flex-wrap gap-1.5">
          {a.chunks.map((c, i) => (
            <span key={i} className="inline-flex flex-col rounded-md border px-2 py-1">
              <span>{c.text}</span>
              <span className="text-xs text-muted-foreground">{c.role}</span>
            </span>
          ))}
        </div>
      </Section>
    )}

    {a.grammar.length > 0 && (
      <Section title="语法点">
        <ul className="space-y-2">
          {a.grammar.map((g, i) => (
            <li key={i} className="space-y-0.5">
              <div className="font-medium">
                {g.title}
                {g.text && <span className="ml-1.5 font-normal text-muted-foreground">「{g.text}」</span>}
              </div>
              <p className="leading-relaxed text-muted-foreground">{g.explanation}</p>
            </li>
          ))}
        </ul>
      </Section>
    )}

    <Section title="交际功能">
      <div className="font-medium">{a.function}</div>
      {a.functionNote && <p className="leading-relaxed text-muted-foreground">{a.functionNote}</p>}
      {a.alternatives.length > 0 && (
        <ul className="space-y-1.5 border-l-2 pl-3">
          {a.alternatives.map((x, i) => (
            <li key={i}>
              <div>{x.en}</div>
              <div className="text-xs text-muted-foreground">{x.zh}</div>
            </li>
          ))}
        </ul>
      )}
    </Section>

    {a.phrases.length > 0 && (
      <Section title="词组">
        <ul className="divide-y rounded-lg border">
          {a.phrases.map((p) => (
            <li key={p.base} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.base}</div>
                <div className="text-xs text-muted-foreground">{p.meaning}</div>
              </div>
              {isTarget(p.base) ? (
                <Badge variant="secondary">目标词</Badge>
              ) : (
                onAddTarget && (
                  <Button variant="outline" size="sm" className="h-7" onClick={() => onAddTarget(p.base)}>
                    <Plus />
                    加入目标词
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      </Section>
    )}

    {a.pronunciation.length > 0 && (
      <Section title="发音要点">
        <ul className="space-y-1.5">
          {a.pronunciation.map((p, i) => (
            <li key={i}>
              <span className="font-medium">{p.text}</span>
              <span className="ml-1.5 text-muted-foreground">{p.tip}</span>
            </li>
          ))}
        </ul>
      </Section>
    )}

    <div className="flex justify-end">
      <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={cn(refreshing && 'animate-spin')} />
        重新分析
      </Button>
    </div>
  </div>
);
