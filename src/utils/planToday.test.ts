import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStepOf, todayLine } from './planToday.ts';
import type { TodayStudySchedule } from '../types/study';
import type { TodayPassageTask } from '../types/passage';

const schedule = (status: TodayStudySchedule['status'], extra: Partial<TodayStudySchedule> = {}): TodayStudySchedule => ({
  plan_id: 1,
  plan_name: '计划',
  schedule_id: 10,
  schedule_date: '2026-10-07',
  new_words_count: 9,
  review_words_count: 12,
  total_words_count: 21,
  completed_words_count: 0,
  progress_percentage: 0,
  status,
  can_start_practice: true,
  overdue_count: 0,
  ...extra,
});
const passage = (itemId: number, status: TodayPassageTask['status'], scheduledDate = '2026-10-07'): TodayPassageTask => ({
  itemId,
  planId: 1,
  planName: '计划',
  passageId: itemId,
  title: `P${itemId}`,
  wordCount: 100,
  setId: null,
  setName: null,
  mode: 'reading',
  scheduledDate,
  status,
});
const label = (d: string) => d.slice(5);

test('继续学习：先练今天的单词，练完再去到期的短文（最早到期的那篇）', () => {
  assert.deepEqual(nextStepOf('both', schedule('not-started'), [passage(1, 'due')]), { kind: 'words' });
  const step = nextStepOf('both', schedule('completed'), [passage(2, 'due'), passage(3, 'overdue', '2026-10-05'), passage(4, 'completed')]);
  assert.equal(step.kind === 'passage' && step.task.itemId, 3);
  // 只练短文的计划不看单词日程
  assert.equal(nextStepOf('passages', schedule('not-started'), [passage(1, 'due')]).kind, 'passage');
  // 都做完 / 什么都没有：原来的行为
  assert.equal(nextStepOf('both', schedule('completed'), [passage(4, 'completed')]).kind, 'default');
  assert.equal(nextStepOf('words', undefined, []).kind, 'default');
});

test('日程栏的今天一行', () => {
  assert.deepEqual(todayLine(schedule('in-progress'), [passage(1, 'due')], label), { text: '今天：新词 9 · 复习 12 · 短文《P1》', warning: false });
  assert.deepEqual(todayLine(schedule('completed'), [passage(1, 'due'), passage(2, 'overdue')], label), { text: '今天：短文 2 篇', warning: true });
  assert.deepEqual(todayLine(schedule('overdue', { schedule_date: '2026-10-05', overdue_count: 2, review_words_count: 0 }), [], label), {
    text: '今天：10-05的单词还没练（共 2 天待补） · 新词 9',
    warning: true,
  });
  assert.deepEqual(todayLine(schedule('completed'), [passage(1, 'completed')], label), { text: '今天已练完', warning: false });
  assert.deepEqual(todayLine(undefined, [passage(1, 'completed')], label), { text: '今天已练完', warning: false });
  assert.equal(todayLine(undefined, [], label), null);
});
