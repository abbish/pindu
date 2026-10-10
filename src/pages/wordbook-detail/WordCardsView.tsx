import React, { useEffect, useState } from 'react';
import { Clapperboard, FileText, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ListPagination } from '@/components/ListPagination';
import { WordStudyCard, studyInfoFromWord } from '@/components/WordStudyCard';
import { cn } from '@/lib/utils';
import type { Word } from '@/types';
import type { WordMaterialCount } from '@/types/material';

export interface WordCardsViewProps {
  /** 当前页的单词 */
  words: Word[];
  loading: boolean;
  pagination: { current: number; pageSize: number; total: number; onChange: (page: number) => void };
  /** 每个词出现在几个片段 / 几篇短文里 */
  materials: Map<number, WordMaterialCount>;
  onEdit: (word: Word) => void;
  onDelete: (word: Word) => void;
  /** 用这个词生成短文 */
  onPassage: (word: Word) => void;
  onOpenPassage: (passageId: number, isClip: boolean) => void;
}

/**
 * 词汇本「单词」页签的卡片视图（与短文、视频片段的目标词同一种单词卡）：左边单词列表（释义、出现在素材里的次数），
 * 右边单词卡（发音、拼读、例句、AI 讲解、其他素材）；↑ ↓ 或上一个 / 下一个切换，到页尾自动翻页。
 */
export const WordCardsView: React.FC<WordCardsViewProps> = ({ words, loading, pagination, materials, onEdit, onDelete, onPassage, onOpenPassage }) => {
  const [index, setIndex] = useState(0);
  /** 翻到下一页后选第一个，翻到上一页后选最后一个 */
  const [pendingEdge, setPendingEdge] = useState<'first' | 'last' | null>(null);

  useEffect(() => {
    if (loading) return;
    setIndex((i) => (pendingEdge === 'first' ? 0 : pendingEdge === 'last' ? Math.max(words.length - 1, 0) : Math.min(i, Math.max(words.length - 1, 0))));
    setPendingEdge(null);
    // 只在一页加载完时调整
  }, [words, loading]);

  const pageCount = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const offset = (pagination.current - 1) * pagination.pageSize;
  const go = (next: number) => {
    if (next < 0 && pagination.current > 1) {
      setPendingEdge('last');
      pagination.onChange(pagination.current - 1);
    } else if (next >= words.length && pagination.current < pageCount) {
      setPendingEdge('first');
      pagination.onChange(pagination.current + 1);
    } else {
      setIndex(Math.max(0, Math.min(next, words.length - 1)));
    }
  };

  // ↑ ↓ 切换单词（输入框里不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable], [role="dialog"]')) return;
      if (e.key === 'ArrowDown') go(index + 1);
      else if (e.key === 'ArrowUp') go(index - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const current = words[index];

  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-6">
      <Card className="gap-1 p-2">
        {loading && words.length === 0
          ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="m-1 h-8" />)
          : words.map((w, i) => {
              const count = materials.get(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50', i === index && 'bg-accent text-accent-foreground hover:bg-accent')}
                  aria-current={i === index ? 'true' : undefined}
                >
                  <span className="font-medium">{w.word}</span>
                  {w.kind === 'phrase' && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">词组</span>}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{w.meaning}</span>
                  {count && count.clips > 0 && <Clapperboard className="size-3 shrink-0 text-muted-foreground" aria-label={`${count.clips} 个视频片段`} />}
                  {count && count.passages > 0 && <FileText className="size-3 shrink-0 text-muted-foreground" aria-label={`${count.passages} 篇短文`} />}
                </button>
              );
            })}
        <ListPagination page={pagination.current} pageSize={pagination.pageSize} total={pagination.total} onChange={pagination.onChange} hideSinglePage className="flex-col items-stretch gap-2 border-t px-1 pt-2 [&>span]:text-xs" />
      </Card>

      {current && (
        <WordStudyCard
          word={current.word}
          info={studyInfoFromWord(current)}
          aiWordId={current.id}
          wordId={current.id}
          onOpenPassage={onOpenPassage}
          actions={
            <>
              <Button variant="outline" size="icon" aria-label="编辑" onClick={() => onEdit(current)}>
                <Pencil />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="更多操作">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onPassage(current)}>
                    <FileText />
                    用这个单词生成短文
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(current)}>
                    <Trash2 />
                    删除…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
          nav={{ index: offset + index, total: pagination.total, onChange: (i) => go(i - offset) }}
        />
      )}
    </div>
  );
};
