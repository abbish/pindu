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

/** 增益范围（倍数）：跟读不开系统的自动增益，原始音量常常很小，默认放大到 4 倍 */
export const MIC_GAIN_MIN = 1;
export const MIC_GAIN_MAX = 8;
export const MIC_GAIN_DEFAULT = 4;

/**
 * 声音设备偏好（「设置 → 朗读与发音」的扬声器与麦克风）：用哪个麦克风（空 = 跟随系统）、增益、说完后等多久停；
 * 用哪个扬声器（空 = 跟随系统）、音量（0–1，朗读、原声、视频、听自己的录音都按它放）
 */
export interface MicPrefs {
  deviceId: string;
  gain: number;
  wait: SilenceWait;
  speakerId: string;
  volume: number;
}

export const DEFAULT_MIC_PREFS: MicPrefs = { deviceId: '', gain: MIC_GAIN_DEFAULT, wait: 'normal', speakerId: '', volume: 1 };

/** 读到的偏好整理成合法值（坏数据、旧格式回到默认） */
export function normalizeMicPrefs(raw: unknown): MicPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const wait = o.wait === 'short' || o.wait === 'long' ? o.wait : 'normal';
  const gain = typeof o.gain === 'number' && Number.isFinite(o.gain) ? Math.min(MIC_GAIN_MAX, Math.max(MIC_GAIN_MIN, Math.round(o.gain * 2) / 2)) : MIC_GAIN_DEFAULT;
  const volume = typeof o.volume === 'number' && Number.isFinite(o.volume) ? Math.min(1, Math.max(0, o.volume)) : 1;
  return { deviceId: typeof o.deviceId === 'string' ? o.deviceId : '', gain, wait, speakerId: typeof o.speakerId === 'string' ? o.speakerId : '', volume };
}

/** 麦克风是这台电脑的设备，偏好只存在本机 */
const PREFS_KEY = 'mic.prefs';

/** 每次放声音都要读（音量、扬声器），读一次记住 */
let current: MicPrefs | null = null;

export function loadMicPrefs(): MicPrefs {
  if (current) return current;
  try {
    const text = localStorage.getItem(PREFS_KEY);
    current = normalizeMicPrefs(text ? JSON.parse(text) : null);
  } catch {
    current = DEFAULT_MIC_PREFS;
  }
  return current;
}

export function saveMicPrefs(prefs: MicPrefs) {
  current = prefs;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 存不下只影响下次打开时的选择
  }
}

/** 系统里的麦克风 / 扬声器列表 → 下拉选项（去掉 Windows 上代表「默认」「通信」的两个虚拟项；授权前没有名字时按顺序编号） */
export function micOptions(devices: { deviceId: string; label: string; kind: string }[], kind: 'audioinput' | 'audiooutput' = 'audioinput'): { value: string; label: string }[] {
  const name = kind === 'audioinput' ? '麦克风' : '扬声器';
  return devices
    .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ value: d.deviceId, label: d.label || `${name} ${i + 1}` }));
}

/** 一个词大概几个音节（元音字母连在一起算一个，词尾不发音的 e 不算；数字每位算两个） */
function syllables(word: string): number {
  const digits = word.replace(/[^0-9]/g, '').length;
  if (digits > 0) return digits * 2;
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.replace(/(?<!l)e$/, '').match(/[aeiouy]+/g)?.length ?? 0;
  return Math.max(1, groups);
}

/** 读完这段文字大概要多久（毫秒，按学习者的语速：一个音节约 250ms）；录音据此判断是不是读到一半停顿 */
export function expectedSpeechMs(text: string): number {
  const n = text.split(/[^A-Za-z0-9'’]+/).reduce((sum, w) => sum + syllables(w), 0);
  return n * 250;
}
