import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Minus, MoreHorizontal, Plus, Tags, Trash2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { tagService } from '@/services/tagService';
import type { ApiResult } from '@/types';
import type { MaterialKind, Tag } from '@/types/material';

/**
 * 素材卡片网格共用的多选与操作（词汇本 / 短文库 / 视频库，与单词列表的交互一致）：
 * 悬停卡片左上角出现勾选框，勾选后进入选择状态（点卡片即勾选，Esc 退出）；工具栏换成选择栏
 * （已选择 N 个 · 全选 · 清除选择 · 批量操作）；每张卡片的 ⋯ 菜单与右键菜单是同一组操作。
 */

// ==================== 选择状态 ====================

export function useSelection(visibleIds: number[]) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const selecting = selected.size > 0;
  const key = visibleIds.join(',');

  // 列表变化（筛选、删除）后只保留还看得见的
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(visibleIds);
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // visibleIds 用 key 比较
  }, [key]);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(new Set());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  const toggle = useCallback(
    (id: number) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleIds));
  const clear = useCallback(() => setSelected(new Set()), []);
  return { selected, selecting, toggle, toggleAll, allSelected, clear, ids: [...selected] };
}

export type Selection = ReturnType<typeof useSelection>;

/** 选择栏：替换工具栏显示 */
export const SelectionBar: React.FC<{ selection: Selection; unit: string; children?: React.ReactNode }> = ({ selection, unit, children }) => (
  <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border bg-muted px-3 py-1">
    <span className="text-sm font-medium">
      已选择 {selection.selected.size} {unit}
    </span>
    <Button variant="ghost" size="sm" onClick={selection.toggleAll}>
      {selection.allSelected ? '取消全选' : '全选'}
    </Button>
    <Button variant="ghost" size="sm" onClick={selection.clear}>
      清除选择
    </Button>
    <div className="flex-1" />
    {children}
  </div>
);

