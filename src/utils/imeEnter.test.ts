import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasNonLatin, isImeEnter } from './imeEnter.ts';

const enter = { key: 'Enter', isComposing: false, keyCode: 13 };

test('输入法选词的回车被忽略', () => {
  assert.equal(isImeEnter({ ...enter, isComposing: true }, false, 0, 1000), true);
  assert.equal(isImeEnter({ ...enter, keyCode: 229 }, false, 0, 1000), true);
  assert.equal(isImeEnter(enter, true, 0, 1000), true);
  // WebKit：compositionend 先于 keydown 触发
  assert.equal(isImeEnter(enter, false, 1000, 1010), true);
});

test('正常回车与其他键', () => {
  assert.equal(isImeEnter(enter, false, 0, 1000), false);
  assert.equal(isImeEnter(enter, false, 1000, 1500), false);
  assert.equal(isImeEnter({ ...enter, key: 'a' }, true, 0, 1000), false);
});

test('非英文字符检测', () => {
  assert.equal(hasNonLatin("don't"), false);
  assert.equal(hasNonLatin('ways'), false);
  assert.equal(hasNonLatin('方法'), true);
  assert.equal(hasNonLatin('wａys'), true);
});
