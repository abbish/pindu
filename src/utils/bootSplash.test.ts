import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootStatusText } from './bootSplash.ts';

test('启动阶段对应的进度文字', () => {
  assert.equal(bootStatusText(null), '正在启动…');
  assert.equal(bootStatusText({ phase: 'opening', detail: null }), '正在打开数据…');
  assert.equal(bootStatusText({ phase: 'backing_up', detail: '57 → 59' }), '正在备份数据，准备升级…');
  assert.equal(bootStatusText({ phase: 'upgrading', detail: '57 → 59' }), '正在升级数据（版本 57 → 59）…');
  assert.equal(bootStatusText({ phase: 'upgrading', detail: null }), '正在升级数据…');
  assert.equal(bootStatusText({ phase: 'ready', detail: null }), '准备就绪');
});
