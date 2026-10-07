import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inflectionMatches,
  passageProblems,
  planProblems,
  questionProblems,
  submitGradeTool,
  translationProblems,
  submitPassageTool,
  type PassageSubmission,
  type QuestionSubmission,
} from './passage.ts';

const passage = (): PassageSubmission => ({
  required_words: ['passport', 'ticket'],
  ai_pick: 2,
  min_words: 30,
  max_words: 60,
  outline: { goal: 'Tom flies to see his grandma.', problem: 'He cannot find his passport at customs.', turn: 'Mom finds it in his luggage.', ending: 'He finds his gate and smiles.' },
  title: 'At the Airport',
  sentences: [
    { en: 'Tom has his passport and two tickets in his bag.', zh: '汤姆的包里有护照和两张票。' },
    { en: 'He walks to customs and shows the officer his passport.', zh: '他走到海关，把护照给工作人员看。' },
    { en: 'Then he finds his gate and waits for the plane with his mom.', zh: '然后他找到登机口，和妈妈一起等飞机。' },
  ],
  chosen_words: ['customs', 'gate'],
});

const questions = (): QuestionSubmission => ({
  expected: { cloze: 2, choice: 1, true_false: 2, open: 1 },
  cloze: [{ sentence: 1, word: 'passport', hint: '护照' }, { sentence: 3, word: 'gate' }],
  cloze_distractors: ['visa'],
  choice: [{ stem: 'What does Tom show?', options: ['a ticket', 'his passport', 'a bag'], answer: 1, explanation: '第二句' }],
  true_false: [
    { statement: 'Tom has two tickets.', answer: true, explanation: '第一句' },
    { statement: 'Tom travels alone.', answer: false, explanation: '和妈妈一起' },
  ],
  open: [{ question: 'Where would you like to fly?', reference_answer: 'I want to fly to Paris.', rubric: ['说出地点', '句子完整'] }],
});

test('屈折形式与 Rust 同规则', () => {
  assert.ok(inflectionMatches('tickets', 'ticket'));
  assert.ok(inflectionMatches('making', 'make'));
  assert.ok(!inflectionMatches('pass', 'passport'));
});

test('合格的短文被接受', async () => {
  assert.deepEqual(passageProblems(passage()), []);
  const result = await submitPassageTool.execute('t', passage(), undefined, undefined, undefined as never);
  assert.equal(result.terminate, true);
});

test('缺必用词、挑词过多或没用上、明显太短都被退回', () => {
  const p = passage();
  p.required_words.push('hotel');
  p.chosen_words = ['customs', 'gate', 'visa'];
  p.min_words = 100;
  p.max_words = 150;
  const problems = passageProblems(p).join('\n');
  assert.match(problems, /必用词：hotel/);
  assert.match(problems, /最多 2 个/);
  assert.match(problems, /没有出现在正文中：visa/);
  assert.match(problems, /明显短于参考篇幅/);
});

test('篇幅只是参考：比参考长或略短都接受，AI 少挑词也接受', () => {
  const p = passage();
  p.min_words = 20;
  p.max_words = 25;
  p.chosen_words = [];
  assert.deepEqual(passageProblems(p), []);
});

test('题量、重复空位、判断题全同答案被退回', () => {
  assert.deepEqual(questionProblems(questions()), []);
  const q = questions();
  q.cloze.push({ sentence: 2, word: 'Passport' });
  q.true_false[1].answer = true;
  q.cloze_distractors = ['gate'];
  const problems = questionProblems(q).join('\n');
  assert.match(problems, /cloze（选词填空） 需要 2 道/);
  assert.match(problems, /重复了/);
  assert.match(problems, /有对也有错/);
  assert.match(problems, /与空位答案重复/);
});

test('评分超出范围被退回', async () => {
  await assert.rejects(
    submitGradeTool.execute('t', { grades: [{ index: 1, score: 5, feedback: '好' }] }, undefined, undefined, undefined as never),
    /0–4/,
  );
});

test('内容规划：必用词都要分到、每词一篇、挑词不超过上限', () => {
  const outline = { goal: '去机场', problem: '护照丢了', turn: '找到了', ending: '登机' };
  const ok = { required_words: ['passport', 'hotel'], ai_pick: 1, note: '两个场景', passages: [
    { title: 'Airport', outline, words: ['passport', 'gate'], length: 'short' },
    { title: 'Hotel', outline, words: ['hotel'], length: 'standard' },
  ] };
  assert.deepEqual(planProblems(ok), []);
  const bad = { ...ok, passages: [
    { title: 'Airport', outline, words: ['passport', 'gate', 'map'], length: 'huge' },
    { title: 'Again', outline: { ...outline, ending: '' }, words: ['Passport'], length: 'short' },
  ] };
  const problems = planProblems(bad).join('\n');
  assert.match(problems, /length 应为/);
  assert.match(problems, /outline.ending 不能为空/);
  assert.match(problems, /同时出现在第 1 篇和第 2 篇/);
  assert.match(problems, /没有分到任何一篇：hotel/);
  assert.match(problems, /最多挑 1 个/);
});

test('导入材料翻译：每句都要译、编号不重复、水平与重点词合法', () => {
  const ok = {
    expected_count: 2,
    translations: [
      { index: 1, zh: '汤姆有一只猫。' },
      { index: 2, zh: '它很可爱。' },
    ],
    title: 'Tom and His Cat',
    level: 'A1',
    key_words: [{ word: 'cute', meaning: '可爱的' }],
  };
  assert.deepEqual(translationProblems(ok), []);
  const bad = {
    ...ok,
    translations: [
      { index: 1, zh: '汤姆有一只猫。' },
      { index: 1, zh: ' ' },
    ],
    level: 'c1',
    key_words: [{ word: 'two words', meaning: '' }],
  };
  const problems = translationProblems(bad).join('\n');
  assert.match(problems, /译了两次/);
  assert.match(problems, /译文为空/);
  assert.match(problems, /缺少这些句子的译文：2/);
  assert.match(problems, /level/);
  assert.match(problems, /英文单词/);
});
