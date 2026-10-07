# evidence：pi harness spike（2026-10-06）

模型：Kimi K3（moonshotai-cn，测试库中唯一配置了 Key 的提供商）。脚本与原始数据：`spikes/agent-harness/`。

## 场景 A：提词（3 段文本，参照答案为确定性分词）

| 方案 | 平均耗时 | tokens/次 | 召回 | 频率准确率 | 说明 |
|---|---|---|---|---|---|
| 当前实现（K3 默认思考，CSV） | **99.0s**（54–136） | 3.2k–6.9k | 1.0 | 1.0 | 准确但很慢 |
| 当前实现 + reasoning_effort=low（直连 API） | 32.5s | ~2.1k | 0.97–1.0 | 0.96–1.0 | 对照组：提速主要来自思考档位 |
| pi + low，submit_words 工具交付 | 30.8s | 1.3k–2.4k | 0.97–1.0 | 0.92–0.99 | 模型自己数频率会错 |
| **pi + low + tokenize_text 工具** | 36.9s | 2.8k–4.0k | 0.97–1.0 | **1.0** | 分词计数交给代码，模型只筛选+标注；漏的 2 个是 that/their（模型判为功能词） |

结论：harness 本身不带来提速（提速来自思考档位，直连 API 也能做到）；它的价值在于**确定性部分放进工具**（频率 100% 准确）、
**工具交付结构化结果**（不再从文本解析 CSV/JSON）、以及思考档位等参数由 harness 按模型适配（pi 内置 K3 的 thinkingLevelMap：off 不可用，low/high/max 可用）。
单次成本（pi 统计）约 $0.01–0.025。

## 场景 B：场景对话 + 练习助手（4 轮 + 进程重启后续聊）

- 流式：每轮 40–58 个文本增量，首字 4–7s（K3 low）。
- 工具：拼写错误 → `record_mistake{tiket→ticket}`；语法错误 → `record_mistake{are→is}`；问发音 → `lookup_word{giraffe}`，回复使用工具返回的 IPA/音节。
- 上下文：第 4 轮“我今天错了哪些”正确列出两处错误。
- 持久化：`--session-dir` + 重启后 `--session <file>` 恢复，消息数 16→18，正确回答“一开始想买 ticket”。
- 整段对话 6.5k–7k tokens（含缓存命中 4k+），成本约 $0.013。

## 打包与运行时

| 形态 | 体积 | 结果 |
|---|---|---|
| npm 包 + 系统 Node（≥22.19） | node_modules 159MB + Node 116MB | 可用；冷启动 0.5s |
| bun 编译 pi 自带 rpc-entry | 68MB | 内置功能可用，但**运行时加载 .ts 扩展失败**（`Cannot find module 'jiti'`） |
| **bun 编译自建 host.ts（`main(args, { extensionFactories })`，工具编译进去）** | **70MB 单文件** | 场景 B 全部通过（工具/流式/恢复会话），不依赖 Node；冷启动 ~1.7s，RSS ~95MB |

隔离与安全（均实测可用）：`PI_CODING_AGENT_DIR` 指向私有目录、空 cwd、`-nc/-ns/-np/-ne/--no-mcp/--no-approve`、`--tools` 白名单（内置 read/bash/edit/write 不开放）、
`PI_OFFLINE=1`（不查版本/不刷新模型目录）、`PI_TELEMETRY=0`；Key 只经环境变量传入，未落盘。stderr 干净。

## 未验证 / 风险

- DeepSeek / MiniMax / OpenRouter 无测试 Key，未实测（pi 内置目录有：deepseek-flash、MiniMax-M2.7/M3（走 anthropic-messages 端点）、openrouter）。
- 温度：pi 默认不发送 temperature（K3 恰好需要 1 或不发）；需要固定温度的模型要用 models.json 的 `samplingParams`，仅 openai-* API 生效。
- 跨平台：只在 macOS arm64 编译验证；Windows/Linux 需各自用 bun `--target` 交叉编译并实测。
- 版本节奏：pi 迭代快（0.73 → 1.0.4，包名已迁移到 @earendil-works），需锁版本并做升级回归。
- 未做 Goose 对比实测；由于 bun 单文件已消除 Node 依赖，Goose“纯 Rust、免 Node”的主要优势被削弱，暂列为备选。
