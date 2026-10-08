---
name: sdd-release
description: "发布新版本（仅显式调用 /sdd-release）：确定版本号、发布前门禁（main 的 CI 绿、发行不变量、迁移只增、升级路径）、把 docs/releases/UNRELEASED.md 定稿为 vX.Y.Z.md、改版本号、打标签触发 CI、检查 Release 草稿（三平台安装包 + 签名更新包 + latest.json）、交用户发布、发布后核对与出问题时的补救。不自动触发；不代替 sdd-verify 的功能验收；本地打包自测用 npm run package（见 CONTRIBUTING）。Keywords: release, publish, tag, version bump, 发版, 发布, 打标签, Release 草稿, latest.json."
disable-model-invocation: true
---

# SDD Release

本 Skill 只在用户显式 `/sdd-release` 时进入。用户从 GitHub Releases 下载安装包、之后经应用内更新升级，所以每次发布直接影响所有已安装用户：数据要能升级、更新要能被发现并验签安装。

人看的流程说明在 `docs/RELEASING.md`（发版步骤、私钥管理、发错了怎么办），本 Skill 不复述，只定义 agent 的门禁、动作边界和交付物。

## 按需读取

- 发版步骤与私钥：`docs/RELEASING.md`。
- 有新迁移：`../deliver-backend-rust/references/sqlx-migration-standards.md`（Verify 节）。
- 这次改了更新、构建或发版链路（`tauri.conf.json`、`build.yml`、`package.mjs`、`release-assets.mjs`、`handlers/updater.rs`）：`../sdd-verify/references/release-and-update-verification.md`，发布前必须先按它实测一遍。

## 输入

- 上一个发布标签（`git describe --tags --abbrev=0`）到 `main` HEAD 的提交
- `docs/releases/UNRELEASED.md`（各次改动累积的用户可见变化）
- `main` 最新提交的 CI 结果（`gh run list --branch main`）

## 执行

1. **定版本号**（问用户确认）：`0.x` 阶段新功能升次版本（0.1 → 0.2），只有修复升修订号（0.1.0 → 0.1.1）。版本号只能往上走，应用内更新只认更高的版本。
2. **发布前门禁**，任一不满足就停下、回 `sdd-work`：
   - `main` 最新提交的 CI 全绿，工作树干净（`git status --short`）。
   - `python3 scripts/check-release-invariants.py` 通过：identifier、库文件名、更新公钥与地址不变，迁移只增且都已登记。
   - `git diff <上个标签>..HEAD --stat src-tauri/migrations/` 只有新增；有新增时，`startup::tests` 的升级用例通过，并用上一版的真实库副本启动一次（`PINDU_DATA_DIR` 指向副本），确认先备份再升级、数据都在。
   - 改动涉及更新或发版链路时，已按 `release-and-update-verification.md` 实测并留了证据。
3. **定稿发布说明**：把 `docs/releases/UNRELEASED.md` 的内容整理成 `docs/releases/vX.Y.Z.md`，用作者口吻、面向用户写（改了什么、有什么要注意），然后清空 UNRELEASED.md，只留标题。这份说明会出现在 Release 页面和应用的「更新内容」弹窗里。
4. **改版本号并提交**：`npm version X.Y.Z --no-git-tag-version`（同时改 `package.json` 和 `package-lock.json`；`tauri.conf.json` 引用 `package.json`，`Cargo.toml` 的版本不影响应用），提交 `release: vX.Y.Z` 并推送 `main`，等这次推送的 CI 变绿。
5. **打标签**（问用户确认后再执行）：`git tag -a vX.Y.Z -m "拼读 vX.Y.Z" && git push origin vX.Y.Z`。构建会在三个系统上各跑一次，大约 15–20 分钟，用后台任务等结果，不要轮询。
6. **检查 Release 草稿**：
   - 三个系统的构建都成功，`release` 任务也成功。有一路失败时不会生成草稿：查日志、修好，先在本机复现验证，再推送修复，最后请用户挪标签（删除远端标签属于破坏性操作，由用户亲自执行）。
   - `gh release view vX.Y.Z --json assets,isDraft`：确认是草稿，附件齐全（mac `universal.dmg`、`universal.app.tar.gz(.sig)`，win `x64-setup.exe(.sig)`，linux `amd64.AppImage(.sig)`、`.deb`、`.rpm`，以及 `latest.json`）。
   - 下载 `latest.json`：`version` 不带 v；`platforms` 包含 darwin-aarch64、darwin-x86_64、windows-x86_64、linux-x86_64，每项都有 `url` 和 `signature`；`url` 指向本标签下的附件。
7. **交用户发布**：请用户在网页上检查草稿后点「Publish release」。公开发布由用户决定，agent 不代为发布。
8. **发布后核对**：
   - `curl -sL https://github.com/abbish/pindu/releases/latest/download/latest.json` 能取到新版本。
   - 用上一版的已安装应用「检查更新」，能看到提示（条件不允许时在交付物里写明未验证）。
9. **出问题时**：应用内更新不会降级。补救办法是尽快发一个版本号更高的修复版；在那之前把有问题的 Release 改回草稿，阻止还没更新的用户继续升级（见 `docs/RELEASING.md`「发错了怎么办」）。

## 规则

- 不在发布流程里顺手改功能或修 bug；发现问题就停下回 `sdd-work`，修好后从第 2 步重来。
- 打标签、公开发布前都先问用户；删除或挪动已推送的标签由用户亲自执行。
- 私钥只存在于 GitHub Secrets 和维护者的离线备份里：不读取、不打印、不复制私钥文件内容。
- 某个平台没有实际运行验证过时，在交付物和发布说明里写明「未验证」，不笼统说「全平台可用」。
- 提交作者和署名遵循仓库约定（见 `CLAUDE.md` 与记忆中的提交规则）。

## 输出形态

```text
版本：vX.Y.Z（上一版 vA.B.C；类型：功能 / 修复）
门禁：CI ✓ | 不变量 ✓ | 迁移 只增 <NNN..MMM> / 无 | 升级路径 ✓ / 不涉及 | 更新链路实测 ✓ / 不涉及
发布说明：docs/releases/vX.Y.Z.md（来自 UNRELEASED.md，<n> 条）
构建：mac ✓ win ✓ linux ✓ → Release 草稿 <url>
草稿检查：附件 <n> 个 ✓；latest.json 平台 4 个、url/signature ✓
发布：用户已发布 / 待用户发布
发布后：latest.json 可取 ✓；旧版检查更新 ✓ / 未验证（原因）
未验证项：<…>
```

## 完成条件

- 草稿经检查无误，用户已发布（或明确等待用户发布）
- 发布后的 `latest.json` 已核对；未验证项已写明
- `UNRELEASED.md` 已清空，`vX.Y.Z.md` 已提交
