import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from './fileSize.ts';

test('字节数格式化', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(null), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(18.4 * 1024 * 1024), '18.4 MB');
  assert.equal(formatBytes(250 * 1024 * 1024), '250 MB');
  assert.equal(formatBytes(1.25 * 1024 ** 3), '1.3 GB');
});
