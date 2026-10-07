// 提词提示词评测：参照答案为确定性分词（重点模式去功能词），统计召回 / 精确 / 释义覆盖、耗时与费用。
// 用法：EVAL_MOONSHOT_KEY=... node agent/eval/eval-extract.mjs [thinking]
// 提示词读取 Rust 渲染好的 extract_words.<mode>.md（见 lib.mjs）。
import { readFileSync } from 'node:fs';
import { promptFile, runTask, saveResult } from './lib.mjs';

const thinking = process.argv[2] ?? 'low';
const STOP = `a an the i you he she it we they me him her us them am is are was were be been being do does did have has had will would can could should shall may might must in on at to for of with by from up out off over under and or but so if when then than as not no yes very too also only just now here there one two three four five six seven eight nine ten`.split(' ');
const tokenize = text => { const m = new Map(); for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) { if (/[0-9]/.test(raw) || raw.length < 2 || raw.length > 20) continue; m.set(raw, (m.get(raw) ?? 0) + 1); } return m; };

const texts = JSON.parse(readFileSync(new URL('./fixtures/extract_texts.json', import.meta.url)));
const rows = [];
for (const t of texts) {
  const ref = tokenize(t.text); if (t.mode === 'focus') for (const s of STOP) ref.delete(s);
  const r = await runTask({ systemPrompt: promptFile(`extract_words.${t.mode}.md`),
    tools: ['tokenize_text', 'submit_words'], thinking, message: `文本：\n${t.text}` });
  const words = r.toolCalls.find(c => c.name === 'submit_words' && !c.isError)?.args?.words ?? [];
  const got = new Set(words.map(w => w.word.toLowerCase()));
  const missing = [...ref.keys()].filter(w => !got.has(w));
  rows.push({ id: t.id, ms: r.ms, cost: r.stats?.cost, reference: ref.size, submitted: words.length,
    recall: +((ref.size - missing.length) / ref.size).toFixed(3), extra: [...got].filter(w => !ref.has(w)),
    meaning: +(words.filter(w => (w.translation ?? '').trim()).length / Math.max(words.length, 1)).toFixed(3), missing,
    sample: words.slice(0, 6).map(w => `${w.word}:${w.pos}:${w.translation}`) });
}
const summary = { thinking, texts: rows.length, recall: +(rows.reduce((a, r) => a + r.recall, 0) / rows.length).toFixed(3),
  seconds: +(rows.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1), cost: +rows.reduce((a, r) => a + (r.cost ?? 0), 0).toFixed(4) };
const file = saveResult('extract', { summary, rows });
console.log(JSON.stringify(summary)); for (const r of rows) console.log(r.id, 'recall', r.recall, 'missing', r.missing.join(','), 'extra', r.extra.join(','), '|', r.sample.join(' '));
console.log(file);
