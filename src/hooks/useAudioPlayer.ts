import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ttsService, type SpeechSpeed, type SpeechStyle, type WordTiming } from '../services/ttsService';
import { useToast } from '../components';

export interface AudioPlayerState {
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  duration: number;
  currentTime: number;
  /** 当前音频的逐词时间（播放时带 withTimings 且服务返回时才有） */
  words: WordTiming[] | null;
}

export interface UseAudioPlayerOptions {
  /** 默认语音ID */
  defaultVoiceId?: string;
  /** 是否自动清理错误状态 */
  autoClearError?: boolean;
  /** 错误自动清理延迟（毫秒） */
  errorClearDelay?: number;
}

export interface PlayOptions {
  /** 中止信号：中止后停止请求/播放，Promise 以 false resolve */
  signal?: AbortSignal;
  /** 朗读风格（playWord / playSentence 会自动设置） */
  style?: SpeechStyle;
  /** 语速：slow 再慢一档 */
  speed?: SpeechSpeed;
  /** 同时取逐词时间（写入 state.words，用于逐词高亮） */
  withTimings?: boolean;
}

/** 一段已生成的语音：音频 URL + 逐词时间 */
interface LoadedSpeech {
  url: string;
  words: WordTiming[] | null;
}

/** 同一页面内最多缓存多少条音频（data URL），避免长列表占用过多内存 */
const MAX_CACHED_AUDIO = 50;

// ==================== 全局共享的 <audio> 元素 ====================
// WebView 可能要求“用户操作后才能播放声音”：这个限制按元素解除。
// 全应用复用同一个元素，并在第一次点击 / 按键时用一段静音解锁它，
// 之后自动朗读（换词、换步骤，没有点击）也能正常出声。

/** 0 时长静音 WAV，用于解锁 */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

let sharedAudio: HTMLAudioElement | null = null;
let unlocked = false;
/** 每次播放递增；事件回调据此判断自己是否已被后来的播放取代 */
let currentPlayToken = 0;
/** 正在加载 / 播放真实音频时不做静音解锁，避免打断 */
let realPlaybackActive = false;

const removeUnlockListeners = () => {
  UNLOCK_EVENTS.forEach(e => document.removeEventListener(e, unlockAudio, true));
};

function unlockAudio() {
  const audio = sharedAudio;
  if (!audio || unlocked) {
    removeUnlockListeners();
    return;
  }
  if (realPlaybackActive) return;
  audio.src = SILENT_WAV;
  audio
    .play()
    .then(() => {
      unlocked = true;
      removeUnlockListeners();
    })
    .catch(() => {
      // 仍被阻止：等下一次用户操作
    });
}

const getSharedAudio = (): HTMLAudioElement => {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
    if (typeof document !== 'undefined') {
      UNLOCK_EVENTS.forEach(e => document.addEventListener(e, unlockAudio, true));
    }
  }
  return sharedAudio;
};

// 应用启动时就创建并挂上解锁监听：进入练习页之前的点击也能解锁
if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
  getSharedAudio();
}

/**
 * 语音播放：全应用同一时间只播放一条；再次播放会停止上一条。
 * 播放 Promise：播放到结尾 resolve `true`；被新播放、`stop()` 或 `signal` 中止 resolve `false`；
 * 生成语音或播放失败 reject（并 toast 提示）。
 * 同一文本的音频在页面内缓存，重复朗读不再请求后端（后端另有文件缓存）。
 */
