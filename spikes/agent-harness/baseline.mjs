// 基线：复刻 RedLark 当前提词实现（word_extraction_agent.md 作为 system 消息、一次调用、解析 CSV）
import { readFileSync, writeFileSync } from 'node:fs';
import { MOONSHOT, providerKey } from './lib/env.mjs';
import { FOCUS_STOPWORDS, referenceWords, score } from './lib/reference.mjs';

const PROMPT = readFileSync(new URL('../../src-tauri/src/prompts/word_extraction_agent.md', import.meta.url), 'utf8');
const FOCUS_RULES = `\n\n**⚠️ 重点模式过滤规则（必须严格遵守）**\n必须完全排除以下简单词汇：${[...FOCUS_STOPWORDS].join(', ')}`;
const texts = JSON.parse(readFileSync(new URL('./fixtures/texts.json', import.meta.url)));
const apiKey = providerKey('moonshot');
const effort = process.argv[2]; // 可选：low / high（K3 支持 reasoning_effort）

function parseCsv(content) {
  const body = content.replace(/```[a-z]*\n?/gi, '').trim();
  return body.split('\n').slice(1).map(line => {
    const [word, frequency, pos, translation] = line.split(',').map(s => s?.trim());
    return { word, frequency: Number(frequency), pos, translation };
  }).filter(r => r.word && /^[A-Za-z]+$/.test(r.word));
}

const results = [];
for (const t of texts) {
  const system = PROMPT.replace('{original_text}', t.text).replace('{filtering_instructions}', t.mode === 'focus' ? FOCUS_RULES : '');
  const started = Date.now();
  const res = await fetch(`${MOONSHOT.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MOONSHOT.model, temperature: MOONSHOT.temperature, max_tokens: MOONSHOT.maxTokens, ...(effort ? { reasoning_effort: effort } : {}),
      messages: [{ role: 'system', content: system }] }),
  });
  const json = await res.json();
  const ms = Date.now() - started;
  if (!res.ok) { results.push({ id: t.id, error: JSON.stringify(json).slice(0, 300), ms }); continue; }
  const content = json.choices?.[0]?.message?.content ?? '';
  const words = parseCsv(content);
  results.push({ id: t.id, ms, usage: json.usage, parsedRows: words.length, ...score(referenceWords(t.text, t.mode), words), sample: words.slice(0, 3) });
}
writeFileSync(new URL(`./results/baseline${effort ? '-' + effort : ''}.json`, import.meta.url), JSON.stringify(results, null, 2));
console.table(results.map(({ id, ms, recall, precision, frequencyAccuracy, parsedRows, usage, error }) =>
  ({ id, ms, recall, precision, frequencyAccuracy, parsedRows, tokens: usage?.total_tokens, error })));
