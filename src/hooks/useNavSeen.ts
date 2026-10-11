import { useSyncExternalStore } from 'react';

/**
 * 侧边栏各入口上次「看过」的时刻（模块级单例）：后台任务、AI 老师对话结束后，之后没看过的结果在菜单上显示小点。
 * 键是侧边栏一级页面键（进入 / 离开页面时记，AppShell）与浮层（点开后关上时记）。
 */

let seenAt: ReadonlyMap<string, number> = new Map();
const listeners = new Set<() => void>();

/** 打开应用的时刻：之前结束的都不算没看过 */
export const NAV_SEEN_SINCE = Date.now();

/** 记下这个入口看过了（每次整体替换，订阅方据此重画） */
export function markNavSeen(key: string) {
  seenAt = new Map(seenAt).set(key, Date.now());
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNavSeen(): ReadonlyMap<string, number> {
  return useSyncExternalStore(subscribe, () => seenAt);
}
