# 改版前功能清单（迁移核对基线）

2026-10-07 从代码盘点（路径以 `src/` 为根，`文件:行号` 为盘点时位置）。每个迁移批次开始前以本节为起点复核 live 代码，完成后逐条核对；删减 / 合并需用户同意并在 progress.md 记录。

## 0. 全局

- **Header**（`components/Header/Header.tsx`）：logo `/logo-maskable.png` + “自然拼读 Pindu.app”；导航 首页 / 学习计划 / 单词本 / 日历 / 设置，`activeNav` 高亮；`hideNavigation`、`rightContent` props 无人使用。无主题切换（`hooks/useTheme.ts` 未被引用，`globals.css` 有 `[data-theme="dark"]`）。HomePage 加载态 Header 未传 onNavChange（:266）。
- **Breadcrumb**：点击项 `onNavigate(item.key, item.params)`。
- **DevTools**（仅 DEV，`App.tsx` 全局挂载）：浮动按钮；环境信息 / 最近 20 次 API 调用 / 最近 50 条控制台日志。
- **LogViewer**：入口仅首页右下角 bug 按钮。`get_system_logs`；搜索（message、component）、级别下拉、刷新、单条展开详情、条数统计、关闭。
- **ErrorModal**（仅首页）：标题、信息、可展开详情、关闭、可选重试。
- **ErrorBoundary**：“出现了一些问题”，重试 / 刷新页面，DEV 下错误详情。
- **Modal**：Esc 关闭、点遮罩关闭、右上角关闭。
- **Toast**：自动消失（默认 4000ms，按类型）。
- **useAudioPlayer**：单词 / 例句经 `text_to_speech`，内存 URL 缓存；失败 toast，未配置 Key 提示去设置。
- **未被任何页面渲染的组件**：SpellingPractice、PlanPreview、TextImport（含拖拽）、AddWords（含拖拽）、WordList、StudyRecordsSidebar、StudyRecordsTable、PerformanceAnalysis、Achievements、VocabProgress、StudyHeader、StudyCompletionHeader、CreateWordBookPreview。

## 1. home（`pages/HomePage.tsx`）

布局：错误横幅 → “欢迎回来！继续你的单词学习之旅吧” → 快捷卡 2 张（创建单词本 / 创建学习计划）→ 我的学习计划网格 → 我的单词本网格（≤6）→ 学习统计 4 卡（总学习单词 / 平均正确率 / 连续学习天数 / 计划完成率）→ 右下角系统日志按钮。

数据：`get_study_plans`（前端过滤 Deleted、Draft）、`get_word_books(false,'normal')` + 每本 `get_word_book_statistics`、`get_study_statistics`。

| 操作 | 行为 |
|---|---|
| 快捷卡 创建单词本 / 创建学习计划 | toast info → create-wordbook / create-plan |
| 计划、单词本“查看全部” | plans / wordbooks |
| 空态按钮 | create-plan / create-wordbook |
| 点计划卡 | plan-detail `{planId}` |
| 计划卡动作按钮 | draft → plan-detail；Pending → `start_study_plan` + toast → `get_study_plan_schedules` + `pickPracticeSchedule` → word-practice；Active → 选日程 → word-practice；其余 → plan-detail |
| 计划卡 ⋮ | 空 TODO |
| 点单词本卡 | wordbook-detail `{id}` |
| 错误横幅 重试 | refresh |
| 系统日志按钮 | LogViewer |

