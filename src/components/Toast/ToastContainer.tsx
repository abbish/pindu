import React, { createContext, useContext, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastData {
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  /** 提示上的操作按钮（如“撤销”） */
  action?: { label: string; onClick: () => void };
  /** 同一 id 的提示只保留一条（后来的替换先前的），用于可能连续触发的失败，如自动朗读 */
  id?: string;
}

/**
 * 轻提示接口。写法规范：ui-interaction-patterns.md §6
 * - title：一句结果（成功“已删除 3 个单词”，失败“无法删除单词”），不加句号、不用“错误”“操作失败”这类空话
 * - message：失败时放原因（直接用 `result.error`，客户端已转成用户能看懂的说法）；成功时只在有后续影响时补充
 */
interface ToastContextType {
  /** 需要操作按钮（如“撤销”）或自定义时长时用 */
  showToast: (toast: ToastData) => void;
  showSuccess: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
  showWarning: (title: string, message?: string) => void;
  showInfo: (title: string, message?: string) => void;
}

/** 各类型默认显示时长（毫秒）：成功 / 提示一闪而过，警告与错误带原因，留更久便于阅读 */
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 6000,
};

const show = ({ type, title, message, duration, action, id }: ToastData) =>
  toast[type](title, {
    id,
    description: message,
    // 带操作的提示留足时间去点（如删除后的“撤销”）
    duration: duration ?? (action ? 8000 : DEFAULT_DURATION[type]),
    action,
  });

/** 模块级常量：引用永远稳定（调用方常把 toast 放进 effect / useCallback 依赖，曾因引用不稳导致日历页无限请求） */
const CONTEXT_VALUE: ToastContextType = {
  showToast: show,
  showSuccess: (title, message) => show({ type: 'success', title, message }),
  showError: (title, message) => show({ type: 'error', title, message }),
  showWarning: (title, message) => show({ type: 'warning', title, message }),
  showInfo: (title, message) => show({ type: 'info', title, message }),
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

/** 轻提示（shadcn sonner）；返回值引用稳定，可以放进 effect / useCallback 依赖 */
export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ToastContext.Provider value={CONTEXT_VALUE}>
    {children}
    {/* 右下角：不挡页头操作与弹窗关闭按钮（桌面应用通知的惯常位置） */}
    <Toaster position="bottom-right" closeButton richColors={false} />
  </ToastContext.Provider>
);
