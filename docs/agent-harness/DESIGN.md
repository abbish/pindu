# RedLark Agent Harness 设计（pi 内置 sidecar）

> 状态：已全部迁移（2026-10-07，见 D12）。选型与各项决策见 [DECISIONS.md](./DECISIONS.md)。
> 本文描述架构与契约；与代码不一致时以代码为准。

## 1. 目标

用一个成熟的、可内置执行的 agent harness 承载 RedLark 所有 LLM 工作：

- 现有一次性任务：提词、拼读分析、学习计划生成（替换 `src-tauri/src/ai_service/` 的 async-openai 直连实现）。
- 未来交互功能：学生与 AI 的场景自由对话、辅助练习助手（多轮、流式、工具调用、会话持久化）。

选定 **pi**（`@earendil-works/pi-coding-agent`，MIT），以 RPC 模式作为 Tauri sidecar 运行。

## 2. 总体结构

```
React ──invoke / Tauri event──▶ Rust（Tauri 主进程）
                                  agent::AgentManager
                                   ├─ 解析模型配置（ai_providers / ai_models）→ AgentLaunchConfig
                                   ├─ spawn sidecar `redlark-agent`（每个 agent 会话一个进程）
                                   │    stdin  ← JSONL 命令（带 id）
                                   │    stdout → JSONL 响应 / 事件（按字节 LF 切分）
                                   └─ 事件 → 业务结果（工具调用参数）/ 前端流式事件
redlark-agent（bun 单文件，~70MB，不依赖 Node）
   = pi RPC 模式 + RedLark 工具（编译进二进制）+ RedLark 配置 → pi models.json 转换
```

代码位置：

| 位置 | 内容 |
|---|---|
| `agent/` | sidecar 的 TypeScript 工程：`src/host.ts`（入口）、`src/tools/*`（工具）、`src/config.ts`（配置转换）、`scripts/build.mjs`（bun 编译） |
| `src-tauri/binaries/redlark-agent-<target-triple>` | 编译产物（不入库），由 `tauri.conf.json > bundle.externalBin` 打包到应用内 |
| `src-tauri/src/agent/` | Rust 侧：`protocol`（命令 / 事件，纯函数 + 录制 fixture）、`config`（模型配置 + 任务 → 启动参数）、`session`（子进程与 JSONL 通信）、`tasks`（各任务：提示词、工具白名单、结果校正） |
| `src-tauri/src/prompts/agent/*.md` | agent 任务的系统提示词（`include_str!`） |
| `src-tauri/src/services/word_extraction.rs` | 提词服务：agent 优先、sidecar 无法启动时回退旧实现（D08） |

## 3. Sidecar 启动契约

参数（全部为 pi 文档列出的 CLI 参数）：

```
redlark-agent [--no-session | --session-dir <dir> [--session <file>]]
  -ne --no-mcp -ns -np -nc --no-themes --no-approve
  --tools <本任务的工具白名单>
  --system-prompt <file>
  --provider <pi provider id> --model <model id> --thinking <level>
```

环境变量：

| 变量 | 值 |
|---|---|
| `PI_CODING_AGENT_DIR` | `<app_data>/agent/runs/<任务>-<uuid>/agent`（每个进程独立，与用户 `~/.pi` 隔离；见 D09） |
| `PI_OFFLINE=1` / `PI_TELEMETRY=0` | 不查版本、不刷新远端模型目录、不发遥测（host.ts 也默认设置） |
| `REDLARK_AGENT_CONFIG` | RedLark 模型配置 JSON 文件路径（见 §4），host 启动时转换为 pi 的 models.json |
| `REDLARK_KEY_<provider_id>` | 各提供商 API Key，只经环境变量传入，models.json 中以 `$REDLARK_KEY_<id>` 引用，**不落盘** |

工作目录：`<app_data>/agent/cwd`（空目录，确保不会加载任何 AGENTS.md / `.pi` 资源）。对话会话文件（H5）保存在 `<app_data>/agent/sessions`。

安全边界：pi 的内置工具（read/bash/edit/write/grep/find/ls）一律不进白名单；Rust 永不发送 RPC `bash` 命令；不加载 MCP / 外部扩展。

## 4. 模型配置统一（RedLark 表 ↔ pi 模型体系）

