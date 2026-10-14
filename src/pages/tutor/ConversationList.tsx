import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CornerUpLeft, Loader2, MessageCircleQuestionMark, MoreHorizontal, Pin, PinOff, Search, SquarePen, X } from 'lucide-react';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { markNavSeen, NAV_SEEN_SINCE, useNavSeen } from '@/hooks/useNavSeen';
import { useTutorActivity } from '@/hooks/useTutorActivity';
import { tutorService } from '@/services/tutorService';
import type { TutorConversation, TutorSearchHit } from '@/types/tutor';
import { formatRelative, formatRelativeDay } from '@/utils/datetime';
import { conversationMark, tutorSeenKey, type ConversationMark } from '@/utils/tutorActivity';
import { clearReveal } from './revealText';

/** 列表的前 n 个；正在看的对话在后面时一直显示到它 */
function firstPage<T extends { id: string }>(list: T[], n: number, activeId: string | null): T[] {
  return list.slice(0, Math.max(n, list.findIndex((c) => c.id === activeId) + 1));
}

/** 按最后对话时间分组 */
function groupOf(modified: string): string {
  const day = formatRelativeDay(modified);
  if (day === '今天' || day === '昨天') return day;
  return day.endsWith('天前') ? '最近 7 天' : '更早';
}

const PINNED = '置顶';
const ARCHIVED = '已归档';
/** 一次显示的对话数，点「更多…」再显示一批 */
const PAGE = 30;
/** 收起的分组（只有置顶与已归档能收起；本机记住，已归档默认收起） */
const COLLAPSED_KEY = 'tutor.collapsedGroups';
function loadCollapsed(): Set<string> {
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    if (saved) return new Set((JSON.parse(saved) as string[]).filter((g) => g === PINNED || g === ARCHIVED));
  } catch {
    // 读不到就用默认
  }
  return new Set([ARCHIVED]);
}
function saveCollapsed(groups: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...groups]));
  } catch {
    // 记不住也不影响使用
  }
}

/**
 * 对话列表：置顶 → 按时间分组 → 已归档；置顶与已归档可以收起，对话一次显示一批，「更多…」接着显示。
 * 每行右侧常驻状态（等你回答 / 正在回答 / 有新回答没看）；悬停时换成「⋯」（重命名、归档、删除）与置顶，右键是同样的菜单。
 */
