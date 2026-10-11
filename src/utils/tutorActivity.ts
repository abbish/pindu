/**
 * 侧边栏「AI 老师」的标记：各对话在回答 / 等学习者回答，以及不在 AI 老师页面时答完的对话。纯函数，有 node 测试。
 * 状态来自后端的 redlark_activity 事件与 get_tutor_activity（D58）。
 */

export interface TutorActivityState {
  /** 在回答或在等回答的对话 */
  live: Readonly<Record<string, { running: boolean; asking: boolean }>>;
  /** 答完的对话 → 答完的时刻（ms）；又开始回答时去掉 */
  finished: Readonly<Record<string, number>>;
}

export const EMPTY_ACTIVITY: TutorActivityState = { live: {}, finished: {} };

/** 一个对话的状态变了。从在回答变成不在回答（停止、结束、进程关掉）记为答完 */
export function applyActivity(state: TutorActivityState, id: string, running: boolean, asking: boolean, now: number): TutorActivityState {
  const wasRunning = state.live[id]?.running ?? false;
  const live = { ...state.live };
  if (running || asking) live[id] = { running, asking };
  else delete live[id];
  const finished = { ...state.finished };
  if (running) delete finished[id];
  else if (wasRunning) finished[id] = now;
  return { live, finished };
}

/** 对话删掉了：不再显示 */
export function forgetActivity(state: TutorActivityState, id: string): TutorActivityState {
  const live = { ...state.live };
  const finished = { ...state.finished };
  delete live[id];
  delete finished[id];
  return { live, finished };
}

export interface TutorActivitySummary {
  /** 在等学习者回答的对话 */
  asking: string[];
  /** 在回答（且不是在等回答）的对话 */
  running: string[];
  /** 答完了、还没看过的对话（正在看 AI 老师页面时为空） */
  unseen: string[];
}

/** seenAt：上次看过 AI 老师的时刻（没看过时为打开应用的时刻）；current：正在看 AI 老师页面 */
export function summarizeActivity(state: TutorActivityState, seenAt: number, current: boolean): TutorActivitySummary {
  const entries = Object.entries(state.live);
  return {
    asking: entries.filter(([, a]) => a.asking).map(([id]) => id),
    running: entries.filter(([, a]) => a.running && !a.asking).map(([id]) => id),
    unseen: current
      ? []
      : Object.entries(state.finished)
          .filter(([id, at]) => at > seenAt && !state.live[id])
          .map(([id]) => id),
  };
}
