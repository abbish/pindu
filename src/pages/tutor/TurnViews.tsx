import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, Check, ChevronRight, CircleAlert, FileText, GraduationCap, ListChecks, Loader2, Plus } from 'lucide-react';
import { JobProgress } from '@/components/Jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useJobActions } from '@/components/Jobs/useJobActions';
import { useJob } from '@/hooks/useJobs';
import { isJobActive, type Job } from '@/types/job';
import { cn } from '@/lib/utils';
import type { NavigateFn } from '@/navigation';
import type { StepOutput, TutorAsk, ViewItem, ViewStep, ViewTurn } from '@/utils/tutorTranscript';

const OUTPUT_ICON: Record<StepOutput['kind'], React.ComponentType<{ className?: string }>> = {
  wordbook: BookOpen,
  passage: FileText,
  questions: ListChecks,
  words: Plus,
};

const OUTPUT_LABEL: Record<StepOutput['kind'], string> = {
  wordbook: '词汇本',
  passage: '短文',
  questions: '题组',
  words: '词汇',
};

/** 打开收进来的素材（词汇：所在词汇本；题组：所属短文） */
export function openOutput(output: StepOutput, onNavigate: NavigateFn) {
  if (output.id === undefined) return;
  if (output.kind === 'wordbook' || output.kind === 'words') onNavigate('wordbook-detail', { id: output.id });
  else onNavigate('passage-detail', { passageId: output.id, tab: output.kind === 'questions' ? 'sets' : undefined });
}

export const UserBubble: React.FC<{ turn: Extract<ViewTurn, { role: 'user' }> }> = ({ turn }) => (
  <div className={cn('flex flex-col items-end gap-1.5', turn.pending && 'opacity-70')}>
    {turn.images.length > 0 && (
      <div className="flex flex-wrap justify-end gap-1.5">
        {turn.images.map((src, i) => (
          <img key={i} src={src} alt="图片" className="max-h-48 max-w-64 rounded-md border object-cover" />
        ))}
      </div>
    )}
    {turn.files.length > 0 && (
      <div className="flex flex-wrap justify-end gap-1.5">
        {turn.files.map((name) => (
          <span key={name} className="inline-flex max-w-56 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs" title={name}>
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
          </span>
        ))}
      </div>
    )}
    {turn.text && (
      <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2 text-sm whitespace-pre-wrap text-primary-foreground select-text">
        {turn.text}
      </div>
    )}
  </div>
);