export const ConversationList: React.FC<{
  conversations: TutorConversation[];
  /** 第一次加载：显示占位 */
  loading?: boolean;
  /** 第一次加载时已显示读到的部分，还在读其余的 */
  partial?: boolean;
  activeId: string | null;
  /** query：从搜索结果打开、匹配在对话内容里时带上（打开后滚到匹配处） */
  onOpen: (id: string, query?: string) => void;
  onFlags: (id: string, pinned: boolean, archived: boolean) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** 新对话（搜索框右边的图标） */
  onNew: () => void;
}> = ({ conversations, loading, partial, activeId, onOpen, onFlags, onRename, onDelete, onNew }) => {
  const [query, setQuery] = useState('');
  // 清掉搜索：对话里标出的匹配处也去掉
  useEffect(() => {
    if (!query.trim()) clearReveal();
  }, [query]);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [limit, setLimit] = useState(PAGE);
  const [archivedLimit, setArchivedLimit] = useState(PAGE);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TutorConversation | null>(null);
  const activity = useTutorActivity();
  const seen = useNavSeen();

  // 正在看的对话：打开时与离开时都记为看过（期间答完的不再标「新回答」）
  useEffect(() => {
    if (!activeId) return;
    markNavSeen(tutorSeenKey(activeId));
    return () => markNavSeen(tutorSeenKey(activeId));
  }, [activeId]);

  const toggle = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      saveCollapsed(next);
      return next;
    });

  const live = conversations.filter((c) => !c.archived);
  const pinned = live.filter((c) => c.pinned);
  const recent = live.filter((c) => !c.pinned);
  const archived = conversations.filter((c) => c.archived);
  const recentShown = firstPage(recent, limit, activeId);
  const archivedShown = firstPage(archived, archivedLimit, activeId);
  const dateGroups: { label: string; items: TutorConversation[] }[] = [];
  for (const c of recentShown) {
    const label = groupOf(c.modified);
    const group = dateGroups.find((g) => g.label === label);
    if (group) group.items.push(c);
    else dateGroups.push({ label, items: [c] });
  }

  const markOf = (c: TutorConversation) =>
    conversationMark(activity, c.id, Math.max(NAV_SEEN_SINCE, seen.get(tutorSeenKey(c.id)) ?? 0), c.id === activeId);
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const row = (c: TutorConversation) => (
    <ConversationRow
      key={c.id}
      conversation={c}
      parentTitle={c.parentId ? byId.get(c.parentId)?.title : undefined}
      active={c.id === activeId}
      mark={markOf(c)}
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

  /** 能收起的分组（置顶、已归档）：收起时标出里面最要紧的状态，正在看的对话照样露出来（如刚归档的） */
  const section = (label: string, items: TutorConversation[], shown: TutorConversation[], onMore?: () => void) => {
    const closed = collapsed.has(label);
    const marks = closed ? items.filter((c) => c.id !== activeId).map(markOf) : [];
    const groupMark = MARK_ORDER.find((m) => marks.includes(m));
    return (
      <div className="mb-3">
        <button
          type="button"
          onClick={() => toggle(label)}
          aria-expanded={!closed}
          className="group/head flex w-full items-center gap-1 px-2 pb-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {label}
          {label === ARCHIVED && <span className="tabular-nums">{items.length}</span>}
          {closed ? (
            <>
              <ChevronRight className="size-3" />
              {groupMark && (
                <span role="img" aria-label={MARK[groupMark].label} title={MARK[groupMark].label} className="ml-auto flex size-4 items-center justify-center">
                  {MARK[groupMark].icon}
                </span>
              )}
            </>
          ) : (
            <ChevronDown className="size-3 opacity-0 transition-opacity group-hover/head:opacity-100 group-focus-visible/head:opacity-100" />
          )}
        </button>
        {(closed ? items.filter((c) => c.id === activeId) : shown).map(row)}
        {!closed && onMore && shown.length < items.length && <MoreButton onClick={onMore} />}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-3 mt-3 mb-2 flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="搜索对话"
            aria-label="搜索对话"
            className="h-8 bg-background pr-7 pl-8 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清除搜索"
              title="清除搜索"
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onNew} aria-label="新对话">
              <SquarePen />
            </Button>
          </TooltipTrigger>
          <TooltipContent>新对话（⌘N）</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {query.trim() ? (
          <SearchResults query={query.trim()} conversations={conversations} activeId={activeId} onOpen={onOpen} />
        ) : (
          <>
            {loading && conversations.length === 0 && (
              <div className="flex flex-col gap-2 px-2 pt-1" aria-label="正在加载对话">
                {[70, 85, 60, 75].map((w) => (
                  <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
                ))}
              </div>
            )}
            {!loading && conversations.length === 0 && <div className="px-2 py-4 text-xs text-muted-foreground">还没有对话</div>}
            {pinned.length > 0 && section(PINNED, pinned, pinned)}
            {dateGroups.map((g) => (
              <div key={g.label} className="mb-3">
                <div className="px-2 pb-1 text-xs text-muted-foreground">{g.label}</div>
                {g.items.map(row)}
              </div>
            ))}
            {recentShown.length < recent.length && <MoreButton onClick={() => setLimit((n) => n + PAGE)} />}
            {archived.length > 0 && section(ARCHIVED, archived, archivedShown, () => setArchivedLimit((n) => n + PAGE))}
            {partial && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                正在读取更多对话…
              </div>
            )}
          </>
        )}
      </div>

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

/** 文字里的 query 标出来（不分大小写） */
const Marked: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-warning-soft text-foreground">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
};

