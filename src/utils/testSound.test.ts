import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestSound, TEST_SOUND_STEP_MS } from './testSound.ts';

test('扬声器测试音：合法的 WAV，响度有起伏、不超过 1', () => {
  const { wav, envelope } = makeTestSound();
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(36, 40)), 'data');
  const seconds = (wav.length - 44) / 2 / 22050;
  assert.ok(Math.abs(envelope.length - (seconds * 1000) / TEST_SOUND_STEP_MS) <= 1);
  assert.ok(Math.max(...envelope) > 0.5 && Math.max(...envelope) <= 1);
  assert.ok(envelope[envelope.length - 1] < 0.2);
});
