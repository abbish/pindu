import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitLearningOrderTool } from './planning.ts';

const run = (order: { id: number; difficulty: number; priority: 'high' | 'medium' | 'low' }[]) =>
  submitLearningOrderTool.execute('t1', { order }, undefined, undefined, undefined as never);

test('合格顺序被接受并结束本轮', async () => {
  const result = await run([{ id: 3, difficulty: 1, priority: 'high' }, { id: 1, difficulty: 4, priority: 'low' }]);
  assert.equal(result.terminate, true);
  assert.deepEqual(result.details?.order.map(o => o.id), [3, 1]);
});

test('空列表与重复 id 被退回', async () => {
  await assert.rejects(run([]), /为空/);
  await assert.rejects(run([{ id: 3, difficulty: 1, priority: 'high' }, { id: 3, difficulty: 2, priority: 'low' }]), /重复/);
});
