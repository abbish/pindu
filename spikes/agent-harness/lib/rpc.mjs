// pi RPC 客户端（按 docs/rpc.md）：严格 JSONL，按字节 LF 切分（不用 readline），命令带 id 关联响应。
// Rust 侧对接时按同样方式实现：stdin 写一行 JSON，stdout 逐行解析，等待 agent_settled 表示一轮结束。
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
export const PI_CLI = join(ROOT, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
export const EXTENSION = join(ROOT, 'extension/redlark-tools.ts');

export class PiRpc {
  /**
   * @param {object} o
   * @param {string[]} o.tools 允许的工具（白名单，内置工具一律不开放）
   * @param {string} o.systemPrompt
   * @param {string} o.provider / o.model / o.thinking
   * @param {Record<string,string>} o.env 额外环境变量（API Key 只经环境变量传入）
   * @param {string} [o.sessionDir] 持久化会话目录；不传则 --no-session
   * @param {string} [o.session] 恢复的会话文件
   */
  constructor(o) {
    const work = mkdtempSync(join(tmpdir(), 'redlark-pi-'));
    const agentDir = join(work, 'agent'); // 与用户 ~/.pi 隔离
    const cwd = join(work, 'cwd'); // 空目录：不会读到任何 AGENTS.md / .pi
    mkdirSync(agentDir); mkdirSync(cwd);
    const promptFile = join(work, 'system.md');
    writeFileSync(promptFile, o.systemPrompt);
    const args = [PI_CLI, '--mode', 'rpc',
      ...(o.sessionDir ? ['--session-dir', o.sessionDir] : ['--no-session']),
      ...(o.session ? ['--session', o.session] : []),
      // REDLARK_AGENT：自建 sidecar（工具已编译进去），不再用 -e 加载扩展文件
      '-ne', ...(process.env.REDLARK_AGENT ? [] : ['-e', EXTENSION]), '--no-mcp', '-ns', '-np', '-nc', '--no-themes', '--no-approve',
      '--tools', o.tools.join(','),
      '--system-prompt', promptFile,
      '--provider', o.provider, '--model', o.model, '--thinking', o.thinking ?? 'low'];
    this.startedAt = Date.now();
    // PI_BIN：使用 bun 编译的单文件可执行（不依赖 Node）；否则用 node 运行 npm 包
    const bin = process.env.REDLARK_AGENT ?? process.env.PI_BIN;
    const [cmd, cmdArgs] = bin ? [bin, args.slice(1)] : [process.execPath, args];
    this.proc = spawn(cmd, cmdArgs, {
      cwd,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_TELEMETRY: '0', ...o.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stderr = '';
    this.proc.stderr.on('data', d => { this.stderr += d; });
    this.listeners = new Set();
    this.pending = new Map();
    this.seq = 0;
    let buf = Buffer.alloc(0);
    this.proc.stdout.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      let i;
      while ((i = buf.indexOf(0x0a)) >= 0) {
        const line = buf.subarray(0, i).toString('utf8').replace(/\r$/, '');
        buf = buf.subarray(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'response' && msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        } else {
          for (const l of this.listeners) l(msg);
        }
      }
    });
    this.exited = new Promise(r => this.proc.on('exit', code => r(code)));
  }

  /** 发命令并等响应 */
  send(type, fields = {}) {
    const id = `req-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, msg => (msg.success ? resolve(msg.data) : reject(new Error(`${type}: ${msg.error}`))));
      this.proc.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
    });
  }

  onEvent(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  /** 发送一条用户消息并收集本轮全部事件，直到 agent_settled */
  async run(message, { onDelta, timeoutMs = 300_000 } = {}) {
    const events = [];
    let firstTokenMs = null;
    const started = Date.now();
    const settled = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      const off = this.onEvent(ev => {
        events.push(ev);
        const d = ev.type === 'message_update' ? ev.assistantMessageEvent : null;
        if (d && (d.type === 'text_delta' || d.type === 'toolcall_delta') && firstTokenMs === null) firstTokenMs = Date.now() - started;
        if (d?.type === 'text_delta') onDelta?.(d.delta);
        if (ev.type === 'agent_settled') { clearTimeout(timer); off(); resolve(); }
      });
    });
    await this.send('prompt', { message });
    await settled;
    const toolCalls = events.filter(e => e.type === 'tool_execution_end')
      .map(e => ({ name: e.toolName, args: e.result?.details ?? null, isError: e.isError }));
    const last = [...events].reverse().find(e => e.type === 'message_end' && e.message?.role === 'assistant');
    const text = (last?.message?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('');
    const error = last?.message?.stopReason === 'error' ? last.message.errorMessage : null;
    return { ms: Date.now() - started, firstTokenMs, toolCalls, text, error, eventTypes: [...new Set(events.map(e => e.type))] };
  }

  async stop() { this.proc.stdin.end(); return this.exited; }
}
