import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import { MIC_PROBLEM_TEXT, micProblemKind, type MicProblemKind } from '@/utils/microphone';

export type RecorderState = 'idle' | 'arming' | 'recording';

export interface Take {
  url: string;
  durationMs: number;
  /** 录音的音量轮廓（0–1，约每 50ms 一个），画成静态波形 */
  peaks: number[];
  /** 开始录音时给的标记（录的是哪个词 / 哪一句）：录完时内容已经换了，调用方据此丢掉 */
  tag?: string;
}

export interface RecorderOptions {
  /** 说完后静音多久自动停止（毫秒）；0 表示不自动停 */
  silenceStopMs?: number;
  /** 最长录多久（毫秒） */
  maxMs?: number;
  /**
   * 用系统的语音处理（回声消除、降噪、自动增益）。只给说话输入用：跟读时原声 / 朗读已经停了，用不着回声消除，
   * 而 macOS 上开着它时声音输出会切到语音处理模式，正在播的原声 / 朗读会被压低、卡顿（每次开关麦克风都会抖一下）。
   */
  voiceProcessing?: boolean;
}

/** 放音停下后等这么久再开始录：扬声器、蓝牙耳机还在放最后一点声音（蓝牙延迟常到 200ms 以上），不等会把句尾录进去 */
export const PLAYBACK_TAIL_MS = 350;

/** 认为在说话的音量阈值（RMS） */
const SPEAKING = 0.04;
/** 声波条的采样间隔 */
const PEAK_MS = 50;

/**
 * 跟读录音：
 * - `open()` 预先打开麦克风并保持（进入跟读时调用），点录音立刻开始，开头不丢；
 * - `start()` 后先短暂 `arming`，录音器真正开始后才进入 `recording`（界面据此提示「开始说」）；
 * - `level` 实时音量（0–1）、`live` 最近的音量轮廓，用来画实时声波；`heard` 是否已经检测到说话；
 * - 说完静音 `silenceStopMs` 或到 `maxMs` 自动停止；停止后得到 `take`（地址、时长、音量轮廓、`start(tag)` 的标记）；
 * - `ended` 每结束一次录音加 1（太短没有 `take`、麦克风打不开也算），等着录音结束的流程据此往下走；
 * - 麦克风打不开时 `error` 是给学习者看的原因，`problem` 是原因的种类（`denied` 时界面给出打开系统设置的按钮，见 MicProblem）。
 *   第一次使用由 getUserMedia 弹出系统授权框；拒绝过以后系统不再弹，只能去系统设置里打开。
 */
export function useRecorder(options: RecorderOptions = {}) {
  const [state, setState] = useState<RecorderState>('idle');
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [heard, setHeard] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<MicProblemKind | null>(null);
  const [ended, setEnded] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const frameRef = useRef(0);
  /** 每次 close 加一：等麦克风授权期间关掉了（离开页面、暂停），拿到的 stream 立即停掉 */
  const generationRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** 打开麦克风（已打开则直接返回） */
  const open = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    const generation = generationRef.current;
    try {
      const processing = optionsRef.current.voiceProcessing ?? false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: processing, noiseSuppression: processing, autoGainControl: processing },
      });
      if (generation !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      streamRef.current = stream;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      setError(null);
      setProblem(null);
      return true;
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      apiClient.log('WARN', 'recorder', `打不开麦克风：${name || '未知原因'}`, e instanceof Error ? e.message : String(e));
      if (generation === generationRef.current) {
        const kind = micProblemKind(name);
        setError(MIC_PROBLEM_TEXT[kind]);
        setProblem(kind);
      }
      return false;
    }
  }, []);

  const close = useCallback(() => {
    generationRef.current += 1;
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

  /** 开始录音；麦克风打不开时返回 false */
  const start = useCallback(async (tag?: string): Promise<boolean> => {
    if (recorderRef.current) return false;
    setState('arming');
    const generation = generationRef.current;
    if (!(await open())) {
      setState('idle');
      setEnded((n) => n + 1);
      return false;
    }
    // 打开麦克风期间被关掉了：不再开始
    if (generation !== generationRef.current) return false;
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
      // 已经关掉（卸载）的不再生成录音地址：没人会释放它
      if (chunks.length > 0 && durationMs > 300 && generation === generationRef.current) {
        setTake({ url: URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })), durationMs, peaks, tag });
      }
      setEnded((n) => n + 1);
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
    return true;
  }, [open]);

  const clear = useCallback(() => setTake(null), []);

  return { state, level, live, heard, elapsedMs, take, ended, error, problem, open, close, start, stop, clear };
}
