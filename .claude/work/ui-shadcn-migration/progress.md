# Progress

## 当前状态
B0+B1+首页试点已实施（2026-10-07），等待用户在 `npm run tauri:dev` 中看效果。

## 已完成
- 2026-10-07 harness：`ui-system-standard.md`、`ui-interaction-patterns.md`（含 §5 桌面约定）等；`validate-skills.sh` 通过
- 2026-10-07 改版前功能盘点 → `feature-inventory.md`
- 2026-10-07 外壳原型 https://claude.ai/artifact/YcUgjy3q8JP2nxJCKBfEQs （用户：模式可以，按桌面 app、不丢功能）
- 2026-10-07 实施：
  - 依赖：React 19、Tailwind v4（`@tailwindcss/vite`）、shadcn（components.json，new-york）、lucide-react、tw-animate-css
  - `src/styles/app.css`：shadcn token（品牌色）+ `@theme inline` + `@custom-variant dark`（跟随 data-theme）；`globals.css` reset 移入 `@layer base`
  - `AppShell`（shadcn Sidebar，折叠状态存 localStorage；侧栏底部 系统日志 / 主题切换 / 设置）；`navigation.ts` 增 `SHELL_PAGES` / `TOP_LEVEL_OF` / `PAGE_TITLE`
  - 首页重写：`PlanSummaryCard`、`WordBookSummaryCard`（新）、`IncompletePracticeModal` 迁到 shadcn Dialog
  - 验证：`tsc` 通过；lint 棘轮 0/0；`npm test` 53 通过；`check-css-vars` 0 未定义（脚本已识别 Tailwind 内置变量）；`vite build` 成功，CSS 层序 theme→base→components→utilities

## 首页功能对等核对（inventory §1）
保留：快捷“创建单词本 / 创建学习计划”（含 toast，改为页头按钮）、计划与单词本“查看全部”、两个空态、计划卡全部字段与按状态动作、单词本卡全部字段（≤6）、学习统计 4 项、错误按数据源列出 + 重试、整页加载（改骨架屏）、未完成练习启动提醒（全部字段、继续、行内确认放弃、稍后再说）、系统日志入口（移至侧栏底部）。
变化（待用户确认）：错误由“横幅 + ErrorModal”合并为页内 Alert；计划卡底部重复的“学习进度”条去掉（与上方学习进度同一数据）；计划卡 ⋯ 菜单由空 TODO 改为“查看详情 / 主操作”并支持右键；新增主题切换。

## 首页卡片信息设计（2026-10-07 第二轮，用户反馈“卡片信息结构和内容要优化”）
- 单词本卡：名称 + 描述（缺省“暂无描述”占位，卡片等高）→ 单词数主数字 + “用于 N 个计划 / 未加入计划” → 词性构成条（只列非零项，悬停看全部）→ 一行相对时间（last_used 与 created_at 同一分钟视为未使用，显示“创建于”）
- 计划卡：名称 / 描述 / 状态 → 三指标（学习进度 % / 已学 x/总数 / 平均正确率，未作答显示“—”）→ 学习进度条 + 时间进度刻度（进行中时提示 落后 / 领先 / 正常）→ 日程方块 + “日程 x/y 天 · 延期 n 天” → 底部 强度·周期·日期 + 主操作
- 新增 `utils/dateLabel.ts`（SQLite UTC 时间戳解析、相对日期、短日期）+ 测试；npm test 58 通过，tsc / lint / css-vars / build 通过
- 待确认：`word_books.last_used` 实际在单词数量更新时刷新（`update_statistics`），语义更接近“最近更新”

