# CLAUDE.md — 拼读 Pindu.app（RedLark 仓库）

> 面向 AI 编码助手与新成员的工程说明。描述的是**当前代码的真实状态**（含已知债务），而非理想设计。
> 修改架构或规范时请同步更新本文件（流程：`harness-governance` Skill）。上次重建：2026-10-03；局部更新：2026-10-06（B4/B5 分层收口）；2026-10-07（前端 UI 体系选定 shadcn/ui）。

## 1. 项目速览

拼读（Pindu.app）是 RedLark 的产品之一：Tauri 2 + React 19 的跨平台桌面单词学习应用，bundle id `com.redlark.pindu-app`。
**命名**：面向用户的产品名中文「拼读」、英文「Pindu.app」（窗口标题、侧边栏、安装包、README）；RedLark 是出品方（发布者、版权、仓库）。已用于标识、路径与包名的 `redlark`（`redlark-agent`、`redlark_app_lib`、`REDLARK_*` 环境变量、`com.redlark.pindu-app`）保留不改；「自然拼读」只指教学方法，不作产品名。
核心价值：**AI 自然拼读分析** + **AI 生成学习日程** + **三步练习法**（完整信息 → 隐藏英文 → 仅中文/音节/拼读+发音）+ 本地 SQLite，数据不出本机。

| 层 | 技术 |
|---|---|
| 前端 | React 19 · TypeScript ~5.6 · Vite 6 · **UI：shadcn/ui（Radix）+ Tailwind CSS v4 + lucide-react**（唯一 UI 体系，无 CSS Modules） |
| 桌面壳 | Tauri 2（plugins: opener, process；`withGlobalTauri: true`，开发模式自动打开 DevTools） |
| 后端 | Rust 2021 · tokio · sqlx 0.8 (sqlite, migrate, WAL) · reqwest · thiserror |
| AI | 内置 agent harness：pi（`@earendil-works/pi-coding-agent`，RPC sidecar `redlark-agent`，bun 单文件） |
| 数据库 | SQLite，文件 `<数据目录>/vocabulary.db`（数据目录见 §4.3），启动时先备份再跑 `src-tauri/migrations/` |
| 外部服务 | OpenAI 兼容接口（AI 分析/规划；种子提供商 OpenRouter / MiniMax / 月之暗面 / DeepSeek，均可「同步模型」读取 `/models`）· 火山引擎豆包语音合成（TTS，V3 HTTP 单向流式，带 SHA256 音频缓存）· ffmpeg / ffprobe（视频库：转码、精确切分、波形与缩略图；独立程序，不随应用分发，位置见 `media.rs`） |
| 包管理 | npm（有 package-lock.json）+ Cargo |

**无路由库、无状态管理库**；UI 组件库唯一选择是 shadcn/ui（源码在 `src/components/ui/`，不引入其它 UI 库）。页面切换靠 `App.tsx` 里的 `currentPage` 字符串 + `pageParams`。

## 2. 常用命令

```bash
npm install                 # 前端依赖
npm run tauri:dev           # 开发（前端 :1420 + Rust 热编译）
npm run agent:install       # agent sidecar 依赖（首次）；npm run agent:build 编译当前平台 sidecar（tauri:dev / package 会自动编译）
npm run agent:test          # agent sidecar 工具测试（node --test）
npm run verify              # 一键验证（= bash scripts/verify.sh）：SQL/IPC/类型/CSS 变量静态检查 + tsc + lint 棘轮 + 前端测试 + cargo fmt/check/clippy/test
npm run type-check          # tsc --noEmit
npm run lint                # eslint src（flat config：eslint.config.js）
npm run lint:ratchet        # error=0（含 no-explicit-any / no-console），warning 只减不增（基线 .eslint-baseline.json 当前为空）
npm test                    # node --test（零依赖），测试文件 src/**/*.test.ts
python3 scripts/check-sql.py            # Rust 中的静态 SQL 在迁移终态 schema 上 EXPLAIN
python3 scripts/check-ipc-contract.py   # 前端 invoke ↔ lib.rs 注册 ↔ 命令签名
python3 scripts/check-type-sync.py      # 同名类型：Rust serde 实际键 ↔ TS 接口字段（前端读到 undefined 的根源）
python3 scripts/check-css-vars.py        # CSS var(--x) 引用必须有定义（未定义会让整条声明静默失效）
python3 scripts/check-time.py            # 时间约定棘轮：time.rs 之外的取时 / 旧格式写入只减不增（--list 列出位置）
python3 scripts/check-release-invariants.py [--update]  # 升级安全：identifier / 库文件名不变，已发布迁移不改（新迁移用 --update 登记进 migrations.lock）
python3 scripts/schema-snapshot.py --table <t>   # 迁移终态表结构（不要凭迁移片段猜列）
cd src-tauri && cargo test  # 后端测试（crate 内 #[cfg(test)]，内存 SQLite）
npm run package             # 一键构建本机安装包（= ./build.sh / build.cmd → scripts/package.mjs）：环境检查 → 依赖 → sidecar → tauri build → release/<版本>-<triple>/
npm run package:check       # 只检查构建环境；选项 --target mac-universal|mac-arm|mac-intel|win|win-arm|linux|linux-arm、--bundles、--no-bundle、--debug、--clean
                            # 开发者本地打包工具（只能打本机系统的包，macOS ad-hoc 签名）。正式发布走 GitHub Releases：未签名安装包 + 应用内更新，CI 带 TAURI_SIGNING_PRIVATE_KEY 时额外生成签名的更新包（docs/RELEASING.md）
npm run clean               # 清 dist、target、vite 缓存
```

后端测试写在 crate 内（`#[cfg(test)] mod tests`），内存库与种子数据用 `src-tauri/src/test_support.rs`；规范见 `.claude/skills/deliver-backend-rust/references/rust-test-standard.md`。
日志：`<app_data_dir>/logs/app.log`（每行一条 JSON `{timestamp, level, component, message, details?, fields?}`；超过 5MB 轮转为 app.1 … app.4.log，总量约 25MB 封顶；写入队列有上限，满了丢弃并补记条数）。统一入口：`Logger`（Tauri 状态）、`tracing` 宏（拿不到 Logger 的代码直接用）、第三方库的 `log` / `tracing`（只收 WARN 以上）、前端 `write_client_log`、panic 钩子，全部经 `log_bridge.rs` / `logger.rs` 写入同一个文件；命令进出自动带请求编号与耗时。分级记录：低于最低级别的不写，「设置 → 通用 → 诊断」可调（`get_log_level` / `set_log_level`，存 `app_settings` 的 `log.level`，`services/log_settings.rs`；未设置时发布版 INFO、开发版 DEBUG）。AI 助手每次运行由 `agent/run_log.rs` 记 `[任务名#编号]` 开头的执行日志（开始 / 自动重试与原因 / 工具校验退回 / 结束用量 / 模型原始错误 / 失败附 stderr；DEBUG 再记消息与工具结果，均去掉密钥）。`get_system_logs(limit)` 只读文件末尾、`open_log_folder` 在访达中打开（`handlers/system.rs`）；前端有 LogViewer / DevTools 浮层。

