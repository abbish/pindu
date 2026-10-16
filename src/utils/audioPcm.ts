/**
 * 录音（MediaRecorder 的 webm / mp4）→ 发音评估要的 16kHz 单声道 16 位 PCM（base64）。
 * 用浏览器自带的解码与重采样（OfflineAudioContext），不经过 ffmpeg、不落临时文件。
 */
const TARGET_RATE = 16000;

export async function recordingToPcmBase64(url: string): Promise<string> {
  return pcmToBase64(await recordingToPcm(url));
}

/** 录音 → 16kHz 单声道 16 位 PCM */
export async function recordingToPcm(url: string): Promise<Int16Array> {
  const data = await (await fetch(url)).arrayBuffer();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(data);
  } finally {
    void ctx.close();
  }
  const length = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, length, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return pcm;
}

export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** PCM 里 [startMs, endMs) 这一段 → wav 的地址（回放一句用：从头播，不用在录音里跳转） */
export function pcmSliceUrl(pcm: Int16Array, startMs: number, endMs: number): string {
  const a = Math.max(0, Math.floor((startMs * TARGET_RATE) / 1000));
  const b = Math.min(pcm.length, Math.max(a, Math.ceil((endMs * TARGET_RATE) / 1000)));
  const body = pcm.subarray(a, b);
  const header = new DataView(new ArrayBuffer(44));
  const text = (at: number, s: string) => [...s].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  header.setUint32(4, 36 + body.byteLength, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, TARGET_RATE, true);
  header.setUint32(28, TARGET_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, 'data');
  header.setUint32(40, body.byteLength, true);
  return URL.createObjectURL(new Blob([header.buffer, body.slice().buffer], { type: 'audio/wav' }));
}
