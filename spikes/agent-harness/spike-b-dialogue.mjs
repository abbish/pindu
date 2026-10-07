// 场景 B：场景对话 + 练习助手。验证：流式文本、工具调用（查词/记错）、多轮上下文、进程重启后恢复会话
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiRpc } from './lib/rpc.mjs';
import { providerKey } from './lib/env.mjs';

const SYSTEM = `You are "Zoe", a friendly zookeeper at the city zoo, role-playing with a Chinese primary-school student who is practising English.
- Stay in the zoo scenario. Reply in simple English (max 3 short sentences), then add one short Chinese hint in brackets when helpful.
- When the student makes a spelling, grammar or word-choice mistake: call record_mistake once per mistake, then gently show the correct form in your reply.
- Before explaining a word's pronunciation or meaning, call lookup_word and use its IPA and syllables.
- Encourage the student and end with a simple question to keep the conversation going.`;

const sessionDir = mkdtempSync(join(tmpdir(), 'redlark-pi-sessions-'));
const base = { tools: ['lookup_word', 'record_mistake'], systemPrompt: SYSTEM, provider: 'moonshotai-cn', model: 'kimi-k3',
  thinking: 'low', env: { MOONSHOT_API_KEY: providerKey('moonshot') }, sessionDir };

const turns = [
  'Hello! I want to buy a tiket for the zoo.',
  'What is giraffe? How to read it?',
  'The elephant are very hungry!',
  'Which words did I get wrong today?',
];
const log = [];
let pi = new PiRpc(base);
for (const message of turns) {
  let deltas = 0;
  const r = await pi.run(message, { onDelta: () => { deltas++; } });
  log.push({ phase: 'live', message, ms: r.ms, firstTokenMs: r.firstTokenMs, textDeltas: deltas, tools: r.toolCalls, reply: r.text, error: r.error });
}
const state = await pi.send('get_state');
const stats = await pi.send('get_session_stats');
await pi.stop();

// 进程重启后恢复同一会话，验证持久化
pi = new PiRpc({ ...base, session: state.sessionFile });
const resumed = await pi.run('Before we go: what did I want to buy at the very beginning?');
log.push({ phase: 'resumed', message: 'what did I want to buy at the very beginning?', ms: resumed.ms, firstTokenMs: resumed.firstTokenMs, tools: resumed.toolCalls, reply: resumed.text, error: resumed.error });
const resumedState = await pi.send('get_state');
await pi.stop();

const out = { sessionFile: state.sessionFile, messageCountBeforeRestart: state.messageCount, messageCountAfterResume: resumedState.messageCount,
  tokens: stats.tokens, cost: stats.cost, contextUsage: stats.contextUsage, turns: log };
writeFileSync(new URL('./results/pi-dialogue.json', import.meta.url), JSON.stringify(out, null, 2));
for (const t of log) {
  console.log(`\n[${t.phase}] 学生: ${t.message}\n  ${t.ms}ms (首字 ${t.firstTokenMs}ms, 流式片段 ${t.textDeltas ?? '-'}) 工具: ${t.tools.map(c => `${c.name}${JSON.stringify(c.args)}`).join(' ') || '无'}${t.error ? ' 错误: ' + t.error : ''}\n  Zoe: ${t.reply}`);
}
console.log('\nmessages before/after resume:', out.messageCountBeforeRestart, out.messageCountAfterResume, 'tokens:', JSON.stringify(stats.tokens));