## 3. 目录地图

```
src/                          前端
├── App.tsx                   页面 switch 路由（见 §5.1），ErrorBoundary + ToastProvider + DevTools
├── api/client.ts             TauriApiClient：封装 invoke，永远返回 ApiResult<T>，不抛异常
├── api/errors.ts             IPC 错误解析 `{code,message}`（纯函数，有 node 测试）
├── navigation.ts             类型化路由表 `RouteParams` / `PageKey` / `NavigateFn`（见 §5.1）
├── services/                 继承 BaseService，一个功能域一个文件（见 §5.2）
├── types/                    与 Rust types 对应的 TS 类型；index.ts 统一导出
├── hooks/                    useAsyncData / useAudioPlayer / useSentencePlayer（短文逐句朗读）/ usePlanPractice（计划卡「继续学习」）/ useTheme（全局单一主题状态，含跟随系统）/ useUpdater（应用更新的全局状态：自动检查偏好、下载进度、跳过的版本）/ useToday / useImeGuard
├── utils/                    datetime（时间唯一入口）、errorHandler、schedulePick、learningHeatmap 等纯函数（多数有 node 测试）
├── pages/                    各页面 `XxxPage.tsx`；子目录放页面私有组件：settings/（设置面板）· plan-detail/（计划详情页签）· calendar/ · passage-detail/ · passage-import/
├── components/ui/            shadcn/ui 原语（`npx shadcn@latest add` 生成，kebab-case 文件）
├── components/               业务组件，一目录一组件（Component.tsx + index.ts），组合 ui/ 原语
├── components/AppShell/      桌面外壳：shadcn Sidebar + 顶栏面包屑，包裹除 `FOCUS_PAGES`（单词练习、短文练习）外的所有页面
├── lib/utils.ts              `cn()` 类名合并
└── styles/app.css            唯一全局样式：Tailwind 入口 + shadcn 主题 token（`@theme inline`，dark 跟随 data-theme）

src-tauri/
├── src/lib.rs                Tauri Builder：解析目录 → Logger → startup::open_database → app.manage(pool/logger/AppDirs/StartupStatus)；generate_handler! 注册全部命令
├── src/app_paths.rs          数据 / 缓存目录与库文件名的唯一 owner（发布版按 identifier，开发版 `-dev` 目录，`PINDU_DATA_DIR` 覆盖）
├── src/startup.rs            启动时打开并升级数据库：对账 → 备份 → 迁移；失败返回 StartupFailure（前端 StartupGate 显示错误页）
├── src/handlers/             ① 接口层：#[tauri::command]，按功能域拆分（见 §4.2）
├── src/services/             ② 业务层：XxxService::new(Arc<SqlitePool>, Arc<Logger>)
├── src/repositories/         ③ 数据访问层：所有 SQL 只应出现在这里
├── src/types/                serde 类型（common / wordbook / study / ai_model / tts / word_analysis / passage）
├── src/error.rs              AppError + AppResult<T>
├── src/logger.rs             文件日志，api_request / api_response / info / error
├── src/database/mod.rs       MIGRATOR（内置迁移）、connect（WAL, synchronous=Normal, create_if_missing）、vacuum_into（整库备份）
├── src/agent/                内置 agent harness（pi sidecar）：protocol · config · session · tasks · catalog（pi 内置目录）（见 docs/agent-harness/DESIGN.md）
├── src/prompts.rs            提示词渲染唯一 owner（见 §6）；src/time.rs 取时与格式唯一入口（见 §7.5）；src/menu.rs macOS 中文菜单
├── src/media.rs              ffmpeg / ffprobe 调用唯一 owner：定位、读取信息、转码与精确切分（进度 + 取消）、波形峰值、缩略图
├── src/jobs.rs               后台任务唯一 owner：提交即返回 jobId，agent / media 两条队列，进度与结果经 `job-updated` 事件推送；只放内存（见 §4.4）
├── src/prompts/agent/*.md    agent 任务提示词，include_str! 编译进二进制（见 §6）
├── migrations/001..059_*.sql
└── src/test_support.rs       #[cfg(test)] 内存库与种子数据

agent/                        agent sidecar 的 TS 工程（pi RPC + RedLark 工具）；npm run agent:build → src-tauri/binaries/redlark-agent-<triple>（不入库）
docs/agent-harness/           agent harness 设计（DESIGN.md）与决策记录（DECISIONS.md，追加式）
docs/RELEASING.md             发版流程：改版本号 → docs/releases/vX.md 更新说明 → 打标签 → CI 出 Release 草稿（安装包 + 更新包 + latest.json）→ 发布；更新签名私钥管理
.claude/skills/                SDD harness：开发 workflow 与领域能力 Skill（见 §10）
.claude/work/<work-id>/        跨会话 work item（brief / plan / progress / evidence / analysis；只在本机，不入库）
.claude/hooks/                 PreToolUse 守卫：拦截修改历史迁移、删库、输出密钥
scripts/validate-skills.sh     Skill 目录结构校验
docs/NAMING_CONVENTIONS.md     前后端命名规范（本文件 §7.2 是摘要）
docs/LOGGING.md                日志规范：级别含义、记在哪里、不能记什么、改动自查（本文件 §7.3 是摘要）
```

## 4. 后端架构（Rust）

### 4.1 三层调用链

```
#[tauri::command] handler
  ├─ app.state::<SqlitePool>() / app.state::<Logger>()
  ├─ logger.api_request(cmd, params)
  ├─ let service = XxxService::new(Arc::new(pool.inner().clone()), Arc::new(logger.inner().clone()));
  ├─ match service.do_thing().await { Ok → logger.api_response(cmd, true, ..); Err → api_response(cmd, false, ..) }
  └─ 返回 AppResult<T>
Service  ── 业务校验（ValidationError）、跨 Repository 协调、事务
Repository ── sqlx 查询、Row → 类型映射、批量查询（已修过多处 N+1）
```

规则：
- **Handler 不写 SQL、不写业务逻辑**；新命令 = handler 薄封装 + service 方法 + repository 方法。
- Service / Repository 实例是轻量的（只持有 `Arc<SqlitePool>` + `Arc<Logger>`），每次请求 new 一个即可。
- 需要多表一致性的操作在 Service 层开 `pool.begin()` 事务（参考 `services/study_plan.rs`、`services/practice.rs`）。
- 所有命令返回 `AppResult<T>`，不要返回 `Result<T, String>`。`AppError` 手写 `Serialize`，前端收到 `{code, message}`（解析在 `src/api/errors.ts`）。

### 4.2 Handler 模块与命令归属

