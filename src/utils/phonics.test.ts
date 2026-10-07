import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhonicsSegments } from './phonics';

test('JSON 数组字符串（001 种子数据格式）', () => {
  assert.deepEqual(parsePhonicsSegments('["El", "e", "phant"]'), ['El', 'e', 'phant']);
});

test('逗号分隔字符串', () => {
  assert.deepEqual(parsePhonicsSegments('C, at'), ['C', 'at']);
});

test('空值与无片段返回 undefined', () => {
  assert.equal(parsePhonicsSegments(undefined), undefined);
  assert.equal(parsePhonicsSegments('  '), undefined);
  assert.equal(parsePhonicsSegments('[]'), undefined);
});

test('以 [ 开头但不是合法 JSON 时按逗号处理', () => {
  assert.deepEqual(parsePhonicsSegments('[El, e'), ['[El', 'e']);
});
