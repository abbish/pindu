import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abortError, abortableSleep, isAbortError, runRepeatedPlayback } from './repeatPlayback';

/** 虚拟时钟：sleep / play 只推进时间，记录每次播放的开始与结束 */
const virtualClock = (playDurations: number[]) => {
  let now = 0;
  const plays: { start: number; end: number }[] = [];
  return {
    plays,
    sleep: async (ms: number, signal: AbortSignal) => {
      if (signal.aborted) throw abortError();
      now += ms;
    },
    play: async () => {
      const start = now;
      now += playDurations[plays.length] ?? 0;
      plays.push({ start, end: now });
    },
  };
};

test('间隔从上一次播放结束算起：首次生成语音慢不会压缩后续间隔', async () => {
  // 第一次含生成语音 3 秒 + 播放 0.8 秒；之后命中缓存只有播放 0.8 秒
  const clock = virtualClock([3800, 800, 800]);
  const completed = await runRepeatedPlayback({
    times: 3,
    initialDelayMs: 500,
    gapMs: 1200,
    signal: new AbortController().signal,
    play: clock.play,
    sleep: clock.sleep,
  });
  assert.equal(completed, 3);
  assert.deepEqual(clock.plays.map(p => p.start), [500, 500 + 3800 + 1200, 500 + 3800 + 1200 + 800 + 1200]);
  for (let i = 1; i < clock.plays.length; i++) {
    assert.equal(clock.plays[i].start - clock.plays[i - 1].end, 1200);
  }
});

test('中止后不再开始新的播放，也不抛错', async () => {
  const controller = new AbortController();
  const clock = virtualClock([100, 100, 100]);
  const indexes: number[] = [];
  const completed = await runRepeatedPlayback({
    times: 3,
    initialDelayMs: 0,
    gapMs: 1000,
    signal: controller.signal,
    play: async (signal) => {
      await clock.play();
      if (clock.plays.length === 1) controller.abort();
      if (signal.aborted) throw abortError();
    },
    onPlay: i => indexes.push(i),
    sleep: clock.sleep,
  });
  assert.equal(completed, 0);
  assert.deepEqual(indexes, [1]);
});

test('播放失败（非中止）向上抛出', async () => {
  await assert.rejects(
    runRepeatedPlayback({
      times: 2,
      initialDelayMs: 0,
      gapMs: 0,
      signal: new AbortController().signal,
      play: async () => {
        throw new Error('TTS 失败');
      },
      sleep: async () => {},
    }),
    /TTS 失败/
  );
});

test('abortableSleep：已中止立即拒绝，等待中被中止也拒绝', async () => {
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(abortableSleep(10, aborted.signal), (e: unknown) => isAbortError(e));

  const controller = new AbortController();
  const pending = abortableSleep(10_000, controller.signal);
  controller.abort();
  await assert.rejects(pending, (e: unknown) => isAbortError(e));

  await abortableSleep(1, new AbortController().signal);
});

test('按序号依次播放不同内容（单词 → 例句）', async () => {
  const clock = virtualClock([700, 2500]);
  const played: string[] = [];
  const items = ['cat', 'The cat is sleeping.'];
  const completed = await runRepeatedPlayback({
    times: items.length,
    initialDelayMs: 600,
    gapMs: 1000,
    signal: new AbortController().signal,
    play: async (_signal, index) => {
      played.push(items[index]);
      await clock.play();
    },
    sleep: clock.sleep,
  });
  assert.equal(completed, 2);
  assert.deepEqual(played, items);
  assert.deepEqual(clock.plays.map(p => p.start), [600, 600 + 700 + 1000]);
});
