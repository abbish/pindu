---
name: sdd-analyze
description: "问题诊断与深度分析：需要定位根因、解释机制、判断 owner、因果、跨层一致性或计划可行性时触发，包括 bug 原因不清、命令调用失败、迁移/数据异常、状态机不一致、AI 输出解析失败、日历或统计数字不对。从用户目标与事实展开因果分支，区分因果 finding、设计 finding 与待决假设；不作为所有任务的固定阶段，不直接改 production。Keywords: root cause, 为什么, diagnose, 排查, analyze, investigate, debug, 数据不对."
---

# SDD Analyze

本 Skill 从用户目标与事实解释问题及其形成机制，支持 owner、方案和验证方式的判断。深度分析主动展开范围内的重要分支，不以找到一个触发错误或可修位置代替根因收敛。

## 诊断方法

先读 `references/first-principles-diagnosis.md`（第一性原理、发散提问与证据约束的共同方法）。
RedLark 的证据在哪里、常见症状对应哪条链路，读 `references/redlark-diagnostic-map.md`。

## 按需读取

- 需要持久化时读 `../harness-context-memory/references/work-item-contract.md` 和 `../harness-context-memory/assets/work-item/analysis.template.md`。
- 分析 AI 输出质量、提示词或解析失败时读 `../deliver-ai-prompt/SKILL.md` 与 `../sdd-verify/references/verification-methods.md` 的“AI 语义”“问题准入”节：先判断实质影响，再归因。
- 分析迁移失败、字段缺失、历史数据形状时读 `../deliver-backend-rust/references/sqlx-migration-standards.md`。
- 分析参数反序列化、字段名不匹配、`null`/`undefined` 时读 `../deliver-contract-and-data/references/tauri-ipc-contract.md`。
- 架构级重构可行性读 `../sdd-plan/references/architecture-refactor-playbook.md`。

## 输入

- 用户目标、live contract、相关 owner 和调用链
- `plan.md`、`progress.md`、`evidence.md` 中与当前问题有关的部分
- `logs/app.log`、WebView 控制台、SQLite 实际数据、测试或复现步骤

## 负责什么

- 定位 `前端调用 → invoke 参数 → handler → service → repository → SQLite`（或 `→ AIService → Provider → JSON 解析`）链上的首个分歧点
- 区分可见事实、违反的 contract、因果 finding、设计 finding 和待决假设
- 检查拟议改动的依据是否足以支持它声称的作用
- 给出继续、补观测、受控实验、回到 plan 或暂停的结论

## 结论依据

- **因果 finding**：用于解释可复现缺陷。证据定位到最早直接分歧，或通过能区分候选的实验支持该机制。
- **设计 finding**：live surface 已显示重复 owner、冲突 contract、错误 consumer 或无消费者结构（如 `endpoints.ts` 的死命令名、`diagnostics.rs` 混放）。它可以支持结构收敛，同时不宣称已经证明某次行为由它造成。
- **待决假设**：现有证据还不足以选择 owner 或改法。下一步只补一项最能区分候选的证据。

## 规则

- 测试失败、审查 finding、时间相关性和单次 AI 输出只能证明现象，不能单独证明原因。
- 只有多个候选会导向不同改法时才维护最小因果账本：`现象与 contract → 候选 → 区分证据 → 最早分歧点 → 下一决定`。
- 对确定性代码沿输入、状态、调用链和副作用取证：`api_request` 参数日志 → handler 入参 → SQL 实际执行 → 表中实际行。前端 `console.log` 与后端 `app.log` 要对时间轴对照。
- 对 AI 相关问题沿 `prompts/*.md → 模板填充 → 发给 Provider 的实际消息 → 原始响应 → 清洗/解析 → 落库` 查到足以回答当前问题的位置；只有源提示词或最终界面时不直接归因。
- 数据“不对”类问题先查权威写入（哪张表哪一行），再查读取聚合（repository SQL），最后才查前端展示；不从界面文字反推。
- 先按验证方法的“问题准入”判断受损结果，再展开会改变处置的重要分支；AI 输出的非实质差异不升级为缺陷。
- 原因不清且结论会改变改法时，可固定输入重复运行或换模型对照排除；不用模型投票定根因。
- 没有直接 consumer 的字段、类型、命令或兼容分支优先视为可删除候选。
- 结论强度随新证据或有效区分实验变化。以“修复根因”为理由的改动需要因果 finding；以 owner/contract 收敛为理由的改动使用设计 finding，并把行为效果留给验证。
- 每个分析分支以证据支持的解释或明确缺口收口；覆盖重要分支后再选择 plan、区分实验、补观测或停止，不等待用户逐点提醒。

## 不负责

- 代替 domain code review
- 为形式完整对所有 work item 生成 `analysis.md`
- 直接修改 production 收口诊断问题

## 输出形态

分析结论用最小因果账本表达（一次性任务写在回复里，持续任务写入 `analysis.md`）；每条候选都要有能区分它的证据或明确缺口。

```text
现象与 contract：<可见事实> 违反 <哪条当前 contract>
候选：C1 <机制> / C2 <机制>
区分证据：<什么观察能区分 C1 与 C2>（已有：<…> | 待补：<…>）
最早分歧点：<path:symbol，或 前端 → invoke → handler → service → repository → DB / AI 链上的位置>
结论类型：因果 finding | 设计 finding | 待决假设 —— 依据：<…>
下一决定：进入 plan | 补观测 <…> | 受控实验 <…> | 暂停
```

## 完成条件

- 已证事实、推断和未知项分开
- 关键替代原因被确认、降低或保留，并说明依据
- 重要分支的起因、放大因素、机制必要性和较小替代已经审查；尚未成立的深层归因保持为假设
- 下一步是可执行的实现、计划修正、实验、补观测或暂停
