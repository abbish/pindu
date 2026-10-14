import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedSpeechMs, micOptions, micProblemKind, normalizeMicPrefs } from './microphone.ts';

test('getUserMedia 错误名归到几种原因', () => {
  assert.equal(micProblemKind('NotAllowedError'), 'denied');
  assert.equal(micProblemKind('SecurityError'), 'denied');
  assert.equal(micProblemKind('NotFoundError'), 'missing');
  assert.equal(micProblemKind('NotReadableError'), 'busy');
  assert.equal(micProblemKind('TypeError'), 'other');
  assert.equal(micProblemKind(''), 'other');
});

test('麦克风偏好：坏数据回到默认', () => {
  const fallback = { deviceId: '', gain: 4, wait: 'normal', speakerId: '', volume: 1 };
  assert.deepEqual(normalizeMicPrefs(null), fallback);
  assert.deepEqual(normalizeMicPrefs({ deviceId: 'abc', gain: 3.5, wait: 'long', speakerId: 's', volume: 0.4 }), { deviceId: 'abc', gain: 3.5, wait: 'long', speakerId: 's', volume: 0.4 });
  assert.deepEqual(normalizeMicPrefs({ deviceId: 3, gain: 'x', wait: 'slow', volume: 7 }), { ...fallback, volume: 1 });
  assert.equal(normalizeMicPrefs({ gain: 20 }).gain, 8);
  assert.equal(normalizeMicPrefs({ gain: 0 }).gain, 1);
});

test('麦克风列表：只要输入设备，去掉虚拟的默认项，没名字的编号', () => {
  const options = micOptions([
    { deviceId: 'default', label: '默认 - 耳机', kind: 'audioinput' },
    { deviceId: 'communications', label: '通信', kind: 'audioinput' },
    { deviceId: 'a', label: '', kind: 'audioinput' },
    { deviceId: 'b', label: 'USB 麦克风', kind: 'audioinput' },
    { deviceId: 'c', label: '扬声器', kind: 'audiooutput' },
  ]);
  assert.deepEqual(options, [
    { value: 'a', label: '麦克风 1' },
    { value: 'b', label: 'USB 麦克风' },
  ]);
});

test('读完一段文字大概要多久：按音节估', () => {
  assert.equal(expectedSpeechMs('three'), 250);
  assert.equal(expectedSpeechMs('table'), 500);
  assert.equal(expectedSpeechMs('We arrived at the moon four minutes early.'), 13 * 250);
  assert.equal(expectedSpeechMs('Apollo 11'), 7 * 250);
  assert.equal(expectedSpeechMs('...'), 0);
});
