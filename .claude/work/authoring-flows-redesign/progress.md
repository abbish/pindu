# Progress

## 当前状态
2026-10-07：B0–B6 全部完成。

## 已完成
- 两份只读盘点（单词本创建 / 编辑、学习计划创建 / 编辑），结论汇总进 plan.md §1
- 抽查确认：A1 日程平移（start_now_conn 只比较 start_date 与今天，平移全部日程）；A2 导入保存失败清空结果

## B0（2026-10-07 完成）
- A1 日程平移：`StudyPlanRepository::start_now_conn` 计划有过任何练习会话就不平移；`publish_study_plan` 对练过的计划改为 草稿 → 进行中（保留实际开始时间、不清 actual 日期），未练过仍为 → 待开始；测试 `starting_never_shifts_schedules_of_a_practiced_plan`，`edit_turns_plan_into_editable_draft_without_losing_data` 期望改为 Active
- A2/A3 导入弹窗：详情页保存失败把错误抛回弹窗（保留分析结果，可直接重试保存）；提取 / 分析用序号丢弃关闭或重来后迟到的结果；卸载清理只在卸载时执行一次
- 停止分析：前端取消不再停止进度轮询（进行中批次跑完前进度继续更新）；按钮“停止分析 → 正在停止，等待进行中的单词完成…”；结果页提示“已停止分析：保留了已完成的 N 个单词”
- A4 批量删除：新命令 `delete_words(book_id, word_ids)`（`services/word.rs::delete_words` 单事务，按计划聚合移除再删除，重复 / 不存在的 ID 忽略；`delete_word` 改为复用它）+ 测试 `deleting_words_in_batch_is_one_transaction_across_plans`；前端 `wordBookService.deleteWords`；勾选随当前页数据变化清空；删空最后一页自动退回现在的最后一页
- A7 规划取消：创建页卸载、编辑弹窗规划中关闭时调用 cancel_analysis + clear_analysis_progress
- A6 文案：编辑计划弹窗说明“重新生成日程会清空练习记录和记忆等级，保存后需发布”；保存提示同步
- 其它：更新单词 / 单词本失败显示后端原因；编辑单词本弹窗每次打开按当前值回填；单词本列表“所有状态”不再包含已删除；恢复单词本成功 / 失败有提示
- 未做（并入后续批次）：A5 补充单词覆盖已有词 → B2（默认跳过已存在）
- 验证：npm run verify 14/14（cargo test 152）；未在 tauri:dev 走查

## B1（2026-10-07 完成）
- 后端：单词本取消草稿——`update_word_book` 只接受 status = normal；从分析结果新建一律 normal，默认图标 / 颜色改为 bookmark / primary（原为 emoji 与十六进制色）；名称 ≤100、描述 ≤500 的校验在新建与更新共用（`validate_title` / `validate_description`）；迁移 049 把存量 draft 改为 normal（已删除不动；在旧库副本上验证）
- 前端：新增 `components/WordBookFormDialog`（新建 / 编辑同一表单与校验：名称、图标 + 颜色、主题可选、描述；保存失败弹窗不关并显示后端原因；主题加载失败不再用假 ID）；新建改为弹窗建空单词本 → 进入详情页（单词本列表、首页入口）；删除 `create-wordbook` 路由与 CreateWordBookPageV2、EditWordBookModal、DeleteWordBookModal
- 详情页：没有单词时显示空状态与“从文本添加单词”；删除单词本改为普通 AlertDialog（失败原因显示在弹窗内）+ 成功提示带“撤销”（`useToast` 支持 action）；去掉“正常 / 草稿”状态标签
- 草稿 UI 全部移除（列表筛选、卡片标签）；创建 / 编辑计划的单词本列表改为“有单词的单词本”
- 首页去掉“正在跳转到…”的多余提示
- 验证：npm run verify 14/14；未在 tauri:dev 走查

