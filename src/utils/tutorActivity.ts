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

/** 记「看过」的键：每个对话一个（对话列表与侧边栏共用，打开过这个对话才算看过） */
export const tutorSeenKey = (id: string) => `tutor:${id}`;

/** seenAt(id)：上次看这个对话的时刻（没看过时为打开应用的时刻）；current：正在看 AI 老师页面（列表上已经标着） */
export function summarizeActivity(state: TutorActivityState, seenAt: (id: string) => number, current: boolean): TutorActivitySummary {
  const entries = Object.entries(state.live);
  return {
    asking: entries.filter(([, a]) => a.asking).map(([id]) => id),
    running: entries.filter(([, a]) => a.running && !a.asking).map(([id]) => id),
    unseen: current
      ? []
      : Object.entries(state.finished)
          .filter(([id, at]) => at > seenAt(id) && !state.live[id])
          .map(([id]) => id),
  };
}

/** 对话列表每行的状态标记：等你回答 / 正在回答 / 有新回答没看 */
export type ConversationMark = 'asking' | 'running' | 'unread';

/** seenAt：上次看这个对话的时刻（没看过时为打开应用的时刻）；active：正在看这个对话（答完就算看过） */
export function conversationMark(state: TutorActivityState, id: string, seenAt: number, active: boolean): ConversationMark | null {
  const live = state.live[id];
  if (live?.asking) return 'asking';
  if (live?.running) return 'running';
  const finished = state.finished[id];
  return !active && finished !== undefined && finished > seenAt ? 'unread' : null;
}