| 文件 | 命令（节选） |
|---|---|
| `handlers/wordbook.rs` | get_word_books, get_word_book_detail, get_word_book_linked_plans, get_word_book_statistics, get_global_word_book_statistics, get_theme_tags, create/update/delete_word_book, get_theme_tags / create_theme_tag（新建主题，1–10 字，同名复用）, restore_word_book |
| `handlers/word.rs` | get_words_by_book（分页/搜索/词性过滤）, add_word_to_book / update_word（单词与释义必填、本内不重名）, delete_words（批量，单事务；单个删除也走它）, find_existing_words, generate_word_examples（AI 补充 append / 重新生成 replace 例句） |
| `handlers/study_plan.rs` | get_study_plans, get_study_plan, generate_study_plan_schedule（默认顺序，立即完成）, start_study_plan_ordering（AI 排序，前台任务）, create_study_plan_with_schedule, start/complete/terminate/restart/publish/delete_study_plan, pause/resume_study_plan（暂停 / 继续，继续时顺延）, get_study_plan_words, batch_remove_words_from_plan, get_study_plan_schedules, get_study_plan_calendar_data, get_plan_memory_overview, get_study_statistics, get_study_plan_statistics, get_study_plan_word_books, update_study_plan_basic_info（任何状态）, preview_study_plan（确定性预览，不用 AI）, replan_study_plan_pace（就地改每天新词数，只重排没练过的新词日）, add_word_books_to_plan（追加单词本） |
| `handlers/practice.rs` | start_practice_session, submit_step_result（`kind`: learn 首次作答 / retry 纠正后重考 / review 当轮小测；成绩与日程完成只看 learn）, save_practice_progress（中途时长落库，恢复后继续累计）, pause/resume/complete/cancel_practice_session, get_incomplete_practice_sessions, get_practice_session_detail, get_plan_practice_sessions |
| `handlers/analysis.rs` | create_word_book_from_analysis |
| `handlers/statistics.rs` | get_daily_learning_activity（首页热力图：每个本地日期练过 / 学会的单词数）, get_database_statistics, reset_user_data, reset_selected_tables（表名只接受库里存在的用户数据表，配置表受保护）, delete_database_and_restart |
| `handlers/calendar.rs` | get_today_study_schedules, get_calendar_month_data（日状态/月统计在 `services/calendar.rs` 纯函数 `build_month`） |
| `handlers/diagnostics.rs` | diagnose_study_plan_data, diagnose_calendar_data, diagnose_today_schedules（仅开发排查，前端不调用；只在 debug 构建编译与注册，`#[cfg(debug_assertions)]`） |
| `handlers/ai_model.rs` | get_all_ai_providers / get_all_ai_models（列表一律返回 `AIProviderSafe`/`AIModelConfigSafe`：has_api_key + 前 4 位预览）, set_default_ai_model, create/update/delete_ai_provider（含 `piProvider` / `api`）|model（生成参数为 `generation: ModelGenerationSettings`，整体替换）, list_provider_remote_models（pi 目录 + 远端 /models）, get_agent_catalog_providers / get_agent_catalog_models（pi 内置目录）, test_ai_model |
| `handlers/word_analysis.rs` | extract_words_from_text, generate_words_from_intent（按描述生成单词，避开本内已有词）, start_word_analysis（后台任务：分批拼读 + 例句，完成后直接加入单词本；关掉弹窗也继续）, analyze_word（单个词「AI 补全」，只返回不保存） |
| `handlers/jobs.rs` | list_jobs, cancel_job, remove_job, clear_finished_jobs, quit_app（有任务在跑时关窗 / ⌘Q 先发 `quit-requested` 让前端确认） |
| `handlers/word_explanation.rs` | generate_word_explanation（agent 实时生成，不落库；流式增量经 `word-explanation-delta` 事件推送，按 requestId 过滤；返回正文 + 推荐追问 `follow_ups`）, ask_word_tutor（`request: WordTutorRequest`：带上正在看的讲解与最近对话，AI 老师答疑，增量事件 `word-tutor-delta`，返回 `TutorReply` 正文 + 推荐追问；对话不落库） |
| `handlers/passage.rs` | get_passage_word_candidates（`request: PassageWordSources`：单词本、学习计划都可多选，计划按取词策略 wrong / weak / recent / upcoming / mastered / learned）, get_plan_scope_counts, plan_passages（AI 内容规划：一篇或拆几篇，`feedback` 让 AI 改规划）, start_passage_generation（后台任务，`request: GeneratePassagesRequest { base: GeneratePassageRequest, items }`：按内容规划逐篇写；base 里必用词 + AI 按场景从来源挑 `aiPick` 个，可按学习情况 `pickStatuses` 筛候选、按难度 / 常用程度 `pickDifficulty` / `pickFrequency` 挑；逐篇状态在 job.detail.items）, get_passages（按来源 book_id / plan_id、origin generated / imported 筛选）, get_passage, get_passage_words（目标词的单词资料，点词卡片用）, delete_passage, start_question_set_generation（后台任务，`request: GenerateQuestionSetRequest`：各题型数量 + 难度）, get_question_set, delete_question_set, start_passage_attempt（set_id + reading / listening，可带 plan_id：计划里的短文任务）, submit_passage_attempt（必须全部作答；客观题代码判分，开放题 AI 评分）, regrade_passage_open, get_passage_statistics；删除短文 / 题组：没结束的计划用着时拒绝 |
| `handlers/passage_import.rs` | read_material_file（`request: ReadMaterialRequest`：txt/md/srt/vtt/docx/pdf → 清理后的纯文本，单词本提取与短文导入共用）, prepare_passage_import（确定性清理、分句、拆篇预览，不用 AI）, start_passage_import（后台任务，`request: ImportPassagesRequest { items }`：逐篇 AI 只翻译 / 起标题 / 估水平 / 挑重点词，原文不改；取消经 cancel_job）, get_passage_new_words, add_passage_words_to_book（拼读分析后入本，补上目标词 wordId） |
| `handlers/plan_passage.rs` | get_plan_passages, set_plan_passages（`request: SetPlanPassagesRequest`：练习内容 + 完整短文顺序 + 间隔天数；已完成的锁定）, get_today_passage_tasks, get_plan_passage_candidates（`request`：bookIds / planId，按相关度排序，含题组）, complete_plan_passage_reading（只朗读的任务“读完了”） |
| `handlers/agent_settings.rs` | get_agent_settings / update_agent_settings（任务模型、批量分析每批词数与并发、AI 等待上限） |
| `handlers/prompt_profile.rs` | get_prompt_profile / update_prompt_profile / apply_prompt_preset / preview_prompts（学习者档案与各任务补充要求，见 §6） |
| `handlers/system.rs` | get_system_logs, get_log_level / set_log_level（最低记录级别）, open_log_folder, open_data_folder, get_startup_status（启动失败原因，见 §4.3） |
| `handlers/updater.rs` | check_for_update（读 GitHub Releases 的 latest.json；开发版可用 `PINDU_UPDATE_ENDPOINT` 覆盖地址）, install_update（`on_progress: Channel<UpdateProgress>`，内置公钥验签；有 agent 任务在跑时拒绝，开始安装后 `agent::session` 不再启动新 sidecar；失败可直接重试）, restart_app；Linux 非 AppImage 只提示不安装。前端 `UpdateWatcher`（App 级：自动检查 + 菜单）/ `UpdateBanner`（AppShell 顶栏下与启动错误页） |
| `handlers/video.rs` | get_media_tools_status / set_ffmpeg_dir（视频组件）, start_video_import（后台任务：复制 → 读信息 → 不能直接播放时转 720p 代理 → 波形与缩略图；字幕在命令里先解析）, get_videos, get_video（含字幕条、规划草稿、缩略图、已切出的短片）, get_video_peaks, rename_video, save_video_plan（编辑器自动保存）, start_video_plan（AI 规划，后台任务）, start_video_processing（按规划精确切分并逐段存成短文，后台任务，按段可续）, get_passage_video（短文详情播放短片）, delete_video（连同短片短文，计划还在用时拒绝）, delete_video_source |
| `handlers/tts.rs` | text_to_speech（`style`: word / sentence → 固定语音指令，参与缓存键）, get_tts_voices（预置英文音色）, get_default_tts_voice（默认音色经 update_tts_config 设置，允许自定义音色 ID）, clear_tts_cache, get_tts_cache_stats, get_tts_config（返回 `TtsConfigSafe`）, update_tts_config（`request: UpdateTtsConfigRequest`） |

