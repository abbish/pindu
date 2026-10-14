import { test } from 'node:test';
import assert from 'node:assert/strict';
import { micOptions, micProblemKind, normalizeMicPrefs } from './microphone.ts';

test('getUserMedia 错误名归到几种原因', () => {
  assert.equal(micProblemKind('NotAllowedError'), 'denied');
  assert.equal(micProblemKind('SecurityError'), 'denied');
  assert.equal(micProblemKind('NotFoundError'), 'missing');
  assert.equal(micProblemKind('NotReadableError'), 'busy');
  assert.equal(micProblemKind('TypeError'), 'other');
  assert.equal(micProblemKind(''), 'other');
});

test('麦克风偏好：坏数据回到默认', () => {
  assert.deepEqual(normalizeMicPrefs(null), { deviceId: '', wait: 'normal' });
  assert.deepEqual(normalizeMicPrefs({ deviceId: 'abc', wait: 'long' }), { deviceId: 'abc', wait: 'long' });
  assert.deepEqual(normalizeMicPrefs({ deviceId: 3, wait: 'slow' }), { deviceId: '', wait: 'normal' });
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
