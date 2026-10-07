import React from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface PanelToolbarAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** 进行中：显示加载图标 */
  spinning?: boolean;
  title?: string;
}

export interface PanelToolbarProps {
  /** 左侧说明（状态 / 来源） */
  meta?: React.ReactNode;
  actions: PanelToolbarAction[];
}

/**
 * 右栏页签共用的工具条：左侧状态说明，右侧 AI 操作按钮（例句、单词讲解保持同一交互与样式）。
 */
export const PanelToolbar: React.FC<PanelToolbarProps> = ({ meta, actions }) => (
  <div className="flex items-center justify-between gap-2 border-t pt-3">
    <span className="min-w-0 truncate text-xs text-muted-foreground">{meta}</span>
    <span className="flex shrink-0 gap-1">
      {actions.map(({ key, label, icon: Icon, onClick, disabled, spinning, title }) => (
        <Button key={key} variant="ghost" size="sm" onClick={onClick} disabled={disabled} title={title ?? label}>
          {spinning ? <Loader2 className="animate-spin" /> : <Icon />}
          {label}
        </Button>
      ))}
    </span>
  </div>
);