`handlers/mod.rs` 用 `pub use xxx::*` 全部重导出，所以 `lib.rs` 里可直接写命令名。**新增命令必须在 `lib.rs` 的 `generate_handler!` 里注册**，否则前端 invoke 报 "command not found"。

### 4.3 数据库

启动流程（owner `startup.rs`）：`AppDirs::resolve`（发布版 `<系统数据目录>/com.redlark.pindu-app/`；debug 构建 `com.redlark.pindu-app-dev/`；环境变量 `PINDU_DATA_DIR` 覆盖）→ `connect(<数据目录>/vocabulary.db)` → 对账 `_sqlx_migrations`（上次升级未完成、数据库来自更新的版本、已执行迁移被改过 → 不动数据、返回 `StartupFailure`）→ 有待执行迁移时先 `VACUUM INTO` 备份到 `backups/`（保留 5 份；备份失败不升级）→ `MIGRATOR.run` → `app.manage(pool)`。任何失败都不 panic、不建新库：前端 `StartupGate` 只显示错误页。`delete_database_and_restart` 删除前也先备份。发布版用 `tauri-plugin-single-instance` 保证只运行一个实例。
外键是开启的（sqlx 默认 `foreign_keys = ON`），schema 中的 `ON DELETE CASCADE` 生效：删除计划/日程会连带删除单词关联、练习会话与作答记录。

当前有效表（迁移 001–059 之后）：
`word_books` · `words` · `word_examples`（单词例句，一对多，`sort_order` 0 为最简单的一句；`words.example_sentence/translation` 为 040 遗留列，041 起不再读写） · `theme_tags` · `word_book_theme_tags` · `study_plans` · `study_plan_words` · `study_plan_schedules` · `study_plan_schedule_words` · `study_plan_status_history` · `study_sessions` · `study_statistics`(遗留) · `study_timer_records` · `study_pause_records` · `practice_sessions` · `word_practice_records` · `practice_pause_records` · `ai_providers` · `ai_models` · `app_settings`（键值设置：AI 任务模型、批量参数、学习者档案）· `tts_cache` · `volcengine_tts_config` · `elevenlabs_config`(遗留，035 起不再读写) · `categories`(001 遗留) · `passages`（短文，独立素材：正文 + 逐句翻译（句子带 paragraph 段落标记）+ 目标词；`origin` generated AI 写的 / imported 导入的材料，`source_label` 文件名，057）· `passage_sources`（来源：单词本 / 计划，`ref_id` 无外键，删来源不删短文）· `passage_question_sets`（阅读理解题组，一篇短文可多套）· `passage_questions`（挂题组）· `passage_attempts`（按题组作答，口径独立于单词练习）· `study_plan_passages`（计划里的短文任务：短文 + 题组（空 = 只朗读）+ reading / listening + 排期日期 + 完成时刻，056；`study_plans.practice_content` words / passages / both、`passage_interval_days`）。`videos`（视频库：文件在 `<数据目录>/videos/<id>/`，表里只存文件名；`cues` 带时间的字幕 JSON、`plan` 切分规划草稿 JSON、`status` importing / ready / processing / done / failed，059）· `video_clips`（切出的短片，一段对应一篇短文，`passage_id` 级联；短文句子 JSON 带 `startMs` / `endMs`，相对短片开头）。`word_explanations`（讲解缓存）已在 058 删除：讲解每次实时生成（D31）。
`tts_providers` / `tts_voices` 已在 030 删除；TTS 自 035 起为火山引擎豆包（单行配置 `volcengine_tts_config`，鉴权 API Key 或 AppID+Access Token，资源 ID 为空时按音色推断）。性能索引见 032；033 刷新种子模型（只改仍为种子原值的行）；036 把种子提供商收敛为 OpenRouter / MiniMax / 月之暗面 / DeepSeek（034 的火山方舟仅在未配置时移除）。

**单词本生命周期**：状态只有 `normal`（正式）/ `draft`（草稿，不能用于计划）；删除为软删除（`deleted_at`），在列表“已删除”里可恢复（`restore_word_book`）。被草稿 / 待开始 / 进行中 / 已暂停的计划使用时不能删除或转草稿。列表的单词数与关联计划数在查询时实时计算。删除单词会在同一事务里把它从所有计划移除并重算日程计数（`services/word.rs::delete_word`）。

**练习统计口径**（唯一 owner：`repositories/practice_metrics.rs`）：正确率只看每步首次 learn 作答；“当次通过” = 某已完成会话中首答全对（新词三步、复习词只考第三步），用于日程完成数与每日学习量；“掌握” = 记忆等级 `study_plan_words.srs_box ≥ 4`（自适应复习，见下）；“已学” = `srs_box ≥ 1`（完成过一次含该词的练习；首页总学习单词与计划卡进度）；时长用 `active_time`（不含暂停）；日期按本地日期（`DATE(x, 'localtime')`、前端 `utils/datetime.ts::localToday`；时间约定见 §7.5）。日程 `status = 'completed'` 表示**练完**（有已完成会话），掌握数是 `completed_words_count`；“该练哪个日程”统一用 `pickPracticeSchedule`。

