# 分析

## 检查范围

后端分层遵守度、事务边界、IPC 错误形状、测试基建、前端体量与类型、依赖与配置。证据来自读代码、`git show` 历史版本、用 Python sqlite3 依次执行 001–032 迁移得到的真实终态 schema、本地 `tsc`。

## 事实与被违反的 Contract

| # | 事实 | 违反的 contract | 类型 |
|---|---|---|---|
| F1 | `AppError` `#[derive(Serialize)]` → wire 形状 `{"DatabaseError":"..."}`；`api/client.ts` 只识别 `message/error/data`，否则 `JSON.stringify` | IPC 错误应为可读消息 | 因果 finding（高置信，待运行时确认） |
| F2 | `services/practice.rs::update_schedule_progress` 为 `TODO` 空函数；`complete_practice_session` 无事务、不写 `study_sessions`、`pause_count` 写死 0、已完成会话重复调用报错 | 重构前（`git show 32b60ff^:src-tauri/src/handlers.rs` L4586）在事务内写会话、写 `study_sessions`、幂等返回已有结果 | 因果 finding：2026-01 重构引入的回归 |
| F3 | 终态 schema 中 `study_plan_schedule_words` **没有** `completed` 列；重构前的 `UPDATE ... SET completed = TRUE` 每次失败且被日志吞掉；`study_plan_schedules.completed_words_count` / `status` 无任何代码维护，日历进度恒为 0 | 日历按 `completed_words_count` 展示进度 | 因果 finding：既有缺陷（早于重构） |
| F4 | `tests/*.rs` 引用不存在的 crate `redlark_app`（实际 `redlark_app_lib`）及私有模块；`test_statistics.rs` 连接用户真实库 | `cargo test` 应可运行且可重复 | 因果 finding：测试基建失效 |
| F5 | ESLint 9 无 `eslint.config.*` | `npm run lint` 应可运行 | 因果 finding |
| F6 | 34 个命令在 diagnostics / ai_model / tts / word_analysis 模块中直接写 SQL；`services/wordbook.rs` 5 处 SQL；`get_calendar_month_data`（356 行）位于 diagnostics.rs | CLAUDE.md §4.1 三层规则 | 设计 finding |
| F7 | `ai_service.rs` 1621 行（`generate_study_plan_schedule` 414 行），两个全局进度单例，3 处前端轮询 | 单一 owner | 设计 finding |
| F8 | `SettingsPage.tsx` 2466 行（4 tab）、`PlanDetailPage.tsx` 1372 行；320 处 `console.*`、109 处 `any`；`WordBookService` 每次渲染 `new`；`CreatePlanPage.tsx`、`api/endpoints.ts`、`@tauri-apps/plugin-sql` 死代码/依赖 | CLAUDE.md §5/§7.3 | 设计 finding |

## 方案准入

- F1–F5：直接进入实现（有因果证据）。
- F2/F3 合并为“练习完成 contract 恢复”：恢复事务、`study_sessions` 写入、幂等；新增日程完成数维护（实现 `update_schedule_progress` 注释所述意图）。完成数口径用 SQL 在真实 schema 上验证。
- F6/F7：先 inventory，再按功能域搬迁；需第一轮 Rust 编译通过后进行。
- F8：前端可用本地 tsc/eslint/node:test 验证，与 Rust 批次并行。
- 不应进入 production 的表层修补：给 `study_plan_schedule_words` 补 `completed` 列来“让旧 UPDATE 生效”——日历消费的是 `completed_words_count`，补列不解决消费端。