**真源仍是 RedLark 数据库**（设置页编辑、密钥保存），采用 pi 的模型概念扩充字段；运行时由 sidecar 转换为 pi 的 `models.json`：

| RedLark 字段 | pi 概念 | 说明 |
|---|---|---|
| `ai_providers.pi_provider` | 内置 provider id（`openrouter` / `moonshotai-cn` / `deepseek` / `minimax-cn` …） | 非空：使用 pi 内置的接口类型、兼容参数、模型目录（思考档位映射、上下文、价格）；`base_url` 仅用于展示与远端同步 |
| `ai_providers.api` | `api`（`openai-completions` / `anthropic-messages` / `openai-responses`） | `pi_provider` 为空时生效：作为自定义 provider `redlark-p<id>` 写入 models.json |
| `ai_providers.api_key` | `apiKey: "$REDLARK_KEY_<id>"` | 值经环境变量注入 |
| `ai_models.model_id` | model `id` | 在内置目录中 → 写 `modelOverrides`；不在 → 写 `models` 追加 |
| `ai_models.max_tokens` | `maxTokens` | 空 = 用目录默认 |
| `ai_models.temperature` + `ai_models.extra_params` | `samplingParams`（自由字段，如 `top_p`） | 仅 openai-* 接口生效 |
| `ai_models.thinking_level` | `--thinking`（off / minimal / low / medium / high / xhigh / max） | 空 = 由任务决定默认档；pi 按模型能力自动收敛 |
| `ai_models.context_window`、`ai_models.reasoning` | `contextWindow`、`reasoning` | 仅自定义模型需要填写 |

转换在 sidecar（TS）里做，因为只有它知道 pi 的内置目录；Rust 只输出 RedLark 自己的配置结构（§3 `REDLARK_AGENT_CONFIG`）。

「同步模型列表」的数据源：优先 pi 内置目录（sidecar 提供，含上下文 / 思考 / 价格），再合并提供商远端 `/models`。

## 5. 任务模型

每个业务能力 = 一个**任务定义**：系统提示词 + 工具白名单 + 默认思考档 + 结果工具。

| 任务 | 工具 | 结果 | 默认思考 |
|---|---|---|---|
| 提词 | `tokenize_text`（确定性分词计数）、`submit_words`（terminate） | `submit_words` 参数 | low |
| 拼读分析 | `submit_phonics`（自带校验，不通过退回重交） | `submit_phonics` 参数 | low |
| 学习计划 | `submit_learning_order`（顺序 + 难度 / 优先级；日程由 Rust 计算，D13） | `submit_learning_order` 参数 | low |
| 场景对话 / 练习助手 | `lookup_word`、`record_mistake`、读取学习进度等 | 流式文本 + 工具副作用 | low |

原则：**确定性的工作放进工具**（分词计数、格式校验、日期排期），模型只做判断与生成；结构化结果一律通过 `submit_*` 工具交付，不从文本中解析 JSON / CSV。

## 6. 事件与结果

- 一轮结束以 `agent_settled` 为准（不是 `agent_end`）。
- 结构化结果：取 `tool_execution_end`（`toolName = submit_*`）的 `result.details`。
- 流式文本：`message_update.assistantMessageEvent.type = text_delta` 推给前端；`message_end` 的完整消息为准。
- 错误：assistant 消息 `stopReason = error` 时取 `errorMessage`；进程异常退出、超时由 Rust 侧转为 `AppError::ExternalServiceError`。
- 用量：`get_session_stats` 的 `tokens` / `cost`。

## 7. 迁移与回退

- 已完成：提词 / 批量拼读 / 学习计划 / 模型测试全部经 agent；旧 `ai_service`（async-openai）与回退开关已删除（D12）。
- 进度：sidecar 事件推送替代 `EnhancedProgressManager` 轮询（顺带完成 `docs/design/batch-analysis-event-driven.md`）。

## 8. 构建与发布

- `npm run agent:build`：在 `agent/` 用 bun 编译当前平台 sidecar 到 `src-tauri/binaries/redlark-agent-<target-triple>`；发布时按目标平台交叉编译。
- `scripts/verify.sh` 在 sidecar 缺失时自动构建（tauri-build 要求 externalBin 存在）。
- pi 版本锁定在 `agent/package.json`；升级 pi 需重跑任务回归（提词参照评分、对话脚本）。