**学习计划排程与复习**（D20，规则 owner：`services/study_planning.rs` 新词排程、`services/srs.rs` 记忆等级）：用户只选每天新词数 + 开始日期；预排日程只有新词日，周期 = 学新词天数 + 11 天巩固。复习按 Leitner 记忆等级（间隔 1/3/7/14/30 天，答对升级、答错回 1 级，以实际练习日期为基准）每天动态放进**今天**的日程（`srs::sync_today`，在开始练习、今日日程、日历、计划日程列表前调用；过期未练的复习条目自动清理）；复习词只做第三步。全部单词掌握时计划自动完成。

**计划里的短文**（D29，规则 owner：`services/plan_passages.rs`）：练习内容 words / passages / both；只练短文的计划没有单词本与日程。短文来自短文库，任务 = 短文 + 一套题组（空 = 只朗读，点「读完了」完成）+ 阅读 / 听力，从开始日起每 N 天一篇（默认 2），到期没完成的留在今日任务；完成 = 计划内一次同题组同方式的作答完成，日期 / 题组 / 方式随之锁定。开始、重新学习、暂停后继续、改短文时 `reschedule_conn` 重排没完成的（已开始的计划不早于今天）；结束日取单词结束日与最后一篇短文中较晚的；自动完成 = 单词全部掌握（没有单词视为满足）且短文全部完成（`try_auto_complete_conn`，单词练习与短文作答共用）。重新学习时任务回到未完成，计划内的作答转为自由练习。

**学习计划状态**：`study_plans.unified_status` 是唯一权威字段（`Draft | Pending | Active | Paused | Completed | Terminated | Deleted`，PascalCase 字符串）。`status`(normal/draft/deleted) 保留兼容，`lifecycle_status` 已删除（Rust 返回类型里不再有这个字段）。前端可用操作由 `src/types/study.ts` 的 `getAvailableActions` 给出，状态文案与徽章配色的唯一来源是同文件的 `PLAN_STATUS`。后端所有状态变更都走 `StudyPlanRepository::transition_conn`（事务内校验当前状态 + 条件更新 + 写状态历史，同步旧 `status` 列）；自动流转：待开始的计划第一次练习时转进行中（开始时日程整体平移到从当天开始），全部单词掌握时自动完成（`services/practice.rs`）。暂停 / 继续：暂停期间不能练习、不同步复习、不算逾期；继续时暂停起之后未练的日程与复习到期日按暂停天数顺延。删除为物理删除（级联删除日程与练习）。界面上不再有“编辑 → 草稿 → 发布”：名称 / 描述随时可改；每天新词数与追加单词本在详情页「设置」就地生效（`services/plan_pace.rs`：只重排没练过的日程里的新词，已练日程、复习条目与 srs_* 不动）；练过的计划不会被开始 / 重新发布平移日程（`start_now_conn` 只平移从未练习的计划）。重新学习保留日程并平移到今天。

### 4.4 AI（agent harness）与进度

- **所有 LLM 功能都经内置 agent harness（pi sidecar）执行**，旧的 async-openai 直连实现已删除（DECISIONS D12）。设计 `docs/agent-harness/DESIGN.md`，决策记录 `docs/agent-harness/DECISIONS.md`（新决定**追加**一条 Dxx）。
- 任务（`src-tauri/src/agent/tasks.rs`，通用 `run_task` / `run_task_cancellable`）：

  | 任务 | 提示词 | 工具 | 调用方 |
  |---|---|---|---|
  | 提词 | `extract_words.md` | `tokenize_text` + `submit_words` | `services/word_extraction.rs` |
  | 批量拼读分析 | `phonics_batch.md` | `submit_phonics`（自带校验，退回重交） | `services/phonics_analysis.rs` |
  | 学习计划排序 | `study_plan_order.md` | `submit_learning_order` | `services/study_plan_generation.rs` → 日程由 `services/study_planning.rs` 确定性计算（D13） |
  | 单词讲解 | `word_explain.md`（medium 思考档） | 无（`-nt`，输出 Markdown 正文 + 末尾推荐追问，流式） | `services/word_explanation.rs`（每次实时生成，不落库；追问拆分与流式闸门在 `agent/follow_up.rs`） |
  | AI 老师答疑 | `word_tutor.md` | 无（`-nt`，简短回答 + 末尾推荐追问，流式） | `services/word_tutor.rs`（带单词资料、前端传来的当前讲解、最近 12 条对话；已问过的问题不再推荐） |
  | 按描述生成单词 | `generate_words.md` | `submit_generated_words` | `agent::tasks::generate_words`（命令 generate_words_from_intent） |
  | 例句补充 / 重新生成 | `word_examples.md` | `submit_examples`（与拼读例句同一套校验） | `services/word_examples.rs` |
  | 短文：内容规划 | `passage_plan.md`（medium 思考档） | `submit_passage_plan`（必用词都分到、篇数上限；Rust `passage_rules::plan_from_submission` 再校验） | `services/passage.rs::plan` |
  | 短文：写短文 | `passage_generate.md` | `submit_passage`（必用词全用上、`chosen_words` 来自候选池且出现在正文、篇幅；Rust `passage_rules::passage_from_submission` 再校验） | `services/passage.rs::generate` |
  | 短文：出阅读理解题 | `passage_questions.md` | `submit_questions`（各题型数量与请求一致、空位是原文里的词、判断题对错都有；Rust `questions_from_submission` 再校验） | `services/passage.rs::generate_question_set` |
  | 短文：开放题评分 | `passage_grade.md` | `submit_grade`（0–4 分 + 评语 + 改进示例） | `services/passage.rs::grade_open` |
  | 短文：导入材料翻译 | `passage_translate.md` | `submit_translation`（只收逐句译文 + 标题 + 水平 + 重点词；条数 / 编号校验；Rust `translation_from_submission` 再校验，英文以请求为准） | `services/passage_import_service.rs::import`（预处理在 `services/passage_import.rs`，docx / pdf 取文字在 `passage_import_files.rs`） |
  | 视频：规划场景切分 | `video_plan.md`（medium 思考档） | `submit_video_plan`（字幕编号范围有序不重叠、字段齐全；Rust `video_plan::segments_from_submission` 换成毫秒、留余量、重点词只留字幕里出现的） | `services/video_plan.rs`（后台任务；长字幕按约 15 分钟分块，3 块并行，`chunk_cues`）；切分处理缺中文 / 标题 / 重点词时复用 `passage_translate` |
  | 模型测试 | `fragments/system/model_test.md` | 无（`-nt`） | `services/ai_model.rs::test_model` |

