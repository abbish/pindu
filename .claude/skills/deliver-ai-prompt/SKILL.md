---
name: deliver-ai-prompt
description: "AI 能力实现（agent harness）：修改 src-tauri/src/prompts/agent/*.md 提示词、agent/src/tools/*.ts 工具与校验、agent::tasks 任务定义与结果校正、模型生成参数映射，或改进提词 / 拼读分析 / 学习计划 / 场景对话的输出质量时使用，由 sdd-implement 调度或用户明确要求时直接进入。保证提示词、工具 schema、Rust 校正与落库字段同步，并用 agent/eval 前后对比取证；不以单次输出改提示词。不负责 sidecar 进程 / 协议基建（归 deliver-backend-rust）。Keywords: prompt, 提示词, agent, pi, 工具, submit_, 拼读分析, 学习计划, 评测, eval."
---

# Deliver AI Prompt

本 Skill 负责 RedLark 的 AI 能力面：任务定义（提示词 + 工具白名单 + 默认思考档）→ sidecar 内工具（结构化交付与确定性校验）→ Rust 结果校正 → 落库 / 进度。架构与决策以 `docs/agent-harness/DESIGN.md`、`DECISIONS.md` 为准；事实总览见 CLAUDE.md §4.4、§6。

## 按需读取

- 验证层、问题准入与采样：`../sdd-verify/references/verification-methods.md` 的“AI 语义”节。
- 诊断链路：`../sdd-analyze/references/redlark-diagnostic-map.md` 的 AI 行。
- 输出结构影响落库字段或前端类型时：`../deliver-contract-and-data/references/tauri-ipc-contract.md`。

## 链路事实

| 环节 | Owner | 说明 |
| --- | --- | --- |
| 提示词 | `src-tauri/src/prompts/{agent,fragments,messages}/*.md` | `include_str!` 编译进 Rust，改完重新编译；渲染唯一 owner 是 `src-tauri/src/prompts.rs`（`system_prompt(task, profile, vars)` / `message(..)`：`{{x}}` 替换、空变量删行、`{{#x}}`/`{{^x}}` 条件块，语法见 CLAUDE.md §6） |
| 任务定义 | `src-tauri/src/agent/tasks.rs`（`AgentTask`、`run_task[_cancellable]`） | 工具白名单、默认思考档、超时；结果从 `RunOutcome::last_successful_call("submit_*")` 取 |
| 工具与校验 | `agent/src/tools/*.ts`（注册在 `tools/index.ts`） | TypeBox schema；校验不通过抛错 → 模型看到问题清单并重交；`terminate: true` 结束本轮。改工具需 `npm run agent:build` |
| Rust 校正 | `agent::tasks::*_from_submission`、`services/passage_rules.rs`（短文 / 规划 / 题目 / 评分 / 导入翻译）、`services/study_planning.rs` | 只接受请求中的输入、补齐遗漏、确定性字段（词频、日期、复习排期）由代码计算 |
| 模型参数 | `src-tauri/src/agent/config.rs`（启动参数 / 思考档）→ `agent/src/config.ts`（pi models.json） | 生成参数只来自模型配置（`ModelGenerationSettings`），调用方不得写死 |
| 落库 / 进度 | `services/wordbook.rs`（建单词本，含 phonics_segments 生成）、`services/study_plan*.rs`、`services/passage.rs`、`services/passage_import_service.rs`、`services/word_explanation.rs`（讲解缓存）；`progress_manager.rs`（批量分析）、`planning_progress.rs`（规划） | 进度契约见 CLAUDE.md §4.4 |
| 评测 | `agent/eval/eval-*.mjs` + `fixtures/` | 准确率（参照答案 / 金标准）+ 质量指标；结果写 `agent/eval/results/`（不入库） |

## 负责什么

- 在“提示词 / 工具 / 校正”这一面完成一个连贯批次
- 保证 **提示词描述的字段 ↔ 工具 schema ↔ Rust 校正与落库字段** 一致
- 用固定输入集给出前后对比（`agent/eval`），结论写进 work item evidence；重要取舍追加 `DECISIONS.md`

## 不负责什么

- sidecar 进程管理、RPC 协议、打包（归 `deliver-backend-rust`）
- 决定“要不要用 AI 做某事”（归 `sdd-plan`）
- 把单次输出的措辞差异当缺陷修

## 实施规则

- **确定性的工作不交给模型**：计数、格式、日期、排期放进代码或工具；模型只做判断与生成（DECISIONS D05 / D13）。
- **结构化结果只经 `submit_*` 工具交付**，不从文本解析 JSON / CSV；新增字段先改工具 schema 与 Rust 校正，再改提示词描述。
- 工具内校验只做确定性检查（拼写一致、格式、枚举），错误信息写成模型能照着改的中文清单。
- 不为单次失败样本加特判；先在 ≥2 次重跑或评测集上复现，再判断是提示词、工具校验还是 Rust 校正的问题。
- 面向的学习者由学习者档案 `PromptProfile` 决定（预设 小学生（默认）/ 中学生 / 成人，D21）；改动要覆盖各预设，用 `EVAL_PRESET` 评测；风格类改动用评测质量指标说明效果。
- 日志不打印密钥；打印模型原文时截断。

## 默认执行方式

1. 确认批次覆盖：提示词 / 工具 / 校正 / 落库 中的哪些。
2. 改前先跑一次对应 `agent/eval` 作为基线（需要 Key 时从隔离测试库读取，只经环境变量传入）。
3. 修改 → `npm run agent:build`（工具变更时）→ 重新编译 → 再跑评测，对比准确率与质量指标。
4. 跑 `cargo test agent::` 与相关 `#[ignore]` 真实调用测试（需要时），`npm run verify`。
5. 记录：输入集、样本数、前后指标、一个原始输出样本；交给 `sdd-verify`。

## 完成条件

- 提示词、工具 schema、Rust 校正与落库字段一致，sidecar 与 Rust 均已重新编译
- 评测前后对比已记录（样本数、准确率、质量指标），无准确率回退
- 没有新增绕过 agent 的直连调用、没有新增进度管理器
