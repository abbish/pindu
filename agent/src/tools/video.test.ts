import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSuggestionsProblems, videoPlanProblems, type VideoPlanSubmission } from './video.ts';

const seg = (first: number, last: number) => ({
  first,
  last,
  title: 'Ordering Food',
  scene: '餐厅点餐',
  level: 'a2',
  focus: '学点餐的常用说法',
  key_words: ['menu', 'recommend'],
  tags: ['点餐'],
});
const plan = (...segments: ReturnType<typeof seg>[]): VideoPlanSubmission => ({ cue_count: 20, segments });

test('合格的规划', () => {
  assert.deepEqual(videoPlanProblems(plan(seg(1, 8), seg(10, 20))), []);
});

test('编号越界、颠倒、重叠都退回', () => {
  assert.equal(videoPlanProblems(plan(seg(0, 3))).length, 1);
  assert.equal(videoPlanProblems(plan(seg(5, 21))).length, 1);
  assert.ok(videoPlanProblems(plan(seg(5, 3))).some((p) => p.includes('first 大于 last')));
  assert.ok(videoPlanProblems(plan(seg(1, 8), seg(8, 12))).some((p) => p.includes('重叠')));
  assert.ok(videoPlanProblems(plan(seg(10, 12), seg(1, 5))).some((p) => p.includes('重叠')));
});

test('字段缺失与水平不合法', () => {
  const bad = { ...seg(1, 5), title: ' ', level: 'x', focus: '' };
  const problems = videoPlanProblems(plan(bad));
  assert.equal(problems.length, 3);
  // 分块规划时某一部分可能没有合适的内容
  assert.deepEqual(videoPlanProblems({ cue_count: 3, segments: [] }), []);
});

test('标签要 1–3 个、每个不超过 10 个字', () => {
  const none = { ...seg(1, 8), tags: [] };
  const long = { ...seg(1, 8), tags: ['一二三四五六七八九十一'] };
  assert.equal(videoPlanProblems(plan(none)).length, 1);
  assert.equal(videoPlanProblems(plan(long)).length, 1);
});

test('切分要求建议：条数、长度、不重复', () => {
  assert.deepEqual(planSuggestionsProblems({ suggestions: ['只要厨房里做饭的对话', '每段围绕一次完整的问答', '挑语速慢的段落', '去掉片头和歌曲'] }), []);
  assert.equal(planSuggestionsProblems({ suggestions: ['只要厨房里做饭的对话'] }).length, 1);
  assert.ok(planSuggestionsProblems({ suggestions: ['好', '每段围绕一次完整的问答', '每段围绕一次完整的问答', '挑语速慢的段落'] }).length >= 2);
});
