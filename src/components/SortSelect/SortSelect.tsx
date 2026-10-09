import React, { useState } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** 列表的排序选择（放在工具栏筛选后面）；排序项与比较函数见 utils/sorting */
export const SortSelect: React.FC<{ value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; className?: string }> = ({
  value,
  options,
  onChange,
  className,
}) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className={cn('w-36', className)} aria-label="排序">
      <ArrowDownUp className="text-muted-foreground" />
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const storageKey = (id: string) => `pindu.sort.${id}`;

/** 每个列表记住上次选的排序（本机偏好，读不到时用默认） */
export function useSortPref(id: string, options: { value: string }[], fallback = options[0]?.value ?? ''): [string, (value: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey(id));
      if (saved && options.some((o) => o.value === saved)) return saved;
    } catch {
      // 存储不可用：用默认
    }
    return fallback;
  });
  const set = (next: string) => {
    setValue(next);
    try {
      localStorage.setItem(storageKey(id), next);
    } catch {
      // 存储不可用：只在本次生效
    }
  };
  return [value, set];
}