## B2（2026-10-07 完成；用户追加需求：AI 按意图生成单词本，不选模型，优化补充单词的表单与步骤）
- 新 agent 任务“按意图生成单词”：提示词 `prompts/agent/generate_words.md`（贴合意图、按描述判断难度、单个单词原形、避开已有词、按重要性排序）、工具 `submit_generated_words`（agent/src/tools/words.ts）、`tasks::generate_words` + `generated_from_submission`（只收单个英文单词、去重、跳过已有、截到请求数量；测试 `generated_words_keep_single_new_words_only`）；模型走 AgentTaskKind::Extract（设置里标签改为“提取 / 生成单词”）
- 新命令：`generate_words_from_intent(intent, count, book_id?, model_id?)`（描述 1–500 字、数量 5–100，传 book_id 时避开已有词）、`find_existing_words(book_id, words)`；`WordRepository::word_texts_by_book`
- 前端 `components/AddWordsDialog` 替代 WordImporterModal（已删除）：步骤 5 → 3（获取单词 / 选择单词 / 分析并保存）；来源 Tabs：AI 生成（描述 + 示例 + 数量 10/20/30/50）/ 从文本提取（文本或文件 + 提取范围分段选择）；不再选模型（按设置）；已在单词本中的词标“已存在”且默认不选（A5）；选完直接分析，全部成功自动保存，有失败或停止时进入检查页（可重新分析未完成的、只保存已完成的、取消勾选）；保存失败保留结果；有未保存结果时关闭先确认、点遮罩不关闭；超长文本不能绕过上限；分析不再传写死的每批词数 / 并发数
- 详情页：空状态两个入口“AI 生成单词 / 从文本提取”；表格工具栏“补充单词”改“添加单词”；WordGrid 支持“已存在”标记与隐藏出现次数；EmptyState 支持自定义操作区
- 验证：tsc、lint 0/0、前端测试、agent tsc / 测试、cargo fmt / check / clippy 通过；cargo test 155 过 2 败，失败的两个（learning_order_submission_keeps_model_order、statistics_use_first_learn_attempts_and_mastery）来自后端会话进行中的提示词模板化 / 统计改动，已告知；未在 tauri:dev 走查，未用真实模型跑 generate_words

## 单词本表单二次优化（2026-10-07，用户反馈“表单不整齐、复杂，图标 / 颜色 / tag 需要补充”）
- 布局（Notion / Linear 的“名称前图标”模式）：名称一行 = 图标按钮 + 输入框；点图标弹出浮层选图标（24 个，旧的 6 个值保持兼容）与颜色（10 色圆点）；主题改为 shadcn Combobox（Popover + Command）多选，触发器内以标签显示、可 × 去掉、可搜索、找不到可直接新建；描述 2 行；弹窗宽度收窄为 md
- 颜色改为主题 token：app.css 新增 `--book-{teal,blue,indigo,purple,pink,red,orange,amber,green,slate}`（亮 / 暗两套）与 `--color-book-*`；旧值 primary → teal、yellow → amber（`normalizeBookColor`）
- 后端：`create_theme_tag(name, icon?)`（1–10 字，同名忽略大小写复用，默认图标 🏷️；测试 `creating_theme_tags_validates_and_reuses_same_name`）；主题按 id 排序（内置在前）；迁移 052 补充 14 个内置主题（考试、课本、阅读、演讲、工作、科技、自然、动物、食物、运动、健康、家庭、节日、音乐）
- shadcn 新增 popover、command（cmdk）；删除不再使用的 ThemeSelector
- 验证：npm run verify 14/14（失败的统计测试由 redlark-75 按用户确认的新口径“已学 = srs_box ≥ 1”同步修好后重跑）；未在 tauri:dev 走查

## AI 生成报错“模型没有提交单词列表”（2026-10-07 用户反馈）
- 原因：sidecar 是 13:54 编译的，`submit_generated_words` 16:16 才加；tauri:dev 只在启动时编译 sidecar，运行中的应用（用 target/debug/redlark-agent 副本）没有这个工具
- 处理：`npm run agent:build` 并把新程序复制到 target/debug/redlark-agent（每次任务都重新启动 sidecar，复制后即生效）
- 防再犯：`agent/config.rs::ensure_sidecar_fresh`（仅 debug 构建）——agent/src 下任意 .ts 比 sidecar 新时直接报“AI 助手程序比源码旧：请运行 npm run agent:build 后重启 npm run tauri:dev”
- 未验证：没有真实模型密钥，未端到端跑 generate_words；请用户重试

