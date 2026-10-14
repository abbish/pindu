/** 麦克风打不开的原因（getUserMedia 的错误名 → 给学习者看的话） */
export type MicProblemKind = 'denied' | 'missing' | 'busy' | 'other';

export function micProblemKind(errorName: string): MicProblemKind {
  switch (errorName) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'missing';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    default:
      return 'other';
  }
}

export const MIC_PROBLEM_TEXT: Record<MicProblemKind, string> = {
  denied: '麦克风权限没打开',
  missing: '没有找到麦克风',
  busy: '麦克风正被其他程序使用',
  other: '麦克风打不开',
};
