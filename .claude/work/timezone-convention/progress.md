# Progress

## 当前状态
T0–T3 全部完成（2026-10-07）。check-time 存量 0；剩余只有“有真实数据库时用副本再验证一次 047”。

## 已完成（2026-10-07，用户确认约定：时刻 `…sssZ`、不改 DEFAULT 改为显式写入、周一起）
- T0：规范 `.claude/skills/deliver-contract-and-data/references/time-and-timezone.md`；CLAUDE.md §7.5（并改 §2 命令、§4.3 引用、§8 债务）；contract / backend / frontend Skill、catalog、README 引用；`scripts/check-time.py`（棘轮，基线 `.time-baseline.json`，已接入 verify.sh）；validate-skills 通过
- T1：`src/utils/datetime.ts`（解析 / 今天 / 展示 / 时长）+ 测试；`hooks/useToday.ts`（跨零点更新）
  - 修复：单词本详情“创建于 / 更新于”与删除弹窗（旧格式按本地时间误读 / Invalid Date）、`timeProgress` 西半球差一天（新增与后端同组用例的测试）、计划详情起止日期原样显示、日历年份上限 2030、热力图与计划详情“今天”不随零点更新、讲解 / 日志 / DevTools / 计划日志时间格式不统一
  - 合并：dateLabel.ts 删除；schedulePick.localToday、learningHeatmap.toLocalDateKey 改为重导出；incompletePractice 的 scheduleLabel / lastActiveLabel / formatActiveTime 委托 datetime（超过 7 天回落为日期）
  - 删除死代码：calendarService.formatDate / isCurrentMonth、utils/index.formatDate、未被使用的 PlanPreview / WordBookHeader / StudyRecordsSidebar 组件
  - ESLint（error）：utils/datetime.ts 之外禁止单参数 new Date、Date.parse、toLocaleDate/TimeString、截取 toISOString；探针验证 4 类均拦截
  - 验证：tsc、lint 0/0、npm test 67、css-vars 0、type-sync 0、vite build
- 后端先行：`src-tauri/src/time.rs`（now_utc / SQL_NOW_UTC / local_today / parse_instant / local_date_of / format_date / parse_date）+ 4 个测试（含 SQL 与 Rust 格式一致、旧格式解析为同一时刻）；`#![allow(dead_code)]` 待 T2 接入后删除；time.rs clippy 干净
- check-time 基线 75 处 → 后端会话改用 time.rs 后收紧到 62（local-now 19→6）
- 迁移 046 新列 srs_due / srs_last 是日历日期但未以 _date 结尾：记为规范中的已知例外，不为改名新增迁移

## T2 / T3（2026-10-07）
- 分工：后端会话正在改学习计划与单词本生命周期，以下文件由它按规则顺手改：repositories/{study_plan,practice,wordbook}_repository.rs、services/{study_plan,practice,wordbook}.rs、handlers/{study_plan,wordbook}.rs（含计划日历网格周一起、word_books INSERT 显式写 updated_at）；改完删除 time.rs 的 `#![allow(dead_code)]` 并 `check-time.py --update`
- 本会话已改：repositories/{ai_model,srs,study_schedule,tts,word_explanation,word,statistics,diagnostics}_repository.rs、services/{statistics,tts}.rs —— SQL 当前时刻改为规范 strftime；INSERT 显式写时刻列（word_explanations、srs 复习日程与复习词、tts_cache、word_examples）；“今天”改为 time::local_today()（统计一次请求取一次、周进度改绑参数）
- 迁移 047：DROP 旧触发器 → word_books.updated_at 为 NULL 时用 created_at 补齐 → 50 个时刻列 `strftime(规范, col)` 等值归一（只改 text 且可解析、且与规范值不同的）→ 重建触发器（WHEN NEW.updated_at IS OLD.updated_at）
- 验证：本机无应用数据库（`~/Library/Application Support/com.redlark.pindu-app/` 不存在），改用 sqlite3 依次执行 001–046 建库 + 写入两种旧格式（SQLite 默认、to_rfc3339 纳秒 +00:00）、NULL updated_at、不可解析值 → 执行 047：97 个值改写，julianday 全部不变、全部为规范格式、行数不变、foreign_key_check 为空、不可解析值保留、触发器两种情况行为正确
- 不变量：`time::assert_instants_canonical` + 测试 `writes_produce_canonical_instants`（AI 提供商 / 模型、TTS 缓存与配置、单词讲解写入后扫描全部时刻列）
- cargo test --lib 148 通过（在后端会话的单词本半成品之前运行）；check-sql 0 失败；check-time 基线收紧为 26（全部在后端会话的文件中）
- 未验证：真实用户数据库副本（本机没有）；clippy 待后端会话的单词本改动可编译后再跑

## 延后（冻结文件 / 后端）
- CreatePlanPageV2、StudySchedulePreview 中的日期原样显示（后端会话改造中）
- 计划日历后端网格周日起 → 周一起（services/study_plan.rs，随 T2）
- 各页面时长格式化改用 formatDuration（WordPracticePage 冻结；其余非时区问题，择机）

## 收尾（2026-10-07）
- 后端会话完成其文件（含计划日历周一起、time.rs 去掉 allow(dead_code)），check-time 0
- test_support 种子改为显式写规范时刻（seed_step 把任意可解析时刻归一）；study_plan 测试夹具同改
- assert_instants_canonical 加入 11 个流程测试（练习完成 / 暂停恢复 / 自动转进行中与完成 / 重考与小测、计划暂停恢复 / 重新学习 / 编辑替换日程 / 状态转换、单词本生命周期 / 创建 / 分析写入）；加入后立即抓到测试夹具的旧格式写入，已修
- npm run verify 14/14（cargo test 150）

## 下一步
1. 有真实数据库时，用副本再验证一次 047（目前本机没有应用数据库）
