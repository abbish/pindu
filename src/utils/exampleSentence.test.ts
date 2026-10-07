import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskExampleSentence, splitExampleSentence } from './exampleSentence.ts';

test('高亮单词及常见词形', () => {
  assert.deepEqual(splitExampleSentence('The cat sees two cats.', 'cat'), [
    { text: 'The ', isTarget: false },
    { text: 'cat', isTarget: true },
    { text: ' sees two ', isTarget: false },
    { text: 'cats', isTarget: true },
    { text: '.', isTarget: false },
  ]);
  assert.equal(maskExampleSentence('She is making a kite.', 'make'), 'She is ______ a kite.');
  assert.equal(maskExampleSentence('The babies are sleeping.', 'baby'), 'The ______ are sleeping.');
});

test('所有格与大小写', () => {
  assert.equal(maskExampleSentence("It is Tom's book.", 'Tom'), "It is ___'s book.");
  assert.equal(maskExampleSentence('Cake is sweet.', 'cake'), '____ is sweet.');
});

test('不误伤相近的词', () => {
  assert.equal(maskExampleSentence('A category of cap.', 'cat'), 'A category of cap.');
  assert.deepEqual(splitExampleSentence('Hello.', ''), [{ text: 'Hello.', isTarget: false }]);
});
