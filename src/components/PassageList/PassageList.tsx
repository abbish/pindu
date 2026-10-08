import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, FileText, FileUp, ListChecks, MoreHorizontal, Sparkles, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageError } from '@/components/PageError';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
import { formatRelative } from '@/utils/datetime';
import { LEVEL_LABEL, MODE_LABEL, scopeDetailLabel, scoreSummary } from '@/utils/passage';
import type { PassageOrigin, PassageSource, PassageSummary } from '@/types/passage';

export interface PassageListProps {
  /** 只看引用了这个单词本的短文 */
  bookId?: number;
  /** 按标题或目标词筛选 */
  query?: string;
  /** 只看 AI 写的 / 导入的材料 */
  origin?: PassageOrigin;
  /** 导入我的材料（空状态的次要操作） */
  onImport?: () => void;
  /** 打开短文详情 */
  onOpen: (passageId: number) => void;
  /** 新建短文（空状态的主操作） */
  onCreate?: () => void;
  /** 列表数量（页签计数） */
  onCountChange?: (count: number) => void;
  /** 空状态说明 */
  emptyDescription?: string;
}

/** 来源标签：单词本 / 计划（已删除的来源划线） */
export const SourceBadge: React.FC<{ source: PassageSource }> = ({ source }) => (
  <Badge variant="outline" className={cn('font-normal', !source.exists && 'text-muted-foreground line-through')} title={source.exists ? undefined : '来源已删除'}>
    {source.kind === 'book' ? <BookOpen /> : <ListChecks />}
    {source.name}
    {source.kind === 'plan' && source.detail && <span className="text-muted-foreground">· {scopeDetailLabel(source.detail)}</span>}
  </Badge>
);

/** 短文卡片：整张可点进入详情；⋯ 菜单与右键菜单是同一组操作 */
const PassageCard: React.FC<{ passage: PassageSummary; onOpen: () => void; onDelete: () => void }> = ({ passage: p, onOpen, onDelete }) => {
  const menu = (Item: typeof DropdownMenuItem | typeof ContextMenuItem, Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator) => (
    <>
      <Item onSelect={onOpen}>
        <FileText />
        打开
      </Item>
      <Separator />
      <Item variant="destructive" onSelect={onDelete}>
        <Trash2 />
        删除短文…
      </Item>
    </>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card className="cursor-default gap-3 px-5 py-4 transition-colors select-none hover:border-ring/60" onClick={onOpen}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <button type="button" className="block max-w-full truncate text-left text-[15px] font-semibold outline-none focus-visible:underline" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
                {p.title}
              </button>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {LEVEL_LABEL[p.level] ?? p.level} · {p.wordCount} 词 · {formatRelative(p.createdAt)}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {menu(DropdownMenuItem, DropdownMenuSeparator)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {p.origin === 'imported' ? (
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline" className="max-w-full font-normal" title={p.sourceLabel ?? undefined}>
                <FileUp />
                <span className="truncate">我的材料{p.sourceLabel ? ` · ${p.sourceLabel}` : ''}</span>
              </Badge>
            </div>
          ) : (
            p.sources.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.sources.map((s) => (
                  <SourceBadge key={`${s.kind}-${s.refId}`} source={s} />
                ))}
              </div>
            )
          )}
          <div className="flex flex-wrap gap-1">
            {p.targetWords.slice(0, 12).map((w) => (
              <span key={w.word} className={cn('rounded-full px-2 py-0.5 text-xs', w.required ? 'bg-accent text-accent-foreground' : 'bg-muted')}>
                {w.word}
              </span>
            ))}
            {p.targetWords.length > 12 && <span className="px-1 text-xs text-muted-foreground">+{p.targetWords.length - 12}</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {p.questionSets > 0 ? `${p.questionSets} 套阅读理解题` : '还没有阅读理解题'}
            {p.lastAttempt && ` · 最近一次${MODE_LABEL[p.lastAttempt.mode]}：${scoreSummary(p.lastAttempt)}`}
          </div>
        </Card>
      </ContextMenuTrigger>
      <ContextMenuContent>{menu(ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
    </ContextMenu>
  );
};

/** 短文卡片网格（短文库、单词本「短文」页签共用）：加载 / 空 / 错误三态，删除确认 */
export const PassageList: React.FC<PassageListProps> = ({ bookId, query = '', origin, onOpen, onCreate, onImport, onCountChange, emptyDescription }) => {
  const toast = useToast();
  const [passages, setPassages] = useState<PassageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<PassageSummary | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await passageService.getPassages({ bookId });
    if (result.success) {
      setPassages(result.data);
      onCountChange?.(result.data.length);
    } else {
      setError(result.error);
    }
  }, [bookId, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!passages) return passages;
    return passages.filter(
      (p) => (!origin || p.origin === origin) && (!q || p.title.toLowerCase().includes(q) || p.targetWords.some((w) => w.word.toLowerCase().includes(q)))
    );
  }, [passages, query, origin]);

  const remove = async () => {
    if (!toDelete) return;
    const result = await passageService.deletePassage(toDelete.id);
    setToDelete(null);
    if (result.success) {
      toast.showSuccess('已删除短文');
      load();
    } else {
      toast.showError('无法删除短文', result.error);
    }
  };

  if (error) return <PageError title="无法加载短文" message={error} onRetry={load} />;
  if (visible === null) {
    return (
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    );
  }
  if (passages?.length === 0) {
    return (
      <EmptyState icon={<FileText />} title="还没有短文" description={emptyDescription}>
        <div className="flex gap-2">
          {onCreate && (
            <Button onClick={onCreate}>
              <Sparkles />
              AI 写短文
            </Button>
          )}
          {onImport && (
            <Button variant="outline" onClick={onImport}>
              <FileUp />
              从我的材料导入
            </Button>
          )}
        </div>
      </EmptyState>
    );
  }
  if (visible.length === 0) {
    if (!query.trim() && origin === 'imported') {
      return (
        <EmptyState icon={<FileUp />} title="还没有导入的材料">
          {onImport && (
            <Button onClick={onImport}>
              <FileUp />
              从我的材料导入
            </Button>
          )}
        </EmptyState>
      );
    }
    return <p className="py-10 text-center text-sm text-muted-foreground">{query.trim() ? `没有匹配「${query.trim()}」的短文` : '没有这类短文'}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {visible.map((p) => (
          <PassageCard key={p.id} passage={p} onOpen={() => onOpen(p.id)} onDelete={() => setToDelete(p)} />
        ))}
      </div>
      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除短文「{toDelete?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>短文、它的 {toDelete?.questionSets ?? 0} 套阅读理解题和练习记录都会删除，单词本和学习计划不受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              删除短文
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
