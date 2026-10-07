# Spike：pi 作为 RedLark 内置 agent harness

评估 [pi](https://pi.dev/)（`@earendil-works/pi-coding-agent` 1.0.4）以 RPC 模式作为 Tauri sidecar，
承接结构化任务（提词）与多轮对话（场景对话 / 练习助手）。结论与数据见 `.claude/work/agent-harness-spike/evidence.md`。

## 目录

| 路径 | 作用 |
|---|---|
| `extension/redlark-tools.ts` | RedLark 自定义工具：`submit_words`（结构化交付，terminate）、`tokenize_text`（确定性分词计数）、`lookup_word`、`record_mistake` |
| `host.ts` | 自建 sidecar 入口：`main(["--mode","rpc"], { extensionFactories })`，工具编译进二进制 |
| `lib/rpc.mjs` | RPC 客户端参考实现（按字节 LF 切 JSONL、id 关联响应、等 `agent_settled`）——Rust 侧照此实现 |
| `lib/env.mjs` | 从隔离测试库读取测试 Key（只经环境变量传给子进程） |
| `lib/reference.mjs` | 提词参照答案与评分（召回 / 精确 / 频率准确率） |
| `baseline.mjs [low]` | 复刻当前实现：提示词 + 一次调用 + 解析 CSV（可选 reasoning_effort） |
| `spike-a-extract.mjs <thinking> [tokenizer]` | 场景 A：经 pi 提词 |
| `spike-b-dialogue.mjs` | 场景 B：4 轮场景对话 + 进程重启后恢复会话 |
| `results/*.json` | 实测数据 |

## 运行

```bash
npm install
node baseline.mjs            # 当前实现（K3 默认思考）
node spike-a-extract.mjs low tokenizer
node spike-b-dialogue.mjs
# 单文件 sidecar（不依赖 Node）：
npx bun build --compile host.ts --outfile dist/redlark-agent
REDLARK_AGENT=$PWD/dist/redlark-agent node spike-b-dialogue.mjs
```

sidecar 启动参数（全部为 pi 文档列出的参数）：
`--no-session | --session-dir <dir> [--session <file>]  -ne --no-mcp -ns -np -nc --no-themes --no-approve
--tools <白名单> --system-prompt <file> --provider <id> --model <id> --thinking <level>`；
环境变量 `PI_CODING_AGENT_DIR=<应用私有目录>`、`PI_OFFLINE=1`、`PI_TELEMETRY=0`、`<PROVIDER>_API_KEY`，工作目录为空目录。
