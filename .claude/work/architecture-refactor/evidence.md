# 证据

## 检查点 1（自动化部分）— 2026-10-06，macOS 本机
- 命令：`bash scripts/verify.sh --work architecture-refactor`
- 首次：cargo fmt/check/clippy/test 失败，唯一编译错误是 `wordbook_repository` 旧测试（`description` 类型不对）；修复后 `test_find_all_empty` 与 001 种子数据冲突，改写为 `find_all_includes_newly_created_book`；全 crate 执行 `cargo fmt`。
- 结果：9/9 PASS（logs/verify-20261006-181512.log），共 16 个 Rust 测试，其中 B1/B2/B3 的错误 contract、暂停/恢复、今日日程、练习完成测试全部通过。
- 未覆盖：tauri:dev 手工走查（需用户）。

## B4 收尾 — 2026-10-06
| 改动 | 验证 | 结果 |
| --- | --- | --- |
| console.log/info/debug 清理（AST 脚本，只删父节点为代码块的语句；删除后变空的 if/useEffect/onClick 一并移除） | tsc；lint 棘轮 | no-console 183→3（DevTools 有意接管 console），any 95→93，基线已收紧 |
| `aiModelService` 模块级单例，替换 4 处组件内 `new AIModelService()` | tsc | 通过 |
| SettingsPage 拆分：页面 2405→124 行；`pages/settings/{AIModelSettings,TTSSettings,GeneralSettings,DataManagementSettings}.tsx`，JSX/处理函数按原行号逐字迁移（生成脚本 + 未迁移行逐条核对） | tsc、lint 棘轮、node --test、check-ipc-contract | 全部通过 |
| 拆分后修复：AI 设置 9 处写入、TTS 默认语音 1 处未判 `result.success`（失败静默）→ 显示错误并保持弹窗 | tsc | 通过 |
| contract 缺陷：后端返回 `AIProviderSafe`（hasApiKey/apiKeyPreview），TS `AIProvider` 却声明 `apiKey`；导致卡片恒显示“未配置”、编辑时必须重输密钥 → TS 类型对齐；编辑时密钥留空表示不变（update 传 undefined → Rust `None` 不更新） | tsc、check-ipc-contract | 通过；需 tauri:dev 走查 |

拆分带来的有意行为差异（需走查确认可接受）：
- 各 tab 挂载时自己加载数据，切换 tab 会重新加载（原来 AI+TTS 在页面挂载时一次加载，数据管理首次切入时加载一次）。
- tab 内的临时 UI 状态（如选择性重置的勾选）切换 tab 后重置。
- AI 加载失败不再阻止 TTS 配置加载；整页 loading 改为 tab 内 loading。

## B5a–B5c 分层收口（diagnostics.rs 拆解）— 2026-10-06
| 改动 | 验证 | 结果 |
| --- | --- | --- |
| B5a：status_history / word_books / update_basic_info / update_with_schedule 迁至 handlers/study_plan.rs → StudyPlanService（事务）→ StudyPlanRepository（`*_conn` 写方法）；重建日程复用 create_* 批量方法 | 5 个 characterization 测试（落库最终行） | 通过 |
| B5a-fix：编辑只接受 status='draft'（ValidationError）；不存在→NotFound、非草稿→ValidationError；update_with_schedule 也排除已删除计划 | 先写测试：3 个在旧实现上失败，修复后通过 | 通过 |
| B5b：get_calendar_month_data 迁至 handlers/calendar.rs → CalendarService（`month_range` / `build_month` 纯函数，today 参数化）→ CalendarRepository 两个范围查询 | 4 个纯函数测试（日期范围、日状态、跨月排除、连续天数）+ 1 个内存库集成测试 | 通过 |
| B5c：diagnose_study_plan_data / diagnose_calendar_data 的 SQL 下沉 diagnostics_repository；查询错误不再 `unwrap_or_default` 吞掉 | 1 个内存库测试 | 通过 |
| handlers/diagnostics.rs 939 → 64 行 | check-ipc-contract 0 错误；check-sql 174 条 0 失败 | — |
| 检查点 | `verify.sh` 9/9 PASS（logs/verify-20261006-183606.log），Rust 测试 30 个；clippy 警告 83→76，cargo check 警告 32→27 | — |

