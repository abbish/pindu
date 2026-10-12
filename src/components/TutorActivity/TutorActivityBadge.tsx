import React, { useState } from 'react';
import { CheckCircle2, Loader2, MessageCircleQuestionMark } from 'lucide-react';
import { SidebarMenuAction } from '@/components/ui/sidebar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { NAV_SEEN_SINCE, useNavSeen } from '@/hooks/useNavSeen';
import { useTutorActivity } from '@/hooks/useTutorActivity';
import { tutorService } from '@/services/tutorService';
import type { NavigateFn } from '@/navigation';
import { summarizeActivity, tutorSeenKey } from '@/utils/tutorActivity';

type RowState = 'asking' | 'running' | 'done';

const ROW_META: Record<RowState, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  asking: { label: '等你回答', icon: MessageCircleQuestionMark, className: 'text-warning' },
  running: { label: '正在回答', icon: Loader2, className: 'text-primary motion-safe:animate-spin' },
  done: { label: '有新回答', icon: CheckCircle2, className: 'text-success' },
};

/**
 * 侧边栏「AI 老师」右侧：与后台任务同样的数量标记——对话在回答时主色、呼吸的数量（开着几个对话同时在做就是几）；
 * 有对话停下来等你回答（确认、选择）时换成醒目色的数量；不在 AI 老师页面时有对话答完了还没打开看，是一个小点
 * （与对话列表的「有新回答」同一口径：打开那个对话才算看过）。
 * 点开列出这些对话，点一个直接打开。侧栏收起成图标时只在图标角上显示。不是后台任务（D58）。
 */
export const TutorActivityBadge: React.FC<{ current: boolean; onNavigate: NavigateFn }> = ({ current, onNavigate }) => {
  const activity = useTutorActivity();
  const seen = useNavSeen();
  const [open, setOpen] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const { asking, running, unseen } = summarizeActivity(activity, (id) => Math.max(NAV_SEEN_SINCE, seen.get(tutorSeenKey(id)) ?? 0), current);
  if (asking.length === 0 && running.length === 0 && unseen.length === 0 && !open) return null;

  const title = [
    asking.length > 0 && `${asking.length} 个对话在等你回答`,
    running.length > 0 && `${running.length} 个对话正在回答`,
    asking.length === 0 && running.length === 0 && '有新回答还没看',
  ]
    .filter(Boolean)
    .join('，');
  const rows: { id: string; state: RowState }[] = [
    ...asking.map((id) => ({ id, state: 'asking' as const })),
    ...running.map((id) => ({ id, state: 'running' as const })),
    ...unseen.map((id) => ({ id, state: 'done' as const })),
  ];

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) return;
    // 对话标题：列表在后端有缓存
    void tutorService.list().then((result) => {
      if (result.success) setTitles(Object.fromEntries(result.data.map((c) => [c.id, c.title])));
    });
  };

  const openConversation = (id: string) => {
    handleOpenChange(false);
    onNavigate('tutor', { conversationId: id, openAt: Date.now() });
  };

  return (
    <>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1.5 left-5 hidden size-2 rounded-full group-data-[collapsible=icon]:block',
          asking.length > 0 ? 'bg-warning' : running.length > 0 ? 'bg-primary motion-safe:animate-pulse' : 'bg-success'
        )}
      />
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <SidebarMenuAction aria-label={`AI 老师：${title}`} title={title} className="aspect-auto w-auto min-w-5 px-0.5">
            {asking.length > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[11px] leading-none font-medium text-background tabular-nums">
                {asking.length}
              </span>
            ) : running.length > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] leading-none font-medium text-primary-foreground tabular-nums motion-safe:animate-pulse">
                {running.length}
              </span>
            ) : (
              <span className="size-2 rounded-full bg-success" />
            )}
          </SidebarMenuAction>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-80 p-0">
          <div className="border-b px-3 py-2 text-sm font-medium">AI 老师</div>
          <div className="max-h-80 overflow-y-auto p-1">
            {rows.map(({ id, state }) => {
              const meta = ROW_META[state];
              const Icon = meta.icon;
              return (
                <button
                  key={id}
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  onClick={() => openConversation(id)}
                >
                  <Icon className={cn('size-4 shrink-0', meta.className)} />
                  <span className="min-w-0 flex-1 truncate text-sm">{titles[id] ?? '对话'}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
};
