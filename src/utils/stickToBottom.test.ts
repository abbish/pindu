import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPinned } from './stickToBottom.ts';

test('往上滚：停止跟随（哪怕只滚了一点）', () => {
  assert.equal(nextPinned(true, { scrollTop: 970, lastScrollTop: 1000, distance: 30 }), false);
});

test('滚回底部附近：接着跟随', () => {
  assert.equal(nextPinned(false, { scrollTop: 990, lastScrollTop: 900, distance: 10 }), true);
});

test('往下滚但还在中间：保持不跟随；跟随时自己滚到底仍跟随', () => {
  assert.equal(nextPinned(false, { scrollTop: 600, lastScrollTop: 500, distance: 400 }), false);
  assert.equal(nextPinned(true, { scrollTop: 1500, lastScrollTop: 1000, distance: 0 }), true);
});

test('内容变短、浏览器把位置收回到底部：不算往回看', () => {
  assert.equal(nextPinned(true, { scrollTop: 800, lastScrollTop: 1000, distance: 0 }), true);
});
