import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Loader2,
  Merge,
  RotateCw,
  Scissors,
  Sparkles,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { InlineError } from '@/components/InlineError';
import { MaterialInput } from '@/components/MaterialInput';
import { CollectWordsCard } from './passage-import/CollectWordsCard';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Stepper } from '@/components/Stepper/Stepper';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { useMaterialSettings } from '@/hooks/useMaterialSettings';
import { passageService } from '@/services/passageService';
import { wordBookService } from '@/services/wordbookService';
import { jobService } from '@/services/jobService';
import { toUserMessage } from '@/api/errors';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { JobPanel } from '@/components/Jobs';
import { isJobActive } from '@/types/job';
import {
  lengthHint,
  mergeWithPrevious,
  renameItem,
  splitAt,
} from '@/utils/passageImport';
import type { ImportPreview, ImportPreviewItem, PassageItemStatus } from '@/types/passage';
import type { NavigateFn } from '@/navigation';

export interface ImportPassagePageProps {
  onNavigate?: NavigateFn;
}

const STEPS = ['材料', '预览与拆分', '导入'];
const LENGTHS = [
  { value: 150, label: '短', hint: '约 150 词' },
  { value: 300, label: '标准', hint: '约 300 词' },
  { value: 450, label: '长', hint: '约 450 词' },
];
const COLLAPSED_SENTENCES = 3;
const segmentItem = 'h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm';

type ItemState = { state: 'waiting' | 'running' | 'cancelled' } | { state: 'done'; passageId: number; title: string } | { state: 'failed'; error: string };

/** 预览里的一篇（带稳定 key，便于合并 / 拆开后保持展开状态） */
type DraftItem = ImportPreviewItem & { key: string };

let keySeq = 0;
const withKey = (it: ImportPreviewItem): DraftItem => ({ ...it, key: `i${++keySeq}` });

/**
 * 导入我的材料（passage-import B3）：粘贴或选文件 → 预览与拆分（清理、分句、拆篇由后端确定性完成，用户可合并 / 拆开 / 改标题）
 * → 逐篇导入（AI 只逐句翻译、起标题、估水平、挑重点词，原文一字不改）。
 */
