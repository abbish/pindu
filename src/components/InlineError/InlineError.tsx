import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InlineErrorProps {
  /** 哪一步失败：“无法保存” */
  title?: string;
  /** 原因（直接用 `result.error`） */
  children?: React.ReactNode;
  /** 原因下方的操作（如“用默认顺序创建”） */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * 弹窗 / 表单 / 卡片内的错误（提交失败、校验未通过的整体原因）：留在出错的地方，不用 toast。
 * 规范：ui-interaction-patterns.md §6
 */
export const InlineError: React.FC<InlineErrorProps> = ({ title, children, actions, className }) => (
  <div className={cn('space-y-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive', className)} role="alert">
    <p className="flex items-start gap-2">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        {title && children ? `${title}：` : title}
        {children}
      </span>
    </p>
    {actions && <div className="flex gap-2 pl-6 text-foreground">{actions}</div>}
  </div>
);
