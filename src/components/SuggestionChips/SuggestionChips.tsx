import React from 'react';
import { Check, Loader2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SuggestionChipsProps {
  /** 建议；null = AI 正在想 */
  items: string[] | null;
  /** 已选的建议（可多选） */
  selected: string[];
  onToggle: (item: string) => void;
  /** 换一批：保留已选的，追加新的一批 */
  onMore: () => void;
  /** 没给出建议的原因 */
  error?: string | null;
  /** 正在想时的说明 */
  loadingText: string;
}

/**
 * AI 给的建议：可多选（选中的高亮带勾）；「换一批」保留已选的、追加新的一批（不与给过的重复，见 mergeSuggestions）。
 */
export const SuggestionChips: React.FC<SuggestionChipsProps> = ({ items, selected, onToggle, onMore, error, loadingText }) => {
  if (items === null) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {loadingText}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {error && <span className="text-xs text-destructive">无法给出建议：{error}</span>}
      {items.map((item) => {
        const on = selected.includes(item);
        return (
          <button
            key={item}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(item)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-left text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
              on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {on && <Check className="size-3" />}
            {item}
          </button>
        );
      })}
      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={onMore}>
        <RotateCw className="size-3" />
        {error ? '重试' : items.length > 0 ? '换一批' : '给我一些建议'}
      </Button>
    </div>
  );
};

/** 换一批后的列表：已选的留在前面，后面接新的一批（去掉重复） */
export function mergeSuggestions(selected: string[], fresh: string[]): string[] {
  return [...selected, ...fresh.filter((f) => !selected.includes(f))];
}