## 首页第三轮（2026-10-07，用户：计划卡再优化；统计改左右两栏 + GitHub 式热力图）
- 新命令 `get_daily_learning_activity(days: 1–730)` → `Vec<DailyLearningActivity { date, practiced_words, mastered_words }>`：练过 = 当天有首次作答（kind=learn）的不同单词（含未完成会话）；学会 = 口径同 practice_metrics；本地日期；排除已删除计划。repository + service（校验）+ handler + lib.rs 注册 + TS 类型 + `studyService.getDailyLearningActivity`；Rust 测试 `daily_learning_activity_counts_practiced_and_mastered_by_local_day`
- `utils/learningHeatmap.ts`（网格 / 等级 / 月份标签，有测试）+ `LearningHeatmap` 组件（周数随宽度 12–53 自适应，悬停看当天练习 / 学会数，今天描边）
- 统计区：左 2×2 指标（带图标与单位），右热力图
- 计划卡改为整行四栏：计划（名称、状态、参数、描述仅在有时显示）→ 单词进度（已学/总数 + % + 进度条与时间刻度 + 正确率 + 进度快慢）→ 日程（按日期算“第 n/N 天”或“x月x日开始”、等宽日程块、完成/延期/未开始计数，图例并入卡内）→ 主操作 + ⋯
- 验证：tsc、lint 0/0、npm test 61、css-vars 0、vite build、check-ipc-contract 0 错、check-type-sync 0 错、check-sql 0 失败、cargo clippy -D warnings、cargo test 132 通过

## 学习计划 / 单词本 / 日历 列表页（2026-10-07）
- `SHELL_PAGES` = home / plans / wordbooks / calendar
- 新共享组件：`MetricCard`、`EmptyState`、`PageHeader`（首页同步改用）；shadcn 新增 select / tabs / alert-dialog
- 学习计划：统计 4 卡（已完成卡附完成率）；状态筛选改为 Tabs 并带数量（新增“已暂停”）；“全部”视图只显示非空分组，顺序改为 进行中→待开始→已暂停→草稿→已完成→已终止；计划行复用 PlanSummaryCard；页面自己的开始逻辑（待开始直接进练习、无日程时提示并进详情）保持
- 单词本：统计 5 卡；工具栏 搜索（可清除）/ 主题 / 状态（后端过滤）/ 排序 / 重置（带激活数）/ “共 N 本”；卡片显示 草稿 / 已删除 标签；空态区分“无匹配”与“还没有”；状态加载合并为一个 effect（原来挂载时会加载两次）
- 日历：月历卡（上/下月按钮、不在本月时“回到本月”、日格 新/复 + 进度 + 状态底色、悬停显示当天计划名与数量、图例移到月历下）；右侧 今日计划 / 未完成练习 / 本月统计；放弃练习确认改为 AlertDialog
- 删除已无引用的旧组件：StudyPlanSection、StudyPlanCard、StatsOverview、FilterSelect、WordBookCard、WordBookStats、WordBookFilter 及三个页面的 .module.css
- 变化待确认：去掉单词本“按完成度”排序（原本未实现）与筛选面板折叠；计划“全部”视图不再显示空分组（已删除标签已按用户要求去掉）
- 协作：另一会话（后端 / 逻辑）同时把两页的逐本词性请求改为 `book.word_types`，已确认保留；已通过 SendMessage 同步本轮改动
- 验证：tsc、lint 0/0、npm test 61、css-vars 0（脚本识别 --radix-*）、type-sync 0、vite build

## 迁移 plan-detail 时必须保留（2026-10-07 后端会话告知；该会话暂不改 plan-detail / wordbook-detail 前端）
- `PlanDetailPage` 的 `CONFIRM_MESSAGES`（编辑 / 重新学习 / 终止 / 完成 / 删除的后果说明）及编辑、重新学习成功后的 toast 文案
- `PlanStatisticsView` 的“单词掌握率”“当前连续学习”标签；`PlanLogsView` 按本地日期解析 scheduleDate
- 后端语义（文案与按钮须与之一致）：编辑只转草稿不删数据；重新学习保留日程并平移到今天；第一次练习自动开始；全部练完自动完成
- `useToast()` 返回稳定引用（日历页 effect 依赖它）

