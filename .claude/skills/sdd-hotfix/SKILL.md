---
name: sdd-hotfix
description: "快速修复并发版（仅显式调用 /sdd-hotfix）：已发布版本里用户碰到的缺陷，修复面小、只升修订号（X.Y.Z → X.Y.Z+1）时走的短流程——定位修复、补回归测试、自动化门禁加针对性手测、写更新说明、打标签发布；不跑完整回归、不做本地全平台打包与应用内更新端到端实测。涉及迁移、更新或构建链路、依赖升级或新功能时不适用，改走 sdd-work + /sdd-release。不自动触发。Keywords: hotfix, patch release, quick fix, 紧急修复, 快速发版, 小版本, 修订号."
disable-model-invocation: true
---

# SDD Hotfix

本 Skill 只在用户显式 `/sdd-hotfix` 时进入。它是 `sdd-release` 的快速通道：修的是已经发出去的版本里用户碰到的问题，改动小、风险可控，所以省掉完整回归和链路实测，只保留「证明问题修好了、没把别的弄坏、发出去的东西是完整的」所必需的工作。

发布机制（版本号、标签、Release 草稿、latest.json、补救）与 `../sdd-release/SKILL.md` 相同，本文只写差异和取舍；人看的发版说明在 `docs/RELEASING.md`。

## 按需读取

- 发布步骤细节：`../sdd-release/SKILL.md`（第 3–10 步）。
- 更新说明的写法：`../sdd-work/references/user-facing-writing.md`。
- 原因不清：`../sdd-analyze/references/redlark-diagnostic-map.md`。

## 准入（全部满足才走快速通道）

| 条件 | 不满足时 |
|---|---|
| 修的是已发布版本里的缺陷，不是新功能或改版 | 走 `sdd-work`，攒进下一个正式版本 |
| 改动集中在少数文件，原因已经定位清楚 | 先 `sdd-analyze`，定位后再判断 |
| 不加迁移、不改表结构 | 走 `sdd-work` + `/sdd-release`（迁移要按完整流程验证升级） |
| 不碰更新与构建链路（`tauri.conf.json`、`build.yml`、`package.mjs`、`release-assets.mjs`、`handlers/updater.rs`、`app_paths.rs`、`startup.rs`） | 走 `/sdd-release`（这些改动必须实测更新链路） |
| 不升级依赖、工具链和 `rust-toolchain.toml` / `.nvmrc` | 走 `/sdd-release` |
| `main` 上自上个标签以来没有别的未发布改动，或这些改动也都满足本表 | 先发正式版本，或在上个标签上开分支只带这次修复（见下文「分支」） |

不确定是否满足时按不满足处理，并告诉用户为什么不走快速通道。

## 执行

1. **定版本号**：上个标签的修订号加一（`v0.2.0` → `v0.2.1`），告诉用户。
2. **修复**：按 `sdd-implement` 的约束改最近的 owner；为这个缺陷补一条能复现它的自动化测试（Rust 测试或 `*.test.ts`），修复前失败、修复后通过。纯界面问题写不出测试时，在交付物里写明手测步骤。
3. **门禁**（不能省）：
   - `npm run verify` 全部通过；推送后 `main` 的 CI 变绿（CI 的工具链可能报本机没有的问题，以 CI 为准）。
   - `python3 scripts/check-release-invariants.py` 通过。
   - 针对性手测：在开发版或本机打的包里，按用户报告的步骤确认问题已经消失；再做一次冒烟（应用能启动、首页与受影响的页面能打开、相关的一个主流程能走通）。需要点击时请用户来点。
4. **更新说明**：在 `docs/releases/vX.Y.Z.md` 写一两条，只写用户碰到的现象现在怎样了，按 `user-facing-writing.md` 自查；`UNRELEASED.md` 里属于这次修复的条目移过去，其余保留。
5. **改版本号、提交、打标签、发布**：同 `sdd-release` 第 4–8 步——`npm version X.Y.Z --no-git-tag-version`，提交 `release: vX.Y.Z` 并推送、等 CI 绿；打标签前问用户；三平台构建成功后检查草稿附件与 `latest.json`（这一步不能省，它保证已安装的用户能收到这个修复）；公开发布前问用户（用户已明确说直接发布的除外）。
6. **发布后**：`latest.json` 能取到新版本；按 `sdd-release` 第 9 步清理本机打包产物，通知其他会话。

## 分支

`main` 上已经有不满足准入条件的未发布改动时，不要把它们夹带进修复版：从上个标签开 `hotfix/vX.Y.Z` 分支，只放这次修复，在分支上打标签发布；发布后把修复合回 `main`。分支的创建、合并方式先和用户确认。

## 省掉的（与 sdd-release 相比）

- 完整回归测试与逐项功能验收。
- 本机全平台 / universal 打包自测、手动触发 Build 工作流预跑（打标签后的构建本身会验证）。
- 应用内更新端到端实测、用上一版真实数据做升级演练（准入条件已排除迁移与更新链路改动）。

这些省掉的项不写成「已验证」；交付物里如实写明本次没做。

## 规则

- 发现改动超出准入条件，立即停下，告诉用户改走完整流程；不在快速通道里顺手做别的改动。
- 打标签、公开发布前问用户；删除或挪动已推送的标签由用户亲自执行。
- 私钥规则、提交作者与署名同 `sdd-release`。

## 输出形态

```text
版本：vX.Y.Z（上一版 vX.Y.Z-1；hotfix）
问题：<用户碰到的现象> → 原因：<一句话> → 修复：<改了什么，path>
准入：迁移 无 | 更新/构建链路 未触达 | 依赖 未升级 | main 无其他未发布改动 / 走 hotfix 分支
门禁：verify ✓ | CI ✓ | 不变量 ✓ | 回归测试 <名称> ✓ | 手测 <步骤> ✓ | 冒烟 ✓
构建：mac ✓ win ✓ linux ✓ → 草稿附件 <n> 个 ✓；latest.json ✓
发布：已发布 / 待用户发布；发布后 latest.json ✓
本次未做：完整回归、更新链路实测、<…>
```

## 完成条件

- 缺陷有回归测试（或写明的手测步骤）且通过；verify 与 CI 全绿
- 修复版已发布（或明确等待用户发布），`latest.json` 已核对
- 交付物写明本次省掉了哪些验证