- **StudyPlanCard**：每卡 `get_study_plan_statistics`；状态标签、名称、描述、总单词数、学习强度、学习周期、起止时间；时间进度 + 学习进度条；已学单词、平均正确率；日程方块图（已完成 / 延期 / 未开始）+ 图例 + x/y；底部学习进度条；按状态的按钮文案（编辑计划 / 重新学习 / 开始学习 / 继续学习 / 查看详情）。
- **WordBookCard**：已删除角标、图标、标题、描述、总单词数、关联计划数、名词 / 动词 / 形容词 / 其他计数、创建时间、最近使用。
- 状态：整页 spinner；错误横幅按数据源列错误，studyPlans / statistics 出错另弹 ErrorModal（重试）；计划、单词本各有空态。
- **未完成练习提醒**：每次启动一次，延迟 1500ms，`get_incomplete_practice_sessions` 有数据则弹 IncompletePracticeModal：按最近活动排序；每条 计划名、日程日期（逾期高亮）、“x/y 题（n 个词）”、已练时长、上次练习、进度条；“继续练习” → word-practice `{planId, scheduleId, sessionId}`；“放弃” → 行内确认“确定放弃 / 不放弃” → `cancel_practice_session` + toast；底部提示“以后也可以在「日历」页的「未完成练习」里继续”+“稍后再说”。
- **2026-10-07 用户确认的删减**：页头「创建单词本」按钮与「我的单词本」区块移出首页（单词本 / 短文库走侧边栏「素材库」；无单词本时的创建入口在单词本页）。首页改为 继续上次练习 → 学习计划 → 学习统计。「今天的短文」区块也移除：今天要做的（单词日程 `get_today_study_schedules` + 到期短文 `get_today_passage_tasks`）并进计划卡——日程栏显示今天的内容，「继续学习」接着做今天没做完的（单词 → 短文，规则 `utils/planToday.ts`）；只朗读的「读完了」在朗读页（passage-detail fromPlan）。单独的「今天」列表与计划卡重复，已撤回。

## 2. plans（`pages/StudyPlansPage.tsx`）

面包屑；错误横幅；页头（标题、状态筛选、创建计划）；统计 4 卡（总计划数 / 进行中 / 已完成（完成率 %）/ 草稿）；分组区。数据 `get_study_plans`。

- 状态筛选：全部 / 草稿 / 待开始 / 进行中 / 已完成 / 已终止 / 已删除；“全部”分 6 组（草稿、待开始、进行中、已暂停、已完成、已终止，不含 Deleted），选具体状态只显示该组。
- compact StudyPlanCard：点卡 → plan-detail；动作按钮同首页（失败只打 console）；⋮ 菜单空 TODO。
- 状态：整页加载；分组空态“暂无{title}的学习计划”；分组骨架。

## 3. create-plan（`pages/CreatePlanPageV2.tsx`）

三步向导：1 基本信息 / 2 AI规划 / 3 确认创建。数据 `get_word_books`（只留 normal），失败整页错误（重试 reload / 返回 plans）。

1. 计划名称*、描述、学习强度（轻松 5-15 / 标准 15-30 / 强化 30-50 词/天）、学习周期（1/3/7/14/28 天）、复习频率（3/4/5 次）、开始日期（默认今天）、WordBookSelector（勾选卡片，加载 / 空态）；取消 / 下一步（不完整禁用）。
2. 所选单词本统计与总词数、参数确认；AIModelSelector（`get_ai_models`，首项“使用系统推荐模型”，加载 / 错误重试 / 空态）；“开始AI规划”：`clear_analysis_progress` → `generate_study_plan_schedule` → toast + 规划结果预览（计划类型、总单词数、周期、结束日期、共 N 天）；之后“重新规划”“下一步”；上一步。
   - **PlanningProgress**：“AI正在规划学习计划”，轮询 `get_analysis_progress`（1s 起退避至 5s）；current_step、状态、块数、字符数、用时、>60s 提示、错误、进度条；“取消规划”（`cancel_analysis` + abort + `clear_analysis_progress`）/ 完成后“关闭”。
3. 计划基本信息网格 + StudySchedulePreview（预览模式）；上一步 / 保存草稿 / 创建学习计划（`create_study_plan_with_schedule`，draft / normal）→ toast → plan-detail。每步有错误条。

## 4. plan-detail（`pages/PlanDetailPage.tsx`、`pages/plan-detail/*`）

数据：`get_study_plan`（解析 ai_plan_data 得今日单词）、`get_study_plan_words`、`get_study_plan_statistics`；日志 tab 懒加载 `get_plan_practice_sessions`。

布局：面包屑 → PlanHeaderSection → 核心统计卡（总单词数 / 已学单词 / 平均正确率 / 连续学习天数，有今日任务时加“今日任务”）→ 5 个 tab（概览 / 日程安排 / 单词列表 / 统计分析 / 学习日志）。

