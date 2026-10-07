import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeWords } from './tokenize.ts';

test('小写合并、去标点、丢弃与数字粘连的片段和单字母', () => {
  assert.deepEqual(tokenizeWords('Tom has a kite. TOM runs on May 12th at 9:00, don\'t stop!'), {
    tom: 2, has: 1, kite: 1, runs: 1, on: 1, may: 1, at: 1, don: 1, stop: 1,
  });
});

test('超过 20 个字母的片段丢弃', () => {
  assert.deepEqual(tokenizeWords('a'.repeat(21) + ' ok'), { ok: 1 });
});