## 添加单词弹窗视觉重做（2026-10-07，用户反馈“每步的表单页面粗糙，像半成品”）
- 弹窗：固定高度（换步不跳动）、标题 + 说明 + 紧凑步骤条在顶部（带分隔线）、底部固定操作栏（左：次要 / 提示，右：取消 + 主操作，浅底色分隔）
- 第 1 步：来源改为两张单选卡片（图标 + 标题 + 一句说明）；描述框加高、字数显示在框内右下；示例改为小胶囊；数量、提取范围改为“标题 + 说明 / 右侧分段选择”行；生成 / 提取中改为居中状态（引用描述 + 预计时间）；模型说明移到底栏左侧
- 第 2 步：WordGrid 重做——工具栏（已选数 + 全选 + 词性快选靠右）、统一高度卡片（单词 + 词性小字 + 释义；有分析时显示音节、音标、首条例句），选中淡色底、未选变灰
- 第 3 步：BatchAnalysisPanel 改为纯展示——标题（含“正在停止…”）+ 用时 / 预计、右侧大号计数、细进度条、状态图例（圆点 + 计数）替代 4 个大色块、单词状态改为中性描边小标签（图标表达状态）；“停止分析”移到底栏；自动保存时显示居中“正在保存”；结果页顶部为结论条（完成 / 部分未完成）
- Stepper 缩小（5px 圆点、细连线）；ThemeTagPicker 无匹配且可新建时不再重复显示“没有这个主题”
- 修复：shadcn Textarea 自动高度会忽略 rows，改用 min-h
- 验证：临时预览页 + playwright-core 截图（亮 / 暗、5 个状态 + 单词本表单的图标浮层与主题下拉），确认后删除临时文件；npm run verify 14/14；方法记入 sdd-verify/references/verification-methods.md

## B4 计划新建单页（2026-10-07 完成）
- 后端：`StudyPlanScheduleRequest.use_ai`（默认 true）；false 时 `study_plan_generation::generate_without_ai`——单词本原顺序 + 词长估难度（与 AI 漏排补齐同一规则），不经 sidecar、立即完成；新命令 `preview_study_plan(wordbook_ids, daily_new_words)` 返回从今天起的确定性日程（去重后的真实词数、天数、每天的词）；`validate_request` 先校验开始日期格式（AI 跑完才报错的问题）；测试 `preview_and_non_ai_generation_are_deterministic_and_validated`
- 前端 `CreatePlanPageV2` 改为单页：左卡片 = 单词本（带图标的两列可勾选行，无单词本时引导去新建）/ 每天新词数（7 档分段 + 当前档说明）/ 学习顺序（AI 智能排序开关）/ 名称与描述（不填名称按单词本自动命名）；右侧固定卡片 = 学习安排预览（新词数、总天数 = 学新词 + 巩固 11、每天分钟数、前 3 天的新词）+ 创建按钮；AI 排序进度内联在预览卡底部、可取消；失败时“用默认顺序创建 / 重试 AI 排序”；创建后为待开始，提示“第一次练习的那天就是第 1 天”；去掉开始日期输入、保存草稿、模型选择（按设置）与三步向导
- WordBookSelector 改为带图标的列表行（EditPlanModal 同步传 icon / color）；PlanningProgress 去掉外层 Card 与“块数 / 字符数”噪音
- 验证：临时预览页截图（空态、已选两本、AI 排序中）；tsc、lint 0/0、cargo test 169 通过；clippy 失败在 tasks.rs generate_words 参数过多（后端会话进行中的单词本场景改动，已告知）
- 未验证：tauri:dev 中真实创建（AI 与默认顺序两条路径）

## B3 手动添加 / 编辑单词（2026-10-07 完成）
- 后端：`WordService::validate_word`——单词与释义必填（去首尾空格）、单词 ≤50 字、同一单词本内不重复（忽略大小写；编辑时排除自己），新增与编辑共用；`UpdateWordRequest` 加 Default；测试 `adding_and_editing_words_validate_and_reject_duplicates`
- 前端 `components/WordFormDialog`（新建 + 编辑同一表单，替代 EditWordModal 并删除）：单词 / 释义 / 词性一行；“AI 补全”只填空着的字段（调用 analyze_extracted_words，带单词本场景与已填释义）；发音与拼读：音标、音节、拼读块（空格或 / 分隔，存 JSON 数组，“按音节拆分”一键生成，标签预览）、拼读规则、拼读讲解；例句改为逐条英文 + 中文输入（增删），第一条为最简单；备注；词性缩写 / 中文 / 英文由词性自动带出（去掉三个重复字段）；保存失败弹窗不关并显示原因（如重名）
- 词性补充“数词 num.”与英文名表 `PART_OF_SPEECH_ENGLISH`（旧编辑表单里 num. 等显示为空的问题）
- 入口：单词表工具栏“添加单词”改为下拉（AI 生成 / 从文本提取 / 手动添加一个单词）；空单词本三个入口；WordListTable 新增 `addAction` 插槽
- 验证：临时预览页截图（编辑态、新建态）；npm run verify 14/14（cargo test 含新测试全部通过）
- 未验证：tauri:dev 中真实保存与 AI 补全