/** 卡片左上角的勾选框：选择状态下一直显示，否则悬停显示 */
export const SelectCheckbox: React.FC<{ checked: boolean; selecting: boolean; onToggle: () => void; label: string; className?: string }> = ({
  checked,
  selecting,
  onToggle,
  label,
  className,
}) => (
  <span
    className={cn('absolute top-2 left-2 z-10 rounded-sm bg-background/90 p-0.5 shadow-xs transition-opacity', selecting || checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100', className)}
    onClick={(e) => e.stopPropagation()}
  >
    <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={label} className="block" />
  </span>
);

// ==================== 卡片菜单（⋯ 与右键同一组） ====================

export interface CardAction {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** 在这一项前加分隔线 */
  separator?: boolean;
}

/** 右键菜单（包住整张卡片） */
export const CardMenu: React.FC<{ actions: CardAction[]; children: React.ReactElement }> = ({ actions, children }) => (
  <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent>
      {actions.map((a) => (
        <React.Fragment key={a.label}>
          {a.separator && <ContextMenuSeparator />}
          <ContextMenuItem variant={a.destructive ? 'destructive' : 'default'} disabled={a.disabled} onSelect={a.onSelect}>
            {a.icon}
            {a.label}
          </ContextMenuItem>
        </React.Fragment>
      ))}
    </ContextMenuContent>
  </ContextMenu>
);

/** 卡片上的 ⋯ 按钮（与右键菜单同一组操作） */
export const CardMenuButton: React.FC<{ actions: CardAction[]; className?: string }> = ({ actions, className }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" className={cn('size-7', className)} aria-label="更多操作" onClick={(e) => e.stopPropagation()}>
        <MoreHorizontal />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
      {actions.map((a) => (
        <React.Fragment key={a.label}>
          {a.separator && <DropdownMenuSeparator />}
          <DropdownMenuItem variant={a.destructive ? 'destructive' : 'default'} disabled={a.disabled} onSelect={a.onSelect}>
            {a.icon}
            {a.label}
          </DropdownMenuItem>
        </React.Fragment>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

// ==================== 批量标签 ====================

/** 选择栏里的「标签」：给选中的素材加上或去掉某个标签（可直接新建） */
export const BatchTagButton: React.FC<{ kind: MaterialKind; ids: number[]; onDone: () => void }> = ({ kind, ids, onDone }) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async (tag: Tag) => {
    setBusy(true);
    const r = await tagService.updateMaterialTags(kind, ids, mode === 'add' ? [tag.id] : [], mode === 'remove' ? [tag.id] : []);
    setBusy(false);
    if (!r.success) {
      toast.showError('无法修改标签', r.error);
      return;
    }
    toast.showSuccess(mode === 'add' ? `已给 ${r.data} 个加上「${tag.name}」` : `已从 ${r.data} 个移除「${tag.name}」`);
    setOpen(false);
    setQuery('');
    onDone();
  };

  const create = async () => {
    const r = await tagService.createTag(query.trim());
    if (!r.success) {
      toast.showError('无法新建标签', r.error);
      return;
    }
    await apply(r.data);
  };

  const name = query.trim();
  const canCreate = mode === 'add' && name.length > 0 && [...name].length <= 10 && !(tags ?? []).some((t) => t.name.toLowerCase() === name.toLowerCase());

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && tags === null) tagService.getTags().then((r) => setTags(r.success ? r.data : []));
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Tags />}
          标签
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="border-b p-2">
          <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as 'add' | 'remove')} className="w-full rounded-md bg-muted p-0.5">
            <ToggleGroupItem value="add" className="h-7 flex-1 rounded-sm text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm">
              <Plus />
              加上
            </ToggleGroupItem>
            <ToggleGroupItem value="remove" className="h-7 flex-1 rounded-sm text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm">
              <Minus />
              移除
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Command>
          <CommandInput placeholder={mode === 'add' ? '搜索或新建标签' : '搜索标签'} value={query} onValueChange={setQuery} maxLength={10} />
          <CommandList>
            {tags === null ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                加载中…
              </div>
            ) : (
              <>
                {!canCreate && <CommandEmpty>没有匹配的标签</CommandEmpty>}
                <CommandGroup>
                  {tags.map((t) => (
                    <CommandItem key={t.id} value={t.name} onSelect={() => apply(t)} disabled={busy}>
                      {t.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {canCreate && (
                  <CommandGroup forceMount>
                    <CommandItem value={`__create__${name}`} onSelect={create} forceMount disabled={busy}>
                      <Plus />
                      新建并加上「{name}」
                    </CommandItem>
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

// ==================== 批量删除 ====================

export interface BatchDeleteProps<T> {
  /** 要删除的（null 关闭确认框） */
  items: T[] | null;
  onClose: () => void;
  /** 单位与说明：「篇短文」「删除后不能恢复…」 */
  unit: string;
  description: string;
  nameOf: (item: T) => string;
  remove: (item: T) => Promise<ApiResult<unknown>>;
  /** 删完（含部分失败）后刷新 */
  onDone: () => void;
}

/**
 * 删除确认：一个时写名字，多个时写数量；逐个删除，最后汇总——全部成功「已删除 N …」，
 * 部分不能删（如被计划使用）时说明删了几个、哪几个没删和原因。
 */
export function BatchDeleteDialog<T>({ items, onClose, unit, description, nameOf, remove, onDone }: BatchDeleteProps<T>) {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const count = items?.length ?? 0;

  const run = async () => {
    if (!items) return;
    setRunning(true);
    const failed: { name: string; error: string }[] = [];
    for (const item of items) {
      const r = await remove(item);
      if (!r.success) failed.push({ name: nameOf(item), error: r.error });
    }
    setRunning(false);
    onClose();
    const ok = items.length - failed.length;
    if (failed.length === 0) toast.showSuccess(items.length === 1 ? `已删除「${nameOf(items[0])}」` : `已删除 ${ok} ${unit}`);
    else if (ok === 0 && failed.length === 1) toast.showError('无法删除', failed[0].error);
    else toast.showWarning(`已删除 ${ok} ${unit}，${failed.length} 个没有删除`, failed.slice(0, 3).map((f) => `「${f.name}」：${f.error}`).join('\n'));
    onDone();
  };

  return (
    <AlertDialog open={items !== null} onOpenChange={(o) => !o && !running && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{count === 1 && items ? `删除「${nameOf(items[0])}」？` : `删除 ${count} ${unit}？`}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={running}
            onClick={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            {running ? <Loader2 className="animate-spin" /> : <Trash2 />}
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 选择栏里的「删除选中」 */
export const BatchDeleteButton: React.FC<{ count: number; onClick: () => void }> = ({ count, onClick }) => (
  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onClick}>
    <Trash2 />
    删除选中（{count}）
  </Button>
);

