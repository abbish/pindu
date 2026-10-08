---
name: sdd-release-build
description: "构建与发布准备（仅显式调用 /sdd-release-build）：版本号三处同步（package.json / Cargo.toml / tauri.conf.json）、迁移终态核对、clippy/tsc 基线、平台构建与安装包产物检查。不自动触发；不代替 sdd-verify 的功能验收。Keywords: release, build, bundle, 打包, 发版, version bump."
disable-model-invocation: true
---

# SDD Release Build

本 Skill 只在用户显式 `/sdd-release-build` 时进入。它把构建发布前的检查落成清单，不做功能验收（归 `sdd-verify`）。

## 输入

- 目标版本号与目标平台
- 本次发布包含的批次 / work item 的 `evidence.md`
- `git status --short` 与 `git log` 自上一版本以来的提交

## 执行

1. **版本同步**：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 三处 `version` 一致；`productName` / `identifier`（`com.redlark.pindu-app`）未被意外改动。
2. **工作树干净**：没有无关未提交改动；有的话先与用户确认归属。
3. **基线**：`cargo clippy -- -D warnings`、`cargo test`、`npm run type-check`、`npm run lint` 全绿；任一失败不进入构建。
4. **迁移终态**：`git diff <last-tag>..HEAD --stat src-tauri/migrations/` 只有新增；用一份真实库副本启动一次确认迁移链可从老版本升级（见 `../deliver-backend-rust/references/sqlx-migration-standards.md` Verify 节）。
5. **敏感信息**：`rg -n "sk-|api_key\s*=\s*\"" src src-tauri/src` 无硬编码密钥；`tauri.conf.json` 的 `csp: null` 作为已知风险写入发布说明。
6. **构建**：执行 `npm run package [-- --target <目标> --bundles <格式>]`（选项见 `CLAUDE.md` §2 与 `INSTALL.md`）；脚本把产物收集到 `release/<版本>-<triple>/` 并打印大小。
7. **产物 smoke**：安装/运行产物，启动成功、迁移完成（`app.log` 有 `migrations completed`）、主页面可打开。
8. 输出发布说明：版本、包含的改动（按 work item / 提交）、迁移列表、已知风险、未在本机验证的平台。

## 规则

- 不在构建分支上顺手修 bug；发现问题回 `sdd-work`。
- 不用 `--no-bundle` 产物冒充安装包验证。
- 跨平台构建（Windows/Linux）未在对应系统运行过时，发布说明明确写“未验证”。
- 不提交或推送；版本号提交与 tag 由用户决定。

## 输出形态

```text
版本：<x.y.z>（package.json ✓ Cargo.toml ✓ tauri.conf.json ✓）
基线：clippy ✓ cargo test ✓ tsc ✓ eslint ✓
迁移：新增 <NNN..MMM>；真实库副本升级 ✓ | 未验证
构建：<platform> → <产物路径>（<size>）；smoke ✓ | 未运行
已知风险：<…>
未验证平台：<…>
```
