import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceWords } from './sentenceBuilder.ts';

test('句子拆词：去掉标点，保留撇号与连字符', () => {
  assert.deepEqual(sentenceWords('Not Inglish, it\'s English.'), ['Not', 'Inglish', "it's", 'English']);
  assert.deepEqual(sentenceWords('"Well-known" — right?'), ['Well-known', 'right']);
});
