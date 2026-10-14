import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PEAKS_PER_SECOND, refineSentenceTimes } from './speechBoundaries.ts';

/** 按 [起, 止, 音量] 段造一段波形（毫秒），其余是安静 */
const wave = (totalMs: number, loud: [number, number, number][]) => {
  const frame = 1000 / PEAKS_PER_SECOND;
  return Array.from({ length: Math.ceil(totalMs / frame) }, (_, i) => {
    const t = i * frame;
    return loud.find(([a, b]) => t >= a && t < b)?.[2] ?? 0.01;
  });
};

test('字幕交界紧挨着下一句开口：上一句停在停顿开始处，下一句从停顿结束处开始', () => {
  // 第一句说到 2000，停顿，第二句 3080 开口；字幕交界在 3000
  const peaks = wave(6000, [
    [0, 2000, 0.4],
    [3080, 5500, 0.4],
  ]);
  const [a, b] = refineSentenceTimes(
    [
      { startMs: 0, endMs: 3000 },
      { startMs: 3000, endMs: 6000 },
    ],
    peaks,
    0
  );
  assert.equal(a.endMs, 2060);
  assert.equal(b.startMs, 3020);
});

test('短片在原视频中间：按偏移读波形', () => {
  const peaks = wave(16000, [
    [10000, 12000, 0.4],
    [13080, 15500, 0.4],
  ]);
  const [a, b] = refineSentenceTimes(
    [
      { startMs: 0, endMs: 3000 },
      { startMs: 3000, endMs: 6000 },
    ],
    peaks,
    10000
  );
  assert.equal(a.endMs, 2060);
  assert.equal(b.startMs, 3020);
});

test('句子中间的停顿离交界远：不当成句间停顿', () => {
  // 第一句 1000–1400 有一段长停顿，交界 3000 前后说话连着
  const peaks = wave(6000, [
    [0, 1000, 0.4],
    [1400, 6000, 0.4],
  ]);
  const times = refineSentenceTimes(
    [
      { startMs: 0, endMs: 3000 },
      { startMs: 3000, endMs: 6000 },
    ],
    peaks,
    0
  );
  assert.deepEqual(times, [
    { startMs: 0, endMs: 3000 },
    { startMs: 3000, endMs: 6000 },
  ]);
});

test('说话连着、找不到停顿时保持字幕时间', () => {
  const peaks = wave(6000, [[0, 6000, 0.4]]);
  const times = refineSentenceTimes(
    [
      { startMs: 0, endMs: 3000 },
      { startMs: 3000, endMs: 6000 },
    ],
    peaks,
    0
  );
  assert.deepEqual(times, [
    { startMs: 0, endMs: 3000 },
    { startMs: 3000, endMs: 6000 },
  ]);
});

test('两句本来就隔开、或没有波形时不动', () => {
  const sentences = [
    { startMs: 0, endMs: 2000 },
    { startMs: 2600, endMs: 5000 },
  ];
  assert.deepEqual(refineSentenceTimes(sentences, wave(6000, [[0, 6000, 0.4]]), 0), sentences);
  assert.deepEqual(refineSentenceTimes(sentences, [], 0), sentences);
});