### 纠正：外键是开启的（影响 harness 规范与历史迁移）
- 原假设“`PRAGMA foreign_keys` 未开启、级联不生效”（写在两份 harness 规范里）是错的：sqlx 0.8 `SqliteConnectOptions` 默认 `foreign_keys=ON`，DatabaseManager 未覆盖。证据：孤儿行测试在未加显式删除时即通过；schema 中各子表声明 `ON DELETE CASCADE`。
- 推论（已实测）：外键开启时 `DROP TABLE study_plans` 触发隐式 DELETE 并级联子表。用 sqlx migrator 迁移到 030 → 插入计划与日程 → 执行 031：`PRAGMA foreign_keys=1`，`study_plan_schedules` 1 → 0（临时测试，已删除）。Python sqlite3 同样复现（`study_plan_words`、`study_plan_schedules` 均清零）。
- 含义：重建 `study_plans` 的历史迁移 020/021/023/031，在用户升级时很可能清空了当时已有计划的单词关联、日程、练习会话与状态历史。历史数据无法由代码恢复；今后的重建规则已写入 `sqlx-migration-standards.md`（`-- no-transaction` + 12 步流程 + 子表行数验证）。
- 已更正：`deliver-backend-rust/references/sqlx-migration-standards.md`、`transaction-and-repository-conventions.md`。

### 工具修复
- `scripts/check-sql.py`：原始字符串正则缺词边界，把 `day_number"` 的 `r"` 当作 raw string 起点 → 加 `(?<![A-Za-z0-9_])`。
- `scripts/validate-skills.sh`：macOS bash 3.2 无 `mapfile`、BSD sed 不支持 `\s` → 改为 while-read 与 `[[:space:]]`；已在本机通过（13 个 skill）。hooks 在 macOS 实测可拦截（迁移 sed -i、删库、cat .env）。

## B5d AI 模型命令分层 — 2026-10-06
- `ai_model_handlers.rs`（1359 行，18 处 SQL）→ `handlers/ai_model.rs`（薄封装，561 行）→ `services/ai_model.rs` → `repositories/ai_model_repository.rs`（全部 SQL；动态 UPDATE / 过滤改用 `QueryBuilder` 绑定参数，不再 `format!` 拼值）。命令名与参数不变（check-ipc-contract 0 错误）。
- 修复（各自有测试）：
  1. **安全**：`get_all_ai_models` 返回含 API Key 明文的 `AIModelConfig`（设置页在用）→ 改为 `AIModelConfigSafe`。测试 `list_responses_never_contain_the_api_key` 序列化全部列表接口断言不含密钥。
  2. `delete_ai_provider` 两条 DELETE 不在事务内 → 同一事务。
  3. `get_ai_models` / `get_all_ai_models` 前端平铺传参、后端读 `query` 且嵌套字段为 snake_case → Rust `AIModelQuery` 加 `rename_all = "camelCase"`，前端传 `{ query }`（当前无调用方传条件，属潜在缺陷）。
- 行为差异（可接受）：analyze/test 查询模型的数据库错误由 InternalError 变为 DatabaseError；provider 映射补齐 display_name/description（旧 repository 映射用 provider name 充当 display_name）。
- 验证：7 个新测试；cargo test 37 通过；check-sql 0 失败（脚本新增：跳过 `QueryBuilder::new(` 片段）；tsc 通过。

