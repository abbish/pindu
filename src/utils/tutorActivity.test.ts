import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyActivity, conversationMark, EMPTY_ACTIVITY, forgetActivity, summarizeActivity } from './tutorActivity.ts';

test('两个对话同时在回答：都算在回答；一个停下来问学习者，单独算等回答', () => {
  let s = applyActivity(EMPTY_ACTIVITY, 'a', true, false, 1);
  s = applyActivity(s, 'b', true, false, 2);
  assert.deepEqual(summarizeActivity(s, 0, false), { asking: [], running: ['a', 'b'], unseen: [] });
  s = applyActivity(s, 'b', true, true, 3);
  assert.deepEqual(summarizeActivity(s, 0, false), { asking: ['b'], running: ['a'], unseen: [] });
});

test('答完：不在 AI 老师页面时记为没看过，看过之后、正在看时都不算', () => {
  let s = applyActivity(EMPTY_ACTIVITY, 'a', true, false, 1);
  s = applyActivity(s, 'a', false, false, 10);
  assert.deepEqual(summarizeActivity(s, 5, false).unseen, ['a']);
  assert.deepEqual(summarizeActivity(s, 20, false).unseen, []);
  assert.deepEqual(summarizeActivity(s, 5, true).unseen, []);
  assert.deepEqual(summarizeActivity(s, 5, false).running, []);
});

test('回答完问题后接着回答不算答完；又开始回答时去掉答完标记', () => {
  let s = applyActivity(EMPTY_ACTIVITY, 'a', true, true, 1);
  s = applyActivity(s, 'a', true, false, 2);
  assert.deepEqual(s.finished, {});
  s = applyActivity(s, 'a', false, false, 3);
  assert.deepEqual(s.finished, { a: 3 });
  s = applyActivity(s, 'a', true, false, 4);
  assert.deepEqual(s.finished, {});
});

test('没在回答过的对话变成空闲（如初始就空闲）不算答完；删掉的对话不再显示', () => {
  let s = applyActivity(EMPTY_ACTIVITY, 'a', false, false, 1);
  assert.deepEqual(s, EMPTY_ACTIVITY);
  s = applyActivity(s, 'b', true, false, 2);
  s = applyActivity(s, 'b', false, false, 3);
  s = forgetActivity(s, 'b');
  assert.deepEqual(s, EMPTY_ACTIVITY);
});

test('对话列表的标记：等回答优先于在回答；答完后没看过显示新回答，正在看或之后看过就不显示', () => {
  let s = applyActivity(EMPTY_ACTIVITY, 'a', true, false, 1);
  assert.equal(conversationMark(s, 'a', 0, false), 'running');
  s = applyActivity(s, 'a', true, true, 2);
  assert.equal(conversationMark(s, 'a', 0, true), 'asking');
  s = applyActivity(s, 'a', false, false, 10);
  assert.equal(conversationMark(s, 'a', 5, false), 'unread');
  assert.equal(conversationMark(s, 'a', 5, true), null);
  assert.equal(conversationMark(s, 'a', 20, false), null);
  assert.equal(conversationMark(s, 'b', 0, false), null);
});
