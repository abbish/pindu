// RedLark 的 agent sidecar 入口：pi 的 RPC 模式 + 编译进来的 RedLark 工具（不在运行时加载扩展文件）。
// 构建：bun build --compile host.ts --outfile dist/redlark-agent
import { main } from "@earendil-works/pi-coding-agent";
import redlarkTools from "./extension/redlark-tools.ts";

// 桌面应用内运行：默认离线（不查版本、不刷新模型目录）、不发遥测
process.env.PI_OFFLINE ??= "1";
process.env.PI_TELEMETRY ??= "0";
process.title = "redlark-agent";

await main(["--mode", "rpc", ...process.argv.slice(2)], { extensionFactories: [redlarkTools] });
