import React, { useState } from 'react';
import { Check, ChevronDown, Clapperboard, Copy, Languages, Layers, Loader2, Pencil, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { Job } from '@/types/job';
import type { VideoPlanInfo } from '@/types/video';

/**
 * 剪辑编辑器顶栏按工作流程收拢的两个菜单（第三步是主按钮「开始切分」）：
 * ① 字幕：整理字幕（AI 断句、补中文），按钮上显示进度或还剩多少条；
 * ② 规划：一个视频可以按不同主题 / 意图规划多批——切换、新建、复制、改名、删除规划，
 *    以及在当前规划里 AI 规划 / 按字幕自动切分、查看切出的片段。
 */

export const SubtitleMenu: React.FC<{
  /** 正在整理整部字幕的任务 */
  job: Job | undefined;
  /** 还没整理的字幕条数 */
  pending: number;
  disabled?: boolean;
  onPrepare: () => void;
}> = ({ job, pending, disabled, onPrepare }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" disabled={disabled}>
        <Languages />
        字幕
        {job ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          pending > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 tabular-nums">
              {pending}
            </Badge>
          )
        )}
        <ChevronDown className="opacity-60" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-72">
      {job ? (
        <div className="space-y-2 px-2 py-1.5 text-sm">
          <div className="flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            正在整理字幕
            {job.total > 0 && (
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {job.current} / {job.total}
              </span>
            )}
          </div>
          {job.total > 0 && <Progress value={(job.current / job.total) * 100} className="h-1" />}
          <p className="text-xs text-muted-foreground">翻完一块显示一块，可以先去编辑</p>
        </div>
      ) : (
        <>
          <DropdownMenuItem onSelect={onPrepare} disabled={pending === 0}>
            <Languages />
            <span className="flex-1">整理字幕</span>
            <span className="text-xs text-muted-foreground">{pending > 0 ? `${pending} 条` : '已整理'}</span>
          </DropdownMenuItem>
          <p className="px-2 pb-1.5 text-xs text-muted-foreground">AI 把断行拆开的句子连起来，并补上中文</p>
        </>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
);

export interface PlanMenuProps {
  plans: VideoPlanInfo[];
  currentId: number;
  /** 每个规划切出了几段（起止与片段相同的短片） */
  cutCount: (plan: VideoPlanInfo) => number;
  /** 这个视频一共切出的片段 */
  clipCount: number;
  disabled?: boolean;
  onSwitch: (id: number) => void;
  onCreate: (copy: boolean) => void;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
  onAiPlan: () => void;
  onAutoSplit: () => void;
  onViewClips: () => void;
}

export const PlanMenu: React.FC<PlanMenuProps> = ({
  plans,
  currentId,
  cutCount,
  clipCount,
  disabled,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onAiPlan,
  onAutoSplit,
  onViewClips,
}) => {
  const current = plans.find((p) => p.id === currentId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="max-w-56" disabled={disabled}>
            <Layers />
            <span className="truncate">{current?.name ?? '规划'}</span>
            {plans.length > 1 && (
              <Badge variant="secondary" className="h-5 px-1.5 tabular-nums">
                {plans.length}
              </Badge>
            )}
            <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs text-muted-foreground">规划（同一个视频可以从不同角度切）</DropdownMenuLabel>
          {plans.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => onSwitch(p.id)}>
              <Check className={p.id === currentId ? 'opacity-100' : 'opacity-0'} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {p.plan.segments.length} 段{cutCount(p) > 0 && ` · 切出 ${cutCount(p)}`}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => onCreate(false)}>
            <Plus />
            新建规划
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCreate(true)} disabled={!current || current.plan.segments.length === 0}>
            <Copy />
            复制当前规划
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">在「{current?.name}」里</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onAiPlan}>
            <Sparkles />
            AI 规划…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAutoSplit}>
            <Wand2 />
            按字幕自动切分…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setName(current?.name ?? '');
              setRenaming(true);
            }}
          >
            <Pencil />
            改名…
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)} disabled={plans.length <= 1}>
            <Trash2 />
            删除这个规划…
          </DropdownMenuItem>
          {clipCount > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onViewClips}>
                <Clapperboard />
                查看切出的片段（{clipCount}）
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={renaming} onOpenChange={setRenaming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>规划改名</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            value={name}
            maxLength={30}
            autoFocus
            placeholder="如：点餐场景"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && name.trim() && (await onRename(name.trim()))) setRenaming(false);
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={!name.trim()}
              onClick={async (e) => {
                e.preventDefault();
                if (await onRename(name.trim())) setRenaming(false);
              }}
            >
              保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除规划「{current?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>规划里的片段安排会删除；已经切出的片段保留在视频库里。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
