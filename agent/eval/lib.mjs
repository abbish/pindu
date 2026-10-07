// 提示词评测公共部分：用编译好的 sidecar（RPC）跑任务。
// 提示词读取 Rust 按学习者预设渲染好的版本（模板与片段在 src-tauri/src/prompts/，含 {{变量}}，不能直接用）：
//   cd src-tauri && cargo test prompts::tests::render_eval_prompts -- --ignored   → agent/eval/rendered/<预设>/
// 预设用环境变量 EVAL_PRESET 选择（primary 默认 / secondary / adult）。
// 测试 Key 从环境变量 EVAL_MOONSHOT_KEY 读取（只传给子进程）。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
export const EVAL_PRESET = process.env.EVAL_PRESET ?? 'primary';
export const promptFile = name => {
  const file = join(ROOT, 'agent/eval/rendered', EVAL_PRESET, name);
  if (!existsSync(file)) {
    throw new Error(`没有找到渲染后的提示词 ${file}；先运行 cd src-tauri && cargo test prompts::tests::render_eval_prompts -- --ignored`);
  }
  return readFileSync(file, 'utf8');
};

function sidecarPath() {
  if (process.env.REDLARK_AGENT_BIN) return process.env.REDLARK_AGENT_BIN;
  return join(ROOT, 'src-tauri/target/debug/redlark-agent');
}

/** 运行一次性任务，返回 { ms, toolCalls:[{name,args,isError,text}], text, error, stats } */
export async function runTask({ systemPrompt, tools, message, thinking = 'low', model = 'kimi-k3', provider = 'moonshotai-cn' }) {
  const key = process.env.EVAL_MOONSHOT_KEY;
  if (!key) throw new Error('需要 EVAL_MOONSHOT_KEY');
  const work = mkdtempSync(join(tmpdir(), 'redlark-eval-'));
  const agentDir = join(work, 'agent'); const cwd = join(work, 'cwd');
  mkdirSync(agentDir); mkdirSync(cwd);
  writeFileSync(join(work, 'system.md'), systemPrompt);
  writeFileSync(join(work, 'config.json'), JSON.stringify({ provider: { key: provider, piProvider: provider, name: provider,
    baseUrl: '', api: 'openai-completions', apiKeyEnv: 'REDLARK_KEY_EVAL',
    model: { modelId: model, name: model, maxTokens: 32000, temperature: null, extraParams: null, contextWindow: null, reasoning: null } } }));
  const args = ['--no-session', '-ne', '--no-mcp', '-ns', '-np', '-nc', '--no-themes', '--no-approve',
    ...(tools.length ? ['--tools', tools.join(',')] : ['-nt']), '--system-prompt', join(work, 'system.md'),
    '--provider', provider, '--model', model, '--thinking', thinking];
  const proc = spawn(sidecarPath(), args, { cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_TELEMETRY: '0',
    REDLARK_AGENT_CONFIG: join(work, 'config.json'), REDLARK_KEY_EVAL: key }, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = []; const pending = new Map(); let buf = Buffer.alloc(0); let seq = 0;
  proc.stdout.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]); let i;
    while ((i = buf.indexOf(0x0a)) >= 0) {
      const line = buf.subarray(0, i).toString('utf8'); buf = buf.subarray(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'response' && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg);
    }
  });
  const send = (type, fields = {}) => new Promise(resolve => { const id = `r${++seq}`; pending.set(id, resolve); proc.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n'); });
  const started = Date.now();
  await send('prompt', { message });
  while (!events.some(e => e.type === 'agent_settled')) {
    if (Date.now() - started > 600_000) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 200));
  }
  const ms = Date.now() - started;
  const stats = (await send('get_session_stats')).data;
  proc.stdin.end();
  const toolCalls = events.filter(e => e.type === 'tool_execution_end').map(e => ({ name: e.toolName, args: e.result?.details ?? null, isError: e.isError,
    text: (e.result?.content ?? []).map(c => c.text ?? '').join('') }));
  const last = [...events].reverse().find(e => e.type === 'message_end' && e.message?.role === 'assistant');
  return { ms, toolCalls, text: (last?.message?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join(''),
    error: last?.message?.stopReason === 'error' ? last.message.errorMessage : null, stats };
}

export function saveResult(name, data) {
  const file = new URL(`./results/${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file.pathname;
}