/** 搜索结果：先按标题在本地筛（马上有），稍等后由后端按标题与对话内容搜，内容匹配的带上那一段 */
const SearchResults: React.FC<{
  query: string;
  conversations: TutorConversation[];
  activeId: string | null;
  onOpen: (id: string, query?: string) => void;
}> = ({ query, conversations, activeId, onOpen }) => {
  const [hits, setHits] = useState<{ query: string; hits: TutorSearchHit[] } | null>(null);
  const run = useRef(0);
  useEffect(() => {
    const id = ++run.current;
    const timer = window.setTimeout(() => {
      void tutorService.search(query).then((result) => {
        if (id === run.current && result.success) setHits({ query, hits: result.data });
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const byId = new Map(conversations.map((c) => [c.id, c]));
  const lower = query.toLowerCase();
  const results: { conversation: TutorConversation; snippet: string }[] =
    hits?.query === query
      ? hits.hits.flatMap((h) => {
          const c = byId.get(h.id);
          return c ? [{ conversation: c, snippet: h.snippet }] : [];
        })
      : conversations.filter((c) => c.title.toLowerCase().includes(lower)).map((c) => ({ conversation: c, snippet: '' }));
  const searching = hits?.query !== query;

  return (
    <div className="flex flex-col">
      {results.map(({ conversation: c, snippet }) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpen(c.id, snippet ? query : undefined)}
          className={cn('flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent', c.id === activeId && 'bg-accent')}
        >
          <span className={cn('truncate text-sm', c.archived && 'text-muted-foreground')}>
            <Marked text={c.title} query={query} />
          </span>
          {snippet && (
            <span className="line-clamp-2 text-xs text-muted-foreground">
              <Marked text={snippet} query={query} />
            </span>
          )}
        </button>
      ))}
      {searching ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在搜索对话内容…
        </div>
      ) : (
        results.length === 0 && <div className="px-2 py-4 text-xs text-muted-foreground">没有找到</div>
      )}
    </div>
  );
};

/** 显示下一批对话 */
const MoreButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" onClick={onClick} className="mb-3 w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
    更多…
  </button>
);

/** 收起的分组只显示一个：等你回答 > 正在回答 > 有新回答 */
const MARK_ORDER: ConversationMark[] = ['asking', 'running', 'unread'];

const MARK: Record<ConversationMark, { label: string; icon: React.ReactNode }> = {
  asking: { label: '等你回答', icon: <MessageCircleQuestionMark className="size-3.5 text-warning" /> },
  running: { label: '正在回答', icon: <Loader2 className="size-3.5 text-primary motion-safe:animate-spin" /> },
  unread: { label: '有新回答', icon: <span className="size-2 rounded-full bg-success" /> },
};

const ConversationRow: React.FC<{
  conversation: TutorConversation;
  /** 从这个对话「重新问」另开的（悬停预览里说明） */
  parentTitle?: string;
  active: boolean;
  mark: ConversationMark | null;
  renaming: boolean;
  onOpen: () => void;
  onPin: () => void;
  onArchive: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}> = ({ conversation: c, parentTitle, active, mark, renaming, onOpen, onPin, onArchive, onStartRename, onRename, onDelete }) => {
  const [menuOpen, setMenuOpen] = useState(false);
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
  const archiveLabel = c.archived ? '取消归档' : '归档';
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn('group relative flex items-center rounded-md hover:bg-accent has-focus-visible:bg-accent', (active || menuOpen) && 'bg-accent')}>
          {/* 停一会儿显示预览：第一句、最近说的、从哪个对话重新问的 */}
          <HoverCard openDelay={700} closeDelay={80}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                onClick={onOpen}
                onDoubleClick={onStartRename}
                className={cn(
                  'min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm',
                  active && 'font-medium',
                  c.archived && 'text-muted-foreground'
                )}
              >
                {c.title}
              </button>
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start" className="flex w-72 flex-col gap-2 p-3 text-sm">
              <div className="font-medium">{c.title}</div>
              {parentTitle && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CornerUpLeft className="size-3.5 shrink-0" />
                  <span className="truncate">从「{parentTitle}」重新问</span>
                </div>
              )}
              {c.firstMessage && c.firstMessage !== c.title && <p className="line-clamp-3 text-muted-foreground">{c.firstMessage}</p>}
              {c.recent && (
                <div>
                  <div className="text-xs text-muted-foreground">最近</div>
                  <p className="line-clamp-3">{c.recent}</p>
                </div>
              )}
              <div className="text-xs text-muted-foreground">{formatRelative(c.modified)}</div>
            </HoverCardContent>
          </HoverCard>
          {/* 状态常驻；悬停、键盘移到这一行或菜单打开时，操作盖在右端（一直可以用 Tab 到达，只是看不见） */}
          {mark && (
            <span
              role="img"
              aria-label={MARK[mark].label}
              title={MARK[mark].label}
              className={cn('flex size-6 shrink-0 items-center justify-center pr-1 group-hover:invisible group-has-focus-visible:invisible', menuOpen && 'invisible')}
            >
              {MARK[mark].icon}
            </span>
          )}
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md bg-accent pr-1 pl-1 opacity-0',
              'group-hover:pointer-events-auto group-hover:opacity-100 group-has-focus-visible:pointer-events-auto group-has-focus-visible:opacity-100',
              menuOpen && 'pointer-events-auto opacity-100'
            )}
          >
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={action} title="更多" aria-label={`更多操作：${c.title}`}>
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              {/* 重命名时输入框要拿到焦点：关菜单后不把焦点还给按钮 */}
              <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenuItem onSelect={onStartRename}>重命名</DropdownMenuItem>
                <DropdownMenuItem onSelect={onArchive}>{archiveLabel}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  删除…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!c.archived && (
              <button type="button" onClick={onPin} className={action} title={c.pinned ? '取消置顶' : '置顶'} aria-label={`${c.pinned ? '取消置顶' : '置顶'}：${c.title}`}>
                {c.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </button>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={onStartRename}>重命名</ContextMenuItem>
        <ContextMenuItem onSelect={onArchive}>{archiveLabel}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          删除…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
