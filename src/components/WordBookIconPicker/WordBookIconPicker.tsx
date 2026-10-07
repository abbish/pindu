import React from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WORD_BOOK_COLORS, WORD_BOOK_ICONS, WordBookIcon, normalizeBookColor } from '@/components/WordBookIcon/WordBookIcon';
import { cn } from '@/lib/utils';

export interface WordBookIconPickerProps {
  /** 图标（WORD_BOOK_ICONS 的 value） */
  icon: string;
  /** 颜色（WORD_BOOK_COLORS 的 value） */
  color: string;
  /** 选择变化 */
  onChange: (next: { icon: string; color: string }) => void;
  /** 触发按钮样式（尺寸与旁边的输入框对齐） */
  className?: string;
}

/**
 * 图标与颜色选择（Notion / Linear 的“名称前图标”模式）：点名称左边的图标打开浮层，上面选图标、下面选颜色，图标预览即用当前颜色。
 */
export const WordBookIconPicker: React.FC<WordBookIconPickerProps> = ({ icon, color, onChange, className }) => {
  const current = normalizeBookColor(color);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="选择图标和颜色"
          title="选择图标和颜色"
          className={cn('shrink-0 rounded-lg outline-none transition-transform hover:scale-105 focus-visible:ring-[3px] focus-visible:ring-ring/50', className)}
        >
          <WordBookIcon icon={icon} color={current} className="size-full" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="text-xs font-medium text-muted-foreground">图标</div>
        <div className="mt-2 grid grid-cols-8 gap-1" role="radiogroup" aria-label="图标">
          {WORD_BOOK_ICONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={icon === value}
              aria-label={label}
              title={label}
              onClick={() => onChange({ icon: value, color: current })}
              className={cn(
                'flex size-8 items-center justify-center rounded-md outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
                icon === value && 'bg-accent text-accent-foreground ring-1 ring-primary'
              )}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
        <div className="mt-3 text-xs font-medium text-muted-foreground">颜色</div>
        <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="颜色">
          {WORD_BOOK_COLORS.map(({ value, label, swatch }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={current === value}
              aria-label={label}
              title={label}
              onClick={() => onChange({ icon, color: value })}
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-white outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                swatch,
                current === value && 'ring-2 ring-ring ring-offset-2 ring-offset-popover'
              )}
            >
              {current === value && <Check className="size-3.5" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
