import { useEffect, useState } from 'react';
import { tagService, TAGS_CHANGED_EVENT } from '@/services/tagService';
import type { TagUsage } from '@/types/material';

/** 一个标签下的素材总数 */
export const tagTotal = (t: TagUsage) => t.wordBooks + t.passages + t.clips + t.videos;

/**
 * 全部标签与各类素材数量（全局共享一份）：标签改动后（tagService 发 TAGS_CHANGED_EVENT）自动重新读取；
 * 素材增删之后由调用方 refreshTagUsage()（如侧边栏在换页、后台任务结束时）。
 */
let current: TagUsage[] | null = null;
const listeners = new Set<(tags: TagUsage[] | null) => void>();
let pending: Promise<void> | null = null;

export function refreshTagUsage(): Promise<void> {
  pending ??= tagService.getTags().then((r) => {
    pending = null;
    if (!r.success) return;
    current = r.data;
    listeners.forEach((l) => l(current));
  });
  return pending;
}

window.addEventListener(TAGS_CHANGED_EVENT, () => void refreshTagUsage());

export function useTagUsage(): TagUsage[] | null {
  const [tags, setTags] = useState(current);
  useEffect(() => {
    listeners.add(setTags);
    if (current === null) void refreshTagUsage();
    return () => {
      listeners.delete(setTags);
    };
  }, []);
  return tags;
}
