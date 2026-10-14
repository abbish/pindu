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

/** 说完后等多久停止录音：短 / 中 / 长（乘在各处的默认等待上，读得慢的选长） */
export type SilenceWait = 'short' | 'normal' | 'long';

export const SILENCE_WAIT_FACTOR: Record<SilenceWait, number> = { short: 0.7, normal: 1, long: 1.8 };

/** 麦克风偏好（「设置 → 朗读与发音 → 麦克风」）：用哪个麦克风（空 = 跟随系统）、说完后等多久停 */
export interface MicPrefs {
  deviceId: string;
  wait: SilenceWait;
}

export const DEFAULT_MIC_PREFS: MicPrefs = { deviceId: '', wait: 'normal' };

/** 读到的偏好整理成合法值（坏数据、旧格式回到默认） */
export function normalizeMicPrefs(raw: unknown): MicPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const wait = o.wait === 'short' || o.wait === 'long' ? o.wait : 'normal';
  return { deviceId: typeof o.deviceId === 'string' ? o.deviceId : '', wait };
}

/** 麦克风是这台电脑的设备，偏好只存在本机 */
const PREFS_KEY = 'mic.prefs';

export function loadMicPrefs(): MicPrefs {
  try {
    const text = localStorage.getItem(PREFS_KEY);
    return normalizeMicPrefs(text ? JSON.parse(text) : null);
  } catch {
    return DEFAULT_MIC_PREFS;
  }
}

export function saveMicPrefs(prefs: MicPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 存不下只影响下次打开时的选择
  }
}

/** 系统里的麦克风列表 → 下拉选项（去掉 Windows 上代表「默认」「通信」的两个虚拟项；授权前没有名字时按顺序编号） */
export function micOptions(devices: { deviceId: string; label: string; kind: string }[]): { value: string; label: string }[] {
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ value: d.deviceId, label: d.label || `麦克风 ${i + 1}` }));
}
