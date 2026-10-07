/**
 * 朗读调度（纯逻辑，便于测试）。
 *
 * 时间线：进入后等待 `initialDelayMs` → 播放 → 播放结束后等待 `gapMs` → 播放 → …… 共 `times` 次。
 * `play` 收到当前序号，可用来按顺序播放不同内容（如先读单词、再读例句）。
 * 间隔从**上一次播放结束**开始计算，因此首次需要生成语音的等待时间不会压缩后续间隔。
 * `signal` 中止后立即停止，不再开始新的播放；中止不视为错误（返回已完成次数）。
 */

export interface RepeatPlaybackOptions {
  /** 播放次数 */
  times: number;
  /** 首次播放前的等待（毫秒） */
  initialDelayMs: number;
  /** 两次播放之间的停顿（毫秒，从上一次播放结束算起） */
  gapMs: number;
  /** 中止信号：换词、换步骤、暂停、显示结果、手动播放时中止 */
  signal: AbortSignal;
  /** 播放第 index 次（从 0 开始），播放结束时 resolve */
  play: (signal: AbortSignal, index: number) => Promise<void>;
  /** 每次开始播放前回调（第几次，从 1 开始） */
  onPlay?: (index: number) => void;
  /** 可注入的等待函数（测试用） */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** 可被中止的等待：中止时 reject AbortError */
export const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export const abortError = (): Error => {
  const error = new Error('播放已中止');
  error.name = 'AbortError';
  return error;
};

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

/**
 * 按时间线重复播放；返回实际完成的播放次数。
 * 中止返回已完成次数；播放失败（非中止）向上抛出，由调用方提示。
 */
export const runRepeatedPlayback = async ({
  times,
  initialDelayMs,
  gapMs,
  signal,
  play,
  onPlay,
  sleep = abortableSleep,
}: RepeatPlaybackOptions): Promise<number> => {
  let completed = 0;
  try {
    await sleep(initialDelayMs, signal);
    for (let i = 0; i < times; i++) {
      if (i > 0) await sleep(gapMs, signal);
      if (signal.aborted) break;
      onPlay?.(i + 1);
      await play(signal, i);
      completed += 1;
    }
  } catch (error) {
    if (!isAbortError(error)) throw error;
  }
  return completed;
};