- **PlanHeaderSection**：标题、描述；“进入练习”（仅 Active）；状态动作按钮（`getAvailableActions`）：Draft 继续编辑 / 发布计划 / 删除计划；Pending 开始学习 / 编辑计划 / 删除计划；Active 完成学习 / 终止学习 / 修改计划；Completed、Terminated 重新学习 / 删除计划；Deleted 恢复计划 / 永久删除。信息卡（状态、强度、周期、单词数、复习频率）；草稿提示区（发布计划；“重新生成日程”仅 needsRegeneration，恒 false）；时间进度、实际进度条。
- 进入练习：`get_study_plan_schedules` + `pickPracticeSchedule` → word-practice；无日程 toast warning。
- 状态动作：确认 Modal（“确认X吗？”，delete 为 danger）→ start / complete / terminate / restart / edit（非草稿：转草稿重置进度）/ publish / delete（→ plans）对应 `*_study_plan` 命令，成功 toast + reload。restore / permanentDelete 无分支（报“状态转换失败”）。草稿 edit 直接开 EditPlanModal。
- **EditPlanModal**：tab 基本信息（名称*、描述，`update_study_plan_basic_info`）；tab 日程规划（强度、周期、复习频率、开始日期、WordBookSelector、AIModelSelector；预填 `get_word_books`、`get_study_plan_word_books`；“重新生成日程” + PlanningProgress 可取消；StudySchedulePreview；“更新计划”：有日程 `update_study_plan_with_schedule`(draft) 否则 `update_study_plan_basic_info`）。
- **概览**：StudyCalendar（`get_study_plan_calendar_data`，上 / 下月，日格“新N / 复N”+ 进度条，图例 未开始 / 进行中 / 已完成 / 逾期，点击日期空 TODO）。
- **日程安排**：无 AI 数据空态；StudySchedulePreview（edit）：`get_plan_practice_sessions`；“共N天，M个单词”，展开 / 收起全部；元数据；每日行（第N天、日期、新学 / 复习 / 总计、用时、已完成或暂停N次、高 / 中 / 低优先级条）；每日“开始 / 继续 / 再次练习” → word-practice；展开显示单词（单词、新学 / 复习(第N次)、优先级、难度）。
- **单词列表**：WordListTable 只读（无勾选、无操作列）。
- **统计分析**：平均每日学习时长、时间进度、按时完成率；词性分布；总学习时间、平均每日学习、最长连续学习、计划完成率、时间完成率。
- **学习日志**：加载 / 空态；每条 日期、起止时间、完成状态、练习时长、总时长、暂停次数、会话ID前 8 位；未完成的“继续练习” → word-practice `{planId, scheduleId, sessionId}`。
- 页面状态：加载；错误 / 不存在（重试、返回计划列表）。

## 5. wordbooks（`pages/WordBookPage.tsx`）

数据：`update_all_word_book_counts` → `get_global_word_book_statistics` + `get_word_books(includeDeleted, status)` → 每本 `get_word_book_statistics`。

- 页头“我的单词本” + 创建单词本；WordBookStats 5 卡（单词本总数 / 单词总数 / 名词 / 动词 / 形容词）。
- **WordBookFilter**：活跃筛选数、重置、折叠 / 展开；搜索（标题、描述，带清除，前端过滤）；主题标签（`get_theme_tags`）；状态（所有 / 正常 / 草稿 / 已删除，后端过滤）；排序（默认 / 创建时间 / 单词数量 / 完成度——完成度未实现）。
- 卡片网格（WordBookCard）→ wordbook-detail。
- 状态：加载；错误（重试、返回首页）；空态（有筛选“没有找到匹配的单词本”/ 无筛选“还没有单词本”+ 创建）。

## 6. create-wordbook（`pages/CreateWordBookPageV2.tsx`）

三步：1 基本信息 / 2 导入单词 / 3 确认内容。

1. 名称*、ThemeSelector 多选主题（`get_theme_tags`，失败回退 6 个内置）、描述；取消 / 下一步（需名称且 ≥1 主题，进入后自动打开导入弹窗）。
2. “开始导入单词”；已导入显示前 10 个 + “+N 更多”、重新导入；上一步 / 下一步。
3. 预览（图标、名称、描述、主题、选中词数）；全选 / 取消全选；WordGrid；上一步 / 保存草稿 / 创建单词本（`create_word_book_from_analysis`，draft / normal）→ wordbook-detail。

