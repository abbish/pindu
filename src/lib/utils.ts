import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 合并 Tailwind 类名：条件拼接 + 冲突类去重（shadcn 约定） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
