import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addLocalDays,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMonth,
  formatRelative,
  formatRelativeDay,
  formatTime,
  formatWeekday,
  instantMs,
  localDateOf,
  localDaysBetween,
  localToday,
  msUntilNextLocalMidnight,
  parseInstant,
  parseLocalDate,
  sameMinute,
  toLocalDateKey,
} from './datetime.ts';

test('时刻：规范格式、SQLite 无时区格式、RFC3339 都按 UTC 解析为同一时刻', () => {
  const expected = '2026-10-07T02:20:15.000Z';
  assert.equal(parseInstant('2026-10-07T02:20:15.000Z')?.toISOString(), expected);
  assert.equal(parseInstant('2026-10-07 02:20:15')?.toISOString(), expected);
  assert.equal(parseInstant('2026-10-07T02:20:15')?.toISOString(), expected);
  assert.equal(parseInstant('2026-10-07T02:20:15.000000000+00:00')?.toISOString(), expected);
  assert.equal(parseInstant('2026-10-07T10:20:15+08:00')?.toISOString(), expected);
  assert.equal(parseInstant(''), null);
  assert.equal(parseInstant('不是时间'), null);
  assert.equal(instantMs('bad'), 0);
});

test('日历日期按本地日解析，不当成 UTC 零点', () => {
  const d = parseLocalDate('2026-10-01');
  assert.deepEqual([d?.getFullYear(), d?.getMonth(), d?.getDate(), d?.getHours()], [2026, 9, 1, 0]);
  assert.equal(parseLocalDate('2026-10-01 10:00:00'), null);
  assert.equal(parseLocalDate(null), null);
  assert.equal(parseInstant('2026-10-01')?.getDate(), 1);
});

test('本地日期键、今天、加减天数、相差天数', () => {
  assert.equal(toLocalDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(localToday(new Date(2026, 9, 7, 0, 30)), '2026-10-07');
  assert.equal(addLocalDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addLocalDays('2026-03-01', -1), '2026-02-28');
  assert.equal(localDaysBetween(new Date(2026, 9, 1, 23), new Date(2026, 9, 3, 1)), 2);
});

test('时刻按本机时区归日，而不是截取 UTC 字符串', () => {
  const local = new Date(2026, 9, 7, 0, 30); // 本地 10-07 00:30
  assert.equal(localDateOf(local.toISOString()), '2026-10-07');
  assert.equal(localDateOf(null), '');
});

test('距下一个本地零点', () => {
  assert.equal(msUntilNextLocalMidnight(new Date(2026, 9, 7, 23, 59, 0)), 60_000);
});

test('展示：日期 / 年月 / 星期 / 时间', () => {
  const now = new Date(2026, 9, 7, 15, 0);
  assert.equal(formatDate('2026-10-14', now), '10月14日');
  assert.equal(formatDate('2025-12-31', now), '2025年12月31日');
  assert.equal(formatDate(new Date(2026, 9, 7, 9, 5).toISOString(), now), '10月7日');
  assert.equal(formatDate(null, now), '');
  assert.equal(formatMonth('2026-10-07'), '2026年10月');
  assert.equal(formatWeekday('2026-10-07'), '周三');
  assert.equal(formatTime(new Date(2026, 9, 7, 9, 5, 7)), '09:05');
  assert.equal(formatTime(new Date(2026, 9, 7, 9, 5, 7), true), '09:05:07');
  assert.equal(formatDateTime(new Date(2026, 9, 7, 9, 5).toISOString(), now), '10月7日 09:05');
});

test('相对时间', () => {
  const now = new Date(2026, 9, 7, 15, 0);
  const at = (...a: [number, number, number, number?, number?, number?]) => new Date(a[0], a[1] - 1, a[2], a[3] ?? 12, a[4] ?? 0, a[5] ?? 0).toISOString();
  assert.equal(formatRelative(at(2026, 10, 7, 14, 59, 30), now), '刚刚');
  assert.equal(formatRelative(at(2026, 10, 7, 14, 20), now), '40 分钟前');
  assert.equal(formatRelative(at(2026, 10, 7, 9, 0), now), '6 小时前');
  assert.equal(formatRelative(at(2026, 10, 6, 23, 0), now), '昨天');
  assert.equal(formatRelative(at(2026, 10, 3, 10, 0), now), '4 天前');
  assert.equal(formatRelative(at(2026, 9, 20), now), '9月20日');
  assert.equal(formatRelative('bad', now), '');
  assert.equal(formatRelativeDay(at(2026, 10, 7, 9), now), '今天');
  assert.equal(formatRelativeDay(at(2025, 12, 31), now), '2025年12月31日');
});

test('同一分钟（跨格式）', () => {
  assert.equal(sameMinute('2026-10-06 12:29:10', '2026-10-06T12:29:50.000Z'), true);
  assert.equal(sameMinute('2026-10-06 12:29:10', '2026-10-07 02:20:15'), false);
  assert.equal(sameMinute(undefined, '2026-10-06 12:29:10'), false);
});

test('时长', () => {
  assert.equal(formatDuration(11_400), '11 秒');
  assert.equal(formatDuration(200_000), '3 分 20 秒');
  assert.equal(formatDuration(3_900_000), '1 小时 5 分');
  assert.equal(formatDuration(null), '0 秒');
  assert.equal(formatDuration(200_000, 'clock'), '03:20');
  assert.equal(formatDuration(3_900_000, 'clock'), '1:05:00');
});
