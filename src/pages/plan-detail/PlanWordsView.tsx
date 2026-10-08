import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2, Search, Trash2, Volume2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/datetime';
import { MEMORY_STAGE_LABEL, dueLabel, memoryBoxLabel, memoryStage, type MemoryStage } from '@/utils/memoryLevel';
import type { StudyPlanWord } from '@/types';
import { InlineError } from '@/components/InlineError';

export interface PlanWordsViewProps {
  /** 计划的单词（每个单词一次，带记忆状态） */
  planWords: StudyPlanWord[];
  /** 加载中 */
  loading: boolean;
  /** 今天 YYYY-MM-DD */
  today: string;
  /** 播放单词发音 */
  onPlayWord: (word: string) => void;
  /** 从计划移除选中的单词（不传则不能勾选，如已结束的计划）；失败时返回错误文案 */
  onRemoveWords?: (wordIds: number[]) => Promise<string | null>;
}

type Filter = 'all' | MemoryStage | 'tricky';

const STAGE_BADGE: Record<MemoryStage, string> = {
  new: 'bg-secondary text-secondary-foreground',
  learning: 'bg-accent text-accent-foreground',
  mastered: 'bg-success-soft text-success',
};

/** 单词列表：每个词的学习状态（记忆等级、下次复习、答错次数），可按状态筛选与搜索 */
export const PlanWordsView: React.FC<PlanWordsViewProps> = ({ planWords, loading, today, onPlayWord, onRemoveWords }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const selectable = Boolean(onRemoveWords);
  // 单词列表刷新（如移除后）时清掉已不存在的勾选
  useEffect(() => {
    const ids = new Set(planWords.map((w) => w.id));
    setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
  }, [planWords]);
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const remove = async () => {
    if (!onRemoveWords) return;
    setRemoving(true);
    setRemoveError(null);
    const error = await onRemoveWords([...selected]);
    setRemoving(false);
    if (error) {
      setRemoveError(error);
      return;
    }
    setSelected(new Set());
    setConfirming(false);
  };

  const counts = useMemo(() => {
    const c = { all: planWords.length, new: 0, learning: 0, mastered: 0, tricky: 0 };
    for (const w of planWords) {
      c[memoryStage(w.memory_box)] += 1;
      if (w.lapses > 0) c.tricky += 1;
    }
    return c;
  }, [planWords]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return planWords
      .filter((w) => {
        if (filter === 'tricky') return w.lapses > 0;
        if (filter !== 'all') return memoryStage(w.memory_box) === filter;
        return true;
      })
      .filter((w) => !q || w.word.toLowerCase().includes(q) || (w.meaning ?? '').includes(q))
      .sort((a, b) =>
        filter === 'tricky'
          ? b.lapses - a.lapses || a.word.localeCompare(b.word)
          : (a.learn_date ?? '9999').localeCompare(b.learn_date ?? '9999') || a.word.localeCompare(b.word)
      );
  }, [planWords, filter, query]);

  if (loading) return <Skeleton className="h-80 rounded-xl" />;
  if (planWords.length === 0) {
    return <EmptyState icon={<BookOpen />} title="这个计划还没有单词" description="在「设置」里追加单词本" />;
  }

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: counts.all },
    { key: 'new', label: MEMORY_STAGE_LABEL.new, count: counts.new },
    { key: 'learning', label: MEMORY_STAGE_LABEL.learning, count: counts.learning },
    { key: 'mastered', label: MEMORY_STAGE_LABEL.mastered, count: counts.mastered },
    { key: 'tricky', label: '易错', count: counts.tricky },
  ];

  const visibleIds = rows.map((w) => w.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selectedLearned = planWords.filter((w) => selected.has(w.id) && memoryStage(w.memory_box) !== 'new').length;

  return (
    <div className="flex flex-col gap-3">
      {selectable && selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-1.5">
          <span className="text-sm font-medium">已选 {selected.size} 个单词</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            清除选择
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              setRemoveError(null);
              setConfirming(true);
            }}
          >
            <Trash2 />
            从计划移除
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="按学习状态筛选">
          {filters.map((f) => (
            <Button
              key={f.key}
              aria-pressed={filter === f.key}
              variant={filter === f.key ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="tabular-nums text-muted-foreground">{f.count}</span>
            </Button>
          ))}
        </div>
        <div className="relative w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索单词或释义" className="h-8 pl-8" />
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={(v) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const id of visibleIds) {
                          if (v === true) next.add(id);
                          else next.delete(id);
                        }
                        return next;
                      })
                    }
                    aria-label="全选当前列表"
                  />
                </TableHead>
              )}
              <TableHead>单词</TableHead>
              <TableHead>释义</TableHead>
              <TableHead>学习日</TableHead>
              <TableHead>记忆状态</TableHead>
              <TableHead>下次复习</TableHead>
              <TableHead className="text-right">复习答错</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={selectable ? 7 : 6} className="py-8 text-center text-sm text-muted-foreground">
                  没有符合条件的单词
                </TableCell>
              </TableRow>
            ) : (
              rows.map((w) => {
                const stage = memoryStage(w.memory_box);
                const due = stage === 'new' ? null : w.next_review_date;
                const dueText = dueLabel(due, today);
                return (
                  <TableRow key={w.id} data-state={selected.has(w.id) ? 'selected' : undefined}>
                    {selectable && (
                      <TableCell>
                        <Checkbox checked={selected.has(w.id)} onCheckedChange={() => toggle(w.id)} aria-label={`选择 ${w.word}`} />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="icon" className="size-7" aria-label={`播放 ${w.word}`} onClick={() => onPlayWord(w.word)}>
                          <Volume2 />
                        </Button>
                        <span className="font-medium select-text">{w.word}</span>
                        {w.ipa && <span className="text-xs text-muted-foreground select-text">{w.ipa}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground select-text">{w.meaning}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{w.learn_date ? formatDate(w.learn_date) : '—'}</TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className={cn('border-transparent', STAGE_BADGE[stage])}>
                            {MEMORY_STAGE_LABEL[stage]}
                            {stage !== 'new' && <span className="tabular-nums opacity-70">· {w.memory_box}</span>}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>{memoryBoxLabel(w.memory_box)}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className={cn('tabular-nums', dueText === '今天' || dueText.startsWith('已到期') ? 'font-medium text-warning' : 'text-muted-foreground')}>
                      {dueText}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', w.lapses > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                      {w.lapses > 0 ? `${w.lapses} 次` : '—'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={confirming} onOpenChange={(open) => !open && !removing && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>从计划移除 {selected.size} 个单词？</AlertDialogTitle>
            <AlertDialogDescription>
              这些单词不再练习和复习
              {selectedLearned > 0 && `；其中 ${selectedLearned} 个已学过，记忆等级和作答记录会一起删除`}
              。单词本不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError && <InlineError title="无法移除单词">{removeError}</InlineError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>取消</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={removing}>
              {removing && <Loader2 className="animate-spin" />}
              移除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
