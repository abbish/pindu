import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropUnpairedBold } from './markdownText.ts';

test('dropUnpairedBold：落单的 ** 去掉，成对的保留', () => {
  assert.equal(dropUnpairedBold('一句话记：**in 是入住，out 是退房。'), '一句话记：in 是入住，out 是退房。');
  assert.equal(dropUnpairedBold('**check out** = 退房'), '**check out** = 退房');
  assert.equal(dropUnpairedBold('**a** 和 **b'), '**a** 和 b');
  assert.equal(dropUnpairedBold('第一行 **粗\n第二行 **粗**'), '第一行 粗\n第二行 **粗**');
});

test('dropUnpairedBold：代码块里的内容不动', () => {
  const md = '```\nx ** 2\n```\n正文 **未闭合';
  assert.equal(dropUnpairedBold(md), '```\nx ** 2\n```\n正文 未闭合');
});
