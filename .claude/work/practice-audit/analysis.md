# analysis（审计发现，已核实者标 ✓）

后端：
- B1 ✓ 日历日完成用 study_sessions.words_studied（= 日程总词数）求和：全错也“completed”，重复练习翻倍。
- B2 日历 / 全局统计按 UTC 日期分组，与本地 today 比较。
- B3 计划“已学单词” = 有任意作答。
- B4 所有正确率含 retry / review。
- B5 words_learned 判定被重考 / 小测污染。
- B6 全局完成率用 status='completed'（不存在的值）。
- B7 连续天数跳过空档日。
- B8 计划统计时长用墙钟时间（含暂停 / 跨天）、天数按会话数、streak 不是连续天数。
- B9 get_study_plan_schedules word_count 按会话数放大、completed 语义错。
- B10 完成幂等先查后写有竞态。
- B11 未完成会话时长不落库。
- B12 已删除 / 终止计划的未完成会话仍列出、可写入。
- B13 暂停可重复开启、完成时不收尾。
- B14 submit 不校验单词属于会话日程。
- B15 average_time_per_word 用 total_time。
前端：
- F1 最后一题提交与完成会话并发，可能丢成绩并弹“提交失败”。
- F2 恢复后计时从 0（同 B11）。
- F3 首页 / 计划列表按已废弃 lifecycle_status 分流。
- F4 activeTime 靠 tick 累加（后台节流少算）、显示含暂停。
- F5 同 B4。
- F6 恢复会重做全部小测、丢失待做重考。
- F7 “今天”用 UTC 日期。
- F8 暂停时间算进单步用时。
- F9 改对后暂停再恢复被自动跳题。
- F10 暂停按钮无防连点。
- F11 同 B15。
- F12 小测 attempts 借用第三步重考计数。
- F13 小组时重考紧挨着出现。
- F14 首页无今日日程时兜底取第一个（可能已完成）。
- F15 错误页“重试”用 reload。
