import { test } from 'node:test';
import assert from 'node:assert/strict';
import { micProblemKind } from './microphone.ts';

test('getUserMedia 错误名归到几种原因', () => {
  assert.equal(micProblemKind('NotAllowedError'), 'denied');
  assert.equal(micProblemKind('SecurityError'), 'denied');
  assert.equal(micProblemKind('NotFoundError'), 'missing');
  assert.equal(micProblemKind('NotReadableError'), 'busy');
  assert.equal(micProblemKind('TypeError'), 'other');
  assert.equal(micProblemKind(''), 'other');
});
