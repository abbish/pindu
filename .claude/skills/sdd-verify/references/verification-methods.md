# RedLark 验证方法

本文件是验证拓扑、AI 输出问题准入、采样与停止条件的 owner。`sdd-verify`、`sdd-analyze`、`harness-regression-curation` 引用它，不复制。

## 验证环境矩阵

不是每个环境都能跑每一层。先确认自己在哪，再选层；跑不了的层写进“未运行项”，不得声称通过。

| 检查 | 入口 | 开发者 Mac | agent 环境（网络受限，无 Rust 依赖） |
| --- | --- | --- | --- |
| Rust 格式 / 编译 / lint | `cargo fmt --check`、`cargo check`、`cargo clippy --all-targets` | ✓ | ✗ |
| Rust 测试 | `cargo test`（内存 SQLite，见 `deliver-backend-rust/references/rust-test-standard.md`） | ✓ | ✗ |
| SQL 对真实 schema | `python3 scripts/check-sql.py` | ✓ | ✓ |
| 迁移终态 schema | `python3 scripts/schema-snapshot.py [--table t]` | ✓ | ✓ |
| IPC contract 静态对账 | `python3 scripts/check-ipc-contract.py` | ✓ | ✓ |
| TS 类型 | `npm run type-check` | ✓ | ✓（`node node_modules/typescript/bin/tsc --noEmit`） |
| ESLint + 棘轮 | `npm run lint` / `node scripts/lint-ratchet.mjs` | ✓ | ✓ |
| 前端纯函数测试 | `npm test`（`node --test`，零依赖） | ✓ | ✓ |
| 运行时 / UI | `npm run tauri:dev` | ✓ | ✗ |

**一键入口**：`bash scripts/verify.sh [--quick]` 依次运行上表中当前机器可运行的所有静态与测试层，输出写入 `.claude/work/<work-id>/logs/verify-<时间>.log`（无 work item 时写 `.claude/logs/`）。agent 无法编译时，在检查点请用户在 Mac 上运行它，再读日志。

## 验证拓扑

| 层 | 证明什么 | 成本 |
| --- | --- | --- |
| 静态（编译、clippy、tsc、ESLint 棘轮、check-sql、check-ipc-contract） | 类型一致、命令注册与参数映射、SQL 引用的表/列存在、lint 不回退 | 秒级，默认必跑 |
| Rust 测试 | service 用例的最终写入、事务原子性、聚合口径、错误 wire 形状 | 秒~分钟，改到对应逻辑必跑 |
| 前端纯函数测试 | `utils/`、状态转换规则、路由参数构造 | 秒级 |
| 迁移 | 空库首跑、真实库副本、终态 schema | 分钟级，改迁移必跑 |
| AI 语义 | 提示词改动后输出仍可解析、关键字段齐全 | 需 API Key，按风险 |
| 桌面 UI | 导航、三态、交互、主题 | 人工，只在用户可见变化时 |

选层原则：从最接近改动、成本最低的层开始；上一层证据已回答接受条件就停止。

**基线说明**：lint 与 clippy 的“基线”以 `verify.sh` 首次运行结果为准并由棘轮保持不回退；在没有日志证据之前，不声称“零警告”。

## 确定性 Contract

硬断言的来源：命令签名、serde 形状、迁移终态 schema、`unified_status` 转换表、统计口径的 SQL、`ApiResult` 形状。失败即缺陷（或测试漂移）。

## AI 语义

### 问题准入：先看实质影响，再查原因

AI 输出（拼读分析、单词提取、日程规划）天然有波动。只有以下情形才进入“问题”：

1. **解析失败**：返回不是合法 JSON、缺少解析结构要求的字段、类型不符 → 工程缺陷（提示词输出约束或清洗逻辑）。
2. **业务不变量被破坏**：规划日程的单词总数 ≠ 输入单词数、日期越界、复习出现在首次学习之前、音标/音节为空串 → 工程缺陷或提示词缺陷。
3. **用户决定受损**：拼读规则明显错误、词性标错导致筛选错、含义与单词不符 → 质量缺陷，需要样本支撑。
4. **措辞、顺序、解释长短不同** → 可接受波动，不是缺陷，不沉淀为断言。

### 采样与结论

- 一次运行 = smoke，只证明“这次能跑通”。
- 声称“修复了解析失败”：固定导致失败的输入重跑 ≥3 次全部可解析。
- 声称“质量提升”：同一组输入 before/after 各 ≥3 次，由人或评审标准判定，不由字数/条目数判定。
- 不同 Provider/模型之间的差异先排除配置（base_url、model_id、temperature、max_tokens）再归因提示词。

### 停止条件

证据已回答接受条件；或剩余不确定性不改变当前决定；或继续采样的成本高于风险。不追求零瑕疵。

## 桌面 UI

走查清单（只记录与本批相关的项）：

- 导航：进入 / 返回 / Breadcrumb 正确；`onNavigate` 参数齐全（如 `planId`、`scheduleId`）。
- 三态：初次 loading、空数据、`success === false` 的错误态都保留同一页面信息结构；错误不静默成空态。
- 数据：界面数字与 sqlite3 手查一致（日历、统计、单词本计数）。
- 主题：light/dark 切换无硬编码颜色漏出。
- 日志：`app.log` 中对应 `api_request` / `api_response` 成对且 success。
- 窗口：最小 1200×800 下布局不溢出。

证据形式：截图 + `app.log` 片段；描述“看起来正常”不算证据。

无 Tauri 环境时的组件截图（agent 可自行完成，适合弹窗 / 表单的多步状态）：
1. 临时入口：项目根 `preview-xxx.html` + `src/__preview_xxx__.tsx`，导入 `styles/app.css`，用 `TooltipProvider` / `ToastProvider` 包住组件；把要用到的 service 单例方法替换成返回假数据的函数（`invoke` 在浏览器里不可用）；`?theme=dark` 时设 `data-theme="dark"`。
2. `npx vite --port 5199 --strictPort` 后台启动；在 scratchpad 里装 `playwright-core`，`executablePath` 指向本机 `~/Library/Caches/ms-playwright/chromium_headless_shell-*/…/chrome-headless-shell`，按角色 / 标签点击走完各步并截图，亮 / 暗各一套。
3. 结束后删除临时入口文件并停掉 vite；截图只证明布局与交互，数据正确性仍要 `tauri:dev` + 真实后端。

## 证据边界

- `cargo check` 通过不证明命令已注册；`tsc` 通过不证明字段名对得上。
- 空库迁移通过不证明老库迁移通过。
- mock 的 AI 响应通过不证明真实模型输出可解析。
- 一位用户一台机器走查通过不证明跨平台（Windows/Linux 构建与应用内更新见 `release-and-update-verification.md`）。
- 没有实际命令、可复查产物或等价权威证据时，不得声称验证通过。