- **WordImporterModal**（“补充单词”，5 步：输入文本 / 提取单词 / 确认单词 / 批量分析 / 选择单词）：打开时 `get_ai_models` 自动选第一个；文件上传 .txt/.md ≤5MB（可清除）、文本框、模型下拉、提取模式单选（重点 / 全量，未传给后端）；>5000 字报错，>3000 字 `window.confirm`；分类错误卡（网络 / 解析 / 超时 / 验证 / 大小 / 认证 / 限流 / 未知；知道了 / 重新提取 / 了解分段处理）；提取 `extract_words_from_text`；确认单词（WordGrid；重新提取 / 取消 / 批量分析(N)）；批量分析 `analyze_extracted_words`（batch 5、并发 5、重试 2、超时 60s），500ms 轮询 `get_batch_analysis_progress`；选择单词（重新提取 / 取消 / 保存单词(N)）。分析中关闭 → `window.confirm` → `cancel_batch_analysis`；卸载也取消。
- **WordAnalysisProgressModal**：取消；提取阶段 spinner；已分析 x/y、百分比、进度条、已用 / 预计剩余时间、状态计数、单词状态 chip（tooltip 错误原因）、失败列表；结束态 + 关闭。
- **WordGrid**：已选 N + 全选 / 取消全选；按词性快速选择（已选 / 总数）；卡片 勾选、单词、释义、音节、音标、拼读规则、分析说明；分析中 / 空态。

## 7. wordbook-detail（`pages/WordBookDetailPage.tsx`、`pages/wordbook-detail/*`）

数据：`get_word_book_detail`、`get_words_by_book`（分页 20）、`get_word_book_statistics`、`get_word_book_linked_plans`。

- 头部：标题、StatusTag、主题标签、创建于 / 更新于；编辑（EditWordBookModal）、删除（DeleteWordBookModal）。
- 统计：总单词数、名词、动词、形容词、其他。
- **WordListTable**：“单词列表 · 共 N 个单词”；补充单词（WordImporterModal）；表头全选、行勾选；选中后选择条（已选择 N、全选 / 取消全选、清除选择）+“删除选中(N)”；列 单词 / 中文释义（附首条例句与翻译、“共 N 条例句”）/ 音标 / 音节 / 词性（彩色）/ 操作（播放发音、朗读例句、删除）；分页（显示第 a-b 条，共 N 条；上一页、页码含省略号、下一页）；骨架、空态。`onEditWord` 未渲染 → EditWordModal（单词*、中文释义*、详细描述、IPA、音节、自然拼读片段、词性及缩写 / 英文 / 中文、拼读规则、分析说明、例句“英文 | 中文”每行，`update_word`）无法打开。
- **BatchDeleteModal**：单删 / 批删，列前 10 个 + “还有N个”，不可恢复提示；逐个 `delete_word` 后刷新。
- **EditWordBookModal**：名称*、描述、主题标签、图标选择、状态（草稿 / 正式）；`update_word_book` + reload。
- **DeleteWordBookModal**：单词数、创建时间；输入单词本名称才可删除；`delete_word_book` → wordbooks。
- WordImporterModal 补充：`create_word_book_from_analysis` 带 book_id；toast“成功处理 N 个单词（新增: a, 更新: b）”，刷新。
- **关联计划**：加载；卡片（名称、状态、描述、总单词数、学习进度%、周期）+ 查看详情 → plan-detail；空态。
- 页面状态：加载；错误 / 不存在（返回单词本列表）。

## 8. start-study-plan（`pages/StartStudyPlanPage.tsx`）— 旧版，mock 数据

入口仅 finish-study-plan 的“重新练习”。3 个写死单词；学习头（图标、标题、描述、进度、正确率、进度条）；WordCard（播放发音、单词详解弹窗 WordDetail（例句可播放）、输入框 Enter 提交、检查；答对 1.5s 下一词，答错 2s 清空重试）；计时卡（每秒 +1、暂停 / 继续、“设置”空 TODO）；完成 → finish-study-plan。

## 9. word-practice（`pages/WordPracticePage.tsx`）