## B5e TTS 分层 — 2026-10-06
- `tts_handlers.rs` + `tts_service.rs` → `handlers/tts.rs` → `services/tts.rs` → `repositories/tts_repository.rs`（elevenlabs_config / tts_cache 全部 SQL）。命令名与参数不变。
- 修复（各自有测试）：
  1. **安全**：`update_elevenlabs_config` 把 `api_key` 明文写入 app.log → 只记 `api_key_changed: bool`。
  2. **安全**：`get_elevenlabs_config` 向前端返回密钥明文，且设置页“试听”会把它回传保存 → 返回 `ElevenLabsConfigSafe`（hasApiKey / apiKeyPreview）；前端编辑时密钥留空表示不变，试听不再回传密钥。TS `ElevenLabsConfig` 同步。
  3. **安全**：`ai_service.rs` 两处日志输出密钥前 10 位（短密钥则整串）→ `mask_api_key`（前 4 位）。`mask_api_key` 改为按字符截取（按字节切片在多字节字符上 panic）。
  4. `clear_tts_cache` 是固定返回 `Ok(10)` 的假实现（界面会提示“已清理 10 个”）→ 删除 `last_used` 超过 N 天（默认 30）的缓存文件与记录；文件已不存在视为已删除；其它删除失败的保留记录。
- 验证：4 个新测试；cargo test 41 通过；check-sql 0 失败；check-ipc 0 错误；tsc 通过；lint 棘轮未回退。

## B5f / B5g 与 B5 收尾 — 2026-10-06
- B5f `services/wordbook.rs`：从分析结果建/补单词本的内联 SQL → `WordBookRepository::{insert_conn, add_theme_tags_conn, exists_active_conn}`、`WordRepository::{create_batch, update_batch}`（原 pool 版本无调用方，改为 conn 版本复用）。
  - 修复：`WordBookRepository::create` 先 INSERT、再另发 `SELECT last_insert_rowid()`——池中多连接时可能落到别的连接，返回错误 ID；主题标签写入失败只记日志被吞 → 同一事务内插入 + 关联标签，ID 取插入结果。
  - 4 个测试替换原空测试 `test_service_creation`（新建含标签与大小写去重、已有单词本更新+新增、单词本不存在零写入、create 返回正确 ID）。
- B5g `word_analysis_handlers.rs`：自带的模型查询（`SELECT *`，不过滤启用状态）→ 复用 `AIModelService::get_model_config`（与生成学习计划同一路径）。行为差异：禁用的模型/提供商不再能用于分析；未配置 API Key 时提前给出“请前往设置页配置”的提示。
- B5 结果：生产代码中 SQL 只在 `repositories/`（services 里的 SQL 全部位于 `#[cfg(test)]` 之后，脚本核对）。
- 检查点：`verify.sh` 9/9 PASS（logs/verify-20261006-184904.log），Rust 测试 44；clippy 警告 83→70，cargo check 警告 32→21。
- CLAUDE.md 同步（harness-governance）：目录地图、§4.2 命令归属、§4.1 错误 wire、§4.3 外键事实、§5.1 类型化路由、§5.2 服务单例、§7.3 日志禁止密钥、§8 债务（删除已修 4 条，新增“历史迁移级联清空”与“ai_service / word_analysis 未分层”）；validate-skills 通过。

## B7 PlanDetailPage 拆分 + B8 字段 contract 对账 — 2026-10-06
### B7（只移动不改写）
- `PlanDetailPage.tsx` 1348 → 约 770 行；`pages/plan-detail/`：`PlanHeaderSection`、`PlanOverviewView`、`PlanScheduleView`、`PlanWordsView`、`PlanStatisticsView`、`PlanLogsView`、`planDetailDisplay.ts`（纯函数）。JSX 按原行号逐字迁移，未迁移行逐条核对（只有被替代的 render 函数与 `new StudyService()`）。页面内 3 处 `new StudyService()` → `studyService` 单例。
- 修复：`calculateTimeProgress` 差一错误（结束日已设 23:59:59 又 +1，10 天计划算成 11 天，最后一天只显示 82%）→ 4 个 node 测试。
### B8 字段 contract（新工具 `scripts/check-type-sync.py`，接入 verify.sh）
- 工具：同名 Rust serde struct ↔ TS interface 按 `rename_all` / 字段级 `rename` 计算实际 JSON 键对账；`*Safe` 映射与前端 DTO 例外在脚本顶部登记。首次运行 58 个同名类型 10 处错误（2 处 *Safe 误报、2 处前端 DTO 例外、6 处真实不一致）。
- 修复的真实缺陷（TS 声明 camelCase，Rust 输出 snake_case，消费处 `as any` 掩盖）：
  1. `StudyPlanStatistics`：计划详情“连续学习”、统计页“总学习时间/平均每日/计划完成率/时间完成率”恒为 0。
  2. `CalendarMonthResponse.monthly_stats`：日历页本月统计恒为 0。
  3. `CalendarDayData` / `CalendarStudyPlan`：日历计划名恒为“未命名计划”；计划图例（planEvents 叠加层）因 `day.studyPlans` 恒为 undefined 从未显示——修复后会首次显示，需走查样式。
  4. `TodayStudySchedule`：日历页今日日程的 `planId/scheduleId/canStartPractice` 全为 undefined，“开始练习”按钮与跳转失效。
  5. `StudyPlanSchedule` / `StudyPlanStatusHistory` / `StudyPlanWord` 类型对齐（当前消费处未读错字段）；删除无消费方的 `StudyPlanAIParams` / `StudyWordInfo`。
