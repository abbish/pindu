---
name: sdd-plan
description: "技术方案与实施计划：用户要方案、设计、计划、任务拆分、批次划分，或开发工作需要明确 owner、IPC contract、迁移、批次、验证和回退时触发。把 shaping 结果转成可独立验证的实现批次，plan.md 是唯一计划 owner；不直接改代码，不为简单任务制造独立 tasks 阶段。Keywords: plan, 方案, 设计, implementation plan, task breakdown, 拆分, migration plan, 重构方案."
---

# SDD Plan

本 Skill 同时负责技术方案和可执行批次。`plan.md` 是唯一计划 owner，不另建 `tasks.md`。

先确认整体责任、边界和信息流（哪些层参与、数据从哪里产生到哪里消费），再展开当前要实施的局部变化。体系级目标不在责任未确认时一次写成大量逐字 patch；窄批次也不能只写原则而不落到真实 owner 和验证入口。

## 按需读取

- 批次形状不清时读 `references/batch-shapes.md`：RedLark 五种典型批次（新命令 / 改表 / 新页面 / 状态机 / 提示词）的 owner 链与验证入口。
- 持续 work item 读 `../harness-context-memory/references/work-item-contract.md` 和 `../harness-context-memory/assets/work-item/plan.template.md`。
- 包含表结构变更时读 `../deliver-backend-rust/references/sqlx-migration-standards.md`。
- 包含命令签名、参数、返回类型或 TS 类型变化时读 `../deliver-contract-and-data/references/tauri-ipc-contract.md`。
- 包含提示词、AI 输出结构或分析进度时读 `../deliver-ai-prompt/SKILL.md`。
- 架构级重构（跨多个 handler/service 的 owner 迁移、`handlers/diagnostics.rs` 拆解等）读 `references/architecture-refactor-playbook.md`。

## 输入

- 用户目标、接受条件、范围和关键约束
- live owner、调用方、现有实现和验证入口
- `analysis.md`，如果方案依赖因果诊断

## 方案 Contract

跨层或多批次方案先说明用户结果、范围、非目标、接受条件、责任与信息流，再给出批次顺序。当前可实施批次只需回答：

- 最近 owner 和 live 位置在哪里（`path:symbol`），当前事实与直接 consumer 是什么；
- 准备删除、改写或新增什么，预期行为和保持不变的 contract 是什么；
- 这项变化作用于哪个已证实输入、状态、约束或 owner，为什么会改变结果；
- producer、consumer、test、迁移/删除和失败路径怎样联动——在 RedLark 里通常是 `repository ↔ service ↔ handler ↔ lib.rs 注册 ↔ TS 类型 ↔ 前端 service ↔ 页面`；
- 用户可见状态变化按 `前态 → 用户动作 → 权威写入（哪张表哪个字段） → 保留/失效的关联状态 → 界面终态 → 刷新或恢复` 对账；学习计划状态变化必须对照 `unified_status` 的转换规则；
- 完成定义、最窄验证、停止条件和回退是什么。

只知道模块而不知道 owner、当前事实或作用机制时，把下一批定义为 inventory / diagnostic，不假装 production ready。多批次或需要精确追踪时才分配 Change ID。

用户明确要求逐字审批，或迁移 SQL、提示词正文、公共类型本身是待审 contract 时，提供 live 原文与完整 unified diff；普通方案不写伪 patch。

## 关键判断

- 每个 production 改动需要明确依据：已证实缺陷、当前 contract 违反、owner/consumer 错位或用户明确授权的改进。只有声称修复某个行为根因时才要求相应因果证据。
- refactor 默认行为不变；允许变化的行为必须进入接受条件。
- 新增抽象、trait、泛型 registry、全局单例、兼容分支或配置层前，必须证明当前问题、真实消费者、稳定变化点、较小替代为什么不够、验证入口和旧路径删除方式。耗时工作一律做成后台任务（`jobs.rs`，CLAUDE.md §4.4），不新增别的进度 / 取消机制；新的 LLM 能力一律做成 agent 任务，不新增直连调用。
- 迁移批次必须写明：目标终态、与现有数据的兼容方式、是否需要重建表、前端/Repository 同步点。不能用删库重建替代。
- 新增 Tauri 命令必须在 plan 中列出 `lib.rs` 注册和前端 service 调用点；缺一项就是不完整批次。
- 涉及用户可见界面的批次必须写明采用的交互模式（`deliver-frontend-react/references/ui-interaction-patterns.md` 的场景行或具体 shadcn Block / Example）；自定义交互要写出查过的来源和偏离理由，否则不算 ready。UI 迁移 / 改版批次还必须附改版前的功能清单（`ui-system-standard.md` §6），功能删减需用户确认。
- supporting artifact 只在能减少实现猜测时创建；能在 `plan.md` 表达的内容不拆文件。
- `plan.md` 维护当前有效路径。决定失效时直接替换、合并或删除对应批次。
- 方案中的关键改动如果无法定位 live owner、说明当前事实或解释作用机制，说明诊断仍不充分；先补 `sdd-analyze`，不靠实施试错补齐。

## 不负责

- 不会改变 owner、contract 或作用机制的低层实现细节大全
- 在 owner、contract 或验收仍不清时假装 ready
- 直接执行 production 改动

## 回退

- 目标或验收不清：回到用户或 `sdd-work`
- owner、原因或调用链不清：进入 `sdd-analyze`
- 实施中计划失效：更新 `plan.md` 后再继续，不在代码里创造新路线

## 输出形态

每个可实施批次在 `plan.md`（或一次性任务的回复）中按同一块表达；无法填满 owner、当前事实或作用机制的批次标为 inventory / diagnostic。

```text
### 批次 B1：<一句目标>（Change ID：可选）
- Owner / live 位置：<path:symbol>；当前事实：<…>；直接 consumer：<…>
- 变化：删除 / 改写 / 新增 <…>；保持不变的 contract：<…>
- 作用机制：作用于 <已证实的输入 / 状态 / 约束>，因此 <结果如何变化>
- 联动：repository <…> / service <…> / handler+lib.rs <…> / TS types <…> / 前端 service+页面 <…> / 迁移 <…> / 测试 <…> / 失败路径 <…>
- 完成定义与最窄验证：<命令或场景>；停止条件：<…>；回退：<…>
```

## 完成条件

- 至少一个批次可独立执行和验证
- 当前批次有 owner、当前事实、拟议变化、作用机制、联动、验证和回退；验收粒度已经由方案明确
- 迁移与 IPC contract 变化的联动点已经逐项列出
- 用户能先判断整体方向和责任边界，再判断当前批次实施后什么行为和 contract 会变化
