import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeTime, pauseClock, resumeClock, startClock, totalTime } from './practiceClock.ts';

test('暂停时间不计入有效时长，总时长包含暂停', () => {
  let c = startClock(0);
  c = pauseClock(c, 60_000); // 练 1 分钟后暂停
  c = resumeClock(c, 360_000); // 暂停 5 分钟
  assert.equal(activeTime(c, 420_000), 120_000);
  assert.equal(totalTime(c, 420_000), 420_000);
  // 重复暂停 / 恢复不影响
  assert.deepEqual(pauseClock(pauseClock(c, 500_000), 600_000), pauseClock(c, 500_000));
  assert.equal(resumeClock(c, 999_999), c);
});

test('恢复会话：从已落库的时长继续累计', () => {
  const c = startClock(1_000, 900_000, 600_000);
  assert.equal(activeTime(c, 61_000), 660_000);
  assert.equal(totalTime(c, 61_000), 960_000);
});

test('不依赖定时器：长时间没有 tick 也按时间戳计算', () => {
  const c = startClock(0);
  assert.equal(activeTime(c, 3_600_000), 3_600_000);
});
