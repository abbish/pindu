import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkpointTitle, wordCheckpoints } from './practiceCheckpoints.ts';

test('三步与小测的状态', () => {
  const cps = wordCheckpoints({
    stepResults: [false, true, false],
    stepAttempts: [1, 1, 1],
    retryCounts: [1, 0, 2],
    fixedSteps: [true, false, false],
    reviewCorrect: true,
  });
  assert.deepEqual(cps.map(c => `${c.label}:${c.status}`), ['刚学写:fixed', '隔词写:first', '听写:missed', '小测:first']);
  assert.match(checkpointTitle(cps[0]), /改对（重考 1 次）/);
  assert.match(checkpointTitle(cps[2]), /重考 2 次仍没写对/);
});

test('旧数据（没有重考 / 小测字段）兼容', () => {
  const cps = wordCheckpoints({ stepResults: [true, true, true], stepAttempts: [1, 1, 1] });
  assert.deepEqual(cps.map(c => c.status), ['first', 'first', 'first', 'none']);
  const notDone = wordCheckpoints({ stepResults: [false, false, false], stepAttempts: [0, 0, 0] });
  assert.deepEqual(notDone.map(c => c.status), ['none', 'none', 'none', 'none']);
});
