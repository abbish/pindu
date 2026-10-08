/**
 * 启动画面（index.html 里的 #boot）的控制：更新进度文字、就绪后淡出并移除。
 * 启动画面写在 index.html 里，前端代码加载之前就能显示；这里只操作那几个元素。
 */
import type { StartupStatus } from '../types';

/** 最短显示时间（毫秒，从页面开始加载算起）：动画约 1 秒播完，再停留一下完整的「拼读 Pindu.app」，启动很快时也不一闪而过 */
const MIN_VISIBLE_MS = 1300;
/** 淡出时长，与 index.html 的 #boot transition 一致 */
const FADE_MS = 360;

/** 启动阶段 → 进度文字 */
export function bootStatusText(status: Pick<StartupStatus, 'phase' | 'detail'> | null): string {
  switch (status?.phase) {
    case 'opening':
      return '正在打开数据…';
    case 'backing_up':
      return '正在备份数据，准备升级…';
    case 'upgrading':
      return status.detail ? `正在升级数据（版本 ${status.detail}）…` : '正在升级数据…';
    case 'ready':
      return '准备就绪';
    default:
      return '正在启动…';
  }
}

export function setBootStatus(text: string): void {
  const el = document.getElementById('boot-status');
  if (el && el.textContent !== text) el.textContent = text;
}

let finishing = false;

/** 动画至少播完一轮后淡出，再从页面移除（重复调用无害） */
export function finishBoot(): void {
  const boot = document.getElementById('boot');
  if (!boot || finishing) return;
  finishing = true;
  const wait = Math.max(0, MIN_VISIBLE_MS - performance.now());
  window.setTimeout(() => {
    boot.classList.add('boot-done');
    window.setTimeout(() => boot.remove(), FADE_MS + 40);
  }, wait);
}
