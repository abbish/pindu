---
name: sdd-implement
description: "执行实现批次：plan.md 或用户已给出清楚的窄批次，需要真正修改代码、迁移、提示词或配置时触发。执行一个连贯批次，按变更面调度最小必要的 deliver-* 能力（backend-rust / frontend-react / contract-and-data / ai-prompt），同步 progress 并为 sdd-verify 留下入口；不扩范围，不要求独立 tasks 阶段。Keywords: implement, 实现, 改代码, apply the plan, make the change, write code, execute batch."
---

# SDD Implement

本 Skill 负责把一个已准备好的批次变成可验证改动。

## 按需读取

- 持续 work item 读 `../harness-context-memory/references/work-item-contract.md` 和当前 `plan.md`、`progress.md`。
- 批次形状对照 `../sdd-plan/references/batch-shapes.md`。
- 架构级重构读 `../sdd-plan/references/architecture-refactor-playbook.md`。
- 表结构变更读 `../deliver-backend-rust/references/sqlx-migration-standards.md`。
- 命令签名 / 类型变化读 `../deliver-contract-and-data/references/tauri-ipc-contract.md`。

## 执行前

- 当前批次只有一个连贯目标，非目标明确
- owner、contract/consumer 联动、完成定义和验证入口明确
- 批次依据已经成立：缺陷、contract、owner/consumer 问题或用户授权的改进有可复核事实，命令签名与当前实现已核对
- 每项 production 改动都能映射到 `plan.md` 或用户已明确的目标、owner、contract、预期行为、作用机制和验收粒度
- `git status --short` 已执行，知道哪些是别人的未提交改动
- 不满足时回到 `sdd-plan` 或 `sdd-analyze`

## 执行

1. 重述批次目标、非目标和验证目标；编辑前核对 live owner、方案依据和已声明的验收粒度仍然成立。多变更批次沿用变更 ID。
2. 只加载相关 owner，选择最小必要 capability：
   - `src-tauri/src/{handlers,services,repositories,types}`、`migrations/`、`lib.rs` → `deliver-backend-rust`
   - `src/{pages,components,services,hooks,types,utils,styles}`、`App.tsx` → `deliver-frontend-react`
   - 命令名、参数、serde 形状、Rust ↔ TS 类型、`ApiResult` → `deliver-contract-and-data`（跨前后端批次几乎总会命中）
   - `src-tauri/src/prompts/agent/*.md`、`agent/src/tools/*.ts`、`agent::tasks` 结果校正 → `deliver-ai-prompt`
3. 以已审查方案为实现基线完成改动，记录实际文件/点位，并检查 scope、owner、contract、failure path 和验证入口；在不改变已审查作用机制和 contract 的边界内选择最小实现。
4. 对账实际 diff 与目标、owner、contract、作用机制和联动面。计划外行为、owner/contract 变化、作用机制替换、范围扩张或没有满足声明的验收粒度属于方案偏差。出现实质偏差时先更新 `plan.md` 并重新审查，不用 `cargo check` 变绿掩盖方案变化。
5. 更新 `progress.md`，把当前目标或变更 ID、实际改动面和验证目标交给 `sdd-verify`。

## RedLark 专项检查（提交给 verify 前自查）

- 新/改命令：`lib.rs` 已注册；`rg "'<cmd>'" src/services` 找到前端调用点；参数名 Rust snake_case / 前端 camelCase。
- 新/改类型：`types/*.rs` 的 serde 属性与 `src/types/*.ts` 字段名一致。
- 新迁移：序号为当前最大 +1；没有触碰任何已有迁移文件（hook 会拦，但自己先看 diff）。
- 新/改提示词：对应 `Json*Response` 结构同步；提示词是 `include_str!`，需重新编译验证。
- 没有留下 `TODO` / 空函数 / 被吞掉的写入错误（`rg -n "TODO|unimplemented!" <改动文件>`）。
- 多表写入在 service 事务内；`python3 scripts/check-sql.py` 与 `python3 scripts/check-ipc-contract.py` 通过。
- 前端：`tsc` 通过；`node scripts/lint-ratchet.mjs` 不回退。
- SQL 只出现在 `repositories/`；handler 不含业务分支。
- 没有新增 `console.log` 调试输出；没有新增 broad `catch` 吞错或 `unwrap_or_default` 掩盖失败。
- 不触碰 `git status` 中别人的未提交改动。

## 变更汇报

批次交接时给出已应用 diff 的可访问入口及足以审查行为的关键改动，覆盖本批新增、删除和修改，标明与既有未提交改动交织的部分。用户要求逐字审查，或迁移 SQL / 提示词正文本身是待审 contract 时，提供完整 unified diff；日常进度只需说明结果、风险与下一步。拟议 patch 和测试结果不能冒充已应用改动；API Key 等敏感内容须脱敏。

## 规则

- 不因“顺手”扩到第二个目标；看到 CLAUDE.md §8 的已知债务不在本批顺手修。
- 计划外新增抽象、全局单例、trait、兼容路径或配置层时暂停，先回到 plan 证明真实消费者和较小替代不足。
- 代码与直接 producer/consumer/type/test 联动在同一批次保持一致：Rust 类型变了 TS 类型同批变；命令签名变了前端 service 同批变。
- 错误必须显式暴露：Rust 用 `AppError` 变体上抛，前端判 `success === false` 走 toast/错误态；不用静默 fallback。
- 实施中 owner、contract 或验证目标失效时停止，不边改边重写目标。
- production diff 不得出现无法追溯到当前目标或变更 ID 的设计变化；纯机械联动可以归入同一目标。

## 输出形态

```text
批次：<目标 / Change ID>
实际改动：<文件:点位>（新增 | 修改 | 删除）× N；与既有未提交改动交织处：<…>
对账 plan：matched <…> / deviated <…>（已回 plan 重审 | 残留风险）/ unplanned <…>
专项自查：lib.rs 注册 ✓/– · 类型同步 ✓/– · 迁移序号 ✓/– · 提示词重编译 ✓/–
验证入口：<最窄命令或场景>；验证对象：<行为 / contract>
progress.md：已同步 | 一次性任务无 work item
```

## 完成条件

- 当前批次改动完成且没有范围漂移
- 实际文件与 diff 已映射到当前目标或变更 ID，并与已审查 owner、contract、作用机制和验收粒度一致
- 专项自查通过或作为残留风险记录
- `progress.md` 已同步，验证对象和最窄入口明确