## B5 计划就地编辑（2026-10-07 完成）
- 后端 `services/plan_pace.rs` + `repositories/plan_pace_repository.rs`：
  - “还没练过的日程” = 没有练习会话且未标记练完；只取这些日程里的新词（is_review = false），保持原顺序
  - `replan_pace(plan, daily, today)`：删掉这些新词条目 → 按新节奏重新铺开（练过的计划从今天起、没开始的从原第 1 天起；练过的日子跳过；只剩复习的未练日程可复用）→ 重算计数、删空的未练日程、按日期重编第几天、更新 daily_new_words / end_date（最后新词日 + 11）
  - `add_word_books(plan, books, today)`：单词本里不在计划中的词（按 id 与拼写去重）以 srs_box 0 加入 study_plan_words，排在还没学的新词后面
  - 只允许 Draft / Pending / Active / Paused；全部单事务；已练日程、复习条目、srs_*、练习会话不动
  - 新命令 `replan_study_plan_pace(plan_id, daily_new_words)`、`add_word_books_to_plan(plan_id, wordbook_ids)` → `PlanPaceResult { remainingNewWords, learningDays, endDate, addedWords }`
  - 测试 3 个：练过的计划从今天重排且保持顺序 / 记忆等级与会话不动；没开始的计划保持第 1 天、校验节奏范围与已结束计划；追加单词本去重、srs_box = 0、重复追加报错
- 前端：详情页新增「设置」页签（`plan-detail/PlanSettingsView`，SettingsSection / Row）：基本信息（改动后出现 还原 / 保存）、学习节奏（分段选择，选了新值出现说明条 + 取消 / 应用，应用后提示剩余新词与天数）、单词本（列表 + 追加单词本对话框）、删除；页头新增「调整计划」按钮跳到设置页签
- 去掉“编辑 → 草稿 → 发布”：getAvailableActions 不再有 edit（Draft 只剩发布 / 删除，供旧草稿使用）；删除 EditPlanModal、StudySchedulePreview、AIModelSelector；planDetailDisplay 与测试同步；update_study_plan_basic_info 注释改为任何状态可改
- 验证：临时预览页截图（设置页签、追加单词本对话框）；npm run verify 14/14；CLAUDE.md §4.2 命令表与 §4.3 状态规则同步
- 未验证：tauri:dev 中对真实计划改节奏 / 追加单词本

## B6 清理（2026-10-07 完成）
- 补功能缺口：计划「单词」页签支持勾选 + “从计划移除”（AlertDialog 说明已学单词的记忆等级与作答记录一并删除、单词本不受影响；调用已有的 batch_remove_words_from_plan）——B5 的设置页文案依赖它，而此前从未有界面
- 删除前端已无入口的命令（handler + lib.rs 注册 + 前端 service 方法）：create_study_plan、update_study_plan、edit_study_plan、update_study_plan_with_schedule、remove_word_from_plan、delete_word、update_all_word_book_counts（列表 / 详情词数本来就是实时计算，两处页面里的刷新调用一并去掉）；已与后端会话确认无依赖
- 级联删除死代码：StudyPlanService 的 update_with_schedule / ensure_editable_draft / edit_study_plan / partial_update / create_study_plan / remove_word_from_plan，WordService::delete_word，StudyPlanRepository 的 find_by_id / create / update / update_plan_summary_conn / update_settings_conn / delete_plan_words_conn / delete_plan_schedules_conn / partial_update / create_plan_words / row_to_study_plan，WordRepository 的 validate_word_ids / get_word_book_id，类型 CreateStudyPlanRequest / StudyPlanSettingsUpdate / StudyPlanPartialUpdate（Rust 与 TS）
- 测试：删去只覆盖已删除流程的 5 个（update_with_schedule × 3、deleted_drafts_cannot_be_edited_with_schedule、partial_update_cannot_change_status）；改写 3 个（旧草稿用 SQL 构造后验证重新发布回到进行中、基本信息任何状态可改、删除单词改走 delete_words）
- 创建计划请求不再发送 intensity_level / study_period_days / review_frequency（Rust 侧 serde(default) 并标注已废弃，保存时以日程元数据为准）
- 保留：开发诊断命令 diagnose_*（仅排查用）、publish_study_plan（旧草稿发布）
- 验证：npm run verify 14/14；check-ipc 只剩 3 个诊断命令的“未调用”提示；CLAUDE.md §4.2 命令表同步