- 初始化：`start_practice_session`（复用未完成会话）或 `get_practice_session_detail`（仅 sessionId）；`buildQueue`（分组、三步交错、答错重考、当轮小测）；恢复时 `resume_practice_session` + toast“接着上次的进度继续 已完成 x/y 题”（会话更换另有文案）；全部已答自动完成。
- 状态栏：“第 g/G 组 · 第一/二/三步”或“当轮小测”；进度条 done/total（tooltip：重考会增加题数）；有效时长 mm:ss；暂停 / 继续；退出。
- 主区两栏：左 PracticeFeedback + PracticeWordCard，右 WordSidePanel；暂停时替换为“练习已暂停”+“继续练习”。
- **PracticeWordCard**：步骤标题与说明；环节条 看 说 盖 写 查；单词显示（完整 / 字母格 + “共 N 个字母” / 问号（只听）/ 纠正逐字母标红 + 图例）；播放发音；看·说“跟着读：a - b - c”；信息栏 音标、音节、释义、详解、拼读块（按提示等级显示 / 遮罩 / 锁定“这一步先藏起来，答完显示”，朗读时拼读块逐块高亮）；输入框（看·说禁用，答对只读）；IME 保护（选词 Enter 不提交）、混入中文提示；按钮 盖住，开始写 / 确认 / 改正 / 下一题；键盘 Enter（写 / 纠正提交，feedback 继续，看·说焦点在“盖住”）。
- 作答：`submit_step_result`（后台提交，完成前等待落库）+ `save_practice_progress`；答对 700ms 自动下一题（Enter 立即）；答错进入“查”、标错误字母、安排重考；改对后需 Enter / 下一题。
- **PracticeFeedback**：夸奖语 / “改对了！看看右边的 AI 讲解” / “拼错了，查一查”（出错拼读块、“稍后还会再考一次”）；非错误显示“Enter 继续”。
- 自动朗读：新题 600ms 读单词，1s 后读首条例句；盖住后再读一遍单词；手动播放中断自动朗读；预取下一题音频。
- 暂停 / 恢复：`pause_practice_session` / `resume_practice_session`，暂停时保存进度。
- 退出：Modal“确定要退出练习吗？”（继续练习 / 确认退出）→ 保存进度 → plan-detail（无 planId → plans）；卸载时保存进度，暂停中离开会 resume 结束暂停。
- 完成：`complete_practice_session` + toast → practice-result（后端 PracticeResult）。
- **WordSidePanel**：tab 例句（数量 badge）/ AI 讲解（盖·写锁定，锁图标 + tooltip；纠正后“去看看”提示）；顶部提示随 tab / 模式变；锁定面板说明。
- **ExamplePanel**：完整（高亮目标词）/ 挖空 / 只中文（看·说 full，盖·写 masked，第三步和小测 translation）；点击例句朗读（播放 / 加载图标）；“补充例句”“重新生成”（`generate_word_examples` append / replace）；生成中提示；空态。
- **WordExplanationView**：先读缓存 `get_word_explanation`；无缓存时在看·说 / 查 / 改对环节停留 1200ms 自动生成；`generate_word_explanation` 流式（`word-explanation-delta`）；工具条“模型名 生成 · 时间”、生成 / 重新生成；Markdown 渲染；缺失态、错误态重试。AI 老师：`ask_word_tutor` 流式（`word-tutor-delta`），按单词内存保留对话；3 条提问建议；输入 ≤300 字、Enter 发送（IME 保护）、发送按钮；“AI 老师正在想…”。
- 其它状态：初始化中；初始化失败 + 重试；全部做完未提交“查看练习结果”；无内容 + 返回首页。

## 10. practice-result（`pages/PracticeResultPage.tsx`）

数据来自路由参数（缺省全 0）。面包屑（首页 > 学习计划 > 练习结果）；成绩横幅（等级 A+ / A / B / C / D 与描述；通过单词、正确率、练习时间）；详细统计 6 卡（总单词数 / 完全掌握 / 步骤正确率 / 平均用时 / 暂停次数 / 需要复习）；练习详情（图例 一次就对 / 查后改对 / 没写对；“完全掌握”“需要复习”单词卡：单词、释义、IPA、检查点徽章 刚学写 / 隔词写 / 听写 / 小测）；继续学习 → plan-detail；返回首页。

