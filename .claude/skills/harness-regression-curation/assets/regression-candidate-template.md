# 回归候选

## 失败摘要

## 根因面

- 已证实原因：
- 仍待验证的候选原因：
- 本次修复手段（不等同于 contract）：

## 如何判断结果正确

- [ ] 可精确验证的代码 / 数据约定（SQL 口径、转换表、serde 形状、迁移终态）
- [ ] AI 输出可解析 / 业务不变量
- [ ] UI 交互与呈现
- [ ] 混合（按接受条件拆分）

## 预期结果来自哪里

- 用户 contract：
- 当前 schema / 调用方 / 副作用：
- 需要保持的业务概念、关系或状态变化：
- 不应固化的实现细节、方法或表达：

## 推荐落点

- [ ] Rust 单测：`<file>::<mod>::<test_name>`
- [ ] Rust 数据库测试（test_support 内存库）：`src-tauri/src/<module>.rs::tests::<test_name>`
- [ ] 解析 fixture：解析模块测试中的原始响应常量
- [ ] 静态检查：`check-sql.py` / `check-ipc-contract.py` 已覆盖
- [ ] node:test：`src/<path>.test.ts`
- [ ] 手工走查清单：`<work-id>/evidence.md`

## AI 采样（适用时）

- 要支持的结论：smoke / 行为成立 / 稳定性
- 固定输入集与重复次数：

## 覆盖的风险

## 不覆盖的风险
