import React, { useState } from 'react';
import { Archive, ArchiveRestore, ChevronRight, Loader2, Pin, PinOff } from 'lucide-react';
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
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { TutorConversation } from '@/types/tutor';
import { formatRelativeDay } from '@/utils/datetime';

/** 按最后对话时间分组 */
function groupOf(modified: string): string {
  const day = formatRelativeDay(modified);
  if (day === '今天' || day === '昨天') return day;
  return day.endsWith('天前') ? '最近 7 天' : '更早';
}

/**
 * 对话列表：置顶 → 按时间分组 → 已归档（收起）。悬停显示置顶 / 归档；右键重命名、删除。
 */
export const ConversationList: React.FC<{
  conversations: TutorConversation[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onFlags: (id: string, pinned: boolean, archived: boolean) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}> = ({ conversations, activeId, onOpen, onFlags, onRename, onDelete }) => {
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TutorConversation | null>(null);

  const live = conversations.filter((c) => !c.archived);
  const groups: { label: string; items: TutorConversation[] }[] = [{ label: '置顶', items: live.filter((c) => c.pinned) }];
  for (const c of live.filter((c) => !c.pinned)) {
    const label = groupOf(c.modified);
    const group = groups.find((g) => g.label === label);
    if (group) group.items.push(c);
    else groups.push({ label, items: [c] });
  }
  const archived = conversations.filter((c) => c.archived);

  const row = (c: TutorConversation) => (
    <ConversationRow
      key={c.id}
      conversation={c}
      active={c.id === activeId}
      renaming={renaming === c.id}
      onOpen={() => onOpen(c.id)}
      onPin={() => onFlags(c.id, !c.pinned, false)}
      onArchive={() => onFlags(c.id, false, !c.archived)}
      onStartRename={() => setRenaming(c.id)}
      onRename={(name) => {
        setRenaming(null);
        if (name && name !== c.title) onRename(c.id, name);
      }}
      onDelete={() => setDeleting(c)}
    />
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {conversations.length === 0 && <div className="px-2 py-4 text-xs text-muted-foreground">还没有对话</div>}
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <div key={g.label} className="mb-3">
              <div className="px-2 pb-1 text-xs text-muted-foreground">{g.label}</div>
              {g.items.map(row)}
            </div>
          )
      )}
      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex w-full items-center gap-1 px-2 pb-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn('size-3 transition-transform', showArchived && 'rotate-90')} />
            已归档 {archived.length}
          </button>
          {showArchived && archived.map(row)}
        </div>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个对话？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleting?.title}」的对话记录会被删除，不能恢复。对话里收进素材库的内容不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) onDelete(deleting.id);
                setDeleting(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const ConversationRow: React.FC<{
  conversation: TutorConversation;
  active: boolean;
  renaming: boolean;
  onOpen: () => void;
  onPin: () => void;
  onArchive: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}> = ({ conversation: c, active, renaming, onOpen, onPin, onArchive, onStartRename, onRename, onDelete }) => {
  const action =
    'flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground';
  if (renaming) {
    return (
      <input
        autoFocus
        defaultValue={c.title}
        aria-label="对话名称"
        onBlur={(e) => onRename(e.target.value.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
          if (e.key === 'Escape') onRename('');
        }}
        className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
    );
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn('group flex items-center rounded-md hover:bg-accent', active && 'bg-accent')}>
          <button
            type="button"
            onClick={onOpen}
            onDoubleClick={onStartRename}
            title={c.title}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm',
              active && 'font-medium',
              c.archived && 'text-muted-foreground'
            )}
          >
            <span className="truncate">{c.title}</span>
            {c.running && <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-label="正在回答" />}
          </button>
          <div className="hidden shrink-0 items-center gap-0.5 pr-1 group-focus-within:flex group-hover:flex">
            {!c.archived && (
              <button type="button" onClick={onPin} className={action} title={c.pinned ? '取消置顶' : '置顶'} aria-label={c.pinned ? '取消置顶' : '置顶'}>
                {c.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </button>
            )}
            <button type="button" onClick={onArchive} className={action} title={c.archived ? '取消归档' : '归档'} aria-label={c.archived ? '取消归档' : '归档'}>
              {c.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
            </button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onStartRename}>重命名</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          删除…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
