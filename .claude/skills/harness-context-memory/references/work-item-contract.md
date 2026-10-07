# Work Item Contract

只有需要跨批次、跨会话恢复或明确交接的开发任务才创建 `.claude/work/<work-id>/`。当前会话可闭环的回答、审查或窄改动使用最终交付证据即可。

work-id 用 kebab-case 描述目标，可带日期：`calendar-stats-mismatch-2026-10`、`handlers-diagnostics-split`。

同一用户目标在 review、纠偏和补验证中复用原 work item；只有目标、owner 或独立生命周期实质分离时才新建。

## Canonical Record

```text
.claude/work/<work-id>/
├── brief.md
├── plan.md       # 有非显然技术决定或多批次时
├── progress.md
├── evidence.md   # 有实际改动和验证时
└── analysis.md   # 有因果诊断或跨层决定时
```

- `brief.md`：稳定目标、范围、成功标准、关键约束和用户决定。
- `plan.md`：owner、contract、技术决定、实施批次、验证和回退。
- `progress.md`：当前状态、当前批次、已完成、阻塞、最近证据和下一步。
- `evidence.md`：实际命令/场景、预期、实际、结论边界和残留风险。
- `analysis.md`：现象、live contract、候选原因、区分证据和准入结论。

`progress.md` 是运行状态的唯一 owner。

## 更新规则

- 创建时通常只需要 `brief.md` 和 `progress.md`；确有设计压力时增加 `plan.md`。
- 批次完成、阻塞变化、关键决定或交接时更新 `progress.md`。
- 长时间运行的构建或真实 AI 批量分析启动时，记录目标、命令、开始时间和它准备证明的结论；只在出现新证据、状态变化、超时或完成时更新。
- 验证完成后更新 `evidence.md`，并在 `progress.md` 留结论摘要和下一步。
- supporting artifact 只在有直接 consumer 时创建；不创建空文件，不复制相同事实到多个记录，不把 artifact 齐全当完成标准。
- 模板是按需删减的脚手架。没有对应决定、风险或消费者的章节、表格和 Change ID 直接省略。

## 可恢复条件

- 目标和成功标准仍然有效。
- 当前批次、阻塞、最近证据和下一步可直接理解。
- plan 与 live owner 不一致时明确回到 `sdd-plan` 或 `sdd-analyze`，不依赖旧状态继续执行。