- 原则：**确定性的工作放进代码或工具**（分词计数、格式校验、日期与复习排期），模型只做判断与生成；结构化结果一律经 `submit_*` 工具交付，Rust 侧再按输入校正（只接受请求中的词、补齐遗漏）。新增 LLM 能力一律做成 agent 任务。
- 任务用哪个模型：命令显式传的 model_id > 「设置 → AI 助手」的任务模型（`app_settings` 表 `agent.model.<task>`，task = extract/phonics/examples/plan/explain/tutor/passage，短文的规划 / 写作 / 出题 / 评分 / 导入翻译都用 passage）> 默认模型，统一经 `services/agent_settings.rs::AgentSettingsService::model_for`；批量分析的每批词数 / 同时请求数也在这里（`agent.batch_size` / `agent.max_concurrency`），后端以设置为准；所有 agent 任务共用一个等待上限 `agent.timeout_minutes`（3–60 分钟，默认 15，`agent_settings::task_timeout`，启动与保存时生效），任务不再各自定超时。
- 模型配置：`ai_providers.pi_provider`（映射 pi 内置提供商）/ `api`；`ai_models` 的生成参数 `ModelGenerationSettings`（最大输出、温度、思考档、额外参数 → samplingParams、上下文、推理）整体保存；sidecar 启动时由 `agent/src/config.ts` 转成 pi 的 models.json。密钥只经 `REDLARK_KEY_<id>` 环境变量传入。
- 进度：耗时的工作是**后台任务**（`src-tauri/src/jobs.rs`，唯一 owner，不再另建进度管理器）：命令 `start_*` 提交后立即返回 jobId，任务在 agent（同时 2 个）/ media（同时 1 个）队列里执行，`JobCtx` 报告进度 / 阶段 / detail、检查取消，变化经 `job-updated` 事件推送；前端 `useJobs`（全局 store）/ `useJob(id)`（发起页面的内嵌进度）/ `waitForJob`，顶栏任务按钮与任务面板在 `components/Jobs/`。`detached` 任务结果由后端写库，离开页面继续（批量分析、写短文、导入材料、出题、视频导入 / 规划 / 切分）；非 detached 的结果只给页面用，页面离开时取消（计划 AI 排序 `start_study_plan_ordering`）。任务只放内存，需要跨重启的状态由业务表自己记。
- 真实调用回归：`cargo test agent::tasks::tests::real_ -- --ignored`（需 `REDLARK_E2E_MOONSHOT_KEY`）；提示词评测 `node agent/eval/eval-phonics.mjs` / `eval-extract.mjs`（需 `EVAL_MOONSHOT_KEY`，结果写 `agent/eval/results/`）。

## 5. 前端架构（React/TS）

### 5.1 路由
`App.tsx` 的 `switch(currentPage)`，页面通过 `onNavigate(page, params)` 跳转。有效 page 键：
`home` `plans` `create-plan` `plan-detail` `wordbooks` `wordbook-detail` `passages` `create-passage` `import-passage` `passage-detail` `word-practice` `passage-practice` `practice-result` `videos` `video-editor` `calendar` `settings`。侧边栏：一级 首页 / 计划 / 日历，分组「素材库」= 单词本 / 短文库 / 视频库（`AppShell` 的 `NAV_GROUPS`）。剪辑编辑器 `pages/video-editor/`（时间轴自绘，规划操作是 `plan.ts` 纯函数）是整窗页面。路由表唯一 owner 是 `src/navigation.ts` 的 `RouteParams`（键 → 参数类型），`onNavigate` 类型为 `NavigateFn`，无别名键。
新增页面：`RouteParams`、`TOP_LEVEL_OF`、`PAGE_TITLE` 加键 → pages/ 下建 `XxxPage.tsx` → App.tsx 加 case（tsc 会指出遗漏）。页面由 `AppShell`（侧边栏 + 顶栏面包屑）包裹，只渲染内容区；整窗专注页面（单词练习、短文练习）列入 `FOCUS_PAGES`。

### 5.2 服务层
```ts
class FooService extends BaseService {
  async getFoo(id: number, setLoading?) {
    return this.executeWithLoading(
      () => this.client.invoke<Foo>('get_foo', { fooId: id }),   // camelCase 参数
      setLoading
    );
  }
}
export const fooService = new FooService();
```
- `ApiResult<T> = { success: true; data: T } | { success: false; error: string; code?; detail? }`（`error` 是给用户看的话，`detail` 是原始错误），调用方必须判 `success`，**不要 try/catch 服务层**；所有服务都返回 ApiResult、不抛异常。
- 现有服务（均为模块级单例，组件内不要 `new`，按文件路径导入）：`wordBookService` · `studyService` · `practiceService` · `calendarService` · `passageService` · `materialService`（资料文件读成文本，单词本提取与短文导入共用）· `dataManagementService` · `ttsService` · `aiModelService` · `agentSettingsService` · `promptProfileService` · `wordExplanationService` · `wordAnalysisService` · `updateService`（应用内更新）· `jobService`（后台任务）· `videoService`（视频库）。
- 类型放 `src/types/*.ts`，字段名与 Rust struct 的序列化结果保持一致（大部分 Rust 类型是 snake_case 输出；`types/tts.rs` 等少数标了 `rename_all = "camelCase"`，改字段前先看 Rust 侧的 serde 属性）。

### 5.3 样式与主题
标准：**shadcn/ui + Tailwind CSS v4**。原语在 `src/components/ui/`，业务组件组合原语，类名用 `cn()` 合并，导入用 `@/` 别名；颜色只用语义 token 类（`bg-primary`、`text-muted-foreground`），禁止硬编码色值与 Tailwind 原始色板；交互统一用 Button / Dialog / AlertDialog / sonner toast / Form / DropdownMenu，图标 `lucide-react`。细则、接入验收与迁移共存规则以 `.claude/skills/deliver-frontend-react/references/ui-system-standard.md` 为准。
- **交互与布局不自己发明**：先按场景采用 shadcn Blocks / Examples / 组件文档示例，其次 WAI-ARIA 与桌面平台惯例；都没有才自定义并在批次说明中写明理由。场景 → 模式表见 `.claude/skills/deliver-frontend-react/references/ui-interaction-patterns.md`；它的 §5 是桌面应用约定（本项目是桌面 app，不按网页做）。
- **改版不丢功能**：每个改版 / 重做批次先从代码盘点该页功能清单，完成后逐条核对；删减或合并功能须用户同意。
- 新增原语用 `npx shadcn@latest add <name>`（生成后检查导入应为 `@/lib/utils`、未安装名为 `cn` 的包、未往 app.css 追加 `.dark {}`）。
- 只写 Tailwind 类，不新建 `.module.css` 或全局 CSS 变量；全局样式只在 `styles/app.css`。轻提示用 `useToast()`（底层 sonner，右下角），页面加载失败用 `PageError`、弹窗 / 表单内提交失败用 `InlineError`，设置类页面用 `components/SettingsLayout`；何时用哪种、标题与原因怎么写（“已…” / “无法…” + `result.error`）见 `ui-interaction-patterns.md` §6。服务层失败的 `result.error` 已由 `api/errors.ts::toUserMessage` 转成用户能看懂的说法，调用点不再拼兜底文案。
- 主题 owner：`useTheme`（全局单一状态，偏好 浅色 / 深色 / 跟随系统存 localStorage）写 `document.documentElement[data-theme]`，`dark:` 经 `@custom-variant` 跟随 `data-theme`。最小窗口 1200×800，窄屏断点 `max-md:` / `max-sm:`。

