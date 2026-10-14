import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import { ensureRunning, levelOf, meterOf, openMicInput, type MicInput } from '@/utils/micInput';
import { loadMicPrefs, MIC_PROBLEM_TEXT, micProblemKind, SILENCE_WAIT_FACTOR, type MicProblemKind } from '@/utils/microphone';
import { playbackTailMs } from '@/utils/playbackTail';

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

export interface StartOptions {
  /** 读完要读的内容大概要多久（毫秒，见 utils/microphone 的 expectedSpeechMs）：读到的还不到一半时，句中停顿多等一会儿，最长录音也跟着放宽 */
  expectMs?: number;
}

/** 认为在说话的音量阈值（RMS × 4，即原始 RMS 约 0.0075）：跟读不开自动增益，离麦克风远一点、小声说也要能听到 */
const SPEAKING = 0.03;
/** 也要比底噪大这么多倍（约 10dB）：增益放大了底噪，安静的房间也可能超过 SPEAKING，那样永远等不到「说完了」 */
const OVER_FLOOR = 3;
/** 底噪的下限（RMS × 4）：麦克风刚打开、蓝牙掉帧时读到 0，底噪不能跟着变成 0（那样再也升不回来） */
const FLOOR_MIN = 0.004;
/** 底噪每秒最多升多少倍：说话时不被拉上去，房间变吵时几秒内跟上 */
const FLOOR_RISE_PER_S = 1.15;
/** 声波条的采样间隔 */
const PEAK_MS = 50;
/** 还没读到一半（按 expectMs）时，停顿这么久才算说完：想下一个词、换气不会被当成读完（读半句会被评低分） */
const MIDWAY_SILENCE_MS = 2500;
/** 有声音的时长到了预计时长的这么多，就算读得差不多了（有声音的帧比说话时长少，留余量） */
const MIDWAY_RATIO = 0.4;

