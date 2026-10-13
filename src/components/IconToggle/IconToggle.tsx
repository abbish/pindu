import React from 'react';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * 工具栏上的图标开关：只有图标，悬停显示名字，开着时图标变主题色并带浅底
 * （按 aria-pressed 上色：外面的 Tooltip 会覆盖 Toggle 的 data-state）。短文朗读与场景片段共用。
 */
export const IconToggle: React.FC<{ label: string; pressed: boolean; onPressedChange: (on: boolean) => void; disabled?: boolean; children: React.ReactNode }> = ({
  label,
  pressed,
  onPressedChange,
  disabled,
  children,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Toggle
        size="sm"
        className="size-8 p-0 text-muted-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary hover:aria-pressed:bg-primary/15"
        pressed={pressed}
        onPressedChange={onPressedChange}
        disabled={disabled}
        aria-label={label}
      >
        {children}
      </Toggle>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);