## 6. AI 提示词
提示词全部是 `src-tauri/src/prompts/` 下的独立文件，`include_str!` 编译进二进制，由 `src-tauri/src/prompts.rs`（唯一 owner）选片段、填变量、渲染：
- `agent/*.md`：各任务系统提示词模板 —— `extract_words.md`（提词）· `generate_words.md`（按意图生成）· `phonics_batch.md`（批量拼读 + 规则库）· `study_plan_order.md`（学习顺序）· `word_explain.md`（单词讲解，正规记忆法 + 正确性自查）· `word_examples.md`（例句）· `word_tutor.md`（AI 老师答疑）· `passage_plan.md` / `passage_generate.md` / `passage_questions.md` / `passage_grade.md` / `passage_translate.md`（短文：内容规划 / 写短文 / 出题 / 开放题评分 / 导入材料翻译）· `video_plan.md`（视频：规划场景切分）。规则、格式、正确性约束写死在模板里；学习者、水平、语言、风格、补充要求经 `{{变量}}` 注入。
- `fragments/<维度>/<取值>.md`：learner / level / language / explain_length / memory / tutor_style / phonics_terms / ipa / extract_mode / system（模型测试）。
- `messages/*.md`：发给模型的用户消息模板（单词资料、答疑上下文、例句任务等）。
- 语法：`{{x}}` 替换，**变量为空的整行删除**；`{{#x}}…{{/x}}` 非空才保留、`{{^x}}…{{/x}}` 为空才保留。新增变量必须在 `prompts::tests` 里保证所有任务 × 预设渲染后无残留 `{{`。
- 学习者档案 `PromptProfile`（设置 → AI 助手 → 学习者与风格；`app_settings` 键 `prompt.profile`，`services/prompt_profile.rs`）：预设 小学生（默认，等同模板化前的行为）/ 中学生 / 成人。
- 单词本场景（D22）：单词本的标题 + 描述 + 主题标签经 `messages/book_scene.md` 渲染（`prompts::book_scene`，读取在 `PromptProfileService::book_scene`），放在生成、提取、拼读分析、例句、讲解、答疑的**用户消息**最前面（不进系统提示词）；生成 / 提取时定好的释义经 `start_word_analysis(meanings)` → `PhonicsContext` 传给拼读分析沿用。
- **改提示词需要重新编译**；工具（参数 schema、校验）在 `agent/src/tools/*.ts`，改工具需 `npm run agent:build`。
- 改提示词前后用 `agent/eval/` 评测对比：先 `cd src-tauri && cargo test prompts::tests::render_eval_prompts -- --ignored` 渲染到 `agent/eval/rendered/<预设>/`（不入库），`EVAL_PRESET=primary|secondary|adult` 选预设；结论写进 work item evidence。

## 7. 开发规范（硬性）

### 7.1 数据库迁移
1. **只增不改**：任何表结构变更都新建 `NNN_description.sql`，序号连续（下一号 060），绝不修改已有迁移。
2. **禁止删库重建**解决问题；向前兼容现有数据（SQLite 改列需走 建新表 → 拷数据 → drop → rename 模式，参考 020/023/031）。
3. 新增迁移后在 Repository 里补对应字段映射，并同步 `types/*.rs` 与 `src/types/*.ts`。
4. 怎样在 SQLite + sqlx 上做到以上三条（重建表模式、兼容已有数据、空库/真实库双验证）以 `.claude/skills/deliver-backend-rust/references/sqlx-migration-standards.md` 为准。`.claude/hooks/guard-migrations.sh` 会拦截对已有迁移文件的编辑。
5. **升级安全（发行不变量）**：0.1.0 是第一个发行版，之后用户从 GitHub Releases 下载或经应用内更新覆盖安装升级。`tauri.conf.json` 的 identifier、`app_paths::DB_FILE` 永不修改；已提交到 main 的迁移登记在 `src-tauri/migrations.lock`（sha256），新迁移提交前用 `python3 scripts/check-release-invariants.py --update` 登记，已登记的不可修改 / 删除 / 改名（verify 与 CI 强制）。迁移须能在“上一个发行版的真实数据”上执行成功，`startup::tests` 有端到端升级用例。

### 7.2 Tauri 命令与参数
- Rust 参数 `snake_case`，前端 invoke 传 `camelCase`，Tauri 自动转换（`bookId` ↔ `book_id`）。前端**禁止**传下划线键名。
- 命令参数用基础类型：`String / Option<String> / i64 / Option<i64> / bool / Vec<String>`；避免 `Option<Id>` 别名和自定义枚举作为顶层参数（复杂数据用一个 `request: XxxRequest` 结构体）。
- 签名模板：`pub async fn cmd(app: AppHandle, ...) -> AppResult<T>`。
- 完整映射表见 `docs/NAMING_CONVENTIONS.md`；serde 形状、类型同步与六点对账清单以 `.claude/skills/deliver-contract-and-data/references/tauri-ipc-contract.md` 为准。

### 7.3 代码风格
- TS：函数组件 + Hooks；named export（`App.tsx`/部分 pages 仍是 default export，新代码不要再加）；业务组件 PascalCase、一目录一组件（`src/components/ui/` 的 shadcn 原语例外，kebab-case 单文件）；样式只写 Tailwind；接口字段补 JSDoc。
- Rust：`cargo fmt`；`cargo check` / `cargo clippy` 零警告（verify 用 `-D warnings` 强制）；SQL 只在 repositories；错误用 `AppError` 变体而不是 `anyhow!` 字符串直接上抛。
- 一个用户动作写多张表 → service 开事务、repository 写方法接收 `&mut SqliteConnection`（`.claude/skills/deliver-backend-rust/references/transaction-and-repository-conventions.md`）。不留 `TODO` 空实现，不吞 contract 写入的错误。
- 错误 wire 形状固定为 `{code, message}`（`AppError` 手写 Serialize），见 IPC contract §4。
- 日志：handler 入口 `api_request`，出口 `api_response`（只读查询 `get_/list_/preview_/find_/diagnose_` 成功记 DEBUG，其余 INFO，失败一律 ERROR）；日志参数里不得出现 API Key 明文，长文本只记长度。前端禁止 `console.log/info/debug`（ESLint `no-console` + 棘轮）。
  - 级别含义：ERROR = 操作失败、需要排查；WARN = 降级 / 自动恢复 / 结果可疑但继续（重试、校验退回、读设置失败用默认）；INFO = 用户动作与业务结果（改数据的命令、练习完成摘要、后台任务提交 / 结束、AI 运行开始 / 完成、启动与升级）；DEBUG = 排查明细（只读查询、SQL、发给模型的消息与工具结果）。
  - 组件名大写（`API` `AGENT` `JOB` `DATABASE` `STARTUP` `TTS` …）；前端经 `apiClient.log` → `write_client_log` 写入，组件名带 `UI:` 前缀（界面崩溃、未捕获异常、没进到命令里的 IPC 错误）。不要留 `*_DEBUG` 之类的临时组件；吞掉的错误（`.ok()`、`let _ =`）若影响结果，至少记一条 WARN。完整规范与改动自查清单：`docs/LOGGING.md`（新增功能时按它判断要不要记、记几级）。
