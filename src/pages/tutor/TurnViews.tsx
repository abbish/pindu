import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Ban, Bell, BookOpen, CalendarCheck, Check, ChevronRight, CircleAlert, FileText, GraduationCap, ListChecks, Loader2, Plus, RotateCcw } from 'lucide-react';
import { JobProgress } from '@/components/Jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useJobActions } from '@/components/Jobs/useJobActions';
import { useJob } from '@/hooks/useJobs';
import { useSmoothText } from '@/hooks/useSmoothText';
import { isJobActive, type Job } from '@/types/job';
import { cn } from '@/lib/utils';
import type { NavigateFn } from '@/navigation';
import { type StepOutput, type TutorAsk, type ViewItem, type ViewStep, type ViewTurn } from '@/utils/tutorTranscript';

const OUTPUT_ICON: Record<StepOutput['kind'], React.ComponentType<{ className?: string }>> = {
  wordbook: BookOpen,
  passage: FileText,
  questions: ListChecks,
  words: Plus,
  plan: CalendarCheck,
};

const OUTPUT_LABEL: Record<StepOutput['kind'], string> = {
  wordbook: '词汇本',
  passage: '短文',
  questions: '题组',
  words: '词汇',
  plan: '学习计划',
};

/** 打开收进来的素材（词汇：所在词汇本；题组：所属短文） */
export function openOutput(output: StepOutput, onNavigate: NavigateFn) {
  if (output.id === undefined) return;
  if (output.kind === 'plan') onNavigate('plan-detail', { planId: output.id });
  else if (output.kind === 'wordbook' || output.kind === 'words') onNavigate('wordbook-detail', { id: output.id });
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

/** 系统提示（后台任务结束等）：居中的一行小字 */
export const NoticeRow: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center gap-3 text-xs text-muted-foreground">
    <div className="h-px flex-1 bg-border" />
    <span className="flex max-w-[80%] items-center gap-1.5">
      <Bell className="size-3.5 shrink-0" />
      <span className="truncate" title={text}>
        {text}
      </span>
    </span>
    <div className="h-px flex-1 bg-border" />
  </div>
);

export const AgentTurnView: React.FC<{
  turn: Extract<ViewTurn, { role: 'agent' }>;
  ask: TutorAsk | null;
  /** 排队的提问数（含 ask） */
  askCount?: number;
  notice: string | null;
  onAnswer: (reply: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
  onExpireAsk?: (id: string) => void;
  /** 最后一轮回答完后显示推荐下一步，点一下就发 */
  onSuggest?: (text: string) => void;
  onNavigate: NavigateFn;
}> = ({ turn, ask, askCount = 1, notice, onAnswer, onExpireAsk, onSuggest, onNavigate }) => {
  const outputs = turn.steps.flatMap((s) => (s.output ? [s.output] : []));
  return (
    <div className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <GraduationCap className="size-4" />
      </span>
      {/* pt-1：第一行文字（约 20px 高）与 28px 的头像居中对齐 */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        <TurnItems turn={turn} />

        {ask && <AskCard key={ask.id} ask={ask} total={askCount} onAnswer={onAnswer} onExpire={onExpireAsk ?? (() => {})} />}

        {outputs.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {outputs.map((o, i) => (
              <OutputCard key={`${o.kind}-${o.id ?? i}`} output={o} onNavigate={onNavigate} />
            ))}
          </div>
        )}

        {/* 最下面：还在做（等学习者回答时由提问卡片接手） */}
        {turn.running && !ask && <WorkingIndicator label={notice ?? workingLabel(turn)} />}

        {turn.error !== undefined && <TurnError raw={turn.error} />}
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

const REMARK_PLUGINS = [remarkGfm];

/** Markdown 正文：文字没变就不重新解析（流式时只有正在写的那段在变） */
const Markdown = React.memo<{ text: string }>(({ text }) => <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown>);

/** 正在写的那段：逐帧平滑追上模型输出 */
const StreamingMarkdown: React.FC<{ text: string }> = ({ text }) => <Markdown text={useSmoothText(text, true)} />;

/**
 * 一轮的内容：最上面一行标题，下面是工作过程（工具调用与中途说的话），最后的回答在外面。
 * - 进行中：「处理中 · 已用 X」，过程默认展开、按顺序往下长；
 * - 结束后：「处理了 N 步 · 用时 X」，过程默认收起，只留最后的回答。没调用工具的一轮不显示标题。
 * 学习者点标题展开 / 收起后按他的来。
 */
const TurnItems: React.FC<{ turn: Extract<ViewTurn, { role: 'agent' }> }> = ({ turn }) => {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? turn.running;
  const lastSteps = turn.items.map((i) => i.kind).lastIndexOf('steps');
  const hasProcess = lastSteps >= 0;
  const process = hasProcess ? turn.items.slice(0, lastSteps + 1) : [];
  const shown = hasProcess ? turn.items.slice(lastSteps + 1) : turn.items;
  const failed = process.some((i) => i.kind === 'steps' && i.steps.some((s) => s.status === 'error'));
  const render = (item: ViewItem, last: boolean) =>
    item.kind === 'text' ? (
      <div key={item.key} className={cn('markdown-body select-text', turn.running && last && 'markdown-streaming')}>
        {turn.running && last ? <StreamingMarkdown text={item.text} /> : <Markdown text={item.text} />}
      </div>
    ) : (
      <StepList key={item.key} steps={item.steps} />
    );
  const title = turn.running ? (
    <RunningTitle startedAt={turn.startedAt} />
  ) : (
    <span>
      处理了 {turn.steps.length} 步{turn.seconds ? ` · 用时 ${formatSeconds(turn.seconds)}` : ''}
    </span>
  );
  return (
    <>
      {(hasProcess || turn.running) && (
        <div className="flex flex-col gap-3">
          {hasProcess ? (
            <button
              type="button"
              onClick={() => setUserOpen(!open)}
              className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              aria-expanded={open}
            >
              {failed && <CircleAlert className="size-3.5 text-destructive" />}
              {title}
              <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
            </button>
          ) : (
            <div className="text-sm text-muted-foreground">{title}</div>
          )}
          {open && process.length > 0 && <div className="flex flex-col gap-3">{process.map((item) => render(item, false))}</div>}
        </div>
      )}
      {shown.map((item, i) => render(item, i === shown.length - 1))}
    </>
  );
};

/** 进行中的标题：「处理中 · 已用 X」，每秒更新；开始时刻未知（消息还没确认）时从显示出来算起 */
const RunningTitle: React.FC<{ startedAt?: number }> = ({ startedAt }) => {
  const [since] = useState(() => startedAt ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - (startedAt ?? since)) / 1000));
  return <span className="tabular-nums">处理中 · 已用 {formatSeconds(seconds)}</span>;
};

/** 最下面的「正在做」：三个依次闪动的点 + 扫过一道光的说明 */
const WorkingIndicator: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center gap-2 text-sm" role="status">
    <span className="typing-dots flex items-center gap-0.5" aria-hidden>
      <span />
      <span />
      <span />
    </span>
    <span className="text-shimmer">{label}</span>
  </div>
);

