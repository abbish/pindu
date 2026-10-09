import React, { useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Tag } from '@/types/material';

export interface TagPickerProps {
  /** 全部标签 */
  tags: Tag[];
  /** 已选标签 ID */
  value: number[];
  /** 选择变化 */
  onChange: (ids: number[]) => void;
  /** 新建标签（名称），返回新标签；不传则不提供新建 */
  onCreate?: (name: string) => Promise<Tag | null>;
  /** 触发器 id（关联 Label） */
  id?: string;
}

const NAME_MAX = 10;

/**
 * 标签多选（shadcn Combobox 模式：Popover + Command）：触发器里以标签显示已选，可直接点 × 去掉；
 * 浮层可搜索，找不到时可直接新建。
 */
export const TagPicker: React.FC<TagPickerProps> = ({ tags, value, onChange, onCreate, id }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const selected = value.map((v) => tags.find((t) => t.id === v)).filter((t): t is Tag => Boolean(t));
  const toggle = (tagId: number) => onChange(value.includes(tagId) ? value.filter((v) => v !== tagId) : [...value, tagId]);

  const name = query.trim();
  const exact = tags.some((t) => t.name.toLowerCase() === name.toLowerCase());
  const canCreate = Boolean(onCreate) && name.length > 0 && [...name].length <= NAME_MAX && !exact;

  const create = async () => {
    if (!onCreate || !canCreate) return;
    setCreating(true);
    const tag = await onCreate(name);
    setCreating(false);
    if (tag) {
      if (!value.includes(tag.id)) onChange([...value, tag.id]);
      setQuery('');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex min-h-9 w-full items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-left text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {selected.length === 0 ? (
              <span className="px-1 text-muted-foreground">选择标签</span>
            ) : (
              selected.map((tag) => (
                <Badge key={tag.id} variant="secondary" className="gap-1 pr-1">
                  {tag.name}
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`去掉 ${tag.name}`}
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(tag.id);
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput
            placeholder={onCreate ? '搜索或新建标签' : '搜索标签'}
            value={query}
            onValueChange={setQuery}
            maxLength={NAME_MAX}
            onKeyDown={(e) => {
              // 没有匹配项时回车直接新建
              if (e.key === 'Enter' && canCreate && !tags.some((t) => t.name.toLowerCase().includes(name.toLowerCase()))) {
                e.preventDefault();
                create();
              }
            }}
          />
          <CommandList>
            {!canCreate && <CommandEmpty>没有匹配的标签</CommandEmpty>}
            <CommandGroup>
              {tags.map((tag) => {
                const checked = value.includes(tag.id);
                return (
                  <CommandItem key={tag.id} value={tag.name} onSelect={() => toggle(tag.id)}>
                    {tag.name}
                    <Check className={cn('ml-auto size-4', checked ? 'opacity-100' : 'opacity-0')} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {canCreate && (
              <CommandGroup forceMount>
                <CommandItem value={`__create__${name}`} onSelect={create} disabled={creating} forceMount>
                  {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                  新建标签「{name}」
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
