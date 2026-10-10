import React from 'react';
import { AlertTriangle, ArrowLeft, RotateCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export interface PageErrorProps {
  /** “无法加载 + 对象”，如“无法加载词汇本” */
  title: string;
  /** 原因（直接用 `result.error`）；多个数据源失败时传列表 */
  message?: React.ReactNode;
  /** 重试 */
  onRetry?: () => void;
  /** 返回上一级（对象已不存在时） */
  back?: { label: string; onClick: () => void };
}

/**
 * 页面级错误（加载失败、对象不存在）：主区内的 Alert，带重试 / 返回，不用 toast。
 * 规范：ui-interaction-patterns.md §6
 */
export const PageError: React.FC<PageErrorProps> = ({ title, message, onRetry, back }) => (
  <Alert variant="destructive">
    <AlertTriangle />
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>
      {message && <div>{message}</div>}
      {(onRetry || back) && (
        <div className="mt-2 flex gap-2 text-foreground">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCw />
              重试
            </Button>
          )}
          {back && (
            <Button variant="outline" size="sm" onClick={back.onClick}>
              <ArrowLeft />
              {back.label}
            </Button>
          )}
        </div>
      )}
    </AlertDescription>
  </Alert>
);
