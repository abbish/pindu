/**
 * 练习任务队列（「看-说-盖-写-查」的出题顺序，纯逻辑）。
 *
 * - 每组 GROUP_SIZE 个词，按步骤交错：组内所有词做完第一步，再轮流做第二步、第三步——
 *   同一个词的两次练习之间隔着其他词，后面的“盖-写”才是从记忆里提取。
 * - 答错并纠正后，同一步在 RETRY_GAP 个任务之后重考（不晚于这个词的下一步），每步最多重考 MAX_RETRIES 次。
 * - 所有组结束后是“当轮小测”：每个词再听写一遍。
 * - 中途恢复：按每个词已做过的步骤跳过。
 * - 复习词（自适应间隔复习安排的到期词）只考第三步：不看答案独立拼写，检验长期记忆；不参加当轮小测。
 */
export type PracticeStepNo = 1 | 2 | 3;
export type TaskKind = 'learn' | 'retry' | 'review';

export interface PracticeTask {
  /** 队列内唯一 */
  id: string;
  /** 在会话单词列表中的下标 */
  wordIndex: number;
  /** 对应后端记录的步骤（小测按第三步记录，成绩只取每步第一次作答） */
  step: PracticeStepNo;
  kind: TaskKind;
  /** 所在组（从 0 开始）；小测为 -1 */
  group: number;
}

export interface QueueWord {
  /** 下一个要做的步骤；4 表示三步都做过 */
  nextStep: 1 | 2 | 3 | 4;
  /** 复习词：只做第三步 */
  reviewOnly?: boolean;
  /** 恢复会话：当轮小测已做过 */
  reviewDone?: boolean;
  /** 恢复会话：答错后还没重考的步骤（放在最前面先补上） */
  pendingRetrySteps?: PracticeStepNo[];
}

export const GROUP_SIZE = 5;
export const RETRY_GAP = 3;
export const MAX_RETRIES = 2;

let seq = 0;
const taskId = (kind: TaskKind, wordIndex: number, step: number) => `${kind}-${wordIndex}-${step}-${++seq}`;

export function buildQueue(
  words: QueueWord[],
  { groupSize = GROUP_SIZE, includeReview = true }: { groupSize?: number; includeReview?: boolean } = {}
): PracticeTask[] {
  const pending = words.map((w, i) => ({ ...w, i })).filter(w => w.nextStep <= 3);
  const tasks: PracticeTask[] = [];
  // 恢复会话：上次答错还没来得及重考的，先补上
  words.forEach((w, i) => {
    for (const step of w.pendingRetrySteps ?? []) {
      tasks.push({ id: taskId('retry', i, step), wordIndex: i, step, kind: 'retry', group: 0 });
    }
  });
  // 分组按单词在会话中的原始位置（恢复时组号不变、做了一半的组保持原样）
  const groupCount = Math.ceil(words.length / groupSize);
  for (let g = 0; g < groupCount; g++) {
    const group = pending.filter(w => Math.floor(w.i / groupSize) === g);
    for (const step of [1, 2, 3] as PracticeStepNo[]) {
      for (const w of group) {
        if (w.reviewOnly && step !== 3) continue;
        if (w.nextStep <= step) tasks.push({ id: taskId('learn', w.i, step), wordIndex: w.i, step, kind: 'learn', group: g });
      }
    }
  }
  if (includeReview && words.length > 0) {
    words.forEach((w, i) => {
      if (!w.reviewDone && !w.reviewOnly) tasks.push({ id: taskId('review', i, 3), wordIndex: i, step: 3, kind: 'review', group: -1 });
    });
  }
  return tasks;
}

/**
 * 答错（已纠正）后安排重考：插在 RETRY_GAP 个任务之后，且不晚于这个词的下一个任务；
 * 小测题与已达上限的不再重考，返回原队列。
 */
export function scheduleRetry(queue: PracticeTask[], position: number, retriesSoFar: number): PracticeTask[] {
  const task = queue[position];
  if (!task || task.kind === 'review' || retriesSoFar >= MAX_RETRIES) return queue;
  let insertAt = Math.min(position + 1 + RETRY_GAP, queue.length);
  const nextOfWord = queue.findIndex((t, i) => i > position && t.wordIndex === task.wordIndex);
  if (nextOfWord !== -1) insertAt = Math.min(insertAt, nextOfWord);
  const retry: PracticeTask = { ...task, id: taskId('retry', task.wordIndex, task.step), kind: 'retry' };
  return [...queue.slice(0, insertAt), retry, ...queue.slice(insertAt)];
}

/** 恢复会话：由后端的单词状态推出队列信息（下一步、小测是否做过、待重考的步骤） */
export function queueWordFromState(state: {
  isReview?: boolean;
  stepAttempts?: number[];
  stepResults?: boolean[];
  fixedSteps?: boolean[];
  retryCounts?: number[];
  reviewCorrect?: boolean | null;
}): QueueWord {
  if (state.isReview) {
    const attempted = (state.stepAttempts?.[2] ?? 0) > 0;
    const pendingRetry =
      attempted && !state.stepResults?.[2] && !state.fixedSteps?.[2] && (state.retryCounts?.[2] ?? 0) < MAX_RETRIES;
    return { nextStep: attempted ? 4 : 3, reviewOnly: true, reviewDone: true, pendingRetrySteps: pendingRetry ? [3] : [] };
  }
  const pendingRetrySteps = ([1, 2, 3] as PracticeStepNo[]).filter(step => {
    const i = step - 1;
    return (
      (state.stepAttempts?.[i] ?? 0) > 0 &&
      !state.stepResults?.[i] &&
      !state.fixedSteps?.[i] &&
      (state.retryCounts?.[i] ?? 0) < MAX_RETRIES
    );
  });
  return {
    nextStep: nextStepFromAttempts(state.stepAttempts),
    reviewDone: state.reviewCorrect === true || state.reviewCorrect === false,
    pendingRetrySteps,
  };
}

/** 恢复会话时已经完成的练习数（各步首次作答 + 已做的小测），用于让进度接着上次显示 */
export function completedTaskCount(words: QueueWord[]): number {
  return words.reduce(
    (n, w) => n + (w.reviewOnly ? Number(w.nextStep === 4) : (w.nextStep - 1) + (w.reviewDone ? 1 : 0)),
    0
  );
}

/** 组数（按会话全部单词计，恢复时不变） */
export function groupCountOf(wordCount: number, groupSize: number = GROUP_SIZE): number {
  return Math.ceil(wordCount / groupSize);
}

/** 由后端每步作答次数推出下一步（步骤按顺序进行） */
export function nextStepFromAttempts(stepAttempts: number[] | undefined): QueueWord['nextStep'] {
  const done = (stepAttempts ?? []).filter(n => n > 0).length;
  return Math.min(done + 1, 4) as QueueWord['nextStep'];
}
