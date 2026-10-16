import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, GraduationCap, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconToggle } from '@/components/IconToggle';
import { Card } from '@/components/ui/card';
import { InlineError } from '@/components/InlineError';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { dropUnpairedBold } from '@/utils/markdownText';
import { passageService } from '@/services/passageService';

/**
 * 正在生成的讲解（按片段，放在模块里）：生成中切到别的页签、组件被卸载后再回来，接着显示这一次，不重新生成。
 * 增量由一个常驻的监听记进 `text`，回来时先显示已经写好的部分。
 */
const inflight = new Map<number, { requestId: string; text: string; promise: ReturnType<typeof passageService.generateClipGuide> }>();
let deltaListening = false;
function listenDeltas() {
  if (deltaListening) return;
  deltaListening = true;
  passageService
    .onClipGuideDelta(({ passageId, requestId, delta }) => {
      const run = inflight.get(passageId);
      if (run && run.requestId === requestId) run.text += delta;
    })
    .catch(() => {
      deltaListening = false;
    });
}

/** 这个片段正在生成的讲解；没有就开始生成 */
function startGenerating(passageId: number) {
  const running = inflight.get(passageId);
  if (running) return running;
  listenDeltas();
  const requestId = `${passageId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const run = { requestId, text: '', promise: passageService.generateClipGuide(passageId, requestId) };
  inflight.set(passageId, run);
  void run.promise.finally(() => {
    if (inflight.get(passageId) === run) inflight.delete(passageId);
  });
  return run;
}

type State = { status: 'loading' } | { status: 'generating'; content: string } | { status: 'ready'; content: string } | { status: 'error'; error: string };

/**
 * 场景片段的内容精讲（AI 生成：先讲全貌，再逐段讲清内容，背景、句式、词汇穿插在讲到的地方，最后回顾）。
 * 已有讲解直接显示；还没有时打开就开始生成（流式显示，生成后保存）；可以重新生成；标题栏可以唤出 AI 老师围绕这段聊。
 */
export const ClipGuide = React.memo<{
  passageId: number;
  /** AI 老师（围绕这个片段聊）开着没有、开关 */
  teacherOpen: boolean;
  onTeacher: (open: boolean) => void;
}>(function ClipGuide({ passageId, teacherOpen, onTeacher }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  /** 当前生成请求；增量与结果只认这一次 */
  const requestRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    passageService
      .onClipGuideDelta(({ requestId, delta }) => {
        if (requestId !== requestRef.current) return;
        setState((s) => (s.status === 'generating' ? { status: 'generating', content: s.content + delta } : s));
      })
      .then((fn) => {
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

  /** 生成（已经在生成就接着这一次） */
  const generate = useCallback(async () => {
    const run = startGenerating(passageId);
    const requestId = run.requestId;
    requestRef.current = requestId;
    setState({ status: 'generating', content: run.text });
    const r = await run.promise;
    if (requestRef.current !== requestId) return;
    requestRef.current = null;
    setState(r.success ? { status: 'ready', content: r.data.content } : { status: 'error', error: r.error });
  }, [passageId]);

  useEffect(() => {
    let alive = true;
    requestRef.current = null;
    setState({ status: 'loading' });
    void passageService.getClipGuide(passageId).then((r) => {
      if (!alive) return;
      if (!r.success) return setState({ status: 'error', error: r.error });
      // 正在生成（刚才切走了）：接着显示；有就显示；都没有才开始生成
      if (inflight.has(passageId)) void generate();
      else if (r.data) setState({ status: 'ready', content: r.data.content });
      else void generate();
    });
    return () => {
      alive = false;
      requestRef.current = null;
    };
  }, [passageId, generate]);

  const busy = state.status === 'loading' || state.status === 'generating';
  return (
    <Card className="gap-3 px-6 py-5">
      <div className="flex items-center gap-2">
        <BookOpen className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">内容讲解</h2>
        {state.status === 'generating' && <span className="text-xs text-muted-foreground">正在生成…</span>}
        <span className="ml-auto" />
        <IconToggle label="AI 老师：聊聊这段" pressed={teacherOpen} onPressedChange={onTeacher}>
          <GraduationCap />
        </IconToggle>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="重新生成" disabled={busy} onClick={() => void generate()}>
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>重新生成</TooltipContent>
        </Tooltip>
      </div>
      {state.status === 'error' ? (
        <InlineError
          title="无法生成讲解"
          actions={
            <Button variant="outline" size="sm" onClick={() => void generate()}>
              重试
            </Button>
          }
        >
          {state.error}
        </InlineError>
      ) : (state.status === 'loading' || state.status === 'generating') && !('content' in state && state.content) ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : (
        <div className={cn('markdown-body text-sm select-text', state.status === 'generating' && 'markdown-streaming')}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{dropUnpairedBold('content' in state ? state.content : '')}</ReactMarkdown>
        </div>
      )}
    </Card>
  );
});
