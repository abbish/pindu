import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSOLIDATION_DAYS, DAILY_NEW_WORDS_OPTIONS, DEFAULT_DAILY_NEW_WORDS, estimatePlan } from './planParams.ts';

test('预估与后端规则一致：学新词天数 + 11 天巩固期', () => {
  const e = estimatePlan(34, 10, '2026-10-07');
  assert.equal(e.learningDays, 4);
  assert.equal(e.periodDays, 4 + CONSOLIDATION_DAYS);
  assert.equal(e.endDate, '2026-10-21');
  assert.equal(estimatePlan(0, 5, '').endDate, '');
  assert.equal(estimatePlan(5, 5, '2026-12-31').endDate, '2027-01-11');
});

test('每天时长随新词数增长', () => {
  assert.ok(estimatePlan(100, 5, '').minutesPerDay < estimatePlan(100, 20, '').minutesPerDay);
  assert.equal(estimatePlan(100, 10, '').minutesPerDay, 23);
});

test('默认值在选项里', () => {
  assert.ok(DAILY_NEW_WORDS_OPTIONS.some(o => o.value === DEFAULT_DAILY_NEW_WORDS));
});
