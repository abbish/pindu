import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTiles, checkBuild, sentenceWords } from './sentenceBuilder.ts';

test('句子拆词：去掉标点，保留撇号与连字符', () => {
  assert.deepEqual(sentenceWords('Not Inglish, it\'s English.'), ['Not', 'Inglish', "it's", 'English']);
  assert.deepEqual(sentenceWords('"Well-known" — right?'), ['Well-known', 'right']);
});

test('单词卡：包含原句全部词与不重复的干扰词，打乱且可复现', () => {
  const s = 'Put it on the table.';
  const tiles = buildTiles(s, ['Please come.', 'Shall I make okra tonight?'], 3);
  const texts = tiles.map((t) => t.text);
  for (const w of sentenceWords(s)) assert.ok(texts.includes(w));
  assert.equal(tiles.length, 5 + 3);
  assert.equal(new Set(tiles.map((t) => t.id)).size, tiles.length);
  assert.deepEqual(buildTiles(s, ['Please come.', 'Shall I make okra tonight?'], 3), tiles);
  // 短句不加干扰词
  assert.equal(buildTiles('Yes, brother.', ['Please come.']).length, 2);
});

test('核对：忽略大小写与标点，逐词标出位置对错', () => {
  assert.equal(checkBuild('Put it on the table.', ['put', 'it', 'on', 'the', 'table']).correct, true);
  const wrong = checkBuild('Put it on the table.', ['Put', 'on', 'it', 'the', 'table']);
  assert.equal(wrong.correct, false);
  assert.deepEqual(wrong.marks, [true, false, false, true, true]);
  assert.equal(checkBuild('Yes, brother.', ['Yes']).correct, false);
});
