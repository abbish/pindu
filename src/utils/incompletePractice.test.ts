import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimLaunchReminder,
  formatActiveTime,
  lastActiveLabel,
  practiceProgress,
  scheduleLabel,
  scheduleTiming,
  sortByLastActive,
} from './incompletePractice.ts';

const session = (over: Partial<{ scheduleDate: string; updatedAt: string; startTime: string; wordStates: { stepAttempts: number[]; reviewCorrect?: boolean | null; isReview?: boolean }[] }> = {}) => ({
  scheduleDate: '2026-10-07',
  updatedAt: '2026-10-07T02:00:00Z',
  startTime: '2026-10-07T01:00:00Z',
  ...over,
});

test('进度按已做的题计（三步 + 小测），交错队列下不会一直显示 0', () => {
  const s = session({
    wordStates: [
      { stepAttempts: [1, 1, 1], reviewCorrect: false },
      { stepAttempts: [1, 1, 0], reviewCorrect: null },
      { stepAttempts: [0, 0, 0] },
    ],
  });
  assert.deepEqual(practiceProgress(s), { done: 6, total: 12, words: 3 });
  assert.deepEqual(practiceProgress(session()), { done: 0, total: 0, words: 0 });
});

test('日程日期按本地日期比较', () => {
  assert.equal(scheduleTiming('2026-10-06', '2026-10-07'), 'overdue');
  assert.equal(scheduleTiming('2026-10-07', '2026-10-07'), 'today');
  assert.equal(scheduleTiming('2026-10-11', '2026-10-07'), 'ahead');
  assert.equal(scheduleLabel('2026-10-11', '2026-10-07'), '10月11日 周日（提前练）');
  assert.equal(scheduleLabel('2026-10-05', '2026-10-07'), '10月5日 周一（已过期）');
  assert.equal(scheduleLabel('2026-10-07', '2026-10-07'), '今天（10月7日）');
});

test('上次练习时间', () => {
  const now = new Date(2026, 9, 7, 15, 0);
  assert.equal(lastActiveLabel(new Date(2026, 9, 7, 14, 59, 30).toISOString(), now), '刚刚');
  assert.equal(lastActiveLabel(new Date(2026, 9, 7, 14, 20).toISOString(), now), '40 分钟前');
  assert.equal(lastActiveLabel(new Date(2026, 9, 7, 9, 0).toISOString(), now), '6 小时前');
  assert.equal(lastActiveLabel(new Date(2026, 9, 6, 23, 0).toISOString(), now), '昨天');
  assert.equal(lastActiveLabel(new Date(2026, 9, 3, 10, 0).toISOString(), now), '4 天前');
  assert.equal(lastActiveLabel('bad', now), '');
});

test('练习时长', () => {
  assert.equal(formatActiveTime(11_400), '11 秒');
  assert.equal(formatActiveTime(200_000), '3 分 20 秒');
  assert.equal(formatActiveTime(3_900_000), '1 小时 5 分');
  assert.equal(formatActiveTime(null), '0 秒');
});

test('最近练过的排前面', () => {
  const a = session({ updatedAt: '2026-10-05T00:00:00Z' });
  const b = session({ updatedAt: '2026-10-07T00:00:00Z' });
  assert.deepEqual(sortByLastActive([a, b]), [b, a]);
});

test('首页提醒每次启动只弹一次', () => {
  assert.equal(claimLaunchReminder(), true);
  assert.equal(claimLaunchReminder(), false);
});

test('复习词进度按一题计', () => {
  const s = session({ wordStates: [{ stepAttempts: [0, 0, 1], isReview: true }, { stepAttempts: [1, 0, 0] }] });
  assert.deepEqual(practiceProgress(s), { done: 2, total: 5, words: 2 });
});
