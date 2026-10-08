import React from 'react';
import { History, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { formatDate, formatDuration, formatTime, formatWeekday } from '@/utils/datetime';
import type { PracticeSession } from '@/types';
import type { NavigateFn } from '@/navigation';

export interface PlanLogsViewProps {
  /** 该计划的练习会话 */
  practiceSessions: PracticeSession[];
  /** 加载中 */
  loading: boolean;
  /** 页面跳转（继续练习） */
  onNavigate?: NavigateFn;
  /** 计划当前能否练习（待开始 / 进行中） */
  canPractice: boolean;
}

/** 学习日志：这个计划的全部练习会话；未完成的可以继续练习 */
export const PlanLogsView: React.FC<PlanLogsViewProps> = ({ practiceSessions, loading, onNavigate, canPractice }) => {
  if (loading) {
    return <Skeleton className="h-64 rounded-xl" />;
  }
  if (practiceSessions.length === 0) {
    return <EmptyState icon={<History />} title="还没有练习记录" />;
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>日程日期</TableHead>
            <TableHead>练习时间</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">练习时长</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {practiceSessions.map((session) => {
            const date = session.scheduleDate.slice(0, 10);
            return (
              <TableRow key={session.sessionId}>
                <TableCell>
                  {formatDate(date)} <span className="text-muted-foreground">{formatWeekday(date)}</span>
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatTime(session.startTime)}
                  {session.endTime && <> – {formatTime(session.endTime)}</>}
                </TableCell>
                <TableCell>
                  {session.completed ? (
                    <Badge variant="outline" className="border-transparent bg-success-soft text-success">已完成</Badge>
                  ) : (
                    <Badge variant="outline" className="border-transparent bg-warning-soft text-warning">未完成</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(session.activeTime)}
                  {session.pauseCount > 0 && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      （暂停 {session.pauseCount} 次，共 {formatDuration(session.totalTime)}）
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!session.completed && canPractice && (
                    <Button
                      size="sm"
                      onClick={() =>
                        onNavigate?.('word-practice', { planId: session.planId, scheduleId: session.scheduleId, sessionId: session.sessionId })
                      }
                    >
                      <Play />
                      继续练习
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
