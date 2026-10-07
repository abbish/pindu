#!/usr/bin/env node
// ESLint 棘轮：error 必须为 0；各规则 warning 数不得超过 .eslint-baseline.json。
// 用法: node scripts/lint-ratchet.mjs [--update]
//   --update  当前计数 ≤ 基线时，把基线收紧为当前计数（只减不增）。
import { ESLint } from 'eslint';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, '.eslint-baseline.json');
const update = process.argv.includes('--update');

const eslint = new ESLint({ cwd: root });
const results = await eslint.lintFiles(['src']);

const counts = {};
const errors = [];
for (const r of results) {
  for (const m of r.messages) {
    const rule = m.ruleId ?? 'parse-error';
    if (m.severity === 2) errors.push(`${path.relative(root, r.filePath)}:${m.line} ${rule} ${m.message}`);
    else counts[rule] = (counts[rule] ?? 0) + 1;
  }
}

const hasBaseline = existsSync(baselinePath);
// 首次运行：以当前计数建立基线
const baseline = hasBaseline ? JSON.parse(readFileSync(baselinePath, 'utf8')).warnings ?? {} : { ...counts };
const rules = [...new Set([...Object.keys(baseline), ...Object.keys(counts)])].sort();
const regressions = [];
const improvements = [];
for (const rule of rules) {
  const now = counts[rule] ?? 0;
  const base = baseline[rule] ?? 0;
  if (now > base) regressions.push(`${rule}: ${base} → ${now} (+${now - base})`);
  else if (now < base) improvements.push(`${rule}: ${base} → ${now}`);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`lint-ratchet: errors=${errors.length}, warnings=${total}`);
for (const e of errors) console.log(`  ✗ ${e}`);
for (const r of regressions) console.log(`  ✗ 回退 ${r}`);
for (const i of improvements) console.log(`  ↓ 改善 ${i}`);

if (errors.length || regressions.length) process.exit(1);
if (update || !hasBaseline) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, JSON.stringify({ note: '由 scripts/lint-ratchet.mjs 维护，只减不增', warnings: sorted }, null, 2) + '\n');
  console.log('  基线已更新 .eslint-baseline.json');
} else if (improvements.length) {
  console.log('  提示：运行 node scripts/lint-ratchet.mjs --update 收紧基线');
}
