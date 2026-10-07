# progress

状态：已完成实现，待用户实机验收
已完成（analysis.md 中的编号）：
- 统一口径：repositories/practice_metrics.rs（首答 CTE、学会 CTE、连续天数纯函数）；全局 / 计划 / 练习统计全部改用（B3 B4 B5 B6 B7 B8）
- 日历：日完成取日程自身的练完状态与掌握数；学习记录按本地完成日期、排除已删除计划（B1 B2）
- 日程“练完”语义：有已完成会话即 completed（迁移 045 回填）；get_study_plan_schedules 单词数子查询、completed = 练完（B9）
- 完成幂等（条件 UPDATE + 回滚返回已记录结果）、完成时结束未结束的暂停、重复暂停不再记录（B10 B13）
- 进度时长落库 save_practice_progress；完成时与已落库取较大值；平均每词用有效时长（B11 B15 F2 F11）
- 已删除 / 终止 / 完成计划：不列入未完成会话、不能开始练习（B12）；作答单词必须属于会话日程（B14）
- 前端：时间戳计时（utils/practiceClock.ts）、显示有效时长、单步用时不含暂停（F4 F8）；完成前等待在途提交（F1）；恢复补上待重考、跳过已做小测、接续重考次数（F6）；暂停防连点、改对后恢复不跳题（F9 F10）；小测 attempts = 1（F12）；错误页重试重新初始化（F15）
- 统一 pickPracticeSchedule + localToday（F7 F14）；首页 / 计划列表 / 卡片 / 关联计划改用 unified_status（F3）；继续练习弹窗显示已练完单词数
未处理：F13（小组时重考紧挨，单词数 ≤2 的组无法拉开间隔，保持现状）
最近证据：evidence.md；verify 13/13
下一步：用户实机验收（统计数字、日历、恢复练习时长）
