import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceAnalysisProblems, type SentenceAnalysisSubmission } from './sentence.ts';

const ok = (): SentenceAnalysisSubmission => ({
  sentence: 'She gave up her job because she wanted to travel.',
  pattern: '主语 + 谓语 + 宾语 + because + 原因从句',
  pattern_note: '说明原因',
  chunks: [
    { text: 'She', role: '主语' },
    { text: 'gave up', role: '谓语' },
    { text: 'her job', role: '宾语' },
    { text: 'because she wanted to travel.', role: '原因状语从句' },
  ],
  grammar: [{ title: '一般过去时', text: 'gave up', explanation: '过去的动作' }],
  function: '说明做某事的原因',
  function_note: '',
  alternatives: [],
  phrases: [{ text: 'gave up', base: 'give up', meaning: '放弃' }],
  pronunciation: [{ text: 'gave up', tip: '连读' }],
});

test('合格的分析', () => {
  assert.deepEqual(sentenceAnalysisProblems(ok()), []);
});

test('成分要照抄原句并按顺序；片段要出自原句；词组要是多词原形', () => {
  const bad = ok();
  bad.chunks = [bad.chunks[2], bad.chunks[0], bad.chunks[1]];
  bad.pronunciation = [{ text: 'look after', tip: 'x' }];
  bad.phrases = [{ text: 'job', base: 'job', meaning: '工作' }];
  const problems = sentenceAnalysisProblems(bad);
  assert.ok(problems.some((p) => p.includes('按顺序')));
  assert.ok(problems.some((p) => p.includes('pronunciation[1]')));
  assert.ok(problems.some((p) => p.includes('phrases[1].base')));
});