- 回归保护：Rust `month_response_wire_shape_is_snake_case`、`plan_statistics_wire_shape_is_snake_case`；`check-type-sync.py` 在 verify 中为 0 错误。
- any 93 → 68（基线已收紧）。
- 检查点：`verify.sh` 10/10 PASS（logs/verify-20261006-185813.log），Rust 测试 46，node 测试 9。
- harness：IPC contract 规范 §3 补充“嵌套结构体字段不自动转换”“lowercase 枚举”，§6 接入 check-type-sync，§7 删除已修偏差；CLAUDE.md §2 / §10 登记新脚本。

## B6 AI 模块拆分 — 2026-10-06
- 先补 characterization：`parser_tests` 7 个（JSON 提取、拼读 JSON、学习计划 JSON 的 snake_case 与无引号键修复、空 daily_plans 报错、提词 CSV、批量 CSV 跳过坏行、围栏清洗），在拆分前的 `ai_service.rs` 上运行。
- 修复（测试先在旧实现上失败）：`clean_csv_markdown` 对 ```csv 包裹的输出留下前导换行，导致表头被当成数据（提词结果多出单词 “word”）；以 ``` 开头但漏写结束围栏时丢掉最后一行数据。
- 拆分（只移动）：`ai_service.rs` 1612 行 → `ai_service/{mod,extraction,phonics,planning,parsers,progress}.rs`；解析方法改为 `parsers` 模块纯函数（调用处 `self.x(` → `parsers::x(` 机械替换）；`include_str!` 路径改为 `../prompts/`；对外名称经 `mod.rs` 重导出，调用方零改动。
- `word_analysis_handlers.rs` → `handlers/word_analysis.rs`（只移动；编排与事件推送耦合，下沉需要新的发射器抽象，按 playbook 不做）。
- 未做（记为待决）：合并两个进度管理器——会改变前端轮询 contract，需 UI 验证；与 `plans/batch-analysis-event-driven-design.md` 一并决策。
- 已知怪癖保留并有注释：`clean_json_syntax` 硬编码修复 `"date": 2025-08-27`。
- 文档同步：CLAUDE.md（目录地图 / §4.2 / §4.4 / §6 / §8 / §9）、deliver-ai-prompt、deliver-backend-rust、sdd-implement、sdd-plan batch-shapes、sdd-analyze 诊断图、IPC contract、skills README；validate-skills 通过。
- 检查点：`verify.sh` 10/10 PASS（logs/verify-20261006-190313.log），Rust 测试 53；clippy 警告 83→68，cargo check 警告 32→20。
- 未验证：拆分后真实 Provider 调用（提词/批量分析/规划）需 tauri:dev + 真实模型跑一次。

