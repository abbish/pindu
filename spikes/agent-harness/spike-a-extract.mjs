// 场景 A：提词经 pi 执行，结果通过 submit_words 工具交付（不再解析 CSV 文本）
import { readFileSync, writeFileSync } from 'node:fs';
import { PiRpc } from './lib/rpc.mjs';
import { providerKey } from './lib/env.mjs';
import { FOCUS_STOPWORDS, referenceWords, score } from './lib/reference.mjs';

const thinking = process.argv[2] ?? 'low';
const withTokenizer = process.argv[3] === 'tokenizer';
const SYSTEM = `你是单词提取系统。从用户给出的英文文本中提取单词，并调用 submit_words 工具一次性提交全部结果（不要在回复里输出列表）。

规则：
1. 分词后统一按小写判断；去掉标点、数字、与数字相连的片段（如 12th、9:00）。
2. 只保留纯英文字母、长度 2–20 的单词；同一单词（忽略大小写）合并，frequency 为出现次数。
3. 每个单词给出词性缩写（n. v. adj. adv. prep. conj. pron. art. int. det.）和 1–3 个汉字的常用中文释义。
4. 不要遗漏任何符合条件的单词。`;
const TOKENIZER_HINT = `\n\n先调用 tokenize_text 工具（传入完整原文）得到确定的单词与频率，frequency 必须直接使用工具结果；你只负责按规则筛选并补充词性和中文释义。`;
const FOCUS = `\n\n本次为「重点模式」：以下功能词一律不提交：${[...FOCUS_STOPWORDS].join(', ')}`;

const texts = JSON.parse(readFileSync(new URL('./fixtures/texts.json', import.meta.url)));
const env = { MOONSHOT_API_KEY: providerKey('moonshot') };
const results = [];
for (const t of texts) {
  const pi = new PiRpc({ tools: withTokenizer ? ['tokenize_text', 'submit_words'] : ['submit_words'],
    systemPrompt: SYSTEM + (withTokenizer ? TOKENIZER_HINT : '') + (t.mode === 'focus' ? FOCUS : ''),
    provider: 'moonshotai-cn', model: 'kimi-k3', thinking, env });
  try {
    const r = await pi.run(`文本：\n${t.text}`);
    const stats = await pi.send('get_session_stats');
    const submit = r.toolCalls.find(c => c.name === 'submit_words');
    const words = submit?.args?.words ?? [];
    results.push({ id: t.id, ms: r.ms, firstTokenMs: r.firstTokenMs, toolCalls: r.toolCalls.map(c => c.name).join('+') || '(none)',
      tokens: stats.tokens?.total, cost: stats.cost, error: r.error ?? undefined, extraText: r.text.slice(0, 80) || undefined,
      ...score(referenceWords(t.text, t.mode), words), sample: words.slice(0, 3) });
  } catch (e) {
    results.push({ id: t.id, error: e.message, stderr: pi.stderr.slice(0, 500) });
  }
  await pi.stop();
}
writeFileSync(new URL(`./results/pi-extract-${thinking}${withTokenizer ? '-tokenizer' : ''}.json`, import.meta.url), JSON.stringify(results, null, 2));
console.table(results.map(({ id, ms, firstTokenMs, recall, precision, frequencyAccuracy, toolCalls, tokens, error }) =>
  ({ id, ms, firstTokenMs, recall, precision, frequencyAccuracy, toolCalls, tokens, error })));
