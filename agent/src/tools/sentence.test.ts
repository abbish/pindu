import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceAnalysisProblems, trimSentenceAnalysis, type SentenceAnalysisSubmission } from './sentence.ts';

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

test('成分要照抄原句并按顺序（主干不合格才退回）', () => {
  const bad = ok();
  bad.chunks = [bad.chunks[2], bad.chunks[0], bad.chunks[1]];
  assert.ok(sentenceAnalysisProblems(bad).some((p) => p.includes('按顺序')));
});

test('附加项不合格的直接去掉，不退回：take...to... 这样的词组、不在原句里的发音要点、语法点引用', () => {
  const sub = ok();
  sub.phrases = [
    { text: 'gave up', base: 'give up', meaning: '放弃' },
    { text: 'take ... to', base: 'take...to...', meaning: '带去' },
    { text: 'job', base: 'job', meaning: '工作' },
  ];
  sub.pronunciation = [{ text: 'look after', tip: 'x' }, { text: 'gave up', tip: '连读' }];
  sub.grammar = [{ title: '一般过去时', text: 'went away', explanation: '过去的动作' }];
  assert.deepEqual(sentenceAnalysisProblems(sub), []);
  const trimmed = trimSentenceAnalysis(sub);
  assert.deepEqual(trimmed.phrases.map((p) => p.base), ['give up']);
  assert.deepEqual(trimmed.pronunciation.map((p) => p.text), ['gave up']);
  assert.equal(trimmed.grammar[0].text, '');
});
