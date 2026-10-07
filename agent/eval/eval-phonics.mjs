// 拼读分析提示词评测：金标准词集（可接受的音节划分 / 规则集合），统计校验退回、音节 / 规则命中率、耗时与费用。
// 用法：EVAL_MOONSHOT_KEY=... node agent/eval/eval-phonics.mjs [thinking] [batchSize]
import { readFileSync } from 'node:fs';
import { promptFile, runTask, saveResult } from './lib.mjs';

const thinking = process.argv[2] ?? 'low';
const batchSize = Number(process.argv[3] ?? 5);
const gold = JSON.parse(readFileSync(new URL('./fixtures/phonics_gold.json', import.meta.url)));
const systemPrompt = promptFile('phonics_batch.md');

const rows = []; const runs = [];
for (let i = 0; i < gold.length; i += batchSize) {
  const batch = gold.slice(i, i + batchSize);
  const words = batch.map(g => g.word);
  const r = await runTask({ systemPrompt, tools: ['submit_phonics'], thinking,
    message: `请分析以下 ${words.length} 个单词：\n${words.join(', ')}` });
  const submits = r.toolCalls.filter(c => c.name === 'submit_phonics');
  const accepted = submits.find(c => !c.isError);
  runs.push({ words, ms: r.ms, rejected: submits.filter(c => c.isError).length, cost: r.stats?.cost, tokens: r.stats?.tokens?.total,
    rejectReasons: submits.filter(c => c.isError).map(c => c.text.slice(0, 300)), error: r.error });
  for (const g of batch) {
    const got = accepted?.args?.words?.find(w => w.word.toLowerCase() === g.word);
    rows.push({ word: g.word, returned: !!got, syllablesOk: !!got && g.syllables.includes(got.syllables.toLowerCase()),
      ruleOk: !!got && g.rules.includes(got.phonics_rule.trim()), got: got && { syllables: got.syllables, ipa: got.ipa, rule: got.phonics_rule, zh: got.chinese_translation, why: got.analysis_explanation, examples: got.examples ?? [] } });
  }
}
// 讲解与释义质量（面向小学生）：长度、术语、是否举同模式例词、释义是否堆叠多义、音标是否英式
const JARGON = /CVC|VCE|闭音节|开音节|辅音字母组合|元音组合|双元音|音节划分|R-?Controlled|Digraph|Blend|Pattern/i;
for (const r of rows) {
  if (!r.got) continue;
  const why = r.got.why ?? '';
  r.whyLen = [...why].length;
  r.jargon = JARGON.test(why);
  r.example = /(如|像|比如|例如|和)\s*[A-Za-z]{2,}/.test(why);
  r.multiSense = /[；;，,、]/.test(r.got.zh ?? '');
  r.american = /oʊ|ɑːr\b|ɚ/.test(r.got.ipa ?? '');
  // 例句：条数、平均词数、句首重复（前两个词相同的句子占比，衡量句式单一）
  const exs = r.got.examples;
  r.exCount = exs.length;
  r.hasEx = exs.length >= 5;
  r.exWords = exs.length ? exs.reduce((a, e) => a + e.sentence.trim().split(/\s+/).length, 0) / exs.length : 0;
  const openers = exs.map(e => e.sentence.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase());
  r.exTemplate = exs.length ? 1 - new Set(openers).size / exs.length : 0;
}
const avg = key => +(rows.reduce((a, r) => a + (r[key] ?? 0), 0) / rows.length).toFixed(1);
const rate = key => +(rows.filter(r => r[key]).length / rows.length).toFixed(3);
const summary = { thinking, batchSize, words: rows.length, returned: rate('returned'), syllables: rate('syllablesOk'), rules: rate('ruleOk'),
  whyLen: avg('whyLen'), jargon: rate('jargon'), example: rate('example'), multiSense: rate('multiSense'), american: rate('american'),
  examples5plus: rate('hasEx'), examplesPerWord: avg('exCount'), exampleWords: avg('exWords'), exampleOpenerRepeat: avg('exTemplate'),
  rejected: runs.reduce((a, r) => a + r.rejected, 0), seconds: +(runs.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1),
  cost: +runs.reduce((a, r) => a + (r.cost ?? 0), 0).toFixed(4) };
const file = saveResult('phonics', { summary, runs, rows });
console.log(JSON.stringify(summary));
for (const r of rows.filter(r => !r.syllablesOk || !r.ruleOk)) console.log('MISS', r.word, JSON.stringify(r.got));
for (const r of rows) console.log(r.word.padEnd(8), (r.got?.ipa ?? '').padEnd(12), (r.got?.zh ?? '').padEnd(8), r.got?.why);
for (const r of rows.slice(0, 3)) for (const e of r.got?.examples ?? []) console.log('  ', r.word, '|', e.sentence, '|', e.translation);
console.log(file);