- 敏感数据：API Key 不得出现在任何返回给前端的列表类型里（用 `*Safe` 类型 + `mask_api_key`）。

### 7.4 测试与验证
- 算法/统计/状态机/多表写入用例写 Rust 测试（crate 内，`test_support::memory_pool()`）；前端纯函数写 `*.test.ts`。
- 没有 Rust 工具链的环境（如受限网络的 agent 环境）不得声称编译/测试通过；在检查点请开发者运行 `npm run verify` 并读取日志。
- UI 流程需 `npm run tauri:dev` 手工验证；提交前至少跑 `npm run type-check && cargo check`。
- 改动命令签名时，全局 grep 前端 `invoke<...>('command_name'` 确认调用点同步。

### 7.5 时间与时区
用户决定：**存储一律 UTC，展示按客户端（本机）时区**。完整规范：`.claude/skills/deliver-contract-and-data/references/time-and-timezone.md`。
- 两类值：**时刻**（`*_at` / `*_time`）存 UTC 定长 `YYYY-MM-DDTHH:MM:SS.sssZ`；**日历日期**（`*_date`）存 `YYYY-MM-DD`，永不做时区换算。历史上的 `YYYY-MM-DD HH:MM:SS` 与 `to_rfc3339()` 值已由迁移 047 归一；读取仍一律经解析函数。
- “今天”按本机本地日期：后端只经 `time::local_today()`（一次请求取一次），前端 `useToday()` / `localToday()`；禁止截取 UTC 字符串当日期、禁止 `new Date('YYYY-MM-DD')`。
- 前端解析与展示只经 `src/utils/datetime.ts`（ESLint 强制）；后端取时只经 `src-tauri/src/time.rs`（`scripts/check-time.py` 棘轮，基线 `.time-baseline.json`），写入时刻显式绑定（INSERT 列出全部时刻列，不依赖旧格式的列 DEFAULT）；写入路径的测试末尾调用 `time::assert_instants_canonical`。

## 8. 已知债务 / 注意事项


- 历史迁移 020 / 021 / 023 / 031 在外键开启下重建 `study_plans`，会级联清空当时已有计划的子表数据（已实测）；不要以它们为重建模板，见 `sqlx-migration-standards.md`。
- `src/types/api.ts` 中 Health/Export/Import 类型对应的后端未实现。
- `src-tauri/Cargo.toml` 的 `[lib] name = "redlark_app_lib"`，包名 `pindu-app`；应用数据目录随 identifier 为 `com.redlark.pindu-app`（macOS: `~/Library/Application Support/com.redlark.pindu-app/`）。**identifier 与库文件名发布后永不修改**（见 §7.1 第 5 条）；productName 可以改（只影响应用名，macOS 上旧名字的 .app 需要用户手动删除）。
- `CLAUDE.md` + `.claude/skills` 是唯一的 agent 规则入口，不再引入其它工具（Augment、spec-workflow、superpowers 等）的规则文件。
- 前端自动化测试刚起步（`node --test` 覆盖纯函数）；组件行为仍靠 `tauri:dev` 走查。

## 9. 典型改动路径

**加一个新后端命令并在前端使用**
1. `repositories/xxx_repository.rs` 加查询方法 → 2. `services/xxx.rs` 加业务方法 → 3. `handlers/xxx.rs` 加 `#[tauri::command]` → 4. `lib.rs` `generate_handler!` 注册 → 5. `src/types/*.ts` 补类型 → 6. `src/services/xxxService.ts` 加方法 → 7. 页面/组件调用并处理 `success === false`。

**改表结构**
`migrations/060_*.sql` → Repository 映射 → `types/*.rs` → `src/types/*.ts` → 受影响的 Service/组件。

**改 AI 行为**
`src-tauri/src/prompts/agent/*.md`（提示词）/ `agent/src/tools/*.ts`（工具与校验）→ `agent::tasks` 的结果校正 → `npm run agent:build` + 重新编译 → `agent/eval/` 前后对比 + 设置页「测试」与真实 Provider 验证 → 在 DECISIONS.md 追加决策。

## 10. 开发 Harness（SDD Skills）

多步骤开发工作由 `.claude/skills/<id>/SKILL.md` 定义流程，本文件只保留共通事实与硬约束。完整导航见 `.claude/skills/README.md`。

**开始任何任务前**：读本文件 → `git status --short` 保护他人未提交改动 → 如有匹配的 `.claude/work/<work-id>/` 先读 `progress.md` → 按 Skill 的 description 选最小匹配入口并完整读取其 `SKILL.md`。

| 场景 | 入口 |
| --- | --- |
| 端到端 feature / bugfix / refactor / improvement | `sdd-work`（再分流到 plan / analyze / implement / verify） |
| 只要方案、拆批次 | `sdd-plan` |
| 原因不清、数据不对、命令调用失败 | `sdd-analyze`（证据地图：`sdd-analyze/references/redlark-diagnostic-map.md`） |
| 执行一个已明确的批次 | `sdd-implement` → 调度 `deliver-backend-rust` / `deliver-frontend-react` / `deliver-contract-and-data` / `deliver-ai-prompt` |
| 验收、测一下 | `sdd-verify`（方法：`sdd-verify/references/verification-methods.md`） |
| 续跑、交接 | `harness-context-memory` |
| 把失败补成测试 | `harness-regression-curation` |
| 改本文件 / Skill / hook | `harness-governance` |
| 发布新版本（仅显式） | `/sdd-release`（人看的流程：`docs/RELEASING.md`） |

**从改动到发布**：每个改动在 `sdd-work` 判断发布影响；验收通过后，用户可见的改动记入 `docs/releases/UNRELEASED.md`；提交到 main 且 CI 绿才算完成；发版由用户显式 `/sdd-release`（UNRELEASED.md → `vX.Y.Z.md` → 打标签 → CI 出 Release 草稿 → 用户发布 → 应用内更新）。

**原则**：任务类型只改变要保护的约束，不选择不同的阶段链；当前会话能闭环的任务不建 work item；`progress.md` 是运行状态唯一 owner；没有实际命令或可复查产物不得声称验证通过；`cargo check` 通过不证明命令已注册，`tsc` 通过不证明字段对得上（字段对账用 `check-type-sync.py`）。

**可执行 gate**（`.claude/settings.json`）：编辑已有迁移文件、`sed -i`/`git checkout` 历史迁移、删除应用数据库、整文件输出 `.env`/密钥会被 hook 拦截并提示替代做法。