/**
 * 跟读录音：
 * - `open()` 预先打开麦克风并保持（进入跟读时调用），点录音立刻开始，开头不丢；
 * - `start()` 后先短暂 `arming`（打开麦克风、等刚停的放音尾巴放完，见 utils/playbackTail），录音器真正开始后才进入 `recording`
 *   （界面据此才提示「请跟读」，早了开头会丢）；`arming` 期间 `stop()` 就不录了；
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

  const inputRef = useRef<MicInput | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const frameRef = useRef(0);
  /** 每次 start 加一；准备录音（arming）期间点了停止，记下停的是哪一次：那次不再开始 */
  const startSeqRef = useRef(0);
  const cancelledSeqRef = useRef(0);
  /** 正在打开的麦克风：同时调用 open() 时共用，不开两次 */
  const openingRef = useRef<Promise<boolean> | null>(null);
  /** 每次 close 加一：等麦克风授权期间关掉了（离开页面、暂停），拿到的 stream 立即停掉 */
  const generationRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** 打开麦克风（已打开则直接返回；设备与增益按麦克风设置，见 utils/micInput） */
  const open = useCallback((): Promise<boolean> => {
    if (inputRef.current) return Promise.resolve(true);
    if (openingRef.current) return openingRef.current;
    const opening = openOnce().finally(() => {
      if (openingRef.current === opening) openingRef.current = null;
    });
    openingRef.current = opening;
    return opening;
  }, []);

  const openOnce = async (): Promise<boolean> => {
    const generation = generationRef.current;
    try {
      const input = await openMicInput(optionsRef.current.voiceProcessing ?? false);
      if (generation !== generationRef.current) {
        input.close();
        return false;
      }
      inputRef.current = input;
      // 麦克风断开（拔掉、AirPods 放回盒子）：关掉，下次录音重新打开（用系统默认的）
      input.onEnded(() => {
        if (inputRef.current !== input) return;
        apiClient.log('WARN', 'recorder', '麦克风断开了');
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        inputRef.current = null;
        input.close();
      });
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
  };

  const close = useCallback(() => {
    generationRef.current += 1;
    cancelAnimationFrame(frameRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    inputRef.current?.close();
    inputRef.current = null;
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
    else if (!rec) cancelledSeqRef.current = startSeqRef.current;
  }, []);

  /** 开始录音；麦克风打不开时返回 false */
  const start = useCallback(async (tag?: string, startOptions: StartOptions = {}): Promise<boolean> => {
    if (recorderRef.current) return false;
    const seq = ++startSeqRef.current;
    setState('arming');
    const generation = generationRef.current;
    /** 这次不录了：被停止（算一次结束，等着的流程照常往下走），或者被后来的一次 start 取代（由那次收尾） */
    const cancelled = () => {
      if (seq !== startSeqRef.current) return true;
      if (cancelledSeqRef.current !== seq) return false;
      setState('idle');
      setEnded((n) => n + 1);
      return true;
    };
    const opened = await open();
    if (seq !== startSeqRef.current) return false;
    if (!opened) {
      setState('idle');
      setEnded((n) => n + 1);
      return false;
    }
    // 打开麦克风期间被关掉了：不再开始
    if (generation !== generationRef.current) return false;
    if (cancelled()) return false;
    // 刚停的原声 / 朗读还有最后一点在放：等它放完
    const tail = playbackTailMs();
    if (tail > 0) await new Promise((r) => setTimeout(r, tail));
    if (generation !== generationRef.current || cancelled()) return false;
    if (recorderRef.current) return false;
    const input = inputRef.current;
    if (!input) return false;
    const { analyser } = input;
    await ensureRunning(input.context);
    if (generation !== generationRef.current || cancelled() || recorderRef.current) return false;
    const chunks: Blob[] = [];
    const peaks: number[] = [];
    const rec = new MediaRecorder(input.stream);
    recorderRef.current = rec;
    const waitFactor = SILENCE_WAIT_FACTOR[loadMicPrefs().wait];
    const expectMs = startOptions.expectMs ?? 0;
    let begun = 0;
    let lastVoice = 0;
    let voice = false;
    /** 有声音的总时长 */
    let voicedMs = 0;
    let lastTick = 0;
    /** 底噪：降得快（安静下来马上跟上）、升得慢（说话时不被拉上去） */
    let floor = Number.POSITIVE_INFINITY;
    let lastFloorAt = 0;
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
      lastTick = begun;
      setHeard(false);
      setLive([]);
      setElapsedMs(0);
      setState('recording');
      const tick = () => {
        const rms = levelOf(analyser, buffer);
        const now = performance.now();
        // 显示按分贝（meterOf），判断说话仍按原始音量
        const shown = meterOf(rms);
        setLevel(shown);
        setElapsedMs(now - begun);
        if (now - lastPeak >= PEAK_MS) {
          lastPeak = now;
          peaks.push(shown);
          setLive((l) => [...l.slice(-59), shown]);
        }
        if (rms < floor) floor = Math.max(FLOOR_MIN, rms);
        else floor *= FLOOR_RISE_PER_S ** ((now - (lastFloorAt || now)) / 1000);
        lastFloorAt = now;
        if (rms > Math.max(SPEAKING, floor * OVER_FLOOR)) {
          voicedMs += now - lastTick;
          lastVoice = now;
          if (!voice) {
            voice = true;
            setHeard(true);
          }
        }
        lastTick = now;
        const { silenceStopMs = 1500, maxMs: baseMax = 30_000 } = optionsRef.current;
        const midway = voicedMs < expectMs * MIDWAY_RATIO;
        const silenceMs = silenceStopMs * waitFactor;
        const quietFor = midway ? Math.max(silenceMs, MIDWAY_SILENCE_MS) : silenceMs;
        const maxMs = Math.max(baseMax, expectMs * 3 + 2000);
        if ((voice && silenceStopMs > 0 && now - lastVoice > quietFor) || now - begun > maxMs) {
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
