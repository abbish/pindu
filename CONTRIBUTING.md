# 参与开发

欢迎提 issue 和 PR。中文或英文都可以（Issues and PRs in English are welcome）。

## 开始之前

- **报告问题**：到 [Issues](https://github.com/abbish/pindu/issues) 写清系统版本、操作步骤、期望结果和实际结果；能附上「设置 → 通用 → 系统日志」里的相关几行更好（日志不含 API Key）。
- **提新功能**：建议先开 issue 说明要解决的学习场景，讨论好方向再动手，避免白做。
- **安全问题**：不要公开提 issue，见 [SECURITY.md](./SECURITY.md)。

## 开发环境

除了 [INSTALL.md](./INSTALL.md#1-准备工具只需一次) 里构建需要的工具，开发还需要：

| 工具 | 用途 |
|---|---|
| Node.js **22.18+**（推荐 24 LTS） | 前端与 agent 的测试直接用 `node --test` 跑 `.ts` 文件，依赖 Node 内置的类型剥离 |
| Python 3 | `npm run verify` 里的 SQL、IPC 契约、类型同步等静态检查 |
| bash | `npm run verify`；Windows 上用 Git Bash 或 WSL |

```bash
git clone https://github.com/abbish/pindu.git
cd pindu
npm install
npm run agent:install   # 内置 AI 助手（agent sidecar）的依赖
npm run tauri:dev       # 启动开发模式（会先编译 sidecar）
```

开发模式（调试构建）用单独的数据目录 `com.redlark.pindu-app-dev`，和安装版的 `com.redlark.pindu-app` 互不影响，开发中的迁移不会碰到你平时用的数据。想用一份指定的数据（测试、演示），设置环境变量 `PINDU_DATA_DIR=/某个目录` 再启动。

## 常用命令

```bash
npm run verify          # 提交前必跑：静态检查 + tsc + ESLint 棘轮 + 前端测试 + cargo fmt/check/clippy/test
npm run verify -- --quick   # 跳过 clippy 和 cargo test，改前端时更快
npm run type-check      # 只跑 tsc
npm test                # 前端纯函数测试（src/**/*.test.ts）
npm run agent:test      # agent 工具测试
cd src-tauri && cargo test   # 后端测试（内存 SQLite）
```

完整命令表见 [CLAUDE.md §2](./CLAUDE.md#2-常用命令)。

## 代码结构

```
src/            前端：React 19 + shadcn/ui + Tailwind v4；页面、服务层、类型
src-tauri/      后端：Rust（handlers → services → repositories）、SQLite 迁移、提示词
agent/          内置 AI 助手（pi RPC sidecar + RedLark 工具），编译成单文件随应用分发
scripts/        一键构建、验证与静态检查脚本
docs/           设计文档（agent-harness/ 内置 AI 助手、design/ 待实施方案）与 README 截图
```

[CLAUDE.md](./CLAUDE.md) 是这个项目的工程说明：分层、命令归属、数据库表、AI 任务、前端约定都在里面，并且描述的是代码的**当前真实状态**。它也是 AI 编码助手（Claude Code）的入口，`.claude/skills/` 里有配套的开发流程。不用 AI 助手也建议读一遍。

## 必须遵守的约定

这些规则有脚本或 hook 检查，违反会让 `verify` 失败或在评审时被打回：

**数据库**
- 迁移只增不改：表结构变化一律新建 `src-tauri/migrations/NNN_xxx.sql`（序号连续），绝不修改已有迁移。新迁移写好、提交前运行 `python3 scripts/check-release-invariants.py --update` 把它登记进 `src-tauri/migrations.lock`；已登记的迁移一旦改动，CI 就会失败，因为用户的库里记着每个迁移的校验和，改了会导致升级被拒绝。
- 应用标识 `com.redlark.pindu-app` 和数据库文件名 `vocabulary.db` 永远不改：数据目录是按它们定位的，改了用户就找不到原来的数据。
- 必须兼容已有用户数据，不能靠删库重建解决问题。SQLite 改列走“建新表 → 拷数据 → 删旧表 → 改名”。
- 细则：`.claude/skills/deliver-backend-rust/references/sqlx-migration-standards.md`。

**后端（Rust）**
- 三层：handler 只做参数和日志，业务在 service，SQL 只出现在 repository。
- 命令返回 `AppResult<T>`；新命令必须在 `src-tauri/src/lib.rs` 的 `generate_handler!` 里注册。
- 一个操作写多张表时在 service 开事务。
- `cargo fmt`，`cargo clippy` 零警告。

**前后端契约**
- 前端 `invoke` 参数用 camelCase，Rust 用 snake_case；TS 类型字段名与 Rust 序列化结果一致（`scripts/check-type-sync.py` 会查）。

**前端**
- UI 只用 `src/components/ui/` 里的 shadcn/ui 原语和 Tailwind 类，颜色只用语义 token（如 `bg-primary`），不写 CSS Modules 或硬编码色值。
- 服务层永远返回 `ApiResult<T>`、不抛异常，调用方判断 `success`。
- 时间只经 `src/utils/datetime.ts` 解析和展示（存储 UTC，展示本地时区）。
- 禁止 `console.log`；ESLint 采用棘轮，warning 只减不增。

**AI 功能**
- 新的大模型能力一律做成 agent 任务：提示词放 `src-tauri/src/prompts/`，结构化结果经 `submit_*` 工具交付，Rust 侧再按输入校验。
- 能用代码确定的事（计数、日期、格式校验）不交给模型。
- 改提示词前后用 `agent/eval/` 做对比。

**安全**
- API Key 不得出现在返回给前端的列表类型和日志里。
- 不要提交 `.env`、数据库文件或任何密钥。

## 提交与 Pull Request

1. 从 `main` 拉一个分支，例如 `feat/word-export`、`fix/calendar-locked`。
2. 一个 PR 只做一件事；涉及表结构、命令签名或提示词的改动在描述里写明。
3. 提交前跑 `npm run verify`，全部通过再推送。有界面改动的，用 `npm run tauri:dev` 手动走一遍相关流程，最好附截图。
4. 提交信息参考 [Conventional Commits](https://www.conventionalcommits.org/)，说明可以用中文：

   ```
   feat(passage): 导入材料支持 epub
   fix(calendar): 并发同步复习时不再报“数据正忙”
   docs: 补充 Linux 构建依赖
   ```

5. 改了架构、命令或目录的，同步更新 `CLAUDE.md` 的对应章节。

提交即表示你同意你的贡献以 [MIT 许可证](./LICENSE) 发布。
