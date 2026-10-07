---
name: harness-context-memory
description: "跨会话 work item 恢复与交接：用户要恢复、暂停、续跑、交接或查看一个跨批次/跨会话开发任务的进度时触发。只维护 .claude/work/<work-id>/ 的最小 work record（brief / progress / plan / evidence / analysis）和下一步；不决定业务方案，不为模板齐全制造 artifact。Keywords: resume, continue, 继续上次, 接着做, handoff, 交接, progress, work item."
---

# Harness Context Memory

本 Skill 只负责让持续任务可恢复。

## 参考

- 创建、恢复或更新 work item 时读 `references/work-item-contract.md`。
- 模板在 `assets/work-item/`，是可删减脚手架，不是必填清单。

## 最小恢复面

- `brief.md`：稳定目标、范围、成功标准和关键约束
- `progress.md`：当前批次、已完成、阻塞、最近证据和下一步 —— **运行状态唯一 owner**
- `plan.md`：存在非显然技术决定或多批次时创建；只保留当前仍有效的实现路径
- `evidence.md`：发生代码/迁移/提示词改动并完成验证时创建
- `analysis.md`：只有因果诊断产生新决定时创建

## 规则

- 当前会话能闭环的任务不创建 work item。
- 同一用户目标的 review、纠偏和补验证复用原记录。
- 不生成 `state.json`、`handoff.md`、`tasks.md` 或按阶段命名的文件；不引入 spec-workflow、superpowers 等第三方 SDD 工具的目录或模板。
- 只在批次完成、阻塞变化、关键决定或交接时更新记录。
- 新证据改变路线时，替换、合并或删除已失效批次；历史经过进入 evidence 或 git，不把 `plan.md` 维护成追加日志。
- 运行状态不写入 Claude Code 的 auto-memory 或用户级记忆；它属于仓库。
- `.claude/work/` 可以提交进 git（便于多机续跑），也可由用户决定加入 `.gitignore`；本 Skill 不替用户决定。

## 恢复流程

1. `ls .claude/work/` 找匹配 work-id；读 `progress.md`，再按需读 `brief.md` / `plan.md` / `evidence.md`。
2. `git status --short` + `git log -5` 核对记录与工作树是否一致；不一致以工作树为事实，更新 progress。
3. 核对 plan 中的 owner 是否仍是 live owner（文件还在、函数还在）；不在则回 `sdd-plan`。
4. 从 progress 的“下一步”继续。

## 完成条件

- 下一位执行者能从 brief/progress 和必要的 plan/evidence 直接继续
- 当前状态、阻塞、最近证据和下一步没有互相冲突
- 没有第二份运行状态 owner