/** 正在做什么：在调用工具 / 在写回答 / 在想下一步 */
function workingLabel(turn: Extract<ViewTurn, { role: 'agent' }>): string {
  const last = turn.items[turn.items.length - 1];
  if (last?.kind === 'text') return '正在回答';
  if (last?.kind === 'steps' && last.steps.some((s) => s.status === 'running')) return '正在处理';
  return '正在思考';
}

/** 用时：不到 1 分钟写秒，否则写几分几秒 */
function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

/**
 * 这一轮最终没回答出来（pi 已按它的规则自动重试过）：不猜原因，原始报错放在「查看原因」里
 */
const TurnError: React.FC<{ raw: string }> = ({ raw }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-start gap-1.5 text-destructive">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <span className="flex-1">
          AI 老师这次没能回答完，可以再试一次。经常出现时，可以在「设置 → AI 任务」给「AI 老师对话」换一个模型。
        </span>
      </div>
      {raw && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ml-5.5 flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          查看原因
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        </button>
      )}
      {open && <div className="ml-5.5 text-xs break-all whitespace-pre-wrap text-muted-foreground select-text">{raw}</div>}
    </div>
  );
};

/** 连着的几步工具调用：按顺序一行一条，进行中转圈，做完打勾 */
const StepList: React.FC<{ steps: ViewStep[] }> = ({ steps }) => (
  <ol className="flex flex-col gap-1 border-l-2 border-border pl-3">
    {steps.map((step) => (
      <StepRow key={step.id} step={step} />
    ))}
  </ol>
);

/** 步骤状态的图标：只有真正出错的是红色；核对后改写、没有改动（没同意 / 只查看 / 停止）是普通的灰色 */
const STEP_ICON: Record<ViewStep['status'], React.ComponentType<{ className?: string }>> = {
  running: Loader2,
  done: Check,
  error: CircleAlert,
  revised: RotateCcw,
  skipped: Ban,
};

const StepRow: React.FC<{ step: ViewStep }> = ({ step }) => {
  const [open, setOpen] = useState(false);
  const running = step.status === 'running';
  const Icon = running ? Loader2 : STEP_ICON[step.status];
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
  /** 还有几个提问在排队（含这一个） */
  total: number;
  onAnswer: (reply: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
  onExpire: (id: string) => void;
}> = ({ ask, total, onAnswer, onExpire }) => {
  const [value, setValue] = useState(ask.prefill ?? '');
  // 带超时的提问：过期后 pi 已按默认值收回
  useEffect(() => {
    if (!ask.expiresAt) return;
    const timer = window.setTimeout(() => onExpire(ask.id), Math.max(0, ask.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [ask.id, ask.expiresAt, onExpire]);
  const submit = () => value.trim() && onAnswer({ value: ask.method === 'editor' ? value : value.trim() });
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 text-sm">{ask.title}</div>
        {total > 1 && <span className="shrink-0 text-xs text-muted-foreground">还有 {total - 1} 个问题</span>}
      </div>
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
              确定
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAnswer({ confirmed: false })}>
              取消
            </Button>
          </>
        )}
        {ask.method === 'input' && (
          <form
            className="flex w-full gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={ask.placeholder} className="h-8" autoFocus />
            <Button size="sm" type="submit" disabled={!value.trim()}>
              回复
            </Button>
          </form>
        )}
        {ask.method === 'editor' && (
          <div className="flex w-full flex-col gap-2">
            <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={4} className="text-sm" autoFocus />
            <Button size="sm" className="self-end" onClick={submit} disabled={!value.trim()}>
              回复
            </Button>
          </div>
        )}
        {ask.method !== 'confirm' && (
          <Button size="sm" variant="ghost" onClick={() => onAnswer({ cancelled: true })}>
            跳过
          </Button>
        )}
      </div>
      {ask.method === 'select' && <div className="mt-2 text-xs text-muted-foreground">都不合适？直接在下面输入你的回答。</div>}
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
