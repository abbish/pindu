import { apiClient } from '@/api/client';
import { loadMicPrefs } from '@/utils/microphone';

/**
 * 打开的麦克风：`stream` 是放大过的声音（录音用；声音处理没跑起来时是原始声音），`analyser` 量音量；`setGain` 实时改增益（设置页测试时）；
 * `onEnded` 麦克风断开（拔掉、蓝牙断了）时调用
 */
export interface MicInput {
  stream: MediaStream;
  analyser: AnalyserNode;
  context: AudioContext;
  setGain: (gain: number) => void;
  onEnded: (callback: () => void) => void;
  close: () => void;
}

/** 等声音处理跑起来最多多久：没有用户操作时 resume() 可能一直不返回 */
const RESUME_TIMEOUT_MS = 1000;

/** 让声音处理跑起来；跑不起来返回 false */
export async function ensureRunning(context: AudioContext): Promise<boolean> {
  if (context.state === 'running') return true;
  await Promise.race([context.resume().catch(() => undefined), new Promise((r) => setTimeout(r, RESUME_TIMEOUT_MS))]);
  return (context.state as string) === 'running';
}

/**
 * 按「设置 → 朗读与发音 → 麦克风」打开麦克风：用选的设备（不在了用系统默认），乘上增益（跟读不开系统的自动增益，
 * 原始音量常常很小），后面接一个限幅器，放大后不破音。
 * `voiceProcessing`：系统的回声消除、降噪、自动增益，只给说话输入用（见 useRecorder）。打不开时抛出 getUserMedia 的错误。
 */
export async function openMicInput(voiceProcessing = false): Promise<MicInput> {
  const base = { echoCancellation: voiceProcessing, noiseSuppression: voiceProcessing, autoGainControl: voiceProcessing };
  const { deviceId, gain } = loadMicPrefs();
  let raw: MediaStream;
  try {
    raw = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (!deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw e;
    apiClient.log('WARN', 'recorder', '设置里选的麦克风不在了，改用系统默认', name);
    raw = await navigator.mediaDevices.getUserMedia({ audio: base });
  }
  const context = new AudioContext();
  const amp = context.createGain();
  // 说话输入开着系统的自动增益，不再另外放大
  amp.gain.value = voiceProcessing ? 1 : gain;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const out = context.createMediaStreamDestination();
  context.createMediaStreamSource(raw).connect(amp).connect(limiter);
  limiter.connect(analyser);
  limiter.connect(out);
  // 声音处理跑不起来时直接录原始声音（没有增益，总比录到静音好）
  const running = await ensureRunning(context);
  if (!running) apiClient.log('WARN', 'recorder', '声音处理没有运行，改录原始声音（没有增益）', context.state);
  return {
    stream: running ? out.stream : raw,
    analyser,
    context,
    setGain: (g) => amp.gain.setValueAtTime(g, context.currentTime),
    onEnded: (callback) => raw.getAudioTracks().forEach((t) => t.addEventListener('ended', callback)),
    close: () => {
      raw.getTracks().forEach((t) => t.stop());
      out.stream.getTracks().forEach((t) => t.stop());
      void context.close();
    },
  };
}

/** 当前音量（0–1，RMS × 4）：录音判断有没有在说话用 */
export function levelOf(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const v of buffer) sum += v * v;
  return Math.min(1, Math.sqrt(sum / buffer.length) * 4);
}

/** 音量条下限 / 上限（dBFS）：正常距离说话约 -35 到 -20，落在音量条中间偏上 */
const METER_FLOOR_DB = -55;
const METER_TOP_DB = -12;

/**
 * 音量条显示用（0–1）：按分贝，像会议软件那样。声音大小人耳听的是分贝，按原始幅度画时正常说话只亮一两格，
 * 看起来像收不到声音。`level` 是 levelOf 的值。
 */
export function meterOf(level: number): number {
  const rms = level / 4;
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / (METER_TOP_DB - METER_FLOOR_DB)));
}
