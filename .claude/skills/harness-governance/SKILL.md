---
name: harness-governance
description: "维护 RedLark 的 agent 指令面：用户要新建、重写、精简或审查 CLAUDE.md，新增/修改/删除 .claude/skills 下的 Skill，调整 catalog.yaml、.claude/settings.json 权限或 hooks，或判断某条规则应放 CLAUDE.md、Skill 还是可执行 gate 时触发。审查 Skill 的触发描述、owner 边界、资源引用和加载图；不用于业务代码、README 或产品提示词。Keywords: CLAUDE.md, skill, SKILL.md, catalog, hook, 规则维护, harness, 指令."
---

# Harness Governance

本 Skill 维护 Claude Code 在本仓库的指令面：根 `CLAUDE.md`、`.claude/skills/**`、`catalog.yaml`、`.claude/settings.json` 与 `.claude/hooks/*.sh`。目标是让根规则负责共通约束与事实，多步骤流程归 Skill，需要强制的约束落到 hook / script / test。

## 参考

- 写法与分层原则：`references/instruction-surface-principles.md`。
- Skill 质量审查清单：`references/skill-review-checklist.md`。

## 输入

- 当前 `CLAUDE.md`、`.claude/skills/README.md`、`catalog.yaml`、目标 Skill 的 `SKILL.md` 及其 references/assets
- 真实 owner 文件（代码、脚本、配置）以核对事实
- 用户对指令风格、范围或工作方式的要求

## 角色边界

- 面向 coding agent，不写成人类 onboarding 或架构白皮书。
- `CLAUDE.md` 是唯一根入口；**不新建 `AGENTS.md`**（Claude Code 存在 `CLAUDE.md` 时会以它为准，双入口会漂移）。如果未来要支持 Codex 等多客户端，再按 ai4se 模式迁移为 `.agents/skills` + 符号链接，且只做一次。
- 用户只要 review 时 findings-first，不直接改文件；要求实施时修改最近的真实 owner。
- 业务代码、产品提示词（`src-tauri/src/prompts/`）不在本 Skill 范围（后者归 `deliver-ai-prompt`）。

## 适用场景

1. `CLAUDE.md` 与代码漂移（目录变了、命令变了、债务已修），需要重建或局部更新。
2. 新增一类反复出现的多步骤工作，需要新 Skill 或扩展现有 Skill 的条件 reference。
3. 某条 CLAUDE.md 规则反复被违反，需要落成 hook（`guard-*.sh`）或校验脚本。
4. Skill 触发描述重叠、owner 不清、reference 没有消费者、模板沦为必填清单。
5. 删除或重命名 Skill。

## 执行流程

1. 盘点 active instruction surface：`CLAUDE.md`、`catalog.yaml`、相关 `SKILL.md` 与 references。
2. 从 live owner 提取事实：`package.json` 脚本、`lib.rs` 注册、`migrations/` 最大序号、目录树。事实以代码为准，不以旧文档为准。
3. 判定改法：
   - 缺失：在最近的 owner 补；共通事实进 `CLAUDE.md`，流程进 Skill。
   - 过重：`CLAUDE.md` 只留所有任务都要知道的最小内容；细节下沉到 Skill reference。
   - 漂移：选择最近真实 owner，删除重复或过时内容，不保留“兼容说明”。
   - 需要强制：改 hook / script / test，不继续堆说明。hook 只执行 `CLAUDE.md` 已有的约束，不定义新规则。
4. 改 Skill 时同步：`catalog.yaml`（id/group/path/summary）、`README.md`、frontmatter `name` = 目录名、`description` 含触发条件 + 不适用场景 + Keywords。explicit-only 的 Skill 加 `disable-model-invocation: true` 并在 README 标注“显式”。
5. 运行 `bash scripts/validate-skills.sh`；通过只证明结构，不证明路由或行为。
6. 需要验证路由时，用 3–5 个代表性请求问“你会用哪个 skill”，记录在回复里；不建长期路由语料库，除非 Skill 数量明显增长。

## 写作约束

- 用准确路径、命令、触发条件和联动面，少写抽象原则。
- `CLAUDE.md` 的章节顺序：速览 → 命令 → 目录地图 → 后端 → 前端 → AI → 硬性规范 → 已知债务 → 典型改动路径 → harness 入口；新增内容归入现有章节，不另开平行章节。
- Skill 的 `SKILL.md` 结构：frontmatter → 一段定位 → 按需读取 → 输入 → 负责/不负责 → 规则 → 默认执行方式 → 输出形态 → 完成条件；不复述 `CLAUDE.md` 已有的事实，用“以 CLAUDE.md §N 为准”引用。
- reference 只在被至少一个 Skill 条件化引用时存在；没有消费者的 reference 删除。
- 同一事实只保留一个 live owner（如迁移规则的 owner 是 `sqlx-migration-standards.md`，CLAUDE.md 只留三条硬规则并指向它）。
- 不把当前 work item 的计划、版本号清单、模型清单写进指令面。

## 输出要求

- Review：按 问题 / 证据 / 影响 / 建议 输出 findings，按影响排序。
- 实施：列出改动文件、同步点（catalog / README / hook）、`validate-skills.sh` 结果、未验证项。

## 完成条件

- `CLAUDE.md` 与 live owner 一致，没有已修债务仍被列为债务、没有已变命令仍是旧名
- 每个 Skill 的触发边界互斥且 catalog / README / frontmatter 三处一致
- 强制约束有对应 hook 或脚本，且 hook 模式与 `CLAUDE.md` 文字一致
- `bash scripts/validate-skills.sh` 通过