export const AgentTurnView: React.FC<{
  turn: Extract<ViewTurn, { role: 'agent' }>;
  ask: TutorAsk | null;
  notice: string | null;
  onAnswer: (reply: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
  /** 最后一轮回答完后显示推荐下一步，点一下就发 */
  onSuggest?: (text: string) => void;
  onNavigate: NavigateFn;
}> = ({ turn, ask, notice, onAnswer, onSuggest, onNavigate }) => {
  const outputs = turn.steps.flatMap((s) => (s.output ? [s.output] : []));
  return (
    <div className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <GraduationCap className="size-4" />
      </span>
      {/* pt-1：第一行文字（约 20px 高）与 28px 的头像居中对齐 */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        <TurnItems turn={turn} />
        {thinking(turn) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {notice ?? '正在思考…'}
          </div>
        )}

        {ask && <AskCard ask={ask} onAnswer={onAnswer} />}

        {outputs.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {outputs.map((o, i) => (
              <OutputCard key={`${o.kind}-${o.id ?? i}`} output={o} onNavigate={onNavigate} />
            ))}
          </div>
        )}

        {turn.error && (
          <div className="flex items-start gap-1.5 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>没能回答完：{turn.error}</span>
          </div>
        )}
        {turn.stopped && <div className="text-xs text-muted-foreground">已停止</div>}
        {onSuggest && !turn.running && !ask && turn.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {turn.suggestions.map((text) => (
              <Button key={text} size="sm" variant="outline" className="h-auto rounded-full py-1 font-normal" onClick={() => onSuggest(text)}>
                {text}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 一轮的内容。运行中按顺序全部显示；结束后，最后一段回答之前的过程（工具调用与中途说的话）
 * 收成一行「处理了 N 步 · 用时 X 秒」，点开再看，只把最后的回答留在外面。
 */
const TurnItems: React.FC<{ turn: Extract<ViewTurn, { role: 'agent' }> }> = ({ turn }) => {
  const [open, setOpen] = useState(false);
  const lastSteps = turn.items.map((i) => i.kind).lastIndexOf('steps');
  const collapsible = !turn.running && lastSteps >= 0;
  const process = collapsible ? turn.items.slice(0, lastSteps + 1) : [];
  const shown = collapsible ? turn.items.slice(lastSteps + 1) : turn.items;
  const failed = process.some((i) => i.kind === 'steps' && i.steps.some((s) => s.status === 'error'));
  const render = (item: ViewItem, last: boolean) =>
    item.kind === 'text' ? (
      <div key={item.key} className={cn('markdown-body select-text', turn.running && last && 'markdown-streaming')}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
      </div>
    ) : (
      <StepList key={item.key} steps={item.steps} />
    );
  return (
    <>
      {collapsible && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            {failed ? <CircleAlert className="size-3.5 text-destructive" /> : <Check className="size-3.5" />}
            <span>
              处理了 {turn.steps.length} 步{turn.seconds ? ` · 用时 ${formatSeconds(turn.seconds)}` : ''}
            </span>
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
          {open && <div className="flex flex-col gap-3">{process.map((item) => render(item, false))}</div>}
        </div>
      )}
      {shown.map((item, i) => render(item, i === shown.length - 1))}
    </>
  );
};

/** 用时：不到 1 分钟写秒，否则写几分几秒 */
function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

/** 正在等模型想下一步：还没有内容，或者最后一组工具都做完了（说话时正文在流式显示，不用另外提示） */
function thinking(turn: Extract<ViewTurn, { role: 'agent' }>): boolean {
  if (!turn.running) return false;
  const last = turn.items[turn.items.length - 1];
  return !last || (last.kind === 'steps' && last.steps.every((s) => s.status !== 'running'));
}

/** 连着的几步工具调用：按顺序一行一条，进行中转圈，做完打勾 */
const StepList: React.FC<{ steps: ViewStep[] }> = ({ steps }) => (
  <ol className="flex flex-col gap-1 border-l-2 border-border pl-3">
    {steps.map((step) => (
      <StepRow key={step.id} step={step} />
    ))}
  </ol>
);

const StepRow: React.FC<{ step: ViewStep }> = ({ step }) => {
  const [open, setOpen] = useState(false);
  const running = step.status === 'running';
  const Icon = running ? Loader2 : step.status === 'error' ? CircleAlert : Check;
  return (
    <li className="text-sm">
      <button
        type="button"
        disabled={!step.detail}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 py-0.5 text-left text-muted-foreground disabled:cursor-default"
      >
        <Icon
          className={cn(
            'mt-0.5 size-3.5 shrink-0',
            running && 'animate-spin',
            step.status === 'error' && 'text-destructive'
          )}
        />
        <span className={cn('flex-1', step.status === 'error' && 'text-destructive')}>
          {step.label}
          {running && '…'}
        </span>
        {step.detail && <ChevronRight className={cn('mt-0.5 size-3.5 transition-transform', open && 'rotate-90')} />}
      </button>
      {open && step.detail && <div className="ml-5.5 py-1 text-xs whitespace-pre-wrap text-muted-foreground select-text">{step.detail}</div>}
    </li>
  );
};

/** 工具向用户的提问：选择 / 确认 / 输入 */
const AskCard: React.FC<{
  ask: TutorAsk;
  onAnswer: (reply: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}> = ({ ask, onAnswer }) => {
  const [value, setValue] = useState('');
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm">{ask.title}</div>
      {ask.message && <div className="mt-1 text-sm text-muted-foreground">{ask.message}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        {ask.method === 'select' &&
          ask.options.map((o) => (
            <Button key={o} size="sm" variant="outline" onClick={() => onAnswer({ value: o })}>
              {o}
            </Button>
          ))}
        {ask.method === 'confirm' && (
          <>
            <Button size="sm" onClick={() => onAnswer({ confirmed: true })}>
              好的
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAnswer({ confirmed: false })}>
              不用
            </Button>
          </>
        )}
        {ask.method === 'input' && (
          <form
            className="flex w-full gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) onAnswer({ value: value.trim() });
            }}
          >
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={ask.placeholder} className="h-8" autoFocus />
            <Button size="sm" type="submit" disabled={!value.trim()}>
              回复
            </Button>
          </form>
        )}
        {ask.method !== 'confirm' && (
          <Button size="sm" variant="ghost" onClick={() => onAnswer({ cancelled: true })}>
            跳过
          </Button>
        )}
      </div>
    </div>
  );
};

/** 后台任务做完后的说法（词汇本、词汇的拼读分析做完不用另说） */
const DONE_TEXT: Partial<Record<StepOutput['kind'], string>> = {
  passage: '已写好',
  questions: '已出好',
};

/** 后台任务写好的短文（job.detail.items 里的第一篇） */
function jobPassage(job: Job | undefined): { id: number; title?: string } | null {
  const items = (job?.detail as { items?: { passageId?: number | null; title?: string | null }[] } | null)?.items;
  const done = items?.find((i) => typeof i.passageId === 'number');
  return done ? { id: done.passageId as number, title: done.title ?? undefined } : null;
}

const OutputCard: React.FC<{ output: StepOutput; onNavigate: NavigateFn }> = ({ output: given, onNavigate }) => {
  const Icon = OUTPUT_ICON[given.kind];
  const job = useJob(given.jobId);
  const jobActions = useJobActions(onNavigate);
  // 短文在后台写好 / 存好后才有 id 与标题
  const written = given.kind === 'passage' ? jobPassage(job) : null;
  const output = written ? { ...given, id: given.id ?? written.id, title: written.title || given.title } : given;
  const failed = job?.status === 'failed' || job?.status === 'cancelled';
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{output.title}</div>
        {output.meta && <div className="truncate text-xs text-muted-foreground">{output.meta}</div>}
        {/* 状态跟着后台任务走（工具结果只写素材本身的信息） */}
        {job?.status === 'succeeded' && DONE_TEXT[output.kind] && (
          <div className="truncate text-xs text-muted-foreground">{DONE_TEXT[output.kind]}</div>
        )}
        {job && isJobActive(job) && (
          <div className="mt-2">
            <JobProgress job={job} />
          </div>
        )}
        {failed && <div className="mt-1 text-xs text-destructive">{job?.status === 'cancelled' ? '已停止' : '没能完成'}</div>}
      </div>
      {output.id !== undefined ? (
        <Button size="sm" variant="ghost" onClick={() => openOutput(output, onNavigate)}>
          打开
        </Button>
      ) : (
        job?.status === 'succeeded' &&
        job.link && (
          <Button size="sm" variant="ghost" onClick={() => jobActions.open(job)}>
            打开
          </Button>
        )
      )}
    </div>
  );
};

/** 顶栏：这段对话收进来的素材 */
export const OutputsPopover: React.FC<{ outputs: StepOutput[]; onNavigate: NavigateFn }> = ({ outputs, onNavigate }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button size="sm" variant="ghost">
        <BookOpen /> 收进 {outputs.length} 份素材
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-72 p-1">
      {outputs.map((o, i) => {
        const Icon = OUTPUT_ICON[o.kind];
        return (
          <button
            key={`${o.kind}-${o.id ?? i}`}
            type="button"
            onClick={() => openOutput(o, onNavigate)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <Icon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{o.title}</span>
            <span className="text-xs text-muted-foreground">{OUTPUT_LABEL[o.kind]}</span>
          </button>
        );
      })}
    </PopoverContent>
  </Popover>
);
