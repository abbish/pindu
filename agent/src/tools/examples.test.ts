import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitExamplesTool } from './examples.ts';

const five = [
  'I like cake.', 'We eat cake on my birthday.', 'Mom is making a cake.',
  'Can I have some cake, please?', 'There is a cake on the table.',
].map(sentence => ({ sentence, translation: '中文' }));

const run = (examples: { sentence: string; translation: string }[]) =>
  submitExamplesTool.execute('t1', { word: 'cake', examples }, undefined, undefined, undefined as never);

test('合格的例句被接受并结束本轮', async () => {
  const result = await run(five);
  assert.equal(result.terminate, true);
  assert.equal(result.details.examples.length, 5);
});

test('条数不足或不含单词被退回', async () => {
  await assert.rejects(run(five.slice(0, 3)), /5–8 条/);
  await assert.rejects(run([...five.slice(0, 4), { sentence: 'I like pie.', translation: '我喜欢派。' }]), /必须包含单词/);
});