## 11. finish-study-plan（`pages/FinishStudyPlanPage.tsx`）— 旧版，配合 start-study-plan

参数缺失用 mock。面包屑；CongratulationsBanner；StudyStatistics（学习单词、正确答案、准确率、学习时长）；ActionButtons：开始下一个计划 → plans、重新练习 → start-study-plan、查看详细报告 → plan-detail。difficultWords / masteredWords 未渲染。

## 12. calendar（`pages/CalendarPage.tsx`、`pages/calendar/CalendarSidebar.tsx`）

数据：`get_calendar_month_data`（只采用最后一次请求，失败 toast）、`get_today_study_schedules`、`get_incomplete_practice_sessions`。

- 页头“学习日历” + 新建计划（create-plan）；月份导航（上个月 / 年月 / 下个月）。
- 月历：周一起；日格 日期、“新N / 复N”、完成进度条；状态 completed / partial / missed / today / planned，非本月淡化；无点击；加载。
- 侧栏 今日计划：加载 / 空态；每项 计划名、状态（已完成 / 进行中 / 未开始 / 待补）、逾期说明“…共有 N 天待补”、新学 / 复习数、x/y 词 + 进度条；按钮 开始 / 继续 / 补练 / 再练一次（`can_start_practice`）→ word-practice；“查看所有计划” → plans。
- 侧栏 未完成练习（有数据才显示）：计划名、日程、x/y 题、已练时长、上次练习；继续练习 → word-practice `{…, sessionId}`；放弃 → ConfirmDialog“放弃这次练习？”（danger）→ `cancel_practice_session` + toast。
- 侧栏 本月统计：学习天数 x/y、完成单词、平均每日、连续天数；图例 已完成目标 / 部分完成 / 未完成 / 今天。
- **2026-10-07 用户要求优化（与首页一起）**：侧栏改为「选中那天」面板（`pages/calendar/CalendarDayPanel.tsx`，默认今天，点日格切换，切月选中该月今天或 1 号）：当天各计划的单词日程（新词 / 复习 / 通过数，状态 已练完 / 练了一半 / 待补 / 未开始；按钮 再练一次 / 继续练习 / 补练 / 开始练习 / 提前练）、短文任务明细（标题、方式、所属计划；去朗读 / 开始练习）、当天练习记录、本月统计。后端 `CalendarDayData.passages` 与 `CalendarStudyPlan` 的计数 / `in_progress` 为此新增。移除：侧栏「今日计划」（由选中今天替代）、「未完成练习」卡（首页有继续入口与放弃弹框；练了一半的日程在当天显示「继续练习」）、「查看所有计划」按钮；`get_today_study_schedules` / `get_incomplete_practice_sessions` 不再在日历页调用。

## 13. settings（`pages/SettingsPage.tsx`）

“系统设置”；4 tab：AI模型配置（默认）/ 语音合成 / 通用设置 / 数据管理；页面级错误弹窗（各 tab onError 汇总）。

