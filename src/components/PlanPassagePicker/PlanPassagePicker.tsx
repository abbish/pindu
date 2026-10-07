import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, FileText, Lock, Plus, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/datetime';
import { LEVEL_LABEL, MODE_LABEL } from '@/utils/passage';
import type { PassageMode, PlanPassageCandidate, PlanPassageInput, PlanPassageStatus, QuestionSetSummary } from '@/types/passage';

/** 计划里一篇短文的编辑态 */
export interface PlanPassageDraft {
  passageId: number;
  title: string;
  level: string;
  wordCount: number;
  /** 这篇短文的题组（新到旧） */
  sets: QuestionSetSummary[];
  /** 为空：只朗读，点「读完了」算完成 */
  setId: number | null;
  mode: PassageMode;
  /** 已完成：日期、题组、方式锁定，只能挪顺序，不能移除 */
  locked?: boolean;
  /** 已完成的日期（锁定项显示） */
  completedAt?: string | null;
}

/** 每几天一篇（后端允许 1–30） */
export const PASSAGE_INTERVAL_OPTIONS = [1, 2, 3, 5, 7];
export const DEFAULT_PASSAGE_INTERVAL = 2;

export const intervalLabel = (days: number) => (days === 1 ? '每天一篇' : `每 ${days} 天一篇`);
export { MODE_LABEL };

/** 候选 → 编辑态：默认用最早的一套题，阅读 */
export const draftFromCandidate = (c: PlanPassageCandidate): PlanPassageDraft => ({
  passageId: c.passage.id,
  title: c.passage.title,
  level: c.passage.level,
  wordCount: c.passage.wordCount,
  sets: c.sets,
  setId: c.defaultSetId,
  mode: 'reading',
});

export const toPassageInputs = (items: PlanPassageDraft[]): PlanPassageInput[] =>
  items.map((i) => ({ passageId: i.passageId, setId: i.setId, mode: i.setId === null ? 'reading' : i.mode }));

/** 任务说明：题组 + 方式，或只朗读 */
export const taskLabel = (setName: string | null | undefined, setId: number | null, mode: PassageMode) =>
  setId === null ? '只朗读' : `${setName ?? '题组'} · ${MODE_LABEL[mode]}`;

/** 计划短文任务的状态显示 */
export const PASSAGE_STATUS: Record<PlanPassageStatus, { label: string; className: string }> = {
  completed: { label: '已完成', className: 'bg-success-soft text-success' },
  due: { label: '今天', className: 'bg-accent text-accent-foreground' },
  overdue: { label: '逾期', className: 'bg-warning-soft text-warning' },
  upcoming: { label: '未开始', className: 'bg-secondary text-muted-foreground' },
};

const NO_SET = 'none';

export interface PlanPassagePickerProps {
  /** 已选短文（顺序即排期顺序） */
  items: PlanPassageDraft[];
  onChange: (items: PlanPassageDraft[]) => void;
  /** 可加入的短文（null 表示加载中） */
  candidates: PlanPassageCandidate[] | null;
  /** 每一项的排期说明（如“第 3 天”“10月9日”），显示在行内 */
  notes?: (string | null)[];
  /** 相关度说明的对象，如“所选单词本” / “计划” */
  overlapLabel?: string;
  /** 短文库为空时去新建短文 */
  onCreatePassage?: () => void;
  disabled?: boolean;
  /** 「添加短文」按钮靠右（放在靠右对齐的设置行里） */
  alignEnd?: boolean;
}

/**
 * 给计划挑短文：已选列表（排序、题组、阅读 / 听力、移除）+「添加短文」对话框（按与单词的相关度排序）。
 * 新建计划与计划设置共用（C4，DECISIONS D29）。
 */
