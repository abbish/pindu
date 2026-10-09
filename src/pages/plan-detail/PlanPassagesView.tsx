import React, { useState } from 'react';
import { BookOpenCheck, FileText, Loader2, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PASSAGE_STATUS, intervalLabel, taskLabel } from '@/components/PlanPassagePicker';
import { cn } from '@/lib/utils';
import { formatDate, formatWeekday } from '@/utils/datetime';
import { LEVEL_LABEL, scoreSummary } from '@/utils/passage';
import type { PlanPassage } from '@/types/passage';

export interface PlanPassagesViewProps {
  /** 计划里的短文任务（按顺序） */
  items: PlanPassage[];
  loading: boolean;
  /** 短文每几天一篇 */
  intervalDays: number;
  /** 计划当前能否练习（待开始 / 进行中） */
  canPractice: boolean;
  /** 打开短文（朗读、查看） */
  onOpen: (item: PlanPassage) => void;
  /** 按计划安排的题组与方式练习 */
  onPractice: (item: PlanPassage) => void;
  /** 只朗读的任务：读完了 */
  onMarkRead: (item: PlanPassage) => Promise<void>;
}

/**
 * 计划详情「短文」页签：每篇短文的日期、题组与方式、状态与成绩。
 * 到期（今天 / 逾期）的任务可以练习；只朗读的任务打开短文读完后点「读完了」。
 */
export const PlanPassagesView: React.FC<PlanPassagesViewProps> = ({ items, loading, intervalDays, canPractice, onOpen, onPractice, onMarkRead }) => {
  const [marking, setMarking] = useState<number | null>(null);

  if (loading) return <Skeleton className="h-64 rounded-xl" />;
  if (items.length === 0) {
    return (
      <EmptyState icon={<FileText />} title="计划里还没有短文" description="在「设置」页签里添加短文" />
    );
  }

  const done = items.filter((i) => i.status === 'completed').length;

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center justify-between border-b px-4 py-3 text-sm">
        <span>
          已完成 <span className="font-medium tabular-nums">{done}</span> / {items.length} 篇
          <span className="text-muted-foreground"> · {intervalLabel(intervalDays)}</span>
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32 pl-4">日期</TableHead>
            <TableHead>短文</TableHead>
            <TableHead className="w-44">任务</TableHead>
            <TableHead className="w-48">结果</TableHead>
            <TableHead className="w-48 pr-4 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const status = PASSAGE_STATUS[item.status];
            const actionable = canPractice && (item.status === 'due' || item.status === 'overdue');
            const readOnly = item.setId === null;
            return (
              <TableRow key={item.id} className={cn(item.status === 'due' && 'bg-accent/30')}>
                <TableCell className="pl-4 tabular-nums">
                  {formatDate(item.scheduledDate)}
                  <span className="ml-1 text-xs text-muted-foreground">{formatWeekday(item.scheduledDate)}</span>
                </TableCell>
                <TableCell>
                  <button type="button" className="block max-w-full truncate text-left font-medium hover:underline" onClick={() => onOpen(item)}>
                    {item.title}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {LEVEL_LABEL[item.level] ?? item.level} · {item.wordCount} 词
                  </div>
                </TableCell>
                <TableCell className="text-sm">{taskLabel(item.setName, item.setId, item.mode, item.isVideo)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={cn('border-transparent font-normal', status.className)}>
                      {status.label}
                    </Badge>
                    {item.attempt ? (
                      <span className="text-xs text-muted-foreground">{scoreSummary(item.attempt)}</span>
                    ) : item.completedAt ? (
                      <span className="text-xs text-muted-foreground">{formatDate(item.completedAt)}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="pr-4 text-right">
                  {actionable && !readOnly && (
                    <Button size="sm" onClick={() => onPractice(item)}>
                      <Play />
                      开始练习
                    </Button>
                  )}
                  {actionable && readOnly && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => onOpen(item)}>
                        {item.isVideo ? '观看' : '朗读'}
                      </Button>
                      <Button
                        size="sm"
                        disabled={marking !== null}
                        onClick={async () => {
                          setMarking(item.id);
                          await onMarkRead(item);
                          setMarking(null);
                        }}
                      >
                        {marking === item.id ? <Loader2 className="animate-spin" /> : <BookOpenCheck />}
                        {item.isVideo ? '看完了' : '读完了'}
                      </Button>
                    </div>
                  )}
                  {/* 已完成且有题组：可以再练一次（和短文详情里的任务条一致；不改变完成状态） */}
                  {!actionable && canPractice && item.status === 'completed' && !readOnly && (
                    <Button size="sm" variant="outline" onClick={() => onPractice(item)}>
                      <Play />
                      再练一次
                    </Button>
                  )}
                  {!actionable && !(canPractice && item.status === 'completed' && !readOnly) && (
                    <Button size="sm" variant="ghost" onClick={() => onOpen(item)}>
                      查看短文
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
};