### 13a. AI模型配置（`pages/settings/AIModelSettings.tsx`）
- 数据：`get_all_ai_providers`、`get_all_ai_models`、`get_agent_catalog_providers`。
- 默认模型条：说明“提词、拼读分析、学习计划、讲解与 AI 老师都使用它”；按提供商分组下拉（只列可用）→ `set_default_ai_model`。
- 左栏提供商：分组 已配置 / 未配置 / 需要额外配置（暂不支持）；副标题（未配置 / 已停用 / 未填写密钥 / N 个模型 · 默认 / 还没有添加模型）；目录不可用提示“agent sidecar 未就绪”。
- 未配置提供商：只需密钥的 → 密码框（Enter）+“保存并选择模型”（`create_ai_provider` + toast → 自动开 SyncModelsModal）；需额外参数的 → 说明文字。
- 已配置提供商：API 密钥行（预览 ••••，修改 / 填写；编辑态密码框 Enter、保存、取消 → `update_ai_provider`）；状态行（停用 / 启用；自定义提供商“编辑接口” → ProviderFormModal）；模型区（“模型（N）”、搜索、选择模型 → SyncModelsModal（停用时禁用）、手动添加 → ModelFormModal）；模型行（名称、默认 / 已停用、modelId、参数摘要、测试结果；设为默认、测试 `test_ai_model`（“测试通过，用时 N ms / 测试失败：…”）、编辑、停用 / 启用 `update_ai_model`、删除 ConfirmDialog → `delete_ai_model`）；“移除这个提供商” ConfirmDialog（连同 N 个模型）→ `delete_ai_provider`。无“新增自定义提供商”入口。
- **SyncModelsModal**：`list_provider_remote_models`（“正在读取 {baseUrl}/models …”、错误态）；搜索；勾选列表（id、name、pi 目录、思考档、上下文 K、价格；已添加禁用）；取消 / 添加所选(N)（逐个 `create_ai_model`，toast 成功 / 失败数）。
- **ModelFormModal**：提供商*、模型ID*（pi 目录候选 `get_agent_catalog_models`）、显示名称*；目录信息（上下文、最大输出、推理档、价格；不在目录提示）；描述；生成参数（思考档、最大输出、温度、额外参数 JSON）；非目录模型 上下文窗口、推理模型；取消 / 保存。
- **ProviderFormModal**：pi 提供商映射（可“不映射”）、名称、显示名称*、接口类型（OpenAI Completions / OpenAI Responses / Anthropic Messages）、API地址*、API密钥（留空不变）、描述；取消 / 保存（`update_ai_provider`）。
- 加载：“加载设置...”。

### 13b. 语音合成（`pages/settings/TTSSettings.tsx`）
- 数据：`get_tts_config`、`get_tts_voices`、`get_default_tts_voice`。
- 豆包语音合成卡：编辑配置（TtsConfigModal）；已配置 / 未配置；鉴权方式（API Key 预览或 AppID + Access Token 预览）；默认音色；资源 ID（“（自动）”）；语速 ×、采样率；试听（固定文本 `text_to_speech` useCache:false，未配置禁用）。
- 缓存管理：说明；清理缓存 ConfirmDialog（warning）→ `clear_tts_cache(30)` → toast“已清理 N 个缓存文件”。
- **TtsConfigModal**：鉴权方式单选（API Key 推荐 / AppID + Access Token 旧版；留空不变）；默认音色 VoiceSelector（每项试听）；自定义音色 ID（优先）；语速滑块（建议 0.8×–1.0×）；资源 ID（自动 / seed-tts-2.0 / seed-tts-1.0 / seed-icl-2.0）；取消 / 保存配置（`update_tts_config`）。`set_default_tts_voice` 无 UI 调用。

### 13c. 通用设置
仅占位“更多设置选项即将推出...”。

### 13d. 数据管理（`pages/settings/DataManagementSettings.tsx`）
- 数据库概览：刷新统计（`get_database_statistics`）、数据表数、总记录数；加载 / 空态。
- 数据表列表：选择性重置 / 取消选择；全选 / 取消全选；“已选择 N 个表，共 M 条记录”；表卡片（勾选、显示名、类型、描述、记录数）。
- 重置区：危险说明（AI 模型配置和系统设置保留）；重置所有用户数据、删除数据库并重启、重置选中的表(N)。
- 重置确认（自制弹窗）：第 1 步影响列表；第 2 步输入 `RESET`；`reset_user_data` / `reset_selected_tables`；成功 `alert()` + 刷新统计。
- 删除数据库（自制弹窗）：第 1 步全部影响（含 AI 配置）；第 2 步输入 `DELETE DATABASE`；`delete_database_and_restart`，应用重启。

## 附：交叉事实
- 键盘：Modal Esc；PracticeWordCard Enter；AI 讲解提问 Enter；AI 设置密钥框 Enter；旧版 WordCard Enter；无全局快捷键。
- 右键菜单：无。拖拽：仅未使用的 TextImport / AddWords。
- 轮询：PlanningProgress `get_analysis_progress`（1–5s 退避）；批量分析 `get_batch_analysis_progress`（500ms）。流式事件：`word-explanation-delta`、`word-tutor-delta`。
- 计时：WordPracticePage 按时间戳每秒刷新；StartStudyPlanPage setInterval +1。
