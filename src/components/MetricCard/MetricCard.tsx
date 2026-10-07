import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export interface MetricCardProps {
  /** 指标名称 */
  label: string;
  /** 数值 */
  value: React.ReactNode;
  /** 单位（个 / % / 天…），显示在数值后 */
  unit?: string;
  /** 右上角图标 */
  icon?: LucideIcon;
  /** 数值下方的补充说明 */
  hint?: React.ReactNode;
  /** 加载中显示骨架 */
  loading?: boolean;
}

/** 统计指标卡：名称 + 图标 / 数值 + 单位 / 可选说明。首页、学习计划、单词本、日历共用 */
export const MetricCard: React.FC<MetricCardProps> = ({ label, value, unit, icon: Icon, hint, loading }) => (
  <Card className="justify-between gap-2 px-5 py-4">
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      {label}
      {Icon && <Icon className="size-4" />}
    </div>
    {loading ? (
      <Skeleton className="h-8 w-16" />
    ) : (
      <div>
        <div className="text-2xl font-semibold tabular-nums">
          {value}
          {unit && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{unit}</span>}
        </div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    )}
  </Card>
);
