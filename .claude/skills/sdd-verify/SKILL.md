---
name: sdd-verify
description: "验证实现批次：需要按确定性 contract、AI 语义或桌面 UI 体验收集证据、对账 plan 与实际 diff 并限定结论时触发。先跑最窄确定性检查（cargo check/test、tsc、eslint），只在真实风险进入时升级到真实 Provider 调用或 tauri:dev 手工走查；迁移和 IPC contract 变更必查。不默认跑全量；存在 work item 时更新 evidence.md 和 progress.md。Keywords: verify, 验证, validate, test the change, 验收, acceptance, evidence, QA, 测一下."
---

# SDD Verify

本 Skill 证明当前接受条件是否成立，不让单一测试层越权代表整项质量，也不把可接受的 AI 生成波动升级为工程缺陷。

## 参考

- 选择证据层、判断 AI 输出是否构成问题、设计采样与停止条件时读 `references/verification-methods.md`。
- 持续 work item 再读 `../harness-context-memory/references/work-item-contract.md` 和相关 plan/progress。
- 架构级重构读 `../sdd-plan/references/architecture-refactor-playbook.md`。
- 迁移进入验收读 `../deliver-backend-rust/references/sqlx-migration-standards.md` 的 Verify 节。
- 命令/类型变化进入验收读 `../deliver-contract-and-data/references/tauri-ipc-contract.md` 的检查清单。

## 负责什么

- 对账 plan 或用户目标与实际 diff，先确认实现保持已审查的 owner、contract、作用机制、范围和已声明的验收粒度
- 把接受条件拆成确定性 contract、AI 理解/生成、桌面 UI 体验或混合项
- 为每项选择最近、最小的证据层
- 记录命令/场景、预期、实际、结论和不能证明什么
- 失败时判断回到 implement、plan、analyze 或 regression curation

## 执行

1. 对账方案与实际 diff：检查目标文件、owner、contract、作用机制、范围、直接联动和验收粒度，记录 matched / deviated / missing / unplanned。多变更批次按变更 ID 记录；不把满足相同 contract 的等价局部实现误判为偏差。
2. 为每条接受条件标注 owner、风险和最窄证据。
3. **IPC contract 变更必查**：涉及命令名、参数、返回类型、serde 形状时，对账 `lib.rs` 注册 → handler 签名 → `types/*.rs` serde → `src/types/*.ts` → `src/services/*.ts` 调用参数 → 页面消费；用 `rg` 把每个命令名在前后端各找一遍。
4. **迁移必查**：空库首次启动 + 真实库副本启动都成功；`_sqlx_migrations` 新增一行；没有已有迁移文件被修改（`git diff --stat src-tauri/migrations/` 只应有新增）。
5. 先运行直接覆盖改动的确定性检查，按 `references/verification-methods.md` 的“验证环境矩阵”选当前机器能跑的层：`check-sql.py` / `check-ipc-contract.py` / `tsc` / `lint-ratchet.mjs` / `npm test` 在任何环境可跑；`cargo check/clippy/test` 只在有 Rust 工具链时跑，否则在检查点请用户运行 `bash scripts/verify.sh` 并读取日志。
6. 只有真实模型决策进入风险时升级到真实 Provider 调用（固定输入，≥2 次）；稳定性主张需要相称的重复。
7. 只有用户可见交互进入范围时升级到 `npm run tauri:dev` 手工走查，按 `references/verification-methods.md` 的 UI 清单记录；截图或 `app.log` 片段作为证据。UI 批次同时对照 plan 中声明的交互模式（组件组合、浮层选择、反馈方式、亮 / 暗主题），不一致记为 finding。
8. 汇总方案一致性、行为覆盖、未覆盖、失败归属和残留风险。

验收汇报用已应用的 diff 对账本批修改前后、作用机制、验证结果与限制；区分本批与工作树既有改动；未运行验证及原因单独说明；API Key 脱敏。

## 规则

- 验收修复和区分原因的诊断实验必须分开。
- 对齐 live contract 后的聚焦确定性失败是强缺陷证据；旧实现断言或场景漂移优先修测试。
- 单次 AI 运行只支持该样本的 smoke 结论，不授权增加长期提示词硬控。
- 结果缺陷、交付阻断与工程根因分别判定；不用轻微措辞差异否决已成立的修复，也不以模型波动免责关键失败。
- 验证在证据已经回答接受条件时结束。
- 测试通过不能替代方案一致性对账；如果实际 diff 改用了另一套作用机制、owner 或 contract，回到 `sdd-plan`/`sdd-implement` 处理后再验收。
- `cargo check` 通过 ≠ 命令可调用（注册漏了编译照样过）；`tsc` 通过 ≠ 字段对得上（`any` 和可选字段会放过）。这两类靠 `check-ipc-contract.py`、第 3 步对账或运行时证据。
- 没有在本机运行的层，写进“未运行项”并注明由谁、在哪运行；不得用“应该能编译”代替证据。
- 没运行的高层验证写明原因；窄检查不包装成全量质量门。
- 持续任务把结论写入 `evidence.md` 并同步 `progress.md`；一次性任务在最终回复给出等价证据。

## 输出形态

```text
plan 对账：matched <…> / deviated <…> / missing <…> / unplanned <…>
IPC contract 对账：<命令> lib.rs ✓ handler ✓ rs-type ✓ ts-type ✓ service ✓ 页面 ✓ | 不涉及
迁移对账：空库 ✓ 真实库副本 ✓ 无历史文件改动 ✓ | 不涉及

| 接受条件 | 证据层（contract / AI / UI） | 命令或场景 | 预期 | 实际 | 结论 | 不能证明什么 |
| --- | --- | --- | --- | --- | --- | --- |

未运行项：<项> —— 原因：<…>
失败归属：回到 implement | plan | analyze | regression curation
残留风险：<…>
```

## 完成条件

- 接受条件已映射到正确证据层
- 每个实际 production 变化都能追溯到当前目标或变更 ID，且方案偏差和遗漏已明确处置
- 结论不超出实际覆盖与采样范围
- 失败的 owner、下一步和残留风险清楚
