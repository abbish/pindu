import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'arming' | 'recording';

export interface Take {
  url: string;
  durationMs: number;
  /** 录音的音量轮廓（0–1，约每 50ms 一个），画成静态波形 */
  peaks: number[];
}

export interface RecorderOptions {
  /** 说完后静音多久自动停止（毫秒）；0 表示不自动停 */
  silenceStopMs?: number;
  /** 最长录多久（毫秒） */
  maxMs?: number;
}

/** 认为在说话的音量阈值（RMS） */
const SPEAKING = 0.04;
/** 声波条的采样间隔 */
const PEAK_MS = 50;

/**
 * 跟读录音：
 * - `open()` 预先打开麦克风并保持（进入跟读时调用），点录音立刻开始，开头不丢；
 * - `start()` 后先短暂 `arming`，录音器真正开始后才进入 `recording`（界面据此提示「开始说」）；
 * - `level` 实时音量（0–1）、`live` 最近的音量轮廓，用来画实时声波；`heard` 是否已经检测到说话；
 * - 说完静音 `silenceStopMs` 或到 `maxMs` 自动停止；停止后得到 `take`（地址、时长、音量轮廓）。
 */
export function useRecorder(options: RecorderOptions = {}) {
  const [state, setState] = useState<RecorderState>('idle');
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [heard, setHeard] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const frameRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** 打开麦克风（已打开则直接返回） */
  const open = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      setError(null);
      return true;
    } catch {
      setError('无法使用麦克风，请在系统设置里允许拼读使用麦克风');
      return false;
    }
  }, []);

  const close = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    analyserRef.current = null;
    setState('idle');
    setLevel(0);
  }, []);

  useEffect(() => close, [close]);

  // 换一个录音时释放上一个的地址
  useEffect(() => () => {
    if (take) URL.revokeObjectURL(take.url);
  }, [take]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    setState('arming');
    if (!(await open())) {
      setState('idle');
      return;
    }
    const stream = streamRef.current!;
    const analyser = analyserRef.current!;
    void ctxRef.current?.resume();
    const chunks: Blob[] = [];
    const peaks: number[] = [];
    const rec = new MediaRecorder(stream);
    recorderRef.current = rec;
    let begun = 0;
    let lastVoice = 0;
    let voice = false;
    let lastPeak = 0;
    const buffer = new Float32Array(analyser.fftSize);

    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      cancelAnimationFrame(frameRef.current);
      recorderRef.current = null;
      setState('idle');
      setLevel(0);
      const durationMs = begun ? performance.now() - begun : 0;
      if (chunks.length > 0 && durationMs > 300) {
        setTake({ url: URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })), durationMs, peaks });
      }
    };
    rec.onstart = () => {
      begun = performance.now();
      lastVoice = begun;
      setHeard(false);
      setLive([]);
      setElapsedMs(0);
      setState('recording');
      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const v of buffer) sum += v * v;
        const rms = Math.min(1, Math.sqrt(sum / buffer.length) * 4);
        const now = performance.now();
        setLevel(rms);
        setElapsedMs(now - begun);
        if (now - lastPeak >= PEAK_MS) {
          lastPeak = now;
          peaks.push(rms);
          setLive((l) => [...l.slice(-59), rms]);
        }
        if (rms > SPEAKING) {
          lastVoice = now;
          if (!voice) {
            voice = true;
            setHeard(true);
          }
        }
        const { silenceStopMs = 1500, maxMs = 30_000 } = optionsRef.current;
        if ((voice && silenceStopMs > 0 && now - lastVoice > silenceStopMs) || now - begun > maxMs) {
          rec.stop();
          return;
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    };
    rec.start(100);
  }, [open]);

  const clear = useCallback(() => setTake(null), []);

  return { state, level, live, heard, elapsedMs, take, error, open, close, start, stop, clear };
}
