# 安装「拼读」

本项目**不提供现成的安装包**：应用没有做开发者签名，请在自己的电脑上构建，一条命令即可生成安装包。
整个过程大约是：装好工具（一次性）→ 下载源码 → 运行构建脚本 → 安装 → 在应用里填好 AI 服务的 API Key。

> 想参与开发而不是只安装使用？看 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 1. 准备工具（只需一次）

| 系统 | 需要安装 |
|---|---|
| 全部 | [Git](https://git-scm.com) · [Node.js](https://nodejs.org) 20 或更高（选 LTS）· [Rust](https://rustup.rs)（stable） |
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

内置 AI 助手用 [Bun](https://bun.sh) 编译成单文件，Bun 会作为 npm 依赖自动下载，不需要单独安装。

## 2. 下载源码

```bash
git clone https://github.com/abbish/redlark.git
cd redlark
```

也可以在 GitHub 页面点 **Code → Download ZIP** 下载后解压。

不确定工具装全了没有，可以先检查（不会构建任何东西）：

```bash
npm run package:check        # 或 ./build.sh --check / build.cmd --check
```

缺什么会逐项列出，并给出安装命令。

## 3. 一键构建

在项目目录里运行：

| 系统 | 命令 |
|---|---|
| macOS / Linux | `./build.sh` |
| Windows | 双击 `build.cmd`，或在命令行运行 `build.cmd` |
| 任意系统 | `npm run package` |

脚本会依次：检查环境 → 安装依赖 → 编译 AI 助手 → 构建应用 → 把安装包复制到 `release/<版本>-<平台>/`。
第一次构建需要编译全部 Rust 依赖，大约 5–15 分钟；之后再构建会快很多。

## 4. 安装

| 系统 | 产物 | 安装方式 |
|---|---|---|
| macOS | `.dmg`、`.app` | 打开 dmg，把「拼读」拖进「应用程序」 |
| Windows | `*-setup.exe` | 双击安装 |
| Debian / Ubuntu | `.deb`、`.AppImage` | `sudo apt install ./xxx.deb`，或 `chmod +x xxx.AppImage` 后直接运行 |
| Fedora 等 | `.rpm`、`.AppImage` | `sudo dnf install ./xxx.rpm` |

在本机构建的安装包可以直接打开。**拷到别的电脑上使用**时，系统会因为没有签名而拦截：

- **macOS**：提示“无法验证开发者”时，在「系统设置 → 隐私与安全性」底部点「仍要打开」；或执行一次
  `xattr -dr com.apple.quarantine "/Applications/拼读.app"`。
- **Windows**：SmartScreen 提示时点「更多信息 → 仍要运行」。

## 5. 首次使用：配置 AI 与发音

应用本身不带任何账号或密钥。手动建单词本、按计划练习、日历与统计不需要联网；
拼读分析、例句、讲解、AI 写短文、导入材料翻译等功能需要你自己的大模型 API Key，单词和句子发音需要语音合成服务。

**AI 模型**（设置 → AI 模型）

1. 选一个提供商：内置了 OpenRouter、MiniMax、月之暗面（Kimi）、DeepSeek，也可以从目录里添加其它提供商，或填任意 OpenAI 兼容接口的地址。
2. 填入该提供商的 API Key，点「同步模型」读取可用模型并添加。
3. 把一个模型设为默认，点「测试」确认能连通。
4. 可选：在「设置 → AI 助手」给不同任务（拼读分析、讲解、短文等）指定不同模型，并按学习者（小学生 / 中学生 / 成人）调整讲解风格。

**语音合成**（设置 → 语音合成）

发音使用[火山引擎豆包语音合成](https://www.volcengine.com/product/tts)。在火山引擎控制台开通后，填入 API Key（或 AppID + Access Token），选一个英文音色并试听。
合成过的音频会缓存在本机，同一个词不会重复请求。

## 6. 构建选项

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

## 7. 升级与卸载

**升级**：拉取最新代码后重新构建、覆盖安装即可。数据库会在启动时自动升级，原有数据保留。

```bash
git pull
./build.sh        # Windows：build.cmd
```

**数据位置**：单词本、学习记录、设置（含 API Key）都保存在本机，重新安装或升级不会丢失：

| 系统 | 目录 |
|---|---|
| macOS | `~/Library/Application Support/com.redlark.pindu-app/` |
| Windows | `%APPDATA%\com.redlark.pindu-app\` |
| Linux | `~/.local/share/com.redlark.pindu-app/` |

其中 `vocabulary.db` 是数据库，`logs/` 是运行日志。想备份就复制整个目录（先退出应用）。
发音音频缓存在系统缓存目录（macOS `~/Library/Caches/com.redlark.pindu-app/`，Windows `%LOCALAPPDATA%\com.redlark.pindu-app\`，Linux `~/.cache/com.redlark.pindu-app/`），删掉只会让发音重新下载。

**卸载**：按系统常规方式删除应用；如果也不要数据了，再删除上面的数据目录。

## 8. 常见问题

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

**AI 功能报错或一直没有结果。** 到「设置 → AI 模型」对默认模型点「测试」，确认 API Key 和余额；
遇到限流（429）可以在「设置 → AI 助手」调小批量分析的每批词数和并发数。更多细节在「设置 → 通用 → 系统日志」。

**还是解决不了。** 到 [Issues](https://github.com/abbish/redlark/issues) 反馈，附上系统版本，以及构建命令的完整输出或系统日志（日志不会记录 API Key）。
