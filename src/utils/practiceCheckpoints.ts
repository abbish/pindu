/**
 * 练习结果的检查点（「盖-写-查」在三个间隔上的结果 + 当轮小测），用于结果页展示。
 * 「看」「说」没有作答，不计结果。
 */
import type { WordPracticeState } from '../types/study';

/** first：一次就对；fixed：答错后经「查」重考改对；missed：没掌握；none：没做 */
export type CheckpointStatus = 'first' | 'fixed' | 'missed' | 'none';

export interface Checkpoint {
  key: 'step1' | 'step2' | 'step3' | 'review';
  label: string;
  /** 说明这个检查点考的是什么 */
  hint: string;
  status: CheckpointStatus;
  /** 重考次数（仅三步） */
  retries: number;
}

const STEPS = [
  { key: 'step1', label: '刚学写', hint: '看·说之后立刻盖住写' },
  { key: 'step2', label: '隔词写', hint: '隔了几个单词再写' },
  { key: 'step3', label: '听写', hint: '只听发音、看中文写' },
] as const;

type StateFields = Pick<WordPracticeState, 'stepResults' | 'stepAttempts' | 'retryCounts' | 'fixedSteps' | 'reviewCorrect' | 'isReview'>;

export function wordCheckpoints(state: StateFields): Checkpoint[] {
  // 复习词只考一次听写（隔几天后不看答案写）
  if (state.isReview) {
    const attempted = (state.stepAttempts?.[2] ?? 0) > 0;
    return [{
      key: 'step3',
      label: '复习',
      hint: '隔几天后不看答案写',
      status: !attempted ? 'none' : state.stepResults?.[2] ? 'first' : state.fixedSteps?.[2] ? 'fixed' : 'missed',
      retries: state.retryCounts?.[2] ?? 0,
    }];
  }
  const steps: Checkpoint[] = STEPS.map((s, i) => {
    const attempted = (state.stepAttempts?.[i] ?? 0) > 0;
    const status: CheckpointStatus = !attempted
      ? 'none'
      : state.stepResults?.[i]
        ? 'first'
        : state.fixedSteps?.[i]
          ? 'fixed'
          : 'missed';
    return { ...s, status, retries: state.retryCounts?.[i] ?? 0 };
  });
  const review = state.reviewCorrect;
  steps.push({
    key: 'review',
    label: '小测',
    hint: '本轮结束时再听写一遍',
    status: review === true ? 'first' : review === false ? 'missed' : 'none',
    retries: 0,
  });
  return steps;
}

/** 徽章的提示文字 */
export function checkpointTitle(c: Checkpoint): string {
  const result = {
    first: '一次就对',
    fixed: `答错后改对（重考 ${c.retries} 次）`,
    missed: c.key === 'review' ? '没写对' : c.retries > 0 ? `重考 ${c.retries} 次仍没写对` : '没写对',
    none: '没有做',
  }[c.status];
  return `${c.label}：${c.hint} — ${result}`;
}
