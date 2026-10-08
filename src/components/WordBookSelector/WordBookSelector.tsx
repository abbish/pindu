import React from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { WordBookIcon } from '@/components/WordBookIcon/WordBookIcon';
import { cn } from '@/lib/utils';

export interface WordBookOption {
  id: number;
  name: string;
  description: string;
  wordCount: number;
  /** 图标（word_books.icon） */
  icon?: string;
  /** 图标颜色（word_books.icon_color） */
  color?: string;
}

export interface WordBookSelectorProps {
  /** 可选单词本 */
  books: WordBookOption[];
  /** 已选单词本 ID */
  selectedBooks: number[];
  /** 选择变化 */
  onSelectionChange: (selectedIds: number[]) => void;
  /** 加载中 */
  loading?: boolean;
  /** 没有单词本时的“去新建”入口 */
  onCreateBook?: () => void;
}

/** 选择计划使用的单词本（可多选）：带图标的列表行，勾选后高亮 */
export const WordBookSelector: React.FC<WordBookSelectorProps> = ({ books, selectedBooks, onSelectionChange, loading = false, onCreateBook }) => {
  const toggle = (id: number) =>
    onSelectionChange(selectedBooks.includes(id) ? selectedBooks.filter((b) => b !== id) : [...selectedBooks, id]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center">
        <BookOpen className="size-5 text-muted-foreground" />
        <div className="text-sm font-medium">还没有可用的单词本</div>
        <p className="text-sm text-muted-foreground">还没有带单词的单词本</p>
        {onCreateBook && (
          <Button size="sm" variant="outline" className="mt-1" onClick={onCreateBook}>
            <Plus />
            去新建单词本
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {books.map((book) => {
        const selected = selectedBooks.includes(book.id);
        return (
          <label
            key={book.id}
            className={cn(
              'flex cursor-default items-center gap-3 rounded-lg border p-2.5 transition-colors hover:bg-muted/40',
              selected && 'border-primary/50 bg-accent/30'
            )}
          >
            <WordBookIcon icon={book.icon} color={book.color} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{book.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {book.wordCount} 个单词{book.description ? ` · ${book.description}` : ''}
              </div>
            </div>
            <Checkbox checked={selected} onCheckedChange={() => toggle(book.id)} aria-label={`选择 ${book.name}`} />
          </label>
        );
      })}
    </div>
  );
};
