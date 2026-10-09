import React from 'react';
import { ArchiveRestore } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { WordBookIcon } from '@/components/WordBookIcon/WordBookIcon';
import { cn } from '@/lib/utils';
import { formatRelativeDay, sameMinute } from '@/utils/datetime';
import { TagChips } from '@/components/MaterialToolbar/MaterialToolbar';
import type { Tag } from '@/types/material';
import type { Job } from '@/types/job';
import { JobProgress } from '@/components/Jobs';
import { CardMenu, CardMenuButton, SelectCheckbox, type CardAction } from '@/components/MaterialSelection/MaterialSelection';

export interface WordBookSummaryCardProps {
  /** 单词本名称 */
  title: string;
  /** 描述 */
  description?: string | null;
  /** 总单词数 */
  totalWords: number;
  /** 关联计划数 */
  linkedPlans: number;
  /** 词性统计 */
  wordTypes: { nouns: number; verbs: number; adjectives: number; others: number };
  /** 创建时间（数据库时间戳） */
  createdAt: string;
  /** 最近使用（数据库时间戳；默认等于创建时间） */
  lastUsed?: string | null;
  /** 图标名称（单词本 icon） */
  icon?: string | null;
  /** 图标颜色（单词本 icon_color） */
  iconColor?: string | null;
  /** 状态：已删除时在名称旁显示标签 */
  status?: 'normal' | 'deleted' | string;
  /** 打开详情 */
  onOpen: () => void;
  /** 恢复（只对已删除的单词本显示「恢复」按钮） */
  onRestore?: () => void;
  /** 标签 */
  tags?: Tag[];
  /** ⋯ 菜单与右键菜单（同一组操作） */
  actions?: CardAction[];
  /** 多选：勾选状态；不传则不能勾选（如已删除的） */
  select?: { checked: boolean; selecting: boolean; onToggle: () => void };
  /** 正在跑的后台任务（AI 分析单词）：词性构成的位置换成进度 */
  job?: Job;
}

const SEGMENTS = [
  { key: 'nouns', label: '名词', color: 'bg-chart-1' },
  { key: 'verbs', label: '动词', color: 'bg-chart-2' },
  { key: 'adjectives', label: '形容词', color: 'bg-chart-3' },
  { key: 'others', label: '其他', color: 'bg-chart-4' },
] as const;

/**
 * 单词本摘要卡（shadcn），单词本列表页使用。
 * 信息层级：名称与描述 → 单词数（主数字）与计划使用情况 → 词性构成条 → 时间（一行相对日期）。
 */
export const WordBookSummaryCard: React.FC<WordBookSummaryCardProps> = ({
  title,
  description,
  totalWords,
  linkedPlans,
  wordTypes,
  createdAt,
  lastUsed,
  status,
  icon,
  iconColor,
  tags = [],
  onOpen,
  onRestore,
  actions,
  select,
  job,
}) => {
  const typedTotal = SEGMENTS.reduce((sum, s) => sum + wordTypes[s.key], 0);
  const neverUsed = !lastUsed || sameMinute(lastUsed, createdAt);
  const timeLabel = neverUsed ? `创建于 ${formatRelativeDay(createdAt)}` : `最近使用 ${formatRelativeDay(lastUsed)}`;

  const card = (
    <Card
      className={cn('group relative gap-4 p-4 transition-colors hover:border-ring/60', status === 'deleted' && 'opacity-70', select?.checked && 'border-primary ring-2 ring-primary/30')}
      onClick={() => (select?.selecting ? select.onToggle() : onOpen())}
    >
      {select && <SelectCheckbox checked={select.checked} selecting={select.selecting} onToggle={select.onToggle} label={`选择「${title}」`} className="top-1.5 left-1.5" />}
      <div className="flex items-start gap-3">
        <WordBookIcon icon={icon} color={iconColor} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="truncate text-left font-semibold outline-none focus-visible:underline"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
            >
              {title}
            </button>
            {status === 'deleted' && <Badge variant="outline" className="shrink-0 border-transparent bg-destructive/10 text-destructive">已删除</Badge>}
            {status === 'deleted' && onRestore && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore();
                }}
              >
                <ArchiveRestore />
                恢复
              </Button>
            )}
            {actions && status !== 'deleted' && <CardMenuButton actions={actions} className="ml-auto shrink-0" />}
          </div>
          <p className={cn('truncate text-sm', description ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
            {description || '暂无描述'}
          </p>
        </div>
      </div>
      <TagChips tags={tags} />

      <div className="flex items-end justify-between gap-2">
        <div className="leading-none">
          <span className="text-2xl font-semibold tabular-nums">{totalWords}</span>
          <span className="ml-1 text-sm text-muted-foreground">个单词</span>
        </div>
        {linkedPlans > 0 ? (
          <Badge variant="outline" className="border-transparent bg-accent text-accent-foreground">
            用于 {linkedPlans} 个计划
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">未加入计划</span>
        )}
      </div>

      <div className="space-y-1.5">
        {job ? (
          <JobProgress job={job} fallback="AI 正在分析单词" />
        ) : typedTotal > 0 ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-label="词性构成">
                  {SEGMENTS.map((s) =>
                    wordTypes[s.key] > 0 ? (
                      <div key={s.key} className={s.color} style={{ width: `${(wordTypes[s.key] / typedTotal) * 100}%` }} />
                    ) : null
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {SEGMENTS.map((s) => `${s.label} ${wordTypes[s.key]}`).join(' · ')}
              </TooltipContent>
            </Tooltip>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {SEGMENTS.filter((s) => wordTypes[s.key] > 0).map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1">
                  <span className={cn('size-2 rounded-full', s.color)} />
                  {s.label} {wordTypes[s.key]}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">暂无词性统计</div>
        )}
      </div>

      <div className="border-t pt-3 text-xs text-muted-foreground">{timeLabel}</div>
    </Card>
  );
  return actions ? <CardMenu actions={actions}>{card}</CardMenu> : card;
};
