import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** 图标（lucide 元素） */
  icon: React.ReactNode;
  /** 标题 */
  title: string;
  /** 一句说明 */
  description?: string;
  /** 主操作文案；不传则不显示按钮 */
  action?: string;
  /** 主操作图标 */
  actionIcon?: React.ReactNode;
  /** 主操作回调 */
  onAction?: () => void;
  /** 额外样式（如 col-span-full） */
  className?: string;
  /** 自定义操作区（多个操作时用，替代 action） */
  children?: React.ReactNode;
}

/** 空状态：图标 + 标题 + 一句说明 + 主操作（ui-interaction-patterns.md §3 反馈与状态） */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, actionIcon, onAction, className, children }) => (
  <Card className={cn('items-center gap-2 border-dashed px-6 py-10 text-center shadow-none', className)}>
    <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div>
    <div className="font-semibold">{title}</div>
    {description && <p className="text-sm text-muted-foreground">{description}</p>}
    {action && onAction && (
      <Button className="mt-2" onClick={onAction}>
        {actionIcon}
        {action}
      </Button>
    )}
    {children && <div className="mt-2">{children}</div>}
  </Card>
);
