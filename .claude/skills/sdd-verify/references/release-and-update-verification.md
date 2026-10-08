# 发布与更新链路的验证

改动触达下面任一处时，`sdd-verify` 必须按本文验证，`sdd-release` 发布前也要确认已经验证过：

- `src-tauri/tauri.conf.json`（identifier、版本、bundle、`plugins.updater`）
- `src-tauri/src/app_paths.rs`、`startup.rs`、`database/mod.rs`（数据目录、启动升级）
- `src-tauri/src/handlers/updater.rs`、`src/hooks/useUpdater.ts`、`src/components/UpdateBanner/`
- `scripts/package.mjs`、`scripts/release-assets.mjs`、`agent/scripts/build.mjs`、`.github/workflows/build.yml`

## 1. 确定性检查（每次都跑）

```bash
python3 scripts/check-release-invariants.py   # identifier / 库文件名 / 更新公钥与地址 / 迁移锁
cd src-tauri && cargo test startup             # 对账、备份、升级端到端
```

## 2. 本机打包（改了构建链路时）

在本机打改动影响到的那个目标的包，产物能打开即可：

```bash
node scripts/package.mjs --target mac-universal --bundles app,dmg   # universal 需要 rustup target add x86_64-apple-darwin
lipo -info "release/<版本>-universal-apple-darwin/拼读.app/Contents/MacOS/redlark-agent"  # 应同时有 x86_64 arm64
```

Windows、Linux 本机打不了，由 CI 的 Build 工作流验证：`gh workflow run Build`（手动触发只构建、不建 Release），用 `gh run download` 下载产物，检查文件名和 `.sig`。

v0.1.0 发版时踩过的坑（改构建链路时先对照）：

- macOS universal：tauri 会按两个架构各编译一次，`binaries/` 里要同时保留 `redlark-agent-aarch64-apple-darwin`、`-x86_64-apple-darwin` 和 lipo 后的 universal 版本，不能合并后删掉单架构文件。
- Windows：`node_modules/.bin` 里没有 `bun.exe`，sidecar 编译要用 `node_modules/bun/bin/bun.exe`。
- CI 的 clippy 可能比本机新，会多报警告（如 `result_large_err`）；推送后看 CI，不以本机 clippy 通过为准。
- 构建失败、需要把标签挪到修复提交时，删除 / 重推远端标签由用户亲自执行。

## 3. 应用内更新端到端（改了更新链路时）

目的：一个「旧版」能发现「新版」，签名不对时拒绝安装，签名正确时装好并以新版本启动。全部在临时目录里做，不碰用户的真实数据。

1. **新版更新包**（用维护者本机的私钥签名；私钥以文件路径的方式交给构建工具，不读取它的内容）：
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/pindu.key"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$HOME/.tauri/pindu.key.password")"
   npx tauri build --target aarch64-apple-darwin --bundles app \
     --config '{"version":"<比当前高的版本>","bundle":{"createUpdaterArtifacts":true,"macOS":{"signingIdentity":"-"}}}'
   ```
   把 `bundle/macos/拼读.app.tar.gz` 和 `.sig` 拷到临时的 `serve/` 目录。
2. **旧版**（当前版本，更新地址临时指向本机；这个配置只用于本次测试构建，不提交）：
   ```bash
   unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
   npx tauri build --target aarch64-apple-darwin --bundles app \
     --config '{"plugins":{"updater":{"endpoints":["http://127.0.0.1:8765/latest.json"],"dangerousInsecureTransportProtocol":true}},"bundle":{"macOS":{"signingIdentity":"-"}}}'
   ```
   把 `拼读.app` 拷到临时目录（安装更新时会原地替换它）。
3. **两份 latest.json**：一份用正确的 `.sig` 内容，一份把签名改坏。先用改坏的那份作为 `latest.json`，在 `serve/` 下启动 `python3 -m http.server 8765 --bind 127.0.0.1`。
4. **启动旧版**：`PINDU_DATA_DIR=<临时数据目录> "<临时目录>/拼读.app/Contents/MacOS/pindu-app"`。约 10 秒后顶栏会出现「新版本 … 可以更新了」。
   - 发布版只允许一个实例：测试期间提醒用户不要打开自己安装的拼读；也要先告诉其他会话。
   - 需要点击时请用户来点：自动点击可能落到用户的其他窗口上。
5. **反例**：点「立即更新」，预期提示「更新包的签名校验没有通过，为了安全没有安装」，`Info.plist` 版本不变。
6. **正例**：换成正确签名的 `latest.json`，在「设置 → 通用 → 更新」里点「检查更新」（重新读取签名），然后点「立即更新」、再点「立即重启」。
7. **证据**：
   - `PlistBuddy -c "Print CFBundleShortVersionString" <app>/Contents/Info.plist` 显示新版本；
   - `<临时数据目录>/logs/app.log` 依次出现 `install_update … SUCCESS`、`Restarting to finish update`、`Application starting up (v<新版本>)`；
   - `xattr <app>` 里没有 `com.apple.quarantine`（否则用户会再次看到「无法验证开发者」）。
8. 收尾：结束测试实例和本地 http 服务，并告诉其他会话。

## 4. 不能证明什么

- 本机只能测 macOS 的应用内更新；Windows（NSIS 安装器接管、关闭应用）和 Linux AppImage 的更新安装，要在对应系统上走一遍才算验证，否则写进未验证项。
- 本地 http 加 `dangerousInsecureTransportProtocol` 只用于测试；正式的更新地址是 https，由插件强制。
