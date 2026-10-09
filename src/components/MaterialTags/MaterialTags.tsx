import React, { useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { tagService } from '@/services/tagService';
import type { MaterialKind, Tag } from '@/types/material';

const NAME_MAX = 10;

export interface MaterialTagsProps {
  kind: MaterialKind;
  refId: number;
  tags: Tag[];
  onChange?: (tags: Tag[]) => void;
}

/**
 * 素材详情页上的标签：显示为标签，点 × 去掉；「标签」浮层里勾选已有的或直接新建，改动立即保存。
 */
export const MaterialTags: React.FC<MaterialTagsProps> = ({ kind, refId, tags, onChange }) => {
  const toast = useToast();
  const [value, setValue] = useState<Tag[]>(tags);
  const [all, setAll] = useState<Tag[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (next: Tag[]) => {
    setSaving(true);
    const result = await tagService.setMaterialTags(kind, refId, next.map((t) => t.id));
    setSaving(false);
    if (!result.success) {
      toast.showError('无法保存标签', result.error);
      return;
    }
    setValue(result.data);
    onChange?.(result.data);
  };

  const openPicker = (o: boolean) => {
    setOpen(o);
    if (o && all === null) tagService.getTags().then((r) => setAll(r.success ? r.data : []));
    if (!o) setQuery('');
  };

  const name = query.trim();
  const canCreate = name.length > 0 && [...name].length <= NAME_MAX && !(all ?? []).some((t) => t.name.toLowerCase() === name.toLowerCase());
  const create = async () => {
    const result = await tagService.createTag(name);
    if (!result.success) {
      toast.showError('无法新建标签', result.error);
      return;
    }
    setAll((prev) => [...(prev ?? []), result.data]);
    setQuery('');
    await save([...value, result.data]);
  };
  const toggle = (tag: Tag) => save(value.some((t) => t.id === tag.id) ? value.filter((t) => t.id !== tag.id) : [...value, tag]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((t) => (
        <Badge key={t.id} variant="outline" className="gap-1 pr-1 font-normal">
          {t.icon && <span aria-hidden="true">{t.icon}</span>}
          {t.name}
          <button type="button" aria-label={`去掉 ${t.name}`} className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => toggle(t)} disabled={saving}>
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={openPicker}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            标签
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-0">
          <Command>
            <CommandInput placeholder="搜索或新建标签" value={query} onValueChange={setQuery} maxLength={NAME_MAX} />
            <CommandList>
              {all === null ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  加载中…
                </div>
              ) : (
                <>
                  {!canCreate && <CommandEmpty>没有匹配的标签</CommandEmpty>}
                  <CommandGroup>
                    {all.map((t) => (
                      <CommandItem key={t.id} value={t.name} onSelect={() => toggle(t)}>
                        {t.icon && <span aria-hidden="true">{t.icon}</span>}
                        {t.name}
                        <Check className={cn('ml-auto size-4', value.some((v) => v.id === t.id) ? 'opacity-100' : 'opacity-0')} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {canCreate && (
                    <CommandGroup forceMount>
                      <CommandItem value={`__create__${name}`} onSelect={create} forceMount>
                        <Plus />
                        新建标签「{name}」
                      </CommandItem>
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
