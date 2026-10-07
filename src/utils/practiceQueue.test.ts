import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, completedTaskCount, groupCountOf, MAX_RETRIES, nextStepFromAttempts, queueWordFromState, RETRY_GAP, scheduleRetry, type PracticeTask } from './practiceQueue.ts';

const fresh = (n: number) => Array.from({ length: n }, () => ({ nextStep: 1 as const }));
const brief = (q: PracticeTask[]) => q.map(t => `${t.kind[0]}${t.wordIndex}.${t.step}`);

test('组内按步骤交错，组之间依次进行，最后是当轮小测', () => {
  const q = buildQueue(fresh(7), { groupSize: 5 });
  assert.deepEqual(brief(q).slice(0, 15), [
    'l0.1', 'l1.1', 'l2.1', 'l3.1', 'l4.1',
    'l0.2', 'l1.2', 'l2.2', 'l3.2', 'l4.2',
    'l0.3', 'l1.3', 'l2.3', 'l3.3', 'l4.3',
  ]);
  assert.deepEqual(brief(q).slice(15, 21), ['l5.1', 'l6.1', 'l5.2', 'l6.2', 'l5.3', 'l6.3']);
  assert.deepEqual(brief(q).slice(21), ['r0.3', 'r1.3', 'r2.3', 'r3.3', 'r4.3', 'r5.3', 'r6.3']);
});

test('恢复会话时跳过已做过的步骤', () => {
  const q = buildQueue([{ nextStep: 3 }, { nextStep: 4 }, { nextStep: 1 }], { includeReview: false });
  assert.deepEqual(brief(q), ['l2.1', 'l2.2', 'l0.3', 'l2.3']);
  assert.deepEqual([nextStepFromAttempts([1, 2, 0]), nextStepFromAttempts([]), nextStepFromAttempts([1, 1, 1])], [3, 1, 4]);
});

test('答错后隔几题重考，但不晚于这个词的下一步', () => {
  const q = buildQueue(fresh(5), { includeReview: false });
  // 第 0 个任务（词 0 第一步）答错：插在 RETRY_GAP 个任务之后
  const q1 = scheduleRetry(q, 0, 0);
  assert.equal(q1.length, q.length + 1);
  assert.equal(brief(q1)[1 + RETRY_GAP], 'r0.1');
  // 词 4 第一步（下标 4）答错：词 4 后面紧接着是其他词的第二步，重考插在 RETRY_GAP 之后、词 4 第二步之前
  const q2 = scheduleRetry(q, 4, 0);
  const retryAt = brief(q2).indexOf('r4.1');
  assert.ok(retryAt > 4 && retryAt < brief(q2).indexOf('l4.2'));
  // 达到上限 / 小测题不再重考
  assert.equal(scheduleRetry(q, 0, MAX_RETRIES), q);
  const withReview = buildQueue(fresh(2));
  assert.equal(scheduleRetry(withReview, withReview.length - 1, 0), withReview);
});

test('只有一个词时重考紧跟在后面', () => {
  const q = buildQueue(fresh(1), { includeReview: false });
  assert.deepEqual(brief(scheduleRetry(q, 0, 0)), ['l0.1', 'r0.1', 'l0.2', 'l0.3']);
});

test('恢复会话：补上待重考的步骤，跳过已做过的小测', () => {
  const words = [
    // 第一步答错、还没重考；第二步已做
    queueWordFromState({ stepAttempts: [1, 1, 0], stepResults: [false, true, false], retryCounts: [0, 0, 0], fixedSteps: [false, false, false] }),
    // 三步做完，小测也做过
    queueWordFromState({ stepAttempts: [1, 1, 1], stepResults: [true, true, true], reviewCorrect: false }),
    // 第一步答错且重考已到上限：不再补
    queueWordFromState({ stepAttempts: [1, 0, 0], stepResults: [false], retryCounts: [MAX_RETRIES, 0, 0] }),
  ];
  assert.deepEqual(words[0], { nextStep: 3, reviewDone: false, pendingRetrySteps: [1] });
  const q = buildQueue(words);
  assert.deepEqual(brief(q), ['r0.1', 'l2.2', 'l0.3', 'l2.3', 'r0.3', 'r2.3']);
});

test('恢复：组号按原始位置，前面整组做完后后面的组号不变', () => {
  const words = [
    ...Array.from({ length: 5 }, () => ({ nextStep: 4 as const, reviewDone: false })),
    { nextStep: 2 as const },
    ...Array.from({ length: 4 }, () => ({ nextStep: 1 as const })),
  ];
  const q = buildQueue(words, { groupSize: 5 });
  const learn = q.filter(t => t.kind === 'learn');
  assert.ok(learn.every(t => t.group === 1));
  assert.equal(learn[0].step, 1);
  assert.equal(groupCountOf(words.length, 5), 2);
  // 已完成：前 5 个词各 3 步 + 第 6 个词 1 步
  assert.equal(completedTaskCount(words), 16);
});

test('复习词只考第三步、不参加当轮小测；恢复时按第三步是否做过判断', () => {
  const words = [
    queueWordFromState({ isReview: true, stepAttempts: [0, 0, 0] }),
    { nextStep: 1 as const },
  ];
  const q = buildQueue(words, { groupSize: 5 });
  const reviewTasks = q.filter(t => t.wordIndex === 0);
  assert.deepEqual(reviewTasks.map(t => `${t.kind}.${t.step}`), ['learn.3']);
  assert.equal(q.filter(t => t.wordIndex === 1).length, 4); // 新词三步 + 小测
  // 复习词做过且答错未改正：先补重考；进度按一题计
  const done = queueWordFromState({ isReview: true, stepAttempts: [0, 0, 1], stepResults: [false, false, false] });
  assert.equal(done.nextStep, 4);
  assert.deepEqual(done.pendingRetrySteps, [3]);
  assert.equal(completedTaskCount([done, { nextStep: 2 }]), 2);
});
