/**
 * 扬声器测试音：一小段铃声旋律（合成，不用联网），WAV 数据 + 每 50ms 的响度（输出音量条按播放位置取，不用把声音接进 Web Audio）。
 */
const RATE = 22050;
/** 响度的时间间隔（毫秒） */
export const TEST_SOUND_STEP_MS = 50;

/** 旋律：C5 E5 G5 C6 · G5 E5，每个音 0.28 秒，句末留一点空 */
const NOTES = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25];
const NOTE_S = 0.28;
const TOTAL_S = NOTES.length * NOTE_S + 0.6;

export interface TestSound {
  wav: Uint8Array<ArrayBuffer>;
  /** 每 TEST_SOUND_STEP_MS 一个，0–1 */
  envelope: number[];
}

export function makeTestSound(): TestSound {
  const n = Math.round(TOTAL_S * RATE);
  const samples = new Float32Array(n);
  NOTES.forEach((f, k) => {
    const start = Math.round(k * NOTE_S * RATE);
    const len = Math.min(n - start, Math.round(0.9 * RATE));
    for (let i = 0; i < len; i++) {
      const t = i / RATE;
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 5);
      samples[start + i] += 0.3 * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t));
    }
  });
  const step = Math.round((RATE * TEST_SOUND_STEP_MS) / 1000);
  const envelope: number[] = [];
  for (let i = 0; i < n; i += step) {
    let peak = 0;
    for (let j = i; j < Math.min(n, i + step); j++) peak = Math.max(peak, Math.abs(samples[j]));
    envelope.push(Math.min(1, peak / 0.4));
  }
  const wav = new Uint8Array(44 + n * 2);
  const view = new DataView(wav.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return { wav, envelope };
}
