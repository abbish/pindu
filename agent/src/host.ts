// RedLark agent sidecar 入口：RedLark 配置 → pi models.json，然后以 RPC 模式运行 pi（工具编译进二进制）。
// 契约见 docs/agent-harness/DESIGN.md §3。
import "./photon-wasm.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { type BuiltinCatalog, type RedLarkAgentConfig, toPiModelsJson } from "./config.ts";
import { buildCatalog } from "./catalog.ts";
import redlarkTools from "./tools/index.ts";

// 桌面应用内运行：默认离线（不查版本、不刷新远端模型目录）、不发遥测
process.env.PI_OFFLINE ??= "1";
process.env.PI_TELEMETRY ??= "0";
process.title = "redlark-agent";

/** 列表里每个对话带的全文上限（搜索用，取最近的部分） */
const MAX_SESSION_TEXT = 200_000;

const catalog: BuiltinCatalog = {
  hasProvider: id => (getBuiltinProviders() as string[]).includes(id),
  hasModel: (providerId, modelId) =>
    getBuiltinModels(providerId as never).some(model => model.id === modelId),
};

// 目录模式：输出 pi 内置模型目录后退出（RedLark 设置页使用）
if (process.argv.includes("--redlark-catalog")) {
  // 等管道写完再退出（目录约数百 KB，直接 exit 会截断）
  await new Promise<void>(resolve => process.stdout.write(JSON.stringify(buildCatalog()), () => resolve()));
  process.exit(0);
}

// 会话列表模式：`--redlark-sessions <会话目录> <工作目录>`，用 pi 的 SessionManager 列出 AI 老师的对话后退出。
// 每行一个 JSON：读的过程中 pi 每读好一批回报一次 `{"partial": [...]}`（不带全文），最后 `{"done": [...]}`（带全文，搜索用）
const sessionsAt = process.argv.indexOf("--redlark-sessions");
if (sessionsAt >= 0) {
  const [sessionDir, cwd] = process.argv.slice(sessionsAt + 1, sessionsAt + 3);
  const write = (line: unknown) => new Promise<void>(resolve => process.stdout.write(`${JSON.stringify(line)}\n`, () => resolve()));
  const summary = (s: SessionInfo, withText: boolean) => ({
    id: s.id,
    path: s.path,
    name: s.name ?? null,
    parentPath: s.parentSessionPath ?? null,
    firstMessage: s.firstMessage,
    created: s.created.toISOString(),
    modified: s.modified.toISOString(),
    messageCount: s.messageCount,
    text: withText ? s.allMessagesText.slice(-MAX_SESSION_TEXT) : "",
  });
  let partial = Promise.resolve();
  const sessions = await SessionManager.list(cwd, sessionDir, (_loaded, _total, sessions) => {
    if (sessions) partial = partial.then(() => write({ partial: sessions.map(s => summary(s, false)) }));
  });
  await partial;
  await write({ done: sessions.map(s => summary(s, true)) });
  process.exit(0);
}

// 从某条消息重新问：`--redlark-fork <会话目录> <来源会话文件> <那条学习者消息的 timestamp> <新对话名>`。
// 用 pi 把这条消息之前的对话复制成新会话（记着来源），输出 `{"id": 新会话 id}`；这条之前还没有回答时输出 `{"id": null}`（直接开新对话）
const forkAt = process.argv.indexOf("--redlark-fork");
if (forkAt >= 0) {
  const [sessionDir, sourcePath, timestamp, name] = process.argv.slice(forkAt + 1, forkAt + 5);
  const manager = SessionManager.open(sourcePath, sessionDir);
  const entry = manager
    .getEntries()
    .find(e => e.type === "message" && e.message.role === "user" && e.message.timestamp === Number(timestamp));
  if (!entry) {
    process.stderr.write("没有找到这条消息\n");
    process.exit(1);
  }
  const before = entry.parentId ? manager.getBranch(entry.parentId) : [];
  let id: string | null = null;
  if (before.some(e => e.type === "message" && e.message.role === "assistant")) {
    manager.createBranchedSession(entry.parentId!);
    manager.appendSessionInfo(name);
    id = manager.getSessionId();
  }
  await new Promise<void>(resolve => process.stdout.write(JSON.stringify({ id }), () => resolve()));
  process.exit(0);
}

const configPath = process.env.REDLARK_AGENT_CONFIG;
const agentDir = process.env.PI_CODING_AGENT_DIR;
if (configPath) {
  if (!agentDir) {
    process.stderr.write("redlark-agent: REDLARK_AGENT_CONFIG 需要同时设置 PI_CODING_AGENT_DIR\n");
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8")) as RedLarkAgentConfig;
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "models.json"), JSON.stringify(toPiModelsJson(config, catalog), null, 2));
}

await main(["--mode", "rpc", ...process.argv.slice(2)], { extensionFactories: [redlarkTools] });
