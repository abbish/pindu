import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localToday, pickPracticeSchedule } from './schedulePick.ts';

const s = (id: number, schedule_date: string, completed = false) => ({ id, schedule_date, completed });

test('本地日期（不是 UTC）', () => {
  // 东八区 10-07 早上 7 点（UTC 仍是 10-06）
  const d = new Date(2026, 9, 7, 7, 0, 0);
  assert.equal(localToday(d), '2026-10-07');
});

test('选择要练习的日程', () => {
  const today = '2026-10-07';
  assert.equal(pickPracticeSchedule([s(1, '2026-10-06', true), s(2, today), s(3, '2026-10-08')], today)?.id, 2);
  // 今天练完了，前天还没练：补做逾期
  assert.equal(pickPracticeSchedule([s(1, '2026-10-05'), s(2, today, true)], today)?.id, 1);
  // 今天和之前都练完：再练今天
  assert.equal(pickPracticeSchedule([s(1, '2026-10-06', true), s(2, today, true), s(3, '2026-10-08')], today)?.id, 2);
  // 计划还没开始：第一个
  assert.equal(pickPracticeSchedule([s(5, '2026-10-10'), s(4, '2026-10-09')], today)?.id, 4);
  // 全部练完：最后一个
  assert.equal(pickPracticeSchedule([s(1, '2026-10-01', true), s(2, '2026-10-02', true)], today)?.id, 2);
  assert.equal(pickPracticeSchedule([], today), undefined);
});
