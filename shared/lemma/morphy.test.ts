import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFormOf } from './morphy.ts';
import cases from './cases.json' with { type: 'json' };

test('词形还原：与 Rust 端共用 cases.json', () => {
  for (const [token, base] of cases.forms) assert.ok(isFormOf(token, base), `${token} → ${base}`);
  for (const [token, base] of cases.not_forms) assert.ok(!isFormOf(token, base), `${token} ✗ ${base}`);
});
