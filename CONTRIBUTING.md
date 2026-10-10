# 参与开发

欢迎提交 issue 和 pull request，中英文均可（Issues and PRs in English are welcome）。

## 开始之前

| 类型 | 方式 |
|---|---|
| 报告问题 | 在 [Issues](https://github.com/abbish/pindu/issues) 中说明系统版本、操作步骤、期望结果与实际结果，并尽量附上「设置 → 通用 → 诊断」中的相关日志（日志不包含 API Key） |
| 新功能 | 先创建 issue，说明要解决的学习场景，确定方向后再实现 |
| 安全问题 | 请勿公开提交，见 [SECURITY.md](./SECURITY.md) |

## 开发环境

### 系统工具

| 系统 | 需要安装 |
|---|---|
| 全部 | [Git](https://git-scm.com)、[Node.js](https://nodejs.org)（版本见 `.nvmrc`）、[rustup](https://rustup.rs)（Rust 版本见 `rust-toolchain.toml`，首次编译时自动安装）、Python 3、bash |
| macOS | Xcode 命令行工具：`xcode-select --install` |
| Windows | [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（勾选「使用 C++ 的桌面开发」）、WebView2（Windows 10/11 通常已自带）、Git Bash 或 WSL（用于运行 `npm run verify`） |
| Linux | WebKitGTK 4.1 等系统库，见下文 |

各工具的用途：

| 工具 | 用途 |
|---|---|
| Node.js | 前端与 agent 的测试使用 `node --test` 直接运行 `.ts` 文件，依赖 Node 内置的类型剥离 |
| Python 3 | `npm run verify` 中的 SQL、IPC 契约、类型同步等静态检查 |
| bash | 运行 `npm run verify` |

本地与 CI 使用同一套版本：Rust 由仓库根目录的 `rust-toolchain.toml` 指定，Node.js 由 `.nvmrc` 指定（可用 nvm / fnm 等自动切换），npm 依赖与 Bun 由 `package.json` 与锁文件固定。升级工具链时只改这些文件，CI 随之生效。

内置 AI 助手由 [Bun](https://bun.sh) 编译为单个可执行文件。Bun 作为 npm 依赖自动下载，无需单独安装。

Linux 系统库：

```bash
# Debian / Ubuntu
sudo apt update && sudo apt install -y build-essential curl wget file pkg-config libssl-dev libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev
# Fedora
sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file libxdo-devel librsvg2-devel pkgconf-pkg-config && sudo dnf group install -y "c-development"
# Arch
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl xdotool librsvg pkgconf
```

视频处理使用随应用分发的 ffmpeg，由 `npm run ffmpeg:prepare` 从固定版本的源码编译（`tauri:dev`、`verify`、`package` 会自动调用）。编译需要 meson、ninja、pkg-config，x86 平台还需要 nasm。

### 获取代码并启动

```bash
git clone https://github.com/abbish/pindu.git
cd pindu
npm install
npm run agent:install   # 内置 AI 助手（agent sidecar）的依赖
npm run tauri:dev       # 开发模式（会先编译 sidecar）
```

开发模式（调试构建）使用独立的数据目录 `com.redlark.pindu-app-dev`，与安装版的 `com.redlark.pindu-app` 互不影响。如需使用指定的数据（测试、演示），可设置环境变量 `PINDU_DATA_DIR=<目录>` 后启动。

## 本地打包

| 系统 | 命令 |
|---|---|
| macOS / Linux | `./build.sh` |
| Windows | 运行 `build.cmd` |
| 任意系统 | `npm run package`；`npm run package:check` 只检查环境并列出缺失项 |

脚本依次执行：检查环境 → 安装依赖 → 编译 AI 助手 → 准备 ffmpeg → 构建应用 → 将安装包复制到 `release/<版本>-<平台>/`。首次构建需要编译全部 Rust 依赖，约需 5–15 分钟。

- 只能构建当前系统的安装包。
- 本机构建的安装包可以直接打开；复制到其他电脑时，会被系统视为未签名应用。
- 本地构建没有更新签名私钥，不生成更新包，但仍可检查并安装官方发布的更新（安装后即为官方版本）。正式发布由 GitHub Actions 完成，流程见 [docs/RELEASING.md](./docs/RELEASING.md)。

### 打包选项

`./build.sh`、`build.cmd` 与 `npm run package -- …` 接受相同的参数：

| 选项 | 作用 |
|---|---|
| `--target <平台>` | 目标平台：`mac-universal`（同时支持 Apple 芯片与 Intel）、`mac-arm`、`mac-intel`、`win`、`win-arm`、`linux`、`linux-arm` |
| `--bundles <格式>` | 安装包格式，逗号分隔：macOS `app,dmg`；Windows `nsis,msi`；Linux `deb,rpm,appimage` |
| `--no-bundle` | 只编译可执行文件，不生成安装包 |
| `--debug` | 调试构建：编译更快，带开发者工具，使用独立的 `com.redlark.pindu-app-dev` 数据目录 |
| `--clean` | 清理编译缓存后重新构建 |
| `--skip-install` | 跳过依赖安装 |

### 常见构建问题

**依赖下载缓慢或失败**

构建需要从 npm、crates.io 和 GitHub 下载依赖，可改用国内镜像：

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

**生成某种安装包失败**

dmg、AppImage 与 Windows 安装器依赖额外工具。失败时可改用其他格式：macOS 使用 `--bundles app`，Linux 使用 `--bundles deb` 或 `rpm`，Windows 使用 `--bundles nsis`。

**编译报错**

先执行 `rustup update` 更新 Rust，再使用 `--clean` 重新构建。

## 常用命令

```bash
npm run verify              # 提交前必须通过：静态检查、tsc、ESLint 棘轮、前端测试、cargo fmt/check/clippy/test
npm run verify -- --quick   # 跳过 clippy 与 cargo test，适合只改前端时使用
npm run type-check          # tsc
npm test                    # 前端纯函数测试（src/**/*.test.ts）
npm run agent:test          # agent 工具测试
cd src-tauri && cargo test  # 后端测试（内存 SQLite）
```

完整命令见 [CLAUDE.md §2](./CLAUDE.md#2-常用命令)。

## 代码结构

```
src/            前端：React 19 + shadcn/ui + Tailwind v4（页面、服务层、类型）
src-tauri/      后端：Rust（handlers → services → repositories）、SQLite 迁移、提示词
agent/          内置 AI 助手（pi RPC sidecar 与 RedLark 工具），编译为单个可执行文件随应用分发
shared/         前端与 agent 共用的代码与数据（词形库）
scripts/        构建、验证与静态检查脚本
docs/           设计文档、发布流程、日志与命名规范、README 截图
```

[CLAUDE.md](./CLAUDE.md) 是项目的工程说明，涵盖分层、命令归属、数据表、AI 任务与前端约定，内容与代码现状保持一致。它同时是 AI 编码助手（Claude Code）的入口，`.claude/skills/` 中有配套的开发流程。

## 开发约定

以下规则由脚本或 hook 检查，违反会导致 `verify` 失败或评审不通过。

### 数据库

- **迁移只增不改**：
  - 表结构变更一律新建 `src-tauri/migrations/NNN_xxx.sql`，序号连续。
  - 提交前运行 `python3 scripts/check-release-invariants.py --update`，将新迁移登记到 `src-tauri/migrations.lock`。
  - 已登记的迁移不得修改：用户数据库记录了每个迁移的校验和，修改后会导致升级被拒绝，CI 也会失败。
- **标识不变**：应用标识 `com.redlark.pindu-app` 与数据库文件名 `vocabulary.db` 不得修改，数据目录依据二者定位。
- **兼容已有数据**：不得以删库重建解决问题。SQLite 修改列时，按“建新表 → 复制数据 → 删除旧表 → 重命名”的步骤进行。
- 细则见 `.claude/skills/deliver-backend-rust/references/sqlx-migration-standards.md`。

### 后端（Rust）

- 三层结构：handler 只处理参数与日志，业务逻辑在 service，SQL 只出现在 repository。
- 命令返回 `AppResult<T>`；新命令必须在 `src-tauri/src/lib.rs` 的 `generate_handler!` 中注册。
- 一个操作写入多张表时，在 service 中开启事务。
- 代码经 `cargo fmt` 格式化，`cargo clippy` 零警告。

### 前后端契约

- 前端 `invoke` 参数使用 camelCase，Rust 使用 snake_case。
- TS 类型字段名与 Rust 序列化结果一致，由 `scripts/check-type-sync.py` 检查。

### 前端

- UI 只使用 `src/components/ui/` 中的 shadcn/ui 原语与 Tailwind 类；颜色只使用语义 token（如 `bg-primary`），不使用 CSS Modules 或硬编码色值。
- 服务层始终返回 `ApiResult<T>`，不抛出异常，调用方判断 `success`。
- 时间只经 `src/utils/datetime.ts` 解析与展示：存储使用 UTC，展示使用本地时区。
- 禁止使用 `console.log`。ESLint 采用棘轮机制，warning 数量只减不增。

### AI 功能

- 新的大模型能力一律实现为 agent 任务：
  - 提示词放在 `src-tauri/src/prompts/`；
  - 结构化结果经 `submit_*` 工具交付；
  - Rust 侧按输入再次校验。
- 可由代码确定的工作（计数、日期、格式校验）不交给模型。
- 修改提示词前后，使用 `agent/eval/` 进行对比评测。

### 安全

- API Key 不得出现在返回前端的列表类型或日志中。
- 不得提交 `.env`、数据库文件或任何密钥。

## 提交与 Pull Request

1. 从 `main` 创建分支，例如 `feat/word-export`、`fix/calendar-locked`。
2. 每个 PR 只处理一件事。涉及表结构、命令签名或提示词的改动，请在描述中注明。
3. 提交前运行 `npm run verify` 并确保全部通过。涉及界面的改动，请用 `npm run tauri:dev` 验证相关流程，并附上截图。
4. 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，描述可使用中文：

   ```
   feat(passage): 导入材料支持 epub
   fix(calendar): 并发同步复习时不再报“数据正忙”
   docs: 补充 Linux 构建依赖
   ```

5. 修改架构、命令或目录时，同步更新 `CLAUDE.md` 的对应章节。
6. 用户可感知的改动（新功能、行为变化、问题修复），在 `docs/releases/UNRELEASED.md` 中添加一条说明，发布时将汇总为该版本的更新说明。说明面向普通用户：写用户能感知的变化，不写文件路径、组件名、实现机制等技术细节（规约见 `.claude/skills/sdd-work/references/user-facing-writing.md`）。

提交即表示你同意以 [MIT 许可证](./LICENSE) 发布你的贡献。
