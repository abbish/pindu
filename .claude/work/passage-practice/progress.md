# 进度

- 当前状态：active（v3：短文库 + 题组，见 DECISIONS D24）
- 当前批次：C1–C3 已完成；C4 后端已完成（2026-10-07，D29），UI 交 redlark-3b
- 已完成：
  - v1：AI 任务（生成 / 评分）、规则与判分、练习页（阅读 / 听力 / 结果）、评测脚本。
  - v2（独立素材）：迁移 054；来源 + 候选词（单词本 / 计划难词·已学·到期复习 / 手动词）；命令 get_passage_word_candidates；侧边栏「素材库」分组；短文库页、新建短文页；单词本「短文」页签改为引用列表 + 跳转新建；文档（CLAUDE.md、D23）。
- v3（2026-10-07，用户反馈后重做）：迁移 055（短文与题组分离）；来源单词本 / 计划并列多选；必用词 + AI 按场景挑词；短文详情（原文阅读 / 朗读 + 阅读理解题组）；题组生成 Dialog；按题组练习；三步新建表单；提示与报错按 ui-interaction-patterns §6。verify 14/14；real_passage 与 eval（primary / adult）通过；截图亮暗。
- 较早验证（v2）：verify 14/14（修 check-sql 后重跑 SQL 检查与 cargo test 通过）；截图（短文库、新建短文、练习阅读 / 结果 / 听力，亮暗）；测试库迁移到 54，计划子表行数不变；real_passage 一次通过（58.7s）、一次 300s 超时。
- 阻塞：无
- C4 约定（与 redlark-3b 已对齐，记录于 .claude/work/authoring-flows-redesign/progress.md「C4 约定」；**等用户确认后实现**）：
  - 迁移 055：study_plans.practice_content（words / passages / both）+ study_plan_passages(plan_id, passage_id, sort_order, scheduled_date, UNIQUE)。
  - 短文从开始日起每 N 天一篇（默认 2）；完成 = 该计划内有完成的作答；只练短文：全部完成即计划完成；两者：单词全掌握且短文全完成。
  - end_date = max(单词结束日, 最后一篇短文日)，后端统一计算；暂停 / 继续、首次练习平移、重新学习时未完成短文的日期一起平移。
  - 命令：create 请求加 practice_content / passage_ids / passage_interval_days；get_plan_passages；set_plan_passages{practice_content, passage_ids, interval_days}（只能加内容或去掉未练过的内容，已完成短文锁定）；get_today_passage_tasks；get_passages 改为 PassageListRequest{book_ids?, plan_id?, sort: recent | relevance}（overlap、bestAttempt）；passage-practice 路由加 planId / returnTo；日历每天加 passage_tasks / passage_completed。
  - 删除短文：被未结束计划引用时拒绝；已完成 / 已终止计划引用时一并删除计划条目与作答。
  - 实现完把最终签名（含 TS 类型位置）发 redlark-3b，由其做 UI。
- C4 后端（2026-10-07）：迁移 056（practice_content / passage_interval_days + study_plan_passages：set_id 可空 = 只朗读、mode、scheduled_date、completed_at、attempt_id）；services/plan_passages.rs（排期纯函数、reschedule / auto_start / try_auto_complete / 作答完成回写）；handlers/plan_passage.rs 5 个命令；start_passage_attempt 加 plan_id；提交必须全部作答；删短文 / 题组保护；日历与计划日历每天 passage_tasks / passage_completed；计划列表 practice_content / total_passages / completed_passages，进度含短文；plan_pace 改节奏后刷新结束日、只练短文的计划追加单词本转 both。TS 类型（src/types/passage.ts、study.ts）与 passageService / studyService 方法已加。verify 14/14；测试库副本演练 056 通过，测试应用已迁到 56。
- 下一步：
  1. C4 UI（redlark-3b）：新建计划、计划设置、详情页短文页签、首页今日短文任务、日历标记；passage-practice 路由加 planId / returnTo 并在提交后回到计划。
  2. 观察生成超时：记录 run_task 的重交次数与耗时，必要时把超时提到 420s 或降低题量。
