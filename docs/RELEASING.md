# 发布新版本

给维护者看的发版流程。用户怎么安装、怎么更新见 [INSTALL.md](../INSTALL.md)。

## 一次发版要做的事

1. **确认 main 是绿的**：最新提交的 CI 全部通过。
2. **发布前整理**：
   - 对照 `docs/releases/UNRELEASED.md`，把 README（中英文）、INSTALL.md、SECURITY.md 改成和这一版一致：功能、界面上的叫法、设置在哪里。
   - 界面变过的截图重截（`docs/screenshots/`，用演示数据，原文件名覆盖）。
   - 本机打一个正式安装包（`npm run package`），用旧版数据的副本打开，实际用一遍：数据都在、AI 任务能跑、视频能导入、能朗读；再打开一次只会回到已有窗口。
   - 升级过 Tauri / 更新插件，或者改过更新、打包流程时，按 `.claude/skills/sdd-verify/references/release-and-update-verification.md` 第 3 节测一遍应用内更新（签名不对不装、签名正确能装好重启）。
   这些改动先提交，下一步要求 main 是干净且绿的。
3. **改版本号**：只改 `package.json`（应用版本取自这里，`tauri.conf.json` 引用它）。
   ```bash
   npm version 0.2.0 --no-git-tag-version   # 同时更新 package-lock.json
   ```
   版本号只能往上走：应用内更新只会提示比当前版本高的版本。
4. **写更新说明**：平时每个用户能感知到的改动，都已经在 `docs/releases/UNRELEASED.md` 里记了一行。发版时把它整理成 `docs/releases/v0.2.0.md`，用用户看得懂的话写，然后清空 UNRELEASED.md、只留标题。它会同时出现在 Release 页面和应用里「更新内容」的弹窗中。没有这个文件时，Release 页面用 GitHub 自动生成的提交列表，应用里只显示一句链接。
5. **提交并打标签**：
   ```bash
   git commit -am "release: v0.2.0"
   git tag -a v0.2.0 -m "拼读 v0.2.0"
   git push origin main v0.2.0
   ```
6. **等构建**：标签会触发 `.github/workflows/build.yml`。它在 macOS（universal）和 Windows 上各构建一次（2026-10-13 起只支持这两个系统，不再出 Linux 版），用更新私钥给更新包签名，然后汇总成一个 **Release 草稿**，附件包括各系统的安装包、更新包、`.sig` 签名和 `latest.json`。标签和 `package.json` 版本不一致时这一步会失败。
7. **检查草稿**：在 Releases 页面打开草稿，至少下载一个安装包装上试试。确认附件里有 `latest.json`，`platforms` 里 darwin-aarch64、darwin-x86_64、windows-x86_64 三项都有 `url` 和 `signature`（没有 linux-x86_64：已装 Linux 版的用户检查更新时找不到对应的包，不会再收到更新）。
8. **发布**：点「Publish release」。发布之后，`releases/latest/download/latest.json` 才会指向这个版本，已安装的应用在 24 小时内（或用户手动检查时）就会收到提示。草稿不会被发现。
9. **清理本机**：删掉本机打包留下的 `release/` 和 `src-tauri/target/**/release/bundle/`，推出挂载的 dmg。它们和正式版用同一个 identifier、版本号也一样，macOS 可能从启动台打开的是这些旧包，看起来就像「新版本还是老界面」。

## 更新签名私钥

- 公钥写在 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，随应用分发。
- 私钥和它的密码在仓库 Secrets 里：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。维护者手里另有离线备份。
- **私钥不能丢**。丢了就没法再给已安装的应用签发更新，所有用户只能手动下载新安装包重装一次。
- 需要换钥匙时，用旧私钥签发一个内置新公钥的版本，等用户都更新到这一版，之后再改用新私钥签名。

## 发错了怎么办

应用内更新只往高版本走，已经更新到问题版本的用户不会被「降级」回去。修复方法是尽快发一个版本号更高的修复版。在那之前，可以把有问题的 Release 改回草稿（或删除），这样还没更新的用户就不会再收到它。

数据库方面，每次升级前应用都会自动备份（见 INSTALL.md 第 4 节）。新增迁移要守的规则见 `CLAUDE.md` §7.1：已发布的迁移不能改，`scripts/check-release-invariants.py` 会在 CI 里检查。
