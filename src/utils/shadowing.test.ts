import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateWords, markedPieces } from './shadowing.ts';

test('按顺序在原句里找词，重复的词找下一个', () => {
  const text = "Well, it's the end of the day.";
  assert.deepEqual(locateWords(text, ['Well', "it's", 'the', 'end', 'of', 'the', 'day']), [
    { start: 0, end: 4 },
    { start: 6, end: 10 },
    { start: 11, end: 14 },
    { start: 15, end: 18 },
    { start: 19, end: 21 },
    { start: 22, end: 25 },
    { start: 26, end: 29 },
  ]);
  assert.deepEqual(locateWords('Hello there', ['hello', 'nowhere']), [{ start: 0, end: 5 }, null]);
});

test('标出的词单独成段，标点和空格原样保留', () => {
  const text = 'No, go now.';
  const pieces = markedPieces(text, locateWords(text, ['No', 'go', 'now']), [true, false, true]);
  assert.deepEqual(pieces, [
    { text: 'No', mark: true },
    { text: ', ', mark: null },
    { text: 'go', mark: false },
    { text: ' ', mark: null },
    { text: 'now', mark: true },
    { text: '.', mark: null },
  ]);
  assert.equal(pieces.map((p) => p.text).join(''), text);
});
