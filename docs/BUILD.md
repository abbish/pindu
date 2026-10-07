# 在自己的电脑上构建「自然拼读」

应用没有做开发者签名，不提供现成的安装包。请按下面的步骤在自己的电脑上构建，一条命令就能生成安装包。

## 1. 准备工具（只需一次）

| 系统 | 需要安装 |
|---|---|
| 全部 | [Node.js](https://nodejs.org) 20 或更高（选 LTS）· [Rust](https://rustup.rs) |
| macOS | Xcode 命令行工具：`xcode-select --install` |
| Windows | [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选「使用 C++ 的桌面开发」；WebView2（Windows 10/11 通常已自带） |
| Linux | WebKitGTK 4.1 等系统库，见下方 |

Linux 系统库：

```bash
# Debian / Ubuntu
sudo apt update && sudo apt install -y build-essential curl wget file pkg-config libssl-dev libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev
# Fedora
sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file libxdo-devel librsvg2-devel pkgconf-pkg-config && sudo dnf group install -y "c-development"
# Arch
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl xdotool librsvg pkgconf
```

不确定装全了没有，可以先检查（不会构建任何东西）：

```bash
npm run package:check        # 或 ./build.sh --check / build.cmd --check
```

缺什么会逐项列出，并给出安装命令。

## 2. 一键构建

在项目目录里运行：

| 系统 | 命令 |
|---|---|
| macOS / Linux | `./build.sh` |
| Windows | 双击 `build.cmd`，或在命令行运行 `build.cmd` |
| 任意系统 | `npm run package` |

脚本会依次：检查环境 → 安装依赖 → 编译 AI 助手 → 构建应用 → 把安装包复制到 `release/<版本>-<平台>/`。
第一次构建需要编译全部 Rust 依赖，大约 5–15 分钟；之后再构建会快很多。

## 3. 安装

| 系统 | 产物 | 安装方式 |
|---|---|---|
| macOS | `.dmg`、`.app` | 打开 dmg，把「自然拼读」拖进「应用程序」 |
| Windows | `*-setup.exe` | 双击安装 |
| Debian / Ubuntu | `.deb`、`.AppImage` | `sudo apt install ./xxx.deb`，或 `chmod +x xxx.AppImage` 后直接运行 |
| Fedora 等 | `.rpm`、`.AppImage` | `sudo dnf install ./xxx.rpm` |

在本机构建的安装包可以直接打开。**拷到别的电脑上使用**时，系统会因为没有签名而拦截：

- **macOS**：提示“无法验证开发者”时，在「系统设置 → 隐私与安全性」底部点「仍要打开」；或执行一次
  `xattr -dr com.apple.quarantine "/Applications/自然拼读.app"`。
- **Windows**：SmartScreen 提示时点「更多信息 → 仍要运行」。

## 4. 常用选项

所有入口（`./build.sh`、`build.cmd`、`npm run package -- …`）参数相同：

| 选项 | 作用 |
|---|---|
| `--target mac-universal` | 同时支持 Apple 芯片与 Intel 的 Mac 包（还有 `mac-arm` / `mac-intel` / `win-arm`） |
| `--bundles app` | 指定安装包格式，逗号分隔：macOS `app,dmg`；Windows `nsis,msi`；Linux `deb,rpm,appimage` |
| `--no-bundle` | 只编译可执行文件，不打安装包 |
| `--debug` | 调试版：编译快，带开发者工具 |
| `--clean` | 清理编译缓存后重新构建（构建出错时再用） |
| `--skip-install` | 跳过依赖安装 |

只能构建当前系统的安装包：Mac 上构建 macOS 包，Windows 上构建 Windows 包，Linux 上构建 Linux 包。

## 5. 常见问题

**网络慢或下载失败。** 构建要从 npm、crates.io 和 GitHub 下载依赖，可以换用国内镜像：

```bash
# npm
npm config set registry https://registry.npmmirror.com
```

```toml
# Rust：写入 ~/.cargo/config.toml（Windows 为 %USERPROFILE%\.cargo\config.toml）
[source.crates-io]
replace-with = "rsproxy-sparse"
[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"
```

**生成某种安装包失败。** dmg、AppImage、Windows 安装器需要额外的工具，失败时换一种格式：
macOS 用 `--bundles app`，Linux 用 `--bundles deb`（或 `rpm`），Windows 用 `--bundles nsis`。

**编译报奇怪的错误。** 先更新 Rust：`rustup update`，再用 `--clean` 重新构建。

**数据放在哪里。** 应用数据（单词本、学习记录、设置）保存在本机，重新安装或升级不会丢失：
macOS `~/Library/Application Support/com.redlark.pindu-app/`，
Windows `%APPDATA%\com.redlark.pindu-app\`，
Linux `~/.local/share/com.redlark.pindu-app/`。
