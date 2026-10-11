---
name: tutor-plans
description: 学习计划与学习情况：今天要学什么、计划进度、新建计划、调整每天新词数、追加词汇本或短文、暂停 / 继续 / 重新学习 / 结束 / 删除计划、学习统计和最近容易错的词。学习者问「今天学什么」「我学得怎么样」「帮我做个计划」「这周太忙先停一下」「考考我」时使用。
---

# 学习计划与学习情况

## 查看

- 今天要学什么：`mcp__pindu__today`（各计划今天的新词 / 复习、有没有落下的天数、到期的短文）。
- 计划：`mcp__pindu__list_plans` → `mcp__pindu__get_plan`（接下来几天的安排、单词、短文）。
- 学得怎么样：`mcp__pindu__learning_overview`（在学的计划、最近容易错的词）、`mcp__pindu__study_stats`（学习天数、正确率、每天学了多少）、`mcp__pindu__passage_results`（短文练习成绩）。
- 给建议要具体：点名几个容易错的词，说清错在哪，给一个记法或例句。

## 新建计划：`mcp__pindu__create_plan`

- 先确认用哪些词汇本（`list_word_books`，草稿不能用）；建之前可以 `mcp__pindu__preview_plan` 告诉学习者大约几天学完、每天几分钟；想加短文时 `mcp__pindu__plan_passage_candidates` 找和这些词最相关的短文（带题组）；每天新词数按学习者的时间定（没说就 10 个；小学生 5–8 个）。
- 学习顺序默认从易到难（在后台排，排好前可以先看计划，排好再开始练）；学习者想跟着课本单元学就用 `order: "book"`。
- 也可以加短文（`passages`，按顺序，每几天一篇，题组和阅读 / 听力要对应）。
- 建好后说一句：叫什么、每天多少词、大约多少天学完。

## 调整

- 改名称、说明、每天新词数、追加词汇本：`mcp__pindu__update_plan`（改每天新词数只重排还没练过的）。
- 计划里的短文：`mcp__pindu__set_plan_passages`（给出完整的顺序；已完成的保留）。
- 学习顺序重新从易到难排：`mcp__pindu__reorder_plan`（只排还没练过的，后台进行）。
- 暂停 / 继续：`pause_plan` / `resume_plan`（继续时没练的往后顺延）；学完或结束的想再学：`restart_plan`。
- 结束 / 删除计划、从计划里移除单词：`end_plan` / `delete_plan` / `remove_words_from_plan`，界面会请学习者确认。结束保留记录，删除不保留——学习者只是不想学了时建议结束，不要删除。

## 记录与分析

- 练习记录与错词：`mcp__pindu__practice_history`（每次练习的日期、用时、没过的词）。
- 记忆情况：`mcp__pindu__plan_memory`（没学 / 学习中 / 已掌握，今天该复习多少）；计划统计：`mcp__pindu__plan_stats`；某个月的学习日历：`mcp__pindu__calendar_month`。
- 只朗读的短文任务读完了：`mcp__pindu__mark_passage_read`。

## 练习

- 开始今天的练习：`mcp__pindu__open_page`（target `practice`，计划 id），和计划卡上的「开始学习」一样（单词没练完进单词练习，练完进到期的短文）。
- 做某套题：`open_page`（target `passage_practice`，题组 id，mode reading / listening）。
- 没练完的练习：`mcp__pindu__unfinished_practice`；接着练：`open_page`（target `continue_practice`，会话 id）；不要了：`mcp__pindu__discard_practice`（界面会确认）。
- 学习者要你考考他时：从容易错的词里出 3–5 道小题（拼写、选意思、填空），一题一题来，等他回答后再判对错、讲解。
