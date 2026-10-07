import { useCallback, useSyncExternalStore } from 'react';

/** 实际生效的主题 */
export type Theme = 'light' | 'dark';

/** 外观偏好：浅色 / 深色 / 跟随系统 */
export type ThemePreference = Theme | 'system';

const STORAGE_KEY = 'theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // 存储不可用时按跟随系统处理
  }
  return 'system';
}

let preference: ThemePreference = readPreference();

const resolve = (p: ThemePreference): Theme => (p === 'system' ? (media().matches ? 'dark' : 'light') : p);

function apply() {
  document.documentElement.setAttribute('data-theme', resolve(preference));
  listeners.forEach((l) => l());
}

apply();
media().addEventListener('change', () => {
  if (preference === 'system') apply();
});

function setPreference(next: ThemePreference) {
  preference = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 忽略：仅本次会话生效
  }
  apply();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * 主题（全局单一状态，多个组件使用时保持同步）：写 <html data-theme>，偏好存 localStorage。
 * theme 为实际生效的浅色 / 深色；preference 含「跟随系统」。
 */
export const useTheme = () => {
  const pref = useSyncExternalStore(subscribe, () => preference);
  const theme = useSyncExternalStore(subscribe, () => resolve(preference));
  const toggleTheme = useCallback(() => setPreference(resolve(preference) === 'dark' ? 'light' : 'dark'), []);
  return { theme, preference: pref, setPreference, toggleTheme };
};
