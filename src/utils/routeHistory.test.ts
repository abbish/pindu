import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushRoute, startHistory, stepRoute, stepTarget } from './routeHistory.ts';

const skip = (r: { page: string }) => r.page === 'practice';

test('跳转追加、相同页面不记、后退再跳转截掉前进', () => {
  let h = startHistory({ page: 'home' });
  h = pushRoute(h, { page: 'book', params: { id: 1 } });
  h = pushRoute(h, { page: 'book', params: { id: 1 } });
  assert.equal(h.entries.length, 2);
  h = pushRoute(h, { page: 'passage', params: { id: 9 } });
  h = stepRoute(h, -1, skip);
  assert.deepEqual(h.entries[h.index], { page: 'book', params: { id: 1 } });
  assert.notEqual(stepTarget(h, 1, skip), null);
  h = pushRoute(h, { page: 'clip', params: { id: 3 } });
  assert.deepEqual(h.entries.map((e) => e.page), ['home', 'book', 'clip']);
  assert.equal(stepTarget(h, 1, skip), null);
});

test('前进后退跳过整窗练习页', () => {
  let h = startHistory({ page: 'plan' });
  h = pushRoute(h, { page: 'practice' });
  h = pushRoute(h, { page: 'result' });
  h = stepRoute(h, -1, skip);
  assert.equal(h.entries[h.index].page, 'plan');
  assert.equal(stepTarget(h, -1, skip), null);
  h = stepRoute(h, 1, skip);
  assert.equal(h.entries[h.index].page, 'result');
});

test('练完回到原页后，后退跳过同一页（只差页签也算同一页）', () => {
  let h = startHistory({ page: 'home' });
  h = pushRoute(h, { page: 'plan', params: { id: 1 } });
  h = pushRoute(h, { page: 'practice' });
  h = pushRoute(h, { page: 'plan', params: { id: 1, tab: 'schedule' } });
  h = stepRoute(h, -1, skip);
  assert.equal(h.entries[h.index].page, 'home');
});
