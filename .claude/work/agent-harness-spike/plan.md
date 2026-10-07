# plan：引入 pi 作为内置 agent harness（spike 结论通过后的落地方案，待用户确认）

## 架构
```
React ──invoke/event──▶ Rust (Tauri)
                          ├─ AgentManager：每个“会话用途”一个 sidecar 进程（提词/分析可复用池，对话一会话一进程或 new_session）
                          │    spawn redlark-agent（Tauri sidecar / externalBin）
                          │    env: PI_CODING_AGENT_DIR=<app_data>/agent, PI_OFFLINE=1, PI_TELEMETRY=0, <PROVIDER>_API_KEY（来自 ai_providers，不落盘）
                          │    stdin 写 JSONL 命令（带 id），stdout 按 LF 读事件 → tauri::Emitter 推给前端（流式对话），
                          │    agent_settled 结束一轮；tool_execution_end 取结构化结果
                          └─ 工具实现：spike 中工具在 sidecar 内（TS）。落地时两种选择：
                               a) 工具留在 TS（纯计算类：tokenize/校验）
                               b) 需要 RedLark 数据的工具（查词、记错、读学习进度）→ 工具在 TS 中定义，执行时通过 extension_ui 或自定义行协议回调 Rust 查 SQLite
```
- 模型配置映射：ai_providers/ai_models → `--provider/--model/--thinking`；自定义 OpenAI 兼容提供商写入私有 models.json（apiKey 用 `$ENV` 引用）。
- 思考档位成为模型配置的新字段（off/low/medium/high/max），提词默认 low，对话默认 low，规划可用 medium。

## 批次（建议）
1. **H1 sidecar 基建**：host.ts + 工具包（锁 pi 版本）、bun 三平台编译脚本、tauri externalBin；Rust `AgentManager`（spawn/JSONL/id 关联/超时/崩溃重启/退出清理）+ 单测（用假 sidecar 回放录制的 JSONL）。
2. **H2 提词迁移**：`submit_words` + `tokenize_text`；保留旧实现做开关回退；用 spike 的参照评分做回归测试。
3. **H3 拼读分析迁移**：`submit_phonics` + 校验工具（IPA/音节格式），失败自动重试；替换 CSV 解析。
4. **H4 学习计划**：排期计算放工具，模型只做分配决策。
5. **H5 场景对话 MVP**（新功能）：会话持久化到 app_data、前端流式 UI、`record_mistake` 写入 RedLark 表供后续练习。
6. 收尾：删除 async-openai 旧路径与 EnhancedProgressManager 轮询（进度改为 sidecar 事件推送，顺带完成 plans/batch-analysis-event-driven-design.md）。

## 需用户决策
- 是否接受 sidecar 体积 ~70MB/平台（安装包增量）。
- DeepSeek / MiniMax / OpenRouter 需提供测试 Key 做兼容性实测。
- H1 开始前确认是否先提交当前所有未提交改动（建议先分批提交，再开新分支做 H1）。
