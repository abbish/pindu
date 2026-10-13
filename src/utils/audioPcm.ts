/**
 * 录音（MediaRecorder 的 webm / mp4）→ 发音评估要的 16kHz 单声道 16 位 PCM（base64）。
 * 用浏览器自带的解码与重采样（OfflineAudioContext），不经过 ffmpeg、不落临时文件。
 */
const TARGET_RATE = 16000;

export async function recordingToPcmBase64(url: string): Promise<string> {
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
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
