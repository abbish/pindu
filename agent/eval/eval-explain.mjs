// 单词讲解提示词评测：不同类型的单词（词族 / 心形词 / 魔法 e / 词素 / 多音节）各生成一份讲解，
// 统计结构与可疑写法，输出全文供人工审阅（专业性与正确性以人工审阅为准）。
// 用法：EVAL_MOONSHOT_KEY=... node agent/eval/eval-explain.mjs [thinking] [word,word...]
import { readFileSync } from 'node:fs';
import { promptFile, runTask, saveResult } from './lib.mjs';

const thinking = process.argv[2] ?? 'low';
const only = process.argv[3]?.split(',');
const words = JSON.parse(readFileSync(new URL('./fixtures/explain_words.json', import.meta.url)))
  .filter(w => !only || only.includes(w.word));
const systemPrompt = promptFile('word_explain.md');

// 与 Rust explain_word_message 相同的输入格式
const message = w => ['请为下面这个单词写一份讲解：', `单词：${w.word}`, `中文释义：${w.meaning}`, `词性：${w.pos}`,
  `音标：${w.ipa}`, `音节：${w.syllables}`, `拼读规则：${w.rule}`, '已有例句：',
  ...w.examples.map(([en, zh], i) => `${i + 1}. ${en} —— ${zh}`)].join('\n');

const SUSPICIOUS = {
  homophone: /谐音/,
  etymology: /来源于|源自|古英语|拉丁|词源/,
  jargon: /CVC|VCE|闭音节|开音节|辅音字母组合|元音组合/,
};
const METHODS = /词族|心形词|看.?说.?盖.?写.?查|拼读映射|音素|词根|前缀|后缀|音节/g;

const rows = await Promise.all(words.map(async w => {
  const r = await runTask({ systemPrompt, tools: [], thinking, message: message(w) });
  const text = r.text.trim();
  const flags = Object.entries(SUSPICIOUS).filter(([, re]) => re.test(text)).map(([k]) => k);
  return { word: w.word, type: w.type, seconds: +(r.ms / 1000).toFixed(1), chars: [...text].length,
    sections: (text.match(/^## /gm) ?? []).length, methods: [...new Set(text.match(METHODS) ?? [])], flags,
    cost: r.stats?.cost, error: r.error, text };
}));
const summary = { thinking, words: rows.length, avgChars: Math.round(rows.reduce((a, r) => a + r.chars, 0) / rows.length),
  avgSeconds: +(rows.reduce((a, r) => a + r.seconds, 0) / rows.length).toFixed(1),
  flagged: rows.filter(r => r.flags.length).map(r => `${r.word}:${r.flags.join('/')}`),
  cost: +rows.reduce((a, r) => a + (r.cost ?? 0), 0).toFixed(4) };
const file = saveResult('explain', { summary, rows });
console.log(JSON.stringify(summary));
for (const r of rows) console.log(`\n==== ${r.word}（${r.type}）${r.chars} 字 ${r.seconds}s 方法=${r.methods.join(',')} 标记=${r.flags.join(',')}\n${r.text}`);
console.log(file);