## 学习计划删除改为物理删除（2026-10-07 用户决定）
- 后端 `delete_study_plan` → `StudyPlanRepository::delete_plan_conn`（事务内 DELETE，子表级联）；不存在返回 NotFound；测试新增 + 旧软删除断言更新；cargo test 136、clippy 0
- 前端学习计划页去掉“已删除”标签
- 用户决定（2026-10-07，后改）：历史软删除的计划**用迁移清理**（“这种数据问题不适合做成一个功能”），由后端会话做迁移 048；不在设置里做清理功能
- 删除后刷新单词本 linked_plans（后端会话提醒），测试断言归零
- 已通知后端会话

## 单词本详情（2026-10-07）
- `SHELL_PAGES` 加入 wordbook-detail；AppShell 顶栏改为 shadcn Breadcrumb：子页面自动显示父级（由 TOP_LEVEL_OF 推出，可点击返回），末项为页面经 `usePageTitle()` 设置的动态标题（如单词本名）
- 页面重写：头部（图标 / 名称 / 状态 / 主题 / 描述 / 创建与更新日期 + 编辑 + ⋯ 删除）、5 个词性指标、Tabs（单词 / 关联计划，带数量）
- `WordListTable` 整组件迁移为 shadcn 数据表（props 不变，计划详情只读模式继续可用）：勾选与选择条（全选 / 清除 / 删除选中）、行内 发音 / 例句、⋯ 菜单与右键菜单（播放发音 / 朗读例句 / 编辑单词 / 删除）、页码分页
- 弹窗迁移（props 不变）：BatchDeleteModal、DeleteWordBookModal → AlertDialog（后者仍需输入名称确认）；EditWordBookModal、EditWordModal → Dialog；ThemeSelector → 标签切换按钮组
- 新增 `WordBookIcon`（数据库 icon / icon_color → lucide 图标与语义色）；首页与单词本列表的卡片恢复显示单词本自己的图标（上一轮遗漏，已补）
- 修复：编辑单词入口恢复（原表格未渲染）；编辑单词原先只在第 1 页查找完整数据，现直接用当前页数据
- 删除：pages/wordbook-detail/*、WordBookDetailPage.module.css 及各弹窗 / 表格 / ThemeSelector 的 .module.css
- 验证：tsc、lint 0/0、npm test 72、css-vars 0、ipc 0 错、vite build

## 创建单词本 + 导入单词（2026-10-07）
- `SHELL_PAGES` 加入 create-wordbook；新共享组件 `Stepper`（向导步骤条）；新工具 `utils/partOfSpeech.ts`（词性中文名 + 归一，有测试；替换 4 处重复实现）
- 创建单词本：三步向导（基本信息 / 导入单词 / 确认内容）；修复：确认步骤的主题按名称从真实标签取（原按内置列表 id 查找，真实标签下显示为空）；新单词本图标改为 bookmark + 主题颜色（原写入 emoji，图标组件无法显示）
- `WordGrid` 迁移（已选计数、全选、按词性快速选择、单词卡含拼读与例句）
- `WordImporterModal` 迁移：5 步步骤条；分析进度改为弹窗内联 `BatchAnalysisPanel`（不再叠第二层弹窗；可取消、用时 / 预计剩余、状态计数、单词状态与失败原因）；三处 `window.confirm` 改为 AlertDialog（关闭中断分析、长文本确认、分段处理建议）；错误分类说明 + 知道了 / 重新提取 / 了解分段处理
- **修复提取模式不生效**：`extract_words_from_text` 增加可选参数 `mode`（focus / all，校验，默认 focus），前端 service 传入；此前 UI 选择被忽略、后端写死 focus
- 删除：WordAnalysisProgressModal 组件、CreateWordBookPage.module.css、WordGrid / WordImporterModal 的 .module.css
- 验证：tsc、lint 0/0、npm test 74、css-vars 0、ipc 0 错、check-time 未增加、cargo check、vite build

## 计划详情（2026-10-07）
- `SHELL_PAGES` 加入 plan-detail；面包屑末项为计划名
- 页头：名称 + 状态 + 描述 + “每天 N 个新词 · 周期 · 起止 · 单词数”（`daily_new_words` 由后端会话新增）；操作：进入练习（进行中）→ 主操作按钮 → 终止 / 删除进“⋯”菜单（`groupPlanActions`，有测试；恢复 / 永久删除不再出现）；草稿显示“发布计划”提示条
- 学习进度卡（共享 `PlanProgressBar`：学习进度 + 时间刻度 + 快慢提示，计划卡同步改用）；**记忆等级卡**（后端会话新增 `get_plan_memory_overview`：等级 1–5 分布、未学 / 学习中 / 已掌握、今天待复习或下次复习日）
- 指标：总单词 / 已掌握（srs_box≥4 口径）/ 平均正确率 / 连续学习 / 今日任务（来自当天日程，含新学·复习拆分）
- 视图：概览（计划日历重写，**前端按周一起排网格**、按日期取数，不再依赖后端周日起的顺序）、日程安排（改用 `get_study_plan_schedules`，**接口增量返回 day / new / review / completed_words_count**；用时与暂停按日期汇总练习会话；可展开当天新词；开始 / 继续 / 再次练习）、单词列表（只读数据表）、统计分析（MetricCard + 词性构成条 + 详细统计）、学习日志（表格，未完成可继续）
- 保留后端会话要求：CONFIRM_MESSAGES 原文、编辑 / 重新学习的 toast 文案、“单词掌握率”“当前连续学习”标签、日志按本地日期显示
- 删除：PlanHeaderSection、PlanDetailPage.module.css、StudyCalendar.module.css、StatCard、StatusTag；planDetailDisplay 去掉强度显示与 FontAwesome 图标名
- 验证：tsc、lint 0/0、npm test 74、css-vars 0、ipc 0 错（97 命令）、type-sync 0、check-time 未增加、相关 cargo test 通过、vite build

## 创建计划 / 编辑计划（2026-10-07）
- `SHELL_PAGES` 加入 create-plan；三步向导（基本信息 / AI 规划 / 确认创建），参数为“每天新词数 + 开始日期 + 单词本”，含预估说明
- 共享件迁移：WordBookSelector（可勾选卡片 + 已选汇总）、AIModelSelector（Select，首项系统推荐，自动选默认，错误可重试，所选模型说明）、PlanningProgress（**整屏遮罩改为内联卡片**，轮询策略不变，可取消）、StudySchedulePreview（只保留预览：参数摘要 + 新词日可展开；“强度 / N 次复习”去掉）
- EditPlanModal → Dialog + Tabs（基本信息 / 日程规划）；每天新词数优先读计划 `daily_new_words`；修复取消判断用了过期的 abortController（改用 ref）
- 删除：CreatePlanPageV2.module.css 与上述组件的 .module.css
- 验证：tsc、lint 0/0、npm test 74、css-vars 0、vite build

## 练习结果 / 单词练习（2026-10-07）
- 练习结果：`SHELL_PAGES` 加入 practice-result；等级 + 关键数据、6 个 MetricCard、检查点徽章（复习词只有“复习”）、本次通过 / 需要复习单词卡；“完全掌握”改称“本次通过”（与 srs≥4 的“已掌握”区分）
- 单词练习：**专注模式**（不进 AppShell，页面自绘整窗框架：退出 / 进度 / 计时 / 暂停），只改渲染，所有状态与副作用逻辑原样保留；退出确认 → AlertDialog
- 组件迁移（props 不变）：PracticeWordCard（字母格、错字标红 / 漏字下划线、拼读块朗读高亮、遮罩与锁定、输入框状态色、Enter 提示）、PracticeFeedback（浮层提示）、WordSidePanel（页签 + 锁定 / 去看看）、PanelToolbar（图标改为 lucide 组件）、ExamplePanel、WordExplanationView（讲解 + AI 老师对话）；新增 `Kbd`；`app.css` 增加 `.markdown-body` 排版（react-markdown 输出）
- 首页“继续上次的练习”常驻入口由后端会话完成（ContinuePracticeBanner）
- 删除：WordPracticePage / PracticeResultPage 及上述组件的 .module.css
- 验证：tsc、lint 0/0、npm test 74、css-vars 0、ipc 0 错、type-sync 0、vite build
- 待用户决定：旧版 start-study-plan / finish-study-plan（假数据、互相跳转、应用内无入口）及其专用组件（WordCard、WordDetail、StudyHeader、StudyProgress、CongratulationsBanner、StudyStatistics、ActionButtons 等）是否删除

## 学习计划模块的契约变化（2026-10-07 后端会话完成自适应复习后告知，冻结已解除）
- 创建 / 编辑只选“每天新词数” + 开始日期（`StudyPlanScheduleRequest.dailyNewWords`，`planMetadata.dailyNewWords`，`utils/planParams.ts`）；周期 = 学新词天数 + 11 天巩固；intensity_level / review_frequency 仅兼容保留，不再显示“N 次复习”
- `ai_plan_data.dailyPlans` 只有新词日；复习按记忆等级动态进入当天日程 → 计划详情日程页改用 `get_study_plan_schedules`
- 练习：`isReview` 词只考第三步；复习词检查点只有一个“复习”徽章
- 已掌握 = `srs_box ≥ 4`（总学习单词、计划 completed_words / actual_progress_percentage、练习统计 words_learned）；日程 completed_words_count 与热力图 mastered_words 仍是“当次通过”
- 计划在全部单词掌握后自动完成；如需“记忆等级分布 / 今日待复习”，请后端会话加命令

## 设置（2026-10-07）
- `SHELL_PAGES` 加入 settings；页面改为 PageHeader + shadcn Tabs（AI 模型配置 / 语音合成 / 通用设置 / 数据管理）；页面级错误弹窗改为 toast（沿用 ErrorModal 的 formatErrorMessage / getErrorType）
- AI 模型：默认模型 Select（按提供商分组）、提供商列表 + 详情卡、模型行（测试 + ⋯ 菜单）、删除确认 AlertDialog；SyncModelsModal / ModelFormModal / ProviderFormModal → Dialog（空选项用哨兵值）
- 语音合成：TTSSettings、TtsConfigModal（Slider，资源 ID“自动”哨兵）、VoiceSelector
- 数据管理：概览 MetricCard + 刷新统计；数据表列表 + 选择性重置（Checkbox、全选 / 取消全选、已选汇总）；危险操作区；重置 / 删库两步确认 Dialog（输入 RESET / DELETE DATABASE），文案保留；`alert()` 改 toast
- 通用设置：新增“外观”（浅色 / 深色 / 跟随系统）；`useTheme` 改为全局单一状态（useSyncExternalStore），侧栏切换与设置页同步，跟随系统时监听系统变化
- 删除：SettingsPage.module.css、AIModelSettings.module.css、SyncModelsModal.module.css、VoiceSelector.module.css
- 验证：tsc、lint 0/0、npm test、css-vars 0、ipc 0 错、type-sync 0、check-time 未增加、vite build
- 计划详情（PlanDetailPage / pages/plan-detail / StudySchedulePreview）已由后端会话交还（2026-10-07）

## 设置页按桌面设置窗口重做 + 全局设施（2026-10-07，用户反馈“设置很粗糙”，参考 Codex / Claude 桌面版设置截图）
- 新增 `components/SettingsLayout`（SettingsPanel / SettingsSection / SettingsRow）：分组标题 + 圆角卡片 + 设置行（左名称与说明、右控件），下钻行带 `›`，面板顶部「‹ 返回」；危险组描红
- SettingsPage：左栏 标题 + 搜索（按名称与关键词过滤，Enter 打开第一项）+ 分组导航（偏好设置：通用；AI 与语音：AI 模型、语音合成；数据：数据管理），右栏 max-w-3xl 面板；上次打开的分类存 localStorage
- 通用：主题（跟随系统 / 浅色 / 深色，分段图标切换）；诊断：系统日志（打开文件夹 / 查看日志）
- AI 模型：总览（默认模型行 + 已配置提供商列表，行内“默认 / 缺密钥”标记）→ 下钻提供商详情（连接：API 密钥修改、启用 Switch、自定义接口；模型列表含搜索 / 选择模型 / 手动添加 / 测试 / ⋯ 菜单；移除）；「添加提供商」页列出 pi 目录中未配置的（可搜索，分“填密钥即可用 / 需要额外配置”）；功能与原双栏版一致，移除后回到总览
- 语音合成：只读设置行（鉴权、默认音色、资源 ID、语速与音质、试听）+「编辑配置…」弹窗；缓存行（清理 30 天前）
- 数据管理：概览行 + 刷新；数据表行（选择性重置模式下变为勾选行，底部汇总 + “重置选中的表”）；危险操作组（重置所有用户数据 / 删除数据库并重启）；重置范围在打开弹窗时确定（修复原实现中“选择模式下点重置全部”会走选择性重置的耦合）；两步确认与文案保留
- shadcn 新增：switch、toggle-group、toggle、sonner（sonner 改用 useTheme，去掉 next-themes 依赖）
- 全局设施：Toast 改为 sonner（`useToast` API 不变，60+ 调用点不改，引用仍稳定）；ErrorBoundary、LogViewer（Dialog + 搜索 + 级别 Select）、DevTools（右下角浮层）改 Tailwind；ErrorModal 组件删除，formatErrorMessage / getErrorType 并入 `utils/errorHandler.ts`
- 删除无引用的死代码：Achievements、AddWords、CreateWordBookPreview、FormInput、Input、LoadingSpinner、Select、SpellingPractice、StudyCompletionHeader、StudyHeader、StudyRecordsTable、TextArea、TextImport、VocabProgress、WordList、ConfirmDialog、Button、Modal、ErrorModal、hooks/useErrorHandler（以 main.tsx 为根的引用可达性分析确认）
- 规范：`ui-interaction-patterns.md` 设置页模式改为桌面设置窗口模式；一级导航行更新为 AppShell
- 验证：tsc（自己的文件无错；另一会话的 WordBookSummaryCard 半成品有错）、lint 0/0、npm test 77、css-vars 0
- 未验证：未在 tauri:dev 中实际查看

## 迁移收尾（2026-10-07，用户同意删除旧版页面：“改，你按照最合理的方式改”）
- 删除无入口、用假数据的旧版 start-study-plan / finish-study-plan 页面与路由键（navigation / App / PAGE_TITLE / TOP_LEVEL_OF），及只服务它们的 Header、Breadcrumb（旧）、旧 WordCard（PracticeWordCard 保留）、WordDetail、StudyProgress、CongratulationsBanner、StudyStatistics、PerformanceAnalysis、ActionButtons；`UntypedNavigate` 无人使用一并删除
- `SHELL_PAGES` 改为反向的 `FOCUS_PAGES`（只有 word-practice）：默认所有页面进 AppShell
- 移除 FontAwesome（依赖、main.tsx 引入、calendarService 中无人调用的图标 / 颜色 / 文案 / formatMonth / isToday 辅助函数）
- 删除 `styles/globals.css`（141 个旧变量已无引用）；body 背景 / 文字色 / 字体与抗锯齿移入 `app.css` 的 base 层；src 下已无 `.module.css`
- 删除无引用的 `utils/studyPlanStatus.ts`
- 规范同步：CLAUDE.md（§1 技术栈、§3 目录、§5.1 路由、§5.3 样式、§7.3、§8 债务）、ui-system-standard（§0 现状、§6 改为功能对等硬约束、去掉迁移共存）、page-layout-standard（AppShell 页面结构）、deliver-frontend-react SKILL、frontend-code-standard、sdd-plan（§ 引用与形状 C / D）、README；validate-skills 通过
- 验证：npm run verify 14/14 通过（含 cargo test 150、clippy、tsc、lint 棘轮、前端测试 77）
- 未验证：tauri:dev 实际走查（两种主题下的全局背景色 / 字体来自 app.css 后是否与之前一致）

## 未验证
- 未运行 `tauri:dev`：真实数据渲染、暗色主题、旧页面在 Tailwind preflight 下的外观、React 19 运行时行为
- 未跑 cargo（未改后端）

## 下一步
1. 用户 `tauri:dev` 看首页效果并反馈；走查几个旧页面确认无样式回归
2. 根据反馈调整，再写 `plan.md` 规划后续页面批次
