import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, flaggedPhones, phoneSegments, phoneTip, sentencePieces, sentenceTips, soundLabel, strictnessFor } from './pronunciation.ts';

test('三档按严格程度：宽松时 80 分也算还差一点，标准时就是再试试', () => {
  assert.equal(bandOf(90, 'lenient'), 'good');
  assert.equal(bandOf(80, 'lenient'), 'close');
  assert.equal(bandOf(80, 'standard'), 'retry');
  assert.equal(bandOf(93, 'standard'), 'good');
  assert.equal(strictnessFor('primary'), 'lenient');
  assert.equal(strictnessFor('adult'), 'standard');
  assert.equal(strictnessFor('primary', 'strict'), 'strict');
});

test('不准的音对到拼读块：three 的 th、elephant 的 ph、make 的 e 不发音', () => {
  assert.deepEqual(phoneSegments(['th', 'ree'], ['θ', 'ɹ', 'i']), [0, 1, 1]);
  assert.deepEqual(phoneSegments(['e', 'le', 'ph', 'ant'], ['ɛ', 'l', 'ə', 'f', 'ə', 'n', 't']), [0, 1, 1, 2, 3, 3, 3]);
  assert.deepEqual(phoneSegments(['m', 'a', 'k', 'e'], ['m', 'eɪ', 'k']), [0, 1, 2]);
  // 对不上的不标
  assert.deepEqual(phoneSegments(['x'], ['θ']), [null]);
});

test('提示：常见读偏有专门说法，没读出来、没有专门说法时也说清楚', () => {
  assert.equal(phoneTip({ ipa: 'θ', score: 30, heardAs: 's', likelyConfused: true }), 'th 听起来像 s：舌尖轻放在上下齿之间，往外送气');
  assert.equal(phoneTip({ ipa: 'n', score: 30, heardAs: '', likelyConfused: false }), 'n 好像没读出来，读完整');
  assert.equal(phoneTip({ ipa: 'æ', score: 40, heardAs: 'ɑ', likelyConfused: false }), '/æ/ 听起来像 /ɑ/');
  assert.equal(soundLabel('ʃ'), 'sh');
});

test('只指出分低的音，最多两个，最低的在前；宽松时更少', () => {
  const word = {
    word: 'three',
    known: true,
    score: 60,
    phones: [
      { ipa: 'θ', score: 20, heardAs: 's', likelyConfused: true },
      { ipa: 'ɹ', score: 55, heardAs: 'l', likelyConfused: false },
      { ipa: 'i', score: 45, heardAs: 'ɪ', likelyConfused: false },
    ],
  };
  assert.deepEqual(flaggedPhones(word, 'standard').map((p) => p.ipa), ['θ', 'i']);
  assert.deepEqual(flaggedPhones(word, 'lenient').map((p) => p.ipa), ['θ', 'i']);
  assert.deepEqual(flaggedPhones({ ...word, phones: [{ ipa: 'ɹ', score: 55, heardAs: 'l', likelyConfused: false }] }, 'lenient'), []);
});

test('明显读成常见读偏（think 读成 sink）：分数照常，标准时提醒「有点像」，宽松时不提', () => {
  const word = { word: 'think', known: true, score: 92, phones: [{ ipa: 'θ', score: 86, heardAs: 's', likelyConfused: true }] };
  assert.deepEqual(flaggedPhones(word, 'standard').map(phoneTip), ['th 听起来有点像 s：舌尖轻放在上下齿之间，往外送气']);
  assert.deepEqual(flaggedPhones(word, 'lenient'), []);
});

test('一句话按词切开标档：标点空格原样保留，与后端拆词一致', () => {
  const words = [
    { word: "I'm", known: true, score: 95, phones: [] },
    { word: 'thinking', known: true, score: 50, phones: [{ ipa: 'θ', score: 20, heardAs: 's', likelyConfused: true }] },
    { word: 'Xyzzy', known: false, score: null, phones: [] },
  ];
  const pieces = sentencePieces("I'm thinking, Xyzzy 3.", words, 'standard');
  assert.equal(pieces.map((p) => p.text).join(''), "I'm thinking, Xyzzy 3.");
  assert.deepEqual(
    pieces.filter((p) => p.word !== null).map((p) => [p.text, p.band]),
    [["I'm", 'good'], ['thinking', 'retry'], ['Xyzzy', null]]
  );
  assert.deepEqual(sentenceTips(words, 'standard'), [{ word: 'thinking', tip: 'th 听起来像 s：舌尖轻放在上下齿之间，往外送气' }]);
});
