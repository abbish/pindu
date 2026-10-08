import { useSyncExternalStore } from 'react';
import { updateService } from '../services/updateService';
import type { UpdateInfo } from '../types';

/**
 * 应用更新的全局状态（模块级单例，多个组件共享）：自动检查偏好、检查 / 下载 / 安装进度、跳过的版本。
 * 偏好与跳过的版本存 localStorage（同主题偏好）；自动检查与菜单「检查更新…」由 UpdateWatcher（App 级）负责。
 */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'downloading'; info: UpdateInfo; downloaded: number; total: number | null }
  | { kind: 'ready'; info: UpdateInfo }
  | { kind: 'failed'; info: UpdateInfo; error: string };

/** 一次检查的结果（给手动检查的调用方提示用） */
export type CheckResult = { kind: 'latest' } | { kind: 'available'; info: UpdateInfo } | { kind: 'error'; error: string };

const AUTO_CHECK_KEY = 'update.autoCheck';
const SKIPPED_KEY = 'update.skippedVersion';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 存储不可用时只在本次运行中生效
  }
}

interface Snapshot {
  state: UpdateState;
  autoCheck: boolean;
  skippedVersion: string | null;
  /** 本次运行中用户点了「稍后」的版本 */
  dismissedVersion: string | null;
}

let snapshot: Snapshot = {
  state: { kind: 'idle' },
  autoCheck: read(AUTO_CHECK_KEY) !== 'false',
  skippedVersion: read(SKIPPED_KEY),
  dismissedVersion: null,
};
const listeners = new Set<() => void>();
function set(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

/** 检查更新。manual = 用户主动检查：忽略「跳过此版本」与「稍后」 */
async function check(manual: boolean): Promise<CheckResult> {
  if (snapshot.state.kind === 'downloading' || snapshot.state.kind === 'ready') {
    return { kind: 'available', info: snapshot.state.info };
  }
  const previous = snapshot.state;
  set({ state: { kind: 'checking' } });
  const result = await updateService.checkForUpdate();
  if (!result.success) {
    set({ state: previous.kind === 'checking' ? { kind: 'idle' } : previous });
    return { kind: 'error', error: result.error };
  }
  if (!result.data) {
    set({ state: { kind: 'idle' } });
    return { kind: 'latest' };
  }
  const info = result.data;
  set({
    state: { kind: 'available', info },
    ...(manual ? { dismissedVersion: null, skippedVersion: null } : {}),
  });
  if (manual) write(SKIPPED_KEY, null);
  return { kind: 'available', info };
}

async function install() {
  const current = snapshot.state;
  if (current.kind !== 'available' && current.kind !== 'failed') return;
  const info = current.info;
  set({ state: { kind: 'downloading', info, downloaded: 0, total: null } });
  const result = await updateService.installUpdate(({ downloaded, total }) =>
    set({ state: { kind: 'downloading', info, downloaded, total } }),
  );
  set({ state: result.success ? { kind: 'ready', info } : { kind: 'failed', info, error: result.error } });
}

export const updater = {
  check,
  install,
  restart: () => updateService.restart(),
  setAutoCheck(on: boolean) {
    write(AUTO_CHECK_KEY, on ? 'true' : 'false');
    set({ autoCheck: on });
  },
  skip(version: string) {
    write(SKIPPED_KEY, version);
    set({ skippedVersion: version });
  },
  dismiss: (version: string) => set({ dismissedVersion: version }),
  get: () => snapshot,
};

export function useUpdater(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}
