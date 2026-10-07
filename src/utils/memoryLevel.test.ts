import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueLabel, memoryBoxLabel, memoryStage } from './memoryLevel.ts';

test('等级 → 学习状态：0 未学，1–3 学习中，≥4 掌握', () => {
  assert.equal(memoryStage(0), 'new');
  assert.equal(memoryStage(undefined), 'new');
  assert.equal(memoryStage(1), 'learning');
  assert.equal(memoryStage(3), 'learning');
  assert.equal(memoryStage(4), 'mastered');
  assert.equal(memoryStage(5), 'mastered');
});

test('等级说明与复习间隔一致', () => {
  assert.equal(memoryBoxLabel(0), '还没学');
  assert.equal(memoryBoxLabel(2), '等级 2 · 隔 3 天复习');
  assert.equal(memoryBoxLabel(5), '等级 5 · 隔 30 天复习');
});

test('下次复习的相对日期', () => {
  assert.equal(dueLabel('2026-10-07', '2026-10-07'), '今天');
  assert.equal(dueLabel('2026-10-08', '2026-10-07'), '明天');
  assert.equal(dueLabel('2026-10-12', '2026-10-07'), '5 天后');
  assert.equal(dueLabel('2026-10-05', '2026-10-07'), '已到期 2 天');
  assert.equal(dueLabel(null, '2026-10-07'), '—');
  assert.equal(dueLabel('2026-11-01', '2026-10-31'), '明天');
});
