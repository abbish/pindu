import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankCorrect, pickBlanks } from './dictation.ts';
import { sentenceWords } from './sentenceBuilder.ts';

const picked = (s: string, vocab: string[] = [], level: 'few' | 'many' = 'few') => pickBlanks(s, vocab, level).map((i) => sentenceWords(s)[i]);

test('短句挖一个、长句最多三个，重点词汇优先，其次长的实词', () => {
  assert.deepEqual(picked('I resigned yesterday.', ['resign']), ['resigned']);
  assert.deepEqual(picked('The makers announced a surprising change this morning.'), ['announced', 'surprising']);
  assert.deepEqual(picked('The makers of this product announced a really surprising change to the plan this morning.'), ['product', 'announced', 'surprising']);
});

test('不挖虚词、数字和句中的人名', () => {
  assert.deepEqual(picked('It was in the box with Sarah and 10 cats.'), ['box', 'cats']);
  assert.deepEqual(pickBlanks('Oh, it is.'), []);
});

test('挖得多时：实词挖完再挖虚词，仍不挖人名和数字', () => {
  assert.deepEqual(picked('It all started with these posts.', [], 'many'), ['all', 'started', 'posts']);
  assert.deepEqual(picked('It was in the box with Sarah and 10 cats.', [], 'many'), ['was', 'box', 'with', 'cats']);
});

test('填空的空：忽略大小写与写法差异', () => {
  assert.equal(blankCorrect('arresting', 'Arresting'), true);
  assert.equal(blankCorrect("isn't", 'is not'), true);
  assert.equal(blankCorrect('ten', '10'), true);
  assert.equal(blankCorrect('arresting', 'resting'), false);
  assert.equal(blankCorrect('word', ''), false);
});