## 第 3 轮清理 — 2026-10-06
### Rust 警告清零
- `cargo fix` / `cargo clippy --fix` 处理机械类；手工：handlers/analysis 三个进度命令改为调用（原本无调用方的）`AnalysisService`；删除死代码 `WordType`、`EnhancedProgressManager::clear_progress`、两个 service 未读的 `logger` 字段、`ai_service::AIProvider.name`；参数过多的 repository/service 方法改为参数结构体（`PracticeStepRecord`、`NewStudySession`、`StudyPlanPartialUpdate`），Tauri 命令签名受前端 contract 约束加 `allow` 注明原因。
- 结果：cargo check 32→0、clippy 83→0；`verify.sh` 的 clippy 改为 `-D warnings`（CLAUDE.md §7.3 同步）。
### 前端
- WordBookDetailPage 882→667 行（`pages/wordbook-detail/`：Header / Stats / LinkedPlans），关联计划由 `any[]` 改为 `StudyPlanWithProgress[]`。
- CalendarPage 705→531 行（`pages/calendar/CalendarSidebar`）；删除日历格子里的调试标记（红色 8px “✓”，硬编码颜色）。
- 删除数据管理页可见的“调试信息: resetting=…”文本；清理两处空的“// 调试信息”注释。
- **缺陷**：项目未安装 Tailwind，但 `ErrorModal`、`LogViewer`、首页日志按钮用 Tailwind 工具类写样式 → 实际无样式渲染。改为 `Modal` + `Button` + CSS Module（设计变量），一目录一组件；`LogViewer` 不再直接 `invoke`，改用 `dataManagementService.getSystemLogs()`。前端规范补充“无 Tailwind”。
- any 68→65，no-console 3（DevTools）。
- 验证：`verify.sh` 10/10（logs/verify-20261006-193859.log）；`vite build` 通过。
- 需走查：首页错误弹窗与“查看系统日志”按钮/面板的样式；单词本详情、日历页侧边栏。

## 第 4 轮：any 清零与随之暴露的缺陷 — 2026-10-06
- `any` 65 → 0；`no-console` 3 → 0（DevTools 接管 console 处带理由豁免）。ESLint 的 `no-explicit-any` / `no-console` 升级为 **error**，棘轮基线为空。
- 去 `any` 过程中发现并修复：
  1. `getAllWordBooks` 以 `include_deleted`（snake）作为顶层参数，Tauri 静默忽略 → `includeDeleted=true` 从未生效。改为 camelCase；参数改为内联对象后 check-ipc-contract 能静态检查（W2 警告 5→0，另 4 处同类内联）。
  2. 单词本列表按主题筛选：转换后的卡片数据没有主题标签，筛选恒为空 → 卡片类型加 `themeTagIds`。
  3. TS `UnifiedStudyPlanStatus` 缺 `Paused`（Rust 有）；`getStatusDisplay` 对 Paused 返回 undefined，计划详情页读 `.text` 会崩溃 → 补齐。
  4. `PhonicsWord`：`types/ai-model.ts` 写成 camelCase、`types/word-analysis.ts` 另有一个字段完全虚构的同名类型，而 Rust（`ai_service/parsers.rs`）输出 snake_case；消费处靠 `any` 读对了 → 统一为一个 snake_case 定义；check-type-sync 扫描范围加入 `ai_service/parsers.rs`。
  5. 词性统计卡片颜色 teal/indigo/red/gray 在 StatCard 中无样式（介词/连词/感叹词/其他图标无色）→ 映射到支持的颜色，返回类型约束为 StatCard 调色板。
  6. DevTools：hooks 前提前 `return null`（违反 Hooks 规则）；“API 调用”面板订阅的 `tauri-api-call` 事件从未被派发（HEAD 中也没有）→ `api/client.ts` 仅在开发模式派发（`API_CALL_EVENT` 常量共享），DevTools 的 return 移到 hooks 之后。
  7. 死代码：练习页 8 处 snake_case 兜底（练习类型实际为 camelCase 字段级 rename）；EditPlanModal `daily_plans` 兜底；StudyPlansPage / 计划详情页基于废弃字段推算状态的兜底；`confirmMessage` 不存在于动作配置。
