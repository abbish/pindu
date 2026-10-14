import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBACK_TAIL_MS, playbackTailMs, trackPlayback } from './playbackTail.ts';

test('放音中、刚停下时要等尾巴放完，停了够久不用等', () => {
  const el = new EventTarget();
  trackPlayback(el);
  trackPlayback(el);
  el.dispatchEvent(new Event('playing'));
  assert.equal(playbackTailMs(), PLAYBACK_TAIL_MS);
  el.dispatchEvent(new Event('pause'));
  const wait = playbackTailMs();
  assert.ok(wait > 0 && wait <= PLAYBACK_TAIL_MS, String(wait));
  assert.equal(playbackTailMs(performance.now() + PLAYBACK_TAIL_MS + 1), 0);
});
