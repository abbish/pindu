import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FULL_REVEAL, maskLetters, writeReveal } from './practiceReveal.ts';

test('提示随等级逐步减少', () => {
  assert.deepEqual(writeReveal(1), { word: 'hint', ipa: 'show', syllables: 'hint', phonics: 'hint' });
  assert.deepEqual(writeReveal(2), { word: 'hint', ipa: 'show', syllables: 'hidden', phonics: 'hidden' });
  assert.deepEqual(writeReveal(3), { word: 'hidden', ipa: 'hidden', syllables: 'hidden', phonics: 'hidden' });
  assert.equal(FULL_REVEAL.word, 'show');
});

test('「盖-写」时任何等级都不显示字母', () => {
  for (const level of [1, 2, 3] as const) {
    const r = writeReveal(level);
    assert.notEqual(r.word, 'show');
    assert.notEqual(r.syllables, 'show');
    assert.notEqual(r.phonics, 'show');
  }
});

test('字母变格子，保留分隔', () => {
  assert.equal(maskLetters('el-e-phant'), '__-_-_____');
  assert.equal(maskLetters("don't"), "___'_");
  assert.equal(maskLetters('ice cream'), '___ _____');
});