export const ImportPassagePage: React.FC<ImportPassagePageProps> = ({ onNavigate }) => {
  const toast = useToast();
  const [step, setStep] = useState(0);

  // ① 材料
  const [text, setText] = useState('');
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [targetWords, setTargetWords] = useState(300);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);

  // ② 预览
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [books, setBooks] = useState<{ id: number; title: string; words: number }[] | null>(null);
  const [bookIds, setBookIds] = useState<number[]>([]);
  const [aiKeyWords, setAiKeyWords] = useState(true);
  // 拆篇长度与挑重点词的默认值来自「设置 → 素材」
  const materialSettings = useMaterialSettings();
  useEffect(() => {
    if (!materialSettings) return;
    setTargetWords(materialSettings.importTargetWords);
    setAiKeyWords(materialSettings.importKeyWords);
  }, [materialSettings]);

  // ③ 导入
  /** 导入的后台任务：每次提交导入哪几篇（预览里的序号）；重试没导入的是新的一次 */
  const [runs, setRuns] = useState<{ jobId: string; indexes: number[] }[]>([]);
  const jobs = useJobs();
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    wordBookService.getAllWordBooks().then((result) => {
      if (result.success) setBooks(result.data.filter((b) => b.status === 'normal' && b.total_words > 0).map((b) => ({ id: b.id, title: b.title, words: b.total_words })));
      else setBooks([]);
    });
  }, []);

  /** 逐篇状态：从后台任务的 detail 读；后提交的覆盖先提交的 */
  const statuses: ItemState[] | null = useMemo(() => {
    if (runs.length === 0) return null;
    const out: ItemState[] = items.map(() => ({ state: 'waiting' }));
    for (const run of runs) {
      const job = jobs.find((j) => j.id === run.jobId);
      const detail = (job?.detail as { items?: PassageItemStatus[] } | null)?.items;
      run.indexes.forEach((idx, k) => {
        const item = detail?.[k];
        if (item?.state === 'done' && item.passageId) out[idx] = { state: 'done', passageId: item.passageId, title: item.title ?? items[idx]?.title ?? '' };
        else if (item?.state === 'failed') out[idx] = { state: 'failed', error: toUserMessage(item.error ?? '') };
        else if (item?.state === 'running') out[idx] = { state: 'running' };
        else if (job && !isJobActive(job)) out[idx] = job.status === 'cancelled' ? { state: 'cancelled' } : { state: 'failed', error: '没有导入' };
        else out[idx] = { state: 'waiting' };
      });
    }
    return out;
  }, [runs, jobs, items]);

  // 这一次全部导入成功：提示一次（失败的在列表里显示原因）
  useOnJobFinished((job) => {
    const run = runs.find((r) => r.jobId === job.id);
    if (!run || job.status !== 'succeeded') return;
    const ids = (job.result as { passageIds?: number[] } | null)?.passageIds ?? [];
    if (ids.length === run.indexes.length) toast.showSuccess(`已导入 ${ids.length} 篇短文`);
  });

  const hasMaterial = text.trim().length > 0;
  const running = statuses !== null && statuses.some((s) => s.state === 'running' || s.state === 'waiting');
  /** 正在导入的那一批（最近提交的进行中任务） */
  const activeRunJob = [...runs].reverse().map((r) => jobs.find((j) => j.id === r.jobId)).find((j) => j && isJobActive(j));

  /** ① → ②：后端清理、分句、拆篇（文件已由 MaterialInput 读成文本，sourceLabel 为文件名） */
  const prepare = async () => {
    setPreparing(true);
    setPrepareError(null);
    const result = await passageService.prepareImport({ text, fileName: sourceLabel, targetWords });
    setPreparing(false);
    if (!result.success) return setPrepareError(result.error);
    setPreview(result.data);
    setItems(result.data.items.map(withKey));
    setExpanded(new Set());
    setStep(1);
  };

  /** 提交后台任务导入这几篇（预览里的序号）；离开页面也会继续 */
  const runImport = async (indexes: number[]) => {
    if (!preview) return;
    const started = await passageService.startImport({
      items: indexes.map((i) => ({
        title: items[i].title.trim() || null,
        sentences: items[i].sentences,
        sourceLabel: preview.sourceLabel,
        bookIds,
        aiKeyWords,
      })),
    });
    if (!started.success) {
      setStartError(started.error);
      return;
    }
    setStartError(null);
    setRuns((prev) => [...prev, { jobId: started.data, indexes }]);
  };

  const startImport = () => {
    setStep(2);
    runImport(items.map((_, i) => i));
  };

  const cancelImport = async () => {
    for (const run of runs) {
      const job = jobs.find((j) => j.id === run.jobId);
      if (job && isJobActive(job)) await jobService.cancel(job.id);
    }
  };

  const doneItems = (statuses ?? []).flatMap((s) => (s.state === 'done' ? [s] : []));
  const retryable = (statuses ?? []).flatMap((s, i) => (s.state === 'failed' || s.state === 'cancelled' ? [i] : []));

  const totalWords = items.reduce((n, it) => n + it.wordCount, 0);
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-7">
      <PageHeader
        title="导入短文"
      />
      <Stepper steps={STEPS} current={step} />

      {step === 0 && (
        <Card className="gap-5 p-6">
          <MaterialInput
            label="英文材料"
            text={text}
            onTextChange={setText}
            sourceLabel={sourceLabel}
            onSourceLabelChange={setSourceLabel}
            privacyNote
            autoFocus
            disabled={preparing}
          />

          <div className="flex items-center justify-between gap-4">
            <div className="text-sm font-medium">每篇多长</div>
            <ToggleGroup type="single" value={String(targetWords)} onValueChange={(v) => v && setTargetWords(Number(v))} className="rounded-lg bg-muted p-0.5" aria-label="每篇多长">
              {LENGTHS.map((l) => (
                <ToggleGroupItem key={l.value} value={String(l.value)} className={segmentItem}>
                  {l.label}
                  <span className="text-xs text-muted-foreground">{l.hint}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {prepareError && <InlineError title="无法整理这份材料">{prepareError}</InlineError>}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="ghost" onClick={() => onNavigate?.('passages')} disabled={preparing}>
              取消
            </Button>
            <Button onClick={prepare} disabled={!hasMaterial || preparing}>
              {preparing && <Loader2 className="animate-spin" />}
              {preparing ? '正在整理…' : '下一步'}
            </Button>
          </div>
        </Card>
      )}

      {step === 1 && preview && (
        <div className="flex flex-col gap-4">
          {preview.warnings.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <ul className="space-y-0.5">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <Card className="flex-row flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {items.length} 篇 · 共 {totalWords} 词
              </div>
              <div className="truncate text-xs text-muted-foreground">来源：{preview.sourceLabel}</div>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <BookOpen />
                  {bookIds.length > 0 ? `标出 ${bookIds.length} 本单词本里的词` : '从单词本标出目标词'}
                  <ChevronDown className="opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-2">
                {books === null ? (
                  <Loader2 className="mx-auto my-3 size-4 animate-spin text-muted-foreground" />
                ) : books.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">还没有带单词的单词本</p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto">
                    {books.map((b) => (
                      <li key={b.id}>
                        <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                          <Checkbox checked={bookIds.includes(b.id)} onCheckedChange={() => setBookIds((ids) => (ids.includes(b.id) ? ids.filter((x) => x !== b.id) : [...ids, b.id]))} />
                          <span className="min-w-0 flex-1 truncate">{b.title}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{b.words}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
            <label className="flex items-center gap-2 text-sm">
              <Sparkles className="size-4 text-primary" />
              AI 标出重点词
              <Switch checked={aiKeyWords} onCheckedChange={setAiKeyWords} aria-label="AI 标出重点词" />
            </label>
          </Card>

          <ol className="flex flex-col gap-3">
            {items.map((item, i) => {
              const open = expanded.has(item.key);
              const shown = open ? item.sentences : item.sentences.slice(0, COLLAPSED_SENTENCES);
              const hint = lengthHint(item.wordCount);
              return (
                <li key={item.key}>
                  <Card className="gap-3 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                      <Input
                        value={item.title}
                        onChange={(e) => setItems((prev) => renameItem(prev, i, e.target.value))}
                        placeholder="AI 起标题"
                        aria-label={`第 ${i + 1} 篇标题`}
                        className="h-8 flex-1 font-medium"
                        maxLength={120}
                      />
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {item.sentences.length} 句 · {item.wordCount} 词
                      </span>
                      {hint && (
                        <Badge variant="outline" className="shrink-0 border-transparent bg-warning-soft font-normal text-warning">
                          {hint === 'short' ? '偏短，可以合并' : '偏长，可以拆开'}
                        </Badge>
                      )}
                      {i > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setItems((prev) => mergeWithPrevious(prev, i))} title="和上一篇合成一篇">
                          <Merge />
                          合并到上一篇
                        </Button>
                      )}
                      {items.length > 1 && (
                        <Button variant="ghost" size="icon" className="size-8" aria-label="不导入这一篇" title="不导入这一篇" onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}>
                          <X />
                        </Button>
                      )}
                    </div>
                    <div className="space-y-0.5 pl-8 text-sm leading-relaxed">
                      {shown.map((s, j) => (
                        <div key={j} className={cn('group relative flex items-start gap-2 rounded-md px-2 py-0.5 hover:bg-muted/50', s.paragraph && j > 0 && 'mt-2')}>
                          <span className="min-w-0 flex-1 select-text">{s.en}</span>
                          {open && j > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 shrink-0 px-2 text-xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                              onClick={() => setItems((prev) => splitAt(prev, i, j))}
                            >
                              <Scissors />
                              从这里拆开
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    {item.sentences.length > COLLAPSED_SENTENCES && (
                      <Button variant="ghost" size="sm" className="self-start pl-8 text-muted-foreground" onClick={() => toggleExpanded(item.key)}>
                        {open ? <ChevronUp /> : <ChevronDown />}
                        {open ? '收起' : `展开全部 ${item.sentences.length} 句（可以从任意一句拆开）`}
                      </Button>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>

          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setStep(0)}>
              上一步
            </Button>
            <Button onClick={startImport} disabled={items.length === 0}>
              <Sparkles />
              导入 {items.length} 篇
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          {activeRunJob && <JobPanel job={activeRunJob} title="AI 正在导入材料" actions={{ stop: cancelImport, onBackground: () => onNavigate?.('passages') }} />}
          {startError && <InlineError title="无法开始导入">{startError}</InlineError>}
          {statuses && (
          <Card className="gap-0 divide-y p-0">
            {items.map((item, i) => {
              const st = statuses[i];
              return (
                <div key={item.key} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    {st.state === 'running' && <Loader2 className="size-4 animate-spin text-primary" />}
                    {st.state === 'done' && <Check className="size-4 text-success" />}
                    {st.state === 'failed' && <CircleAlert className="size-4 text-destructive" />}
                    {(st.state === 'waiting' || st.state === 'cancelled') && <span className="size-2 rounded-full bg-muted-foreground/30" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{st.state === 'done' ? st.title : item.title || `第 ${i + 1} 篇`}</div>
                    <div className={cn('text-xs text-muted-foreground', st.state === 'failed' && 'text-destructive')}>
                      {st.state === 'waiting' && `等待中 · ${item.wordCount} 词`}
                      {st.state === 'running' && '正在翻译、标出重点词'}
                      {st.state === 'done' && '已导入'}
                      {st.state === 'cancelled' && '已停止'}
                      {st.state === 'failed' && st.error}
                    </div>
                  </div>
                  {st.state === 'done' && (
                    <Button variant="outline" size="sm" onClick={() => onNavigate?.('passage-detail', { passageId: st.passageId })}>
                      打开
                    </Button>
                  )}
                </div>
              );
            })}
          </Card>
          )}

          {!running && doneItems.length > 0 && preview && (
            <CollectWordsCard
              passages={doneItems.map((d) => ({ passageId: d.passageId, title: d.title }))}
              sourceLabel={preview.sourceLabel}
              onOpenBook={(id) => onNavigate?.('wordbook-detail', { id })}
            />
          )}

          <div className="flex justify-end gap-2">
            {!running && (
              <>
                {retryable.length > 0 && (
                  <Button variant="outline" onClick={() => runImport(retryable)}>
                    <RotateCw />
                    重试没导入的 {retryable.length} 篇
                  </Button>
                )}
                <Button variant={doneItems.length === 1 ? 'outline' : 'default'} onClick={() => onNavigate?.('passages')}>
                  回到短文库
                </Button>
                {doneItems.length === 1 && <Button onClick={() => onNavigate?.('passage-detail', { passageId: doneItems[0].passageId })}>打开短文</Button>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