## 下一步
1. 用户在 tauri:dev 中走查 B0–B6（重点：练过的计划改节奏 / 追加单词本 / 移除单词；AI 生成单词；新建计划的 AI 与默认顺序两条路径）
2. 短文练习接入学习计划（C4）的界面由本会话做；后端由 redlark-5d 实现，等用户确认短文这版后开工，最终签名实现后发来

## C4 约定（2026-10-07 与 redlark-5d 对齐，草案）
- **变更（2026-10-07）**：用户要求重做短文（短文与题组分离，一篇短文多套题组 passage_question_sets；新增短文详情页；菜单名「短文库」）。redlark-5d 占用迁移 055 重建短文表；C4 迁移顺延 056；计划里的短文任务改为「短文 + 指定一套题组」；passage-practice 参数改为 { setId, mode, planId?, returnTo? }；以下签名待 redlark-5d 这一版做完后重发，以重发为准
- **短文库 v3 已完成（2026-10-07，redlark-5d）**：迁移 055 已用，C4 用 056；路由 passage-detail { passageId }、passage-practice { setId, mode }（planId / returnTo 在 C4 加）、create-passage { bookIds?, planIds?, wordIds? }；题组命令 generate_question_set / get_question_set / delete_question_set，start_passage_attempt(setId, mode)；TS 类型在 src/types/passage.ts。C4「短文 + 指定题组」签名待用户确认做 C4 后由 redlark-5d 发来
- 数据：study_plans.practice_content（words / passages / both）；study_plan_passages(plan_id, passage_id, sort_order, scheduled_date)；短文从开始日起每 N 天一篇（默认 2）；到期未完成留在今日任务不重排；完成 = 该计划内有一次已完成作答
- end_date 后端统一 = max(单词结束日, 最后一篇短文日)；首次练习平移 / restart / 暂停继续时未完成短文日期一起平移
- get_passages(PassageListRequest{book_ids?, plan_id?, sort?: recent | relevance}) → PassageSummary（title、level、wordCount、sources、completedAttempts、lastAttempt、bestAttempt、overlap?）
- set_plan_passages(SetPlanPassagesRequest{practice_content, passage_ids 完整顺序, interval_days})：只能增加练习内容或去掉没练过的；已完成短文原位锁定且必须包含在顺序里
- get_plan_passages(plan_id) → PlanPassage{passage, sort_order, scheduled_date, completed, best_attempt}；get_today_passage_tasks() 给首页
- passage-practice 路由 { passageId, mode, planId?, returnTo?: plan-detail | home | passages }（页面归 redlark-5d）
- 日历：get_calendar_month_data 每天加 passage_tasks / passage_completed
- 删除短文：被未结束计划引用时拒绝；已结束计划引用时允许，计划条目与作答一并删除（删除确认框要说明）
- 本会话的 UI：新建计划页（练习内容选择 + 短文选择列表含相关度排序 + 间隔天数 + 预览里的短文日期）、计划设置页签（练习内容、短文顺序上下移、间隔、已完成锁定）、详情页短文页签、首页今日任务、日历短文标记
- **C4 完成（2026-10-07）**：后端 redlark-5d（迁移 056、D29、签名见 src/types/passage.ts 末尾「学习计划里的短文」）；本会话 UI：
  - 共用组件 `components/PlanPassagePicker`（已选列表：上下移 / 题组或只朗读 / 阅读听力 / 移除，已完成锁定；「添加短文」对话框按相关度排序、搜索多选）
  - 新建计划：「练什么」单词 / 单词 + 短文 / 短文；只练短文不走排程直接保存（aiPlanData ''、wordbookIds []）；预览显示第几天读哪篇
  - 计划设置「短文」区：练习内容（有单词：只练单词 / 单词 + 短文；完成过短文不能改回只练单词）、间隔、完整顺序整体 setPlanPassages；只练短文的计划隐藏学习节奏
  - 计划详情：「短文」页签（PlanPassagesView）；只练短文的计划默认短文页签、隐藏日程 / 单词 / 统计 / 日志，进度与今日任务按短文；单词日程练完但有到期短文时「进入练习」转到短文页签
  - 首页「今天的短文」、日历页侧栏「今日短文」（TodayPassageTasks）；两处日历日格「文N」与悬停说明；PlanSummaryCard / usePlanPractice 适配只练短文
  - 验证：verify --quick 全 PASS；未在 tauri:dev 走查
  - 已知：练完返回 plan-detail 时落在默认页签（单词 + 短文的计划是「日程安排」）
