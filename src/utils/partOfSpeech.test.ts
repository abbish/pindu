import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partOfSpeechLabel, standardizePartOfSpeech } from './partOfSpeech.ts';

test('词性归一', () => {
  assert.equal(standardizePartOfSpeech('noun'), 'n.');
  assert.equal(standardizePartOfSpeech('Adj.'), 'adj.');
  assert.equal(standardizePartOfSpeech(' VERBS '), 'v.');
  assert.equal(standardizePartOfSpeech('det'), 'det.');
  assert.equal(standardizePartOfSpeech(''), 'n.');
  assert.equal(standardizePartOfSpeech('未知'), 'n.');
});

test('词性中文名', () => {
  assert.equal(partOfSpeechLabel('prep.'), '介词');
  assert.equal(partOfSpeechLabel('x.'), '其他');
  assert.equal(partOfSpeechLabel(undefined), '其他');
});
