import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeWordIndex, inflectionMatches, scoreSummary, specSummary, splitWithBlanks, targetOf, tokenize, phraseSpans, targetSpans, textUses, recallBlanks } from './passage.ts';

test('空位按整词定位，忽略大小写，保留原文写法', () => {
  const parts = splitWithBlanks('Show your Passport at customs, not the passports.', [
    { questionId: 1, word: 'passport' },
    { questionId: 2, word: 'customs' },
    { questionId: 3, word: 'hotel' },
  ]);
  assert.deepEqual(parts, [
    { kind: 'text', text: 'Show your ' },
    { kind: 'blank', questionId: 1, answer: 'Passport' },
    { kind: 'text', text: ' at ' },
    { kind: 'blank', questionId: 2, answer: 'customs' },
    { kind: 'text', text: ', not the passports.' },
  ]);
  assert.deepEqual(splitWithBlanks('No blanks.', []), [{ kind: 'text', text: 'No blanks.' }]);
});

test('成绩与题组摘要', () => {
  assert.equal(scoreSummary({ objectiveCorrect: 7, objectiveTotal: 9, openScore: 3, openTotal: 4 }), '客观题 7/9 · 开放题 3/4');
  assert.equal(scoreSummary({ objectiveCorrect: 0, objectiveTotal: 0, openScore: null, openTotal: 4 }), '开放题待评分');
  assert.equal(specSummary({ cloze: 5, choice: 3, trueFalse: 0, open: 1, difficulty: 'standard' }), '选词填空 5 · 选择 3 · 开放 1 · 标准');
});

test('目标词匹配含常见变形', () => {
  assert.ok(inflectionMatches('tickets', 'ticket') && inflectionMatches('making', 'make') && inflectionMatches('stopped', 'stop'));
  assert.ok(!inflectionMatches('pass', 'passport'));
  assert.equal(targetOf('Elephants', ['cat', 'elephant']), 'elephant');
  assert.equal(targetOf('tree', ['cat']), null);
});

test('分词：单词按顺序编号，标点与空格保留', () => {
  const t = tokenize("Day by day, Mali's trunk.");
  assert.deepEqual(
    t.filter((x) => x.kind === 'word').map((x) => x.text),
    ['Day', 'by', 'day', "Mali's", 'trunk'],
  );
  assert.equal(t.map((x) => x.text).join(''), "Day by day, Mali's trunk.");
});

test('逐词高亮按播放时间定位，停顿里保持上一个词，词数不一致时按比例', () => {
  const timings = [
    { startMs: 200, endMs: 600 },
    { startMs: 600, endMs: 800 },
    { startMs: 900, endMs: 1200 },
  ];
  assert.equal(activeWordIndex(timings, 100, 3), null);
  assert.equal(activeWordIndex(timings, 650, 3), 1);
  assert.equal(activeWordIndex(timings, 850, 3), 1);
  assert.equal(activeWordIndex(timings, 5000, 3), 2);
  assert.equal(activeWordIndex(timings, 950, 6), 4);
  assert.equal(activeWordIndex(null, 500, 3), null);
});

test('词组：变形、可拆开、占位词，与后端同规则', () => {
  const words = (s: string) => tokenize(s).flatMap((t) => (t.kind === 'word' ? [t.text] : []));
  assert.ok(textUses('She gave up smoking.', 'give up'));
  assert.ok(textUses('Please pick it up.', 'pick up'));
  assert.ok(!textUses('Pick a very big red box up.', 'pick up'));
  assert.ok(textUses('They made a decision.', 'make a decision'));
  assert.ok(textUses('I take care of my little sister.', 'take care of sb'));
  assert.ok(!textUses('The ice broke.', 'break the ice'));
  assert.deepEqual(phraseSpans(words('look after it and look after him'), 'look after'), [[0, 2], [4, 6]]);
});

test('目标词片段：先词组后单词，词组覆盖的单词不再单独标', () => {
  const spans = targetSpans(tokenize('She gave up her old toys.'), ['give up', 'toy', 'up']);
  assert.deepEqual(spans.get(1), { target: 'give up', start: 1, end: 3 });
  assert.deepEqual(spans.get(2), { target: 'give up', start: 1, end: 3 });
  assert.deepEqual(spans.get(5), { target: 'toy', start: 5, end: 6 });
  assert.equal(spans.get(0), undefined);
});

test('挖空：单词逐个挖，连着出现的词组整体挖，拆开用的词组不挖', () => {
  const blanks = (s: string, t: string[]) => recallBlanks(s, t).flatMap((p) => (p.kind === 'blank' ? [p.answer] : []));
  assert.deepEqual(blanks('She gave up her toys.', ['give up', 'toy']), ['gave up', 'toys']);
  assert.deepEqual(blanks('Please pick it up.', ['pick up']), []);
  assert.equal(recallBlanks('She gave up.', ['give up']).map((p) => (p.kind === 'text' ? p.text : '_')).join(''), 'She _.');
});
