# RedLark Development Skills

本目录是 Claude Code 在 RedLark 仓库中的开发 workflow 与工程能力入口（SDD harness）。根规则在 `CLAUDE.md`；本目录定义多步骤流程；`catalog.yaml` 只做注册与分组；`bash scripts/validate-skills.sh` 校验结构。

设计源自 ai4se-requirements-assistant 的 `.agents/skills` harness，按 RedLark（Tauri 2 + Rust 三层 + React，单客户端）裁剪：不设 `.agents` + 符号链接双层，不含 SSE/Agent runtime 与 UAT 发布层。

## Workflow

- `sdd-work`：feature / bugfix / refactor / improvement 的统一入口，收敛目标、范围、验收和未知项，再选 plan / analyze / implement / verify。
- `sdd-plan`：按 RedLark 的 owner 链（前端 service → IPC 命令 → handler → service → repository → migration）写可独立验证的批次；`plan.md` 是唯一计划 owner，没有 `tasks.md`。
- `sdd-analyze`：定位首个分歧点；区分因果 finding、设计 finding、待决假设。`references/redlark-diagnostic-map.md` 说明证据在哪里。
- `sdd-implement`：执行一个批次并调度最小 `deliver-*`；实际 diff 对账 plan。
- `sdd-verify`：三层证据（确定性 / AI 语义 / 桌面 UI），迁移和 IPC contract 变更必查。
- `sdd-release-build`（仅显式 `/sdd-release-build`，`disable-model-invocation: true`）：版本同步、构建、安装包检查。

任务类型只改变 plan / analyze / verify 要保护的约束，不选择不同的阶段链。

## Domain Capabilities

- `deliver-backend-rust`：`src-tauri/src/{handlers,services,repositories,types}` 与 `migrations/`。迁移标准：`references/sqlx-migration-standards.md`。
- `deliver-frontend-react`：`src/{pages,components,services,hooks,types,utils,styles}`。UI 体系（shadcn/ui + Tailwind v4、交互统一、功能对等）：`references/ui-system-standard.md`；交互模式与布局（场景 → shadcn Block / Example）：`references/ui-interaction-patterns.md`；页面规范：`references/page-layout-standard.md`。
- `deliver-contract-and-data`：Tauri IPC contract owner。`references/tauri-ipc-contract.md` 是命令名、参数命名、serde 形状、类型同步的唯一规范。时间与时区（存储 UTC、展示按本机时区）：`references/time-and-timezone.md`。
- `deliver-ai-prompt`：`src-tauri/src/prompts/agent/*.md`、`agent/src/tools/*.ts`、`agent::tasks` 结果校正、`agent/eval` 评测。

通常由 `sdd-implement` 调度；用户明确要求窄实现批次时可直接进入，但不重新定义目标。

## Evidence And Memory

- `harness-context-memory`：跨会话 work item。
- `harness-regression-curation`：真实失败 → 最贴近根因的长期保护。

持续 work item 的 owner：

```text
.claude/work/<work-id>/
├── brief.md
├── plan.md       # 有技术决定或多批次时
├── progress.md   # 运行状态唯一 owner
├── evidence.md   # 有改动和验证时
└── analysis.md   # 有因果诊断时
```

当前会话能闭环的任务不创建 work item。

## Engineering Governance

- `harness-governance`：维护 `CLAUDE.md`、本目录、`catalog.yaml`、`.claude/settings.json` 与 hooks；审查 Skill 质量。

## 可执行 gate（`.claude/settings.json`）

- `hooks/guard-migrations.sh`：PreToolUse(Edit|Write) 拦截对已存在 `src-tauri/migrations/*.sql` 的修改 —— CLAUDE.md「迁移只增不改」的硬实现。
- `hooks/guard-bash.sh`：拦截删除/覆盖应用数据库、`git checkout`/`restore` 历史迁移、整文件输出密钥文件。

## 验证工具（`scripts/`）

| 工具 | 作用 | 何处可跑 |
| --- | --- | --- |
| `verify.sh [--quick]` | 一键运行下列全部检查 + cargo fmt/check/clippy/test，日志写入 work item | 任何机器（缺的工具记为“未运行”） |
| `check-sql.py` | 提取 Rust 中的静态 SQL，在迁移终态 schema 上 `EXPLAIN` | 任何有 python3 的机器 |
| `schema-snapshot.py [--table t]` | 按序执行全部迁移，输出终态表结构 | 同上 |
| `check-ipc-contract.py [--warnings]` | 前端 invoke ↔ lib.rs 注册 ↔ 命令签名（参数名、必填、重复注册） | 同上 |
| `check-type-sync.py` | 同名类型：Rust serde 实际键 ↔ TS 接口字段 | 任何有 python3 的机器 |
| `check-css-vars.py` | CSS `var(--x)` 引用都有定义 | 同上 |
| `check-time.py [--list]` | 时间约定棘轮（`.time-baseline.json`） | 同上 |
| `package.mjs` | 一键构建本机安装包（`npm run package`，见 INSTALL.md） | 有 Node 与 Rust 的机器 |
| `lint-ratchet.mjs [--update]` | ESLint error 必须为 0，warning 按规则只减不增（`.eslint-baseline.json`） | 有 node_modules 的机器 |
| `test-resolve-hook.mjs` | `npm test`（`node --test`）的模块解析钩子 | 同上 |
| `validate-skills.sh` | 本目录结构校验 | 任何机器 |

这些工具在 2026-10 首次运行即发现：暂停/恢复练习、今日日程、状态历史的 SQL 引用不存在的列；`get_words_by_book` 参数名错误导致搜索/分页失效；5 个前端方法调用不存在的命令。

## 维护

新增、删除或重命名 Skill 时同步 `catalog.yaml`、本 README，然后运行：

```bash
bash scripts/validate-skills.sh
```

只读取当前批次实际命中的 reference，不为完整加载整个目录。