export const PlanPassagePicker: React.FC<PlanPassagePickerProps> = ({ items, onChange, candidates, notes, overlapLabel = '所选单词', onCreatePassage, disabled, alignEnd }) => {
  const [adding, setAdding] = useState(false);
  const chosenIds = useMemo(() => new Set(items.map((i) => i.passageId)), [items]);

  const update = (index: number, patch: Partial<PlanPassageDraft>) => onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const move = (index: number, delta: number) => {
    const next = [...items];
    const [it] = next.splice(index, 1);
    next.splice(index + delta, 0, it);
    onChange(next);
  };
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));

  return (
    <div className={cn('flex w-full flex-col gap-2 text-left', alignEnd ? 'items-end' : 'items-start')}>
      {items.length > 0 && (
        <ol className="w-full divide-y rounded-lg border">
          {items.map((it, i) => (
            <li key={it.passageId} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{it.title}</span>
                  {it.locked && (
                    <Badge variant="outline" className="shrink-0 border-transparent bg-success-soft font-normal text-success">
                      <Lock />
                      已完成
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {LEVEL_LABEL[it.level] ?? it.level} · {it.wordCount} 词
                  {it.locked && it.completedAt ? ` · ${formatDate(it.completedAt)} 完成` : notes?.[i] ? ` · ${notes[i]}` : ''}
                </div>
              </div>
              <Select
                value={it.setId === null ? NO_SET : String(it.setId)}
                onValueChange={(v) => update(i, { setId: v === NO_SET ? null : Number(v) })}
                disabled={disabled || it.locked}
              >
                <SelectTrigger size="sm" className="w-40" aria-label={`「${it.title}」用哪套题`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {it.sets.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NO_SET}>只朗读（不做题）</SelectItem>
                </SelectContent>
              </Select>
              <ToggleGroup
                type="single"
                value={it.setId === null ? '' : it.mode}
                onValueChange={(v) => v && update(i, { mode: v as PassageMode })}
                className="rounded-md bg-muted p-0.5"
                disabled={disabled || it.locked || it.setId === null}
                aria-label="练习方式"
              >
                {(['reading', 'listening'] as const).map((m) => (
                  <ToggleGroupItem key={m} value={m} className="h-7 rounded-sm px-2.5 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm">
                    {MODE_LABEL[m]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className="flex shrink-0">
                <Button variant="ghost" size="icon" className="size-7" aria-label={`上移「${it.title}」`} onClick={() => move(i, -1)} disabled={disabled || i === 0}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon" className="size-7" aria-label={`下移「${it.title}」`} onClick={() => move(i, 1)} disabled={disabled || i === items.length - 1}>
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`移除「${it.title}」`}
                  title={it.locked ? '已完成的短文不能移除' : undefined}
                  onClick={() => remove(i)}
                  disabled={disabled || it.locked}
                >
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={disabled}>
        <Plus />
        添加短文
      </Button>
      <AddPassagesDialog
        open={adding}
        onClose={() => setAdding(false)}
        candidates={candidates}
        excluded={chosenIds}
        overlapLabel={overlapLabel}
        onCreatePassage={onCreatePassage}
        onAdd={(picked) => {
          onChange([...items, ...picked.map(draftFromCandidate)]);
          setAdding(false);
        }}
      />
    </div>
  );
};

/** 从短文库挑短文：搜索 + 多选；按相关度排序（后端已排好） */
const AddPassagesDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  candidates: PlanPassageCandidate[] | null;
  excluded: Set<number>;
  overlapLabel: string;
  onCreatePassage?: () => void;
  onAdd: (picked: PlanPassageCandidate[]) => void;
}> = ({ open, onClose, candidates, excluded, overlapLabel, onCreatePassage, onAdd }) => {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<number[]>([]);

  const available = (candidates ?? []).filter((c) => !excluded.has(c.passage.id));
  const q = query.trim().toLowerCase();
  const shown = q
    ? available.filter((c) => c.passage.title.toLowerCase().includes(q) || c.passage.targetWords.some((w) => w.word.toLowerCase().includes(q)))
    : available;

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const close = () => {
    setPicked([]);
    setQuery('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>添加短文</DialogTitle>
          <DialogDescription>从短文库里选，含{overlapLabel}多的排在前面。按勾选的顺序加到列表末尾。</DialogDescription>
        </DialogHeader>
        {candidates === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : available.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
            <FileText className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{candidates.length === 0 ? '短文库里还没有短文' : '短文库里的短文都已经加进来了'}</p>
            {candidates.length === 0 && onCreatePassage && (
              <Button size="sm" variant="outline" onClick={onCreatePassage}>
                去新建短文
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="按标题或单词搜索" aria-label="搜索短文" className="pl-8" />
            </div>
            <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border">
              {shown.map((c) => {
                const checked = picked.includes(c.passage.id);
                return (
                  <li key={c.passage.id}>
                    <label className={cn('flex cursor-default items-start gap-3 px-3 py-2.5 hover:bg-muted/50', checked && 'bg-accent/40')}>
                      <Checkbox checked={checked} onCheckedChange={() => toggle(c.passage.id)} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.passage.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {LEVEL_LABEL[c.passage.level] ?? c.passage.level} · {c.passage.wordCount} 词 · {c.sets.length > 0 ? `${c.sets.length} 套题` : '还没有题，只能朗读'}
                        </span>
                      </span>
                      {c.overlap > 0 && (
                        <Badge variant="secondary" className="shrink-0 font-normal">
                          含{overlapLabel} {c.overlap} 个
                        </Badge>
                      )}
                    </label>
                  </li>
                );
              })}
              {shown.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">没有找到匹配的短文</li>}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            取消
          </Button>
          <Button
            onClick={() => {
              const byId = new Map(available.map((c) => [c.passage.id, c]));
              onAdd(picked.map((id) => byId.get(id)).filter((c): c is PlanPassageCandidate => Boolean(c)));
              setPicked([]);
              setQuery('');
            }}
            disabled={picked.length === 0}
          >
            添加{picked.length > 0 ? ` ${picked.length} 篇` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
