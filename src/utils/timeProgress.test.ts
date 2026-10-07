import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTimeProgress } from './timeProgress.ts';

// 与后端 statistics_repository::time_progress_counts_days_before_today 同一组用例
test('时间进度：第 k 天 = (k-1)/n，按本地日历日', () => {
  const pct = (y: number, m: number, d: number, h = 12) =>
    Math.round(calculateTimeProgress('2026-10-05', '2026-10-07', new Date(y, m - 1, d, h)));
  assert.equal(pct(2026, 10, 4), 0);
  assert.equal(pct(2026, 10, 5), 0);
  assert.equal(pct(2026, 10, 6), 33);
  assert.equal(pct(2026, 10, 7), 67);
  assert.equal(pct(2026, 10, 8), 100);
  // 本地凌晨与深夜都算同一天
  assert.equal(pct(2026, 10, 6, 0), 33);
  assert.equal(pct(2026, 10, 6, 23), 33);
});

test('缺少或无效日期为 0', () => {
  assert.equal(calculateTimeProgress(null, '2026-10-07'), 0);
  assert.equal(calculateTimeProgress('坏', '2026-10-07'), 0);
});
