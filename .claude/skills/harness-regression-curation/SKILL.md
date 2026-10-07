---
name: harness-regression-curation
description: "把失败沉淀为长期回归保护：用户要“把这次失败/修复补成测试”“加个回归”“以后别再犯”时触发。先确认要保护的风险和正确结果依据，再选择 cargo 单测、sqlx 集成测试、node --test 纯函数测试或手工走查清单；不固化修复手段或 AI 措辞，不把可接受的生成波动变成断言。Keywords: regression test, 回归, 补测试, add test for this fix, protect against regression."
---

# Harness Regression Curation

本 Skill 从失败和修复中提炼长期回归资产，用最低成本、最稳定的形式覆盖真实风险。

## 参考基线

- 使用 `assets/regression-candidate-template.md` 记录回归候选。
- 涉及 AI 输出质量时读 `../sdd-verify/references/verification-methods.md` 的“AI 语义”节：先判断实质影响，再决定是否沉淀。

## RedLark 可用的保护层

| 层 | 适合保护 | 位置 / 入口 |
| --- | --- | --- |
| Rust 单测 | 纯算法、统计口径、状态转换表、JSON 清洗/解析函数、错误 wire 形状 | 对应模块 `#[cfg(test)] mod tests` |
| Rust 数据库测试 | repository SQL、service 事务原子性、迁移后 schema 可用性 | 对应 service/repository 的 `#[cfg(test)]`，用 `crate::test_support::memory_pool()` 与 `seed_*`（见 `../deliver-backend-rust/references/rust-test-standard.md`） |
| 静态 SQL / IPC 检查 | SQL 引用的列不存在、命令未注册、参数名错误 | `scripts/check-sql.py`、`scripts/check-ipc-contract.py`（无需编译即可运行） |
| 解析 fixture | AI 原始响应 → 解析结构 | 把真实失败的原始响应（脱敏）作为字符串常量放在解析模块的测试中，断言 `parse_*` 结果 |
| node:test | 前端纯函数（`utils/`、`navigation.ts`、`api/client.ts` 错误解析、状态转换规则） | `src/**/*.test.ts`，`npm test` |
| 手工走查清单 | 用户可见交互、三态、主题 | 写入 `evidence.md` 或页面 README 的清单；不是自动化 |

目前没有 E2E 框架；不要为补回归引入 Playwright/Tauri driver，除非用户明确决定。

## 负责什么

- 识别失败中的确定性 contract、AI 语义和 UI 体验成分
- 选择最贴近失败根因的保护层
- 给出回归应该落到哪里的明确建议（文件、函数名、断言对象）

## 不负责什么

- 直接实现整套修复
- 为“补回归”默认上高成本层
- 用模糊的“加点测试”代替可执行建议
- 把本次修复手段、单次 AI 输出或历史实现路径固化为 contract

## 规则

- 优先选最稳定、最贴近根因的层：SQL 口径错 → sqlx 集成测试；转换表漂移 → Rust 单测 + node --test 双侧；解析失败 → fixture 单测。
- 迁移相关回归：断言迁移后 `.schema`/查询可用，不断言迁移文件内容。
- IPC contract 相关：Rust 侧用类型测试（struct 序列化 JSON 字段名快照）保护 serde 形状；前端侧用 TS 类型即可，不写运行时断言。
- AI 语义：硬断言只保护可解析、字段齐全、业务不变量（总数、日期范围、非空）；措辞、顺序、长度不断言。
- 回归保护的是失败风险，不是本次修复的写法；更换实现仍满足 contract 时测试应继续通过。
- 根因未证实时仍可保护明确的实质风险，但测试名和断言不得把某个候选原因固化成事实。
- 产出要写明为什么选这一层，以及覆盖/不覆盖什么。

## 默认执行方式

1. 从真实失败中分离风险、已证实原因、候选原因和本次修复手段。
2. 说明每项正确结果依据什么（用户 contract / 当前 schema / 转换表 / 业务不变量）。
3. 根因未确认且影响修复 owner 时，先回 `sdd-analyze`。
4. 用 `assets/regression-candidate-template.md` 写清落点与证据边界。
5. 存在 work item 时把结论写回 `evidence.md`。

## 完成条件

- 已明确每项正确结果的依据与最近保护层
- 硬断言有稳定约定来源；AI 质量结论有样本数说明
- 已说明覆盖与不覆盖的风险
- 后续执行者知道该把保护落到哪个文件、哪个函数