export const useAudioPlayer = (options: UseAudioPlayerOptions = {}) => {
  const toast = useToast();
  // 回调里经 ref 取 toast：toast 引用变化不应让 playText 等回调失效
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const timeoutRef = useRef<number | null>(null);
  /** 当前播放的结束回调：被打断时以 false 结束，避免 Promise 永远挂起 */
  const settleRef = useRef<((completed: boolean) => void) | null>(null);
  /** 本实例最近一次播放的令牌（只停止自己发起的播放） */
  const myTokenRef = useRef(0);
  /** style|voice|text → 音频 data URL（或进行中的请求） */
  const urlCacheRef = useRef(new Map<string, Promise<LoadedSpeech>>());

  const {
    defaultVoiceId,
    autoClearError = true,
    errorClearDelay = 5000
  } = options;

  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    isLoading: false,
    error: null,
    duration: 0,
    currentTime: 0,
    words: null,
  });

  const updateState = useCallback((updates: Partial<AudioPlayerState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // 自动清理错误状态
  useEffect(() => {
    if (state.error && autoClearError) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        updateState({ error: null });
      }, errorClearDelay);
    }
  }, [state.error, autoClearError, errorClearDelay, updateState]);

  /** 停止本实例正在播放的音频，并把当前播放的 Promise 以“未播完”结束 */
  const cleanupAudio = useCallback(() => {
    if (myTokenRef.current === currentPlayToken) {
      if (sharedAudio && !sharedAudio.paused) sharedAudio.pause();
      realPlaybackActive = false;
    }
    const settle = settleRef.current;
    settleRef.current = null;
    settle?.(false);
  }, []);

  /** 取得音频 URL：命中页面缓存直接返回；并发请求同一文本只发一次 */
  const loadAudioUrl = useCallback((text: string, voiceId?: string, style?: SpeechStyle, speed?: SpeechSpeed, withTimings?: boolean): Promise<LoadedSpeech> => {
    const key = `${style ?? ''}|${speed ?? ''}|${withTimings ? 't' : ''}|${voiceId ?? ''}|${text}`;
    const cache = urlCacheRef.current;
    const cached = cache.get(key);
    if (cached) return cached;

    const request = ttsService
      .textToSpeech({ text, voiceId, useCache: true, style, speed, withTimings })
      .then(result => {
        if (!result.success) throw new Error(result.error);
        return { url: result.data.audioUrl, words: result.data.words ?? null };
      });
    cache.set(key, request);
    // 失败不缓存，下次重试
    request.catch(() => cache.delete(key));
    if (cache.size > MAX_CACHED_AUDIO) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return request;
  }, []);

  const playText = useCallback(async (
    text: string,
    voiceId?: string,
    playOptions: PlayOptions = {}
  ): Promise<boolean> => {
    const { signal, style, speed, withTimings } = playOptions;
    if (signal?.aborted) return false;

    // 新的播放打断上一条
    cleanupAudio();
    updateState({ isLoading: true, error: null });

    let audioUrl: string;
    try {
      const loaded = await loadAudioUrl(text, voiceId || defaultVoiceId, style, speed, withTimings);
      audioUrl = loaded.url;
      updateState({ words: loaded.words });
    } catch (error) {
      const errorMessage = error instanceof Error && error.message ? error.message : '语音生成失败，请再试一次';
      updateState({ isLoading: false, error: errorMessage });
      // 练习页会连续自动朗读：同一条提示只保留一条，不刷屏
      toastRef.current.showToast({ type: 'error', id: 'audio-playback', title: '无法播放发音', message: errorMessage });
      throw error;
    }

    // 等待语音生成期间被中止（换词、暂停、手动播放等）
    if (signal?.aborted) {
      updateState({ isLoading: false });
      return false;
    }

    // 生成期间可能已有别的播放开始，再清理一次确保只有一条在播
    cleanupAudio();
    const audio = getSharedAudio();
    const token = ++currentPlayToken;
    myTokenRef.current = token;
    realPlaybackActive = true;
    audio.src = audioUrl;

    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const isCurrent = () => currentPlayToken === token;

      const detach = () => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
        if (isCurrent()) realPlaybackActive = false;
      };
      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        detach();
        if (settleRef.current === finish) settleRef.current = null;
        updateState({ isPlaying: false, isLoading: false });
        resolve(completed);
      };
      const fail = (message: string, error: Error) => {
        if (settled) return;
        settled = true;
        detach();
        if (settleRef.current === finish) settleRef.current = null;
        updateState({ isPlaying: false, isLoading: false, error: message });
        toastRef.current.showToast({ type: 'error', id: 'audio-playback', title: '无法播放发音', message });
        reject(error);
      };

      // 每个事件先确认自己仍是当前播放；已被取代则按“中止”结束
      function onLoaded() {
        if (!isCurrent()) return finish(false);
        updateState({ duration: audio.duration });
      }
      function onTimeUpdate() {
        if (!isCurrent()) return finish(false);
        updateState({ currentTime: audio.currentTime });
      }
      function onPlay() {
        if (!isCurrent()) return finish(false);
        updateState({ isPlaying: true, isLoading: false });
      }
      function onEnded() {
        if (!isCurrent()) return finish(false);
        updateState({ currentTime: 0 });
        finish(true);
      }
      function onError() {
        if (!isCurrent()) return finish(false);
        fail('音频文件无法播放，请再试一次', new Error('音频播放失败'));
      }
      function onAbort() {
        if (isCurrent() && !audio.paused) audio.pause();
        finish(false);
      }

      settleRef.current = finish;
      signal?.addEventListener('abort', onAbort, { once: true });
      audio.addEventListener('loadedmetadata', onLoaded);
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('play', onPlay);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      audio.play().catch((error: unknown) => {
        const name = error instanceof Error ? error.name : '';
        // 被打断导致的 play() 失败按中止处理
        if (settled || !isCurrent() || name === 'AbortError') {
          finish(false);
          return;
        }
        if (name === 'NotAllowedError') {
          fail('系统阻止了自动播放：点击页面任意位置后即可正常朗读', error as Error);
          return;
        }
        fail('音频没能开始播放，请再试一次', error instanceof Error ? error : new Error('音频播放失败'));
      });
    });
  }, [cleanupAudio, loadAudioUrl, updateState, defaultVoiceId]);

  const playWord = useCallback(
    (word: string, voiceId?: string, playOptions?: PlayOptions) =>
      // 词组按句子的语调读（连读自然），单词按单词读（D45）
      playText(word, voiceId, { ...playOptions, style: /\s/.test(word.trim()) ? 'sentence' : 'word' }),
    [playText]
  );

  const playSentence = useCallback(
    (sentence: string, voiceId?: string, playOptions?: PlayOptions) =>
      playText(sentence, voiceId, { ...playOptions, style: 'sentence' }),
    [playText]
  );

  /** 预先生成并缓存音频（如下一个单词、当前例句），失败静默 */
  const prefetch = useCallback((text: string, style: SpeechStyle = 'word', voiceId?: string, extra: Pick<PlayOptions, 'speed' | 'withTimings'> = {}) => {
    loadAudioUrl(text, voiceId || defaultVoiceId, style, extra.speed, extra.withTimings).catch(() => {});
  }, [loadAudioUrl, defaultVoiceId]);

  const pause = useCallback(() => {
    if (myTokenRef.current === currentPlayToken && sharedAudio && !sharedAudio.paused) {
      sharedAudio.pause();
    }
  }, []);

  const resume = useCallback(() => {
    if (myTokenRef.current === currentPlayToken && sharedAudio && sharedAudio.paused) {
      sharedAudio.play().catch(() => updateState({ error: '音频播放失败' }));
    }
  }, [updateState]);

  /** 停止播放（正在等待的播放 Promise 以 false 结束） */
  const stop = useCallback(() => {
    cleanupAudio();
    updateState({ isPlaying: false, isLoading: false, currentTime: 0 });
  }, [cleanupAudio, updateState]);

  const seek = useCallback((time: number) => {
    if (myTokenRef.current === currentPlayToken && sharedAudio) {
      sharedAudio.currentTime = Math.max(0, Math.min(time, sharedAudio.duration));
    }
  }, []);

  const setVolume = useCallback((volume: number) => {
    if (sharedAudio) {
      sharedAudio.volume = Math.max(0, Math.min(1, volume));
    }
  }, []);

  /** 本实例正在播放的音频的实时位置（秒），用于逐词高亮这类需要比 timeupdate 更细的场景 */
  const currentTimeNow = useCallback(
    () => (myTokenRef.current === currentPlayToken && sharedAudio && !sharedAudio.paused ? sharedAudio.currentTime : null),
    []
  );

  const clearError = useCallback(() => {
    updateState({ error: null });
  }, [updateState]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanupAudio();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [cleanupAudio]);

  // 返回稳定引用：调用方把它放进依赖数组时不会每次渲染都变化
  return useMemo(() => ({
    state,
    playText,
    playWord,
    playSentence,
    prefetch,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    clearError,
    currentTimeNow,
  }), [state, playText, playWord, playSentence, prefetch, pause, resume, stop, seek, setVolume, clearError, currentTimeNow]);
};
