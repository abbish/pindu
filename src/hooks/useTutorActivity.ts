import { useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { tutorService } from '../services/tutorService';
import type { TutorEventPayload } from '../types/tutor';
import { applyActivity, EMPTY_ACTIVITY, forgetActivity, type TutorActivityState } from '../utils/tutorActivity';

/**
 * AI 老师各对话在回答 / 等回答的全局状态（模块级单例，同 useJobs 的写法）：App 启动时取一次，之后只听 `tutor-event` 里的
 * `redlark_activity`（D58）。侧边栏「AI 老师」的标记用它；不是后台任务。
 */

let state: TutorActivityState = EMPTY_ACTIVITY;
let started = false;
/** 删掉的对话：之后到达的事件（进程关掉时的最后一条）不再显示 */
const deleted = new Set<string>();
const listeners = new Set<() => void>();

function set(next: TutorActivityState) {
  state = next;
  listeners.forEach((l) => l());
}

/** 开始同步（App 启动时调用一次） */
export async function startTutorActivitySync() {
  if (started) return;
  started = true;
  // 先听事件再取初始状态：事件先到的对话以事件为准
  const touched = new Set<string>();
  await listen<TutorEventPayload>('tutor-event', ({ payload }) => {
    const { conversationId: id, event } = payload;
    if (event.type !== 'redlark_activity' || deleted.has(id)) return;
    const { running, asking } = event as { running: boolean; asking: boolean };
    touched.add(id);
    set(applyActivity(state, id, running, asking, Date.now()));
  });
  const result = await tutorService.activity();
  if (!result.success) return;
  set(
    result.data
      .filter((a) => !touched.has(a.conversationId))
      .reduce((s, a) => applyActivity(s, a.conversationId, a.running, a.asking, Date.now()), state)
  );
}

/** 对话删掉了 */
export function forgetTutorActivity(id: string) {
  deleted.add(id);
  set(forgetActivity(state, id));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTutorActivity(): TutorActivityState {
  return useSyncExternalStore(subscribe, () => state);
}
