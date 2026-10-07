// RedLark agent sidecar 入口：RedLark 配置 → pi models.json，然后以 RPC 模式运行 pi（工具编译进二进制）。
// 契约见 docs/agent-harness/DESIGN.md §3。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "@earendil-works/pi-coding-agent";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { type BuiltinCatalog, type RedLarkAgentConfig, toPiModelsJson } from "./config.ts";
import { buildCatalog } from "./catalog.ts";
import redlarkTools from "./tools/index.ts";

// 桌面应用内运行：默认离线（不查版本、不刷新远端模型目录）、不发遥测
process.env.PI_OFFLINE ??= "1";
process.env.PI_TELEMETRY ??= "0";
process.title = "redlark-agent";

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
