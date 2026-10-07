# 技术方案：短文练习（阅读 + 听力）—— v2：短文为独立素材

## 目标与边界

见 brief.md。关系：

```
来源（可组合）                  素材库                       学习计划（两套练习，互相独立）
单词本 A / B ─┐
学习计划 ─────┼─ 选词 + 场景 ─▶ 短文（独立） ─从库里选─▶ 短文练习：阅读 / 听力 / 题目
手动输入 ─────┘                单词本 ──────────────────▶ 单词练习：三步法 + 记忆等级
```

## 已完成（v1，保留）

- AI 任务 passage-generate / passage-grade（提示词、submit_passage / submit_grade 工具与校验、Rust 二次校验）；评测脚本 eval-passage.mjs（primary / adult 各一轮：目标词 10/10、篇幅达标、评分三档单调）。
- 规则（passage_rules.rs）、作答与判分、开放题评分 / 重新评分、统计；练习页 PassagePracticePage（阅读选词填空、听力逐句播放、结果与翻译）。
- 迁移 053（v1 结构，已应用到测试库，未发布）。

## v2 变化

### 数据（迁移 054）
- 053 未发布、只有测试数据：054 删除 053 的三张短文表与 `study_plans.passage_interval_days`，按 v2 重建（迁移注释写明理由）。
- `passages`：title、sentences、target_words（JSON：[{wordId?, word}]，手动输入的词 wordId 为空）、scene（生成时用的场景文本）、level、word_count、model_name、prompt_fingerprint、时刻列。不再引用单词本 / 计划。
- `passage_sources`：passage_id（CASCADE）、kind（book / plan）、ref_id（无外键：删除来源不删短文）、name（创建时的名称快照）、detail（plan 的选词范围 hard / learned / due）。
- `passage_questions`：不变。
- `passage_attempts`：passage_id、plan_id / schedule_id（SET NULL，计划接入时用）、其余不变。

### 命令
| 命令 | 变化 |
| --- | --- |
| `get_passage_word_candidates(request)` | 新增：按来源（book_ids、plan_id + 范围）列出候选词（单词、释义、来源、已在短文里用过几次、是否难词、是否建议勾选） |
| `generate_passage(request)` | 改：book_ids、plan_id + plan_scope、word_ids（勾选的词）、extra_words（手动输入）、topic（可空，空时用所选单词本的场景）、length |
| `get_passages(book_id?, plan_id?)` | 改：按来源筛选（passage_sources） |
| 其余（get / delete / start / submit / regrade / statistics） | 不变 |

### 前端
- 侧边栏：一级 首页 / 学习计划 / 日历；分组「素材库」：单词本、短文（AppShell，协调 redlark-3b）。
- `passages` 短文库页：卡片网格（标题、水平、来源、目标词、最近成绩、阅读 / 听力），来源筛选，「新建短文」。
- `create-passage` 新建短文页：① 词汇来源（单词本多选；学习计划 + 范围 难词 / 已学 / 今日复习）② 选词（候选列表默认勾选建议的 10 个，可手动加词，4–15 个）③ 场景与篇幅（主题可空）→ 生成（20–60s，内联进度）→ 结果卡片：开始阅读 / 听力。路由参数可预填 bookIds / wordIds（单词本页入口）。
- 单词本详情「短文」页签：引用这本单词本的短文 +「用这本单词写短文」（跳新建页并预填）；单词列表批量「用选中的词写短文」同样跳新建页。
- 练习页返回短文库（或来源页）。

### 计划接入（下一批，先与 redlark-3b 协调）
- 计划练习内容：单词 / 短文 / 两者；只练短文不需要单词本。
- 计划从短文库选短文排进日程（顺序 + 日期），今日任务显示短文；计划统计分开展示。
- 后端：`study_plan_passages`（plan_id、passage_id、sort_order、schedule_date）与相关命令；UI 可能由 redlark-3b 负责。

## 批次

| 批次 | 内容 | 验证 |
| --- | --- | --- |
| C1 | 迁移 054 + 类型 / repository / service / 命令改造（来源、候选词、难词） | cargo test（候选词、难词、来源筛选、删除来源不删短文）；测试库迁移到 54 |
| C2 | 侧边栏分组、短文库页、新建短文页、单词本页签与批量入口改为跳转 | tsc / lint / 截图（亮暗） |
| C3 | 真实模型走一遍（多来源 + 手动词） | real_passage 测试 + 测试应用 |
| C4 | 计划接入（协调后） | — |
| C5 | 文档：CLAUDE.md、DECISIONS D23 | — |