- `validateRequired` 改为泛型 `(params: T, fields: (keyof T & string)[])`，字段名拼写由 tsc 检查；错误处理统一 `unknown` + `messageOf()`。
- 记录未改：`LinkedPlansSection` 同时按 `unified_status` 与废弃的 `lifecycle_status` 显示徽标，可能重复显示“已完成”，需真实数据确认。
- 验证：`verify.sh` 10/10（logs/verify-20261006-201602.log）；`vite build` 通过；node 测试 9。
- 需走查：单词本列表主题筛选；词性统计卡片颜色；开发模式 DevTools 的 API 调用面板；导入单词（WordImporter）流程。

## 第 5 轮：真实应用自主回归（2026-10-06，macOS，隔离 HOME）

方法：`HOME=<scratchpad>/e2e-home ./target/debug/pindu-app`（debug 构建加载 vite :1420），用户真实数据目录未触碰。
AppleScript `click at` 坐标点击 + 剪贴板粘贴输入（绕过中文输入法，用完恢复剪贴板）+ CGEvent 滚轮；
断言 = 窗口截图 + `app.log` 的 `API Response ... SUCCESS/FAILED` + sqlite3 查隔离库。未点击任何重置/删库按钮。

走查通过：首页、日志面板；设置 AI（编辑提供商不重输密钥保留原值、日志无密钥）；TTS（保存密钥脱敏、默认语音、清理缓存）；
日历（今日日程、月统计 3/31、日状态）；练习三步 + 暂停/恢复（pause 记录）+ 完成（practice_sessions / study_sessions / 日程 2/2）；
结果页；计划列表卡片；计划详情（连续学习=1、概览日历、日志）；单词本主题筛选。

走查中发现并修复（均已在应用内复测）：
| 问题 | 修复 |
|---|---|
| 种子提供商密钥是占位符 `PLEASE_SET_YOUR_API_KEY`，列表显示“已配置” | `AIProvider::has_api_key()` 统一判定；测试 `seeded_placeholder_key_is_reported_as_not_configured` |
| 时间进度三处口径不一（卡片 / 头部 / 统计视图，且后端用 UTC） | 后端纯函数 `time_progress`（本地日期，测试）；前端唯一实现 `utils/timeProgress.ts`；三处一致 33% |
| 练习页 / 结果页顶部导航点击无反应 | Header 传 `onNavChange` |
| 拼读分段显示成 `["C", "at"]` | `utils/phonics.ts` 解析 JSON 数组或逗号串（4 个测试） |
| 计划统计卡片写死 “+12%” “+5” | 改为真实完成率 |
| `fa-target` / `clock-check` 图标不存在（空白） | `fa-bullseye` / `calendar-check` |
| TTS 密钥显示重复圆点 | 显示后端 `apiKeyPreview` |
| 日历下方漂浮的计划圆点（失效叠加层） | 删除叠加层及样式 |
| 计划卡片逾期色块 / 图例不可见 | 根因：50 个 CSS 变量被引用但从未定义（如 `--color-red`、`--font-size-md`×102、`--color-border-secondary`×77），整条声明失效。globals.css 增加 legacy 别名；新增 `scripts/check-css-vars.py` 纳入 verify |
| 未完成练习提示显示 “学习计划 #1”、“单词进度: 0”；日历侧栏计划名为空 | 会话列表查询 LEFT JOIN 计划名；未完成会话补 word_states；测试 `incomplete_sessions_carry_plan_title_and_word_states` |

仅记录未修：练习暂停时计时器显示仍走（DB active_time 正确）；设置弹窗底部按钮需滚动；DevTools “显示调试面板”按钮压住“设置”导航（仅开发）；
StudyCalendar 周日起 vs 日历页周一起；单词本页每次进入调用 `update_all_word_book_counts`；StartStudyPlanPage / FinishStudyPlanPage 为未接线的假数据页面（是否删除待用户定）；
日历侧栏“继续/取消”按钮无间距；从计划详情“进入练习”会优先进入逾期日程（看起来是有意为之）。
未覆盖：真实 AI Provider 链路（提词 / 批量分析 / 生成计划）与 TTS 发音（隔离环境只有假密钥）。

验证：`bash scripts/verify.sh --work architecture-refactor` 11/11 PASS（含新 check-css-vars），57 个 Rust 测试，`vite build` 通过。
