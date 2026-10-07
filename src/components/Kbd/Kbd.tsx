import React from 'react';
import { cn } from '@/lib/utils';

/** 键盘按键提示（如 Enter、⌘K） */
export const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <kbd className={cn('inline-flex h-5 items-center rounded border bg-muted px-1.5 font-sans text-[11px] font-medium text-muted-foreground', className)}>
    {children}
  </kbd>
);
