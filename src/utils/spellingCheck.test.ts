import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpelling } from './spellingCheck.ts';

const pattern = (input: string, target: string) =>
  checkSpelling(input, target).marks.map(m => (m.status === 'ok' ? m.char : m.status === 'wrong' ? '!' : '_')).join('');

test('正确（不区分大小写、忽略首尾空格）', () => {
  const r = checkSpelling(' Cake ', 'cake');
  assert.equal(r.correct, true);
  assert.equal(pattern('cake', 'cake'), 'cake');
});

test('替换、漏写、多写', () => {
  // said 写成 sed：中间两个字母一个写错、一个漏写
  assert.ok(['s!_d', 's_!d'].includes(pattern('sed', 'said')));
  assert.equal(pattern('cak', 'cake'), 'cak_');
  assert.equal(pattern('kake', 'cake'), '!ake');
  const extra = checkSpelling('caake', 'cake');
  assert.equal(extra.extra, 1);
  assert.equal(extra.correct, false);
});

test('错误对应到拼读块', () => {
  assert.deepEqual(checkSpelling('nite', 'night', ['n', 'igh', 't']).wrongChunks, ['igh']);
  assert.deepEqual(checkSpelling('elefant', 'elephant', ['el', 'e', 'ph', 'ant']).wrongChunks, ['ph']);
  assert.deepEqual(checkSpelling('sed', 'said', ['s', 'ai', 'd']).wrongChunks, ['ai']);
  // 拼读块拼不回单词时不对应
  assert.deepEqual(checkSpelling('dg', 'dog', ['D', 'o']).wrongChunks, []);
});

test('词组：多打的空格不算错，按词标出错的块', () => {
  assert.equal(checkSpelling('give   up', 'give up').correct, true);
  const r = checkSpelling('giv up', 'give up', ['give', 'up']);
  assert.equal(r.correct, false);
  assert.deepEqual(r.wrongChunks, ['give']);
});
