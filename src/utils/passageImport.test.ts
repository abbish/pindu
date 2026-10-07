import { test } from 'node:test';
import assert from 'node:assert/strict';
import { englishWordCount, lengthHint, mergeWithPrevious, renameItem, splitAt, titleFrom } from './passageImport.ts';

const s = (en: string, paragraph = false) => ({ en, paragraph });
const item = (title: string, ...sentences: ReturnType<typeof s>[]) => ({
  title,
  sentences,
  wordCount: sentences.reduce((n, x) => n + englishWordCount(x.en), 0),
});

test('英文词数：缩写与连字符算一个词，数字不算', () => {
  assert.equal(englishWordCount("Don't stop, it's a well-known road in 2026."), 7);
  assert.equal(englishWordCount(''), 0);
});

test('合并到上一篇：句子接上、词数相加、合并处另起一段', () => {
  const items = [item('A', s('One two.', true)), item('B', s('Three four five.', true), s('Six.'))];
  const merged = mergeWithPrevious(items, 1);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'A');
  assert.equal(merged[0].wordCount, 6);
  assert.deepEqual(merged[0].sentences.map((x) => x.paragraph), [true, true, false]);
});

test('合并第一篇或越界不变', () => {
  const items = [item('A', s('One.'))];
  assert.equal(mergeWithPrevious(items, 0), items);
  assert.equal(mergeWithPrevious(items, 3), items);
});

test('从某句拆开：前后两篇，新篇标题取首句开头', () => {
  const items = [item('Story', s('Once upon a time.', true), s('A small cat walked slowly to Mali and rubbed its head.'), s('The end.'))];
  const split = splitAt(items, 0, 1);
  assert.equal(split.length, 2);
  assert.equal(split[0].sentences.length, 1);
  assert.equal(split[0].wordCount, 4);
  assert.equal(split[1].title, 'A small cat walked slowly to…');
  assert.equal(split[1].sentences[0].paragraph, true);
  assert.equal(split[1].wordCount, 13);
});

test('在第一句或越界处拆开不变', () => {
  const items = [item('A', s('One.'), s('Two.'))];
  assert.equal(splitAt(items, 0, 0), items);
  assert.equal(splitAt(items, 0, 2), items);
  assert.equal(splitAt(items, 5, 1), items);
});

test('标题：短句去掉句末标点', () => {
  assert.equal(titleFrom('Hello world!'), 'Hello world');
  assert.equal(renameItem([item('A', s('x.'))], 0, 'New')[0].title, 'New');
});

test('篇幅提示', () => {
  assert.equal(lengthHint(30), 'short');
  assert.equal(lengthHint(300), null);
  assert.equal(lengthHint(1200), 'long');
});

test('文件后缀与 base64', async () => {
  const { bytesToBase64, fileExtension } = await import('./passageImport.ts');
  assert.equal(fileExtension('Story.DOCX'), '.docx');
  assert.equal(fileExtension('README'), '');
  const bytes = new Uint8Array(70000).map((_, i) => i % 256);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
  assert.equal(bytesToBase64(new TextEncoder().encode('Hi')), 'SGk=');
});
