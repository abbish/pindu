# 技术方案：架构优化与重构（第 1 轮）

方法：`.claude/skills/sdd-plan/references/architecture-refactor-playbook.md`（行为锁定 → 搬迁/修复分批 → 检查点）。
本轮只做“可逐行审查”的 Rust 改动 + 可本地验证的前端改动；分层搬迁与 AI 拆分在检查点 1 通过后进行。

## 行为基线：练习会话命令

| 命令 | 写入（重构前 32b60ff^） | 写入（当前） | 判定 |
| --- | --- | --- | --- |
| complete_practice_session | 事务内：`practice_sessions` 完成；`study_sessions` INSERT；`study_plan_schedule_words.completed`（列不存在，必失败被吞）；已完成会话幂等返回 | 无事务：仅 `practice_sessions`；`update_schedule_progress` 为 TODO；已完成会话报错；`pause_count=0` | 回归 + 既有缺陷 |
| pause_practice_session | INSERT `practice_pause_records(pause_start)`；`pause_count+1` | INSERT `(paused_at)` → **列不存在，必失败** | 回归 |
| resume_practice_session | 最近一条 `pause_end IS NULL` 记录写 `pause_end`；无记录时成功 | `SET resumed_at … ORDER BY … LIMIT` → **列不存在，必失败** | 回归 |
| get_today_study_schedules | 查询正常 | 引用 `sps.progress_percentage` → **必失败** | 回归 |
| get_study_plan_status_history | 引用 `changed_at` → 必失败 | 同左 | 既有缺陷 |

有意保留的差异：`PracticeResult.total_words` 当前按日程全部单词计（旧实现按有练习记录的单词计），保持当前行为。

## 批次

### B0 测试基建（Rust）
- 新增 `src/test_support.rs`（`#[cfg(test)]`）：`memory_pool()`（单连接内存库 + 全部迁移）、`test_logger()`、`seed_*`。
- 删除无法编译/非可重复的 `src-tauri/tests/*.rs`、`src/test_statistics.rs`（及 lib.rs 中 `mod test_statistics`）。
- 验证：verify.sh 中 `cargo test` 可编译运行。

### B1 错误 contract（Rust + TS）
- Owner：`src-tauri/src/error.rs`；consumer：`src/api/client.ts`、`src/types/api.ts|common.ts` 的 `ApiResult`。
- 变化：`AppError` 去掉 `derive(Serialize, Deserialize)`，手写 `Serialize` 为 `{code, message}`；`code()` 方法供两处复用；`From<sqlx::Error>` 不再二次拼接前缀。client 解析 `{code,message}`。
- 机制：Tauri 用 serde 序列化 `Err(E)`；外部标签 enum → 前端取不到 message。
- 验证：Rust 单测锁 wire JSON；`client.test.ts` 锁解析；tsc。

### B2 运行时 SQL 故障（Rust）
- `practice_repository` 暂停/恢复改用 `pause_start/pause_end`，改为 conn 版本；暂停在 service 事务内 INSERT + `pause_count+1`。
- `calendar_repository::find_today_schedules` 去掉 `progress_percentage`，排序恢复为 `sp.created_at ASC`。
- `diagnostics::get_study_plan_status_history` 用 `created_at AS changed_at`。
- `lib.rs` 去掉 2 个重复注册。
- 验证：check-sql 0 失败、check-ipc-contract 无 E5；pause/resume 测试。

### B3 练习完成 contract 恢复（Rust）
- Owner：`services/practice.rs::complete_practice_session`。
- 变化：读（会话、单词状态）在事务外；事务内：标记会话完成 → 写 `study_sessions` → `StudyScheduleRepository::refresh_completion`（SQL 已在真实 schema 验证，见 evidence）→ commit。已完成会话幂等返回结果；`pause_count` 取会话值；删除 `update_schedule_progress` 空函数。
- 新 repository 方法（接收 `&mut SqliteConnection`）：`mark_session_completed`、`insert_study_session`、`create_pause_record`、`increment_pause_count`、`close_latest_pause`、`refresh_completion`。
- 验证：service 测试——完成后三表最终行；重复完成幂等；完成数去重与未完成会话不计入。

### B4 前端（可本地验证）
- `get_words_by_book` 参数改 camelCase（搜索/分页/词性筛选恢复生效）。
- 删除调用不存在命令的 5 个 service 方法、`CreatePlanPage`、`api/endpoints.ts`、`@tauri-apps/plugin-sql`。
- `WordBookService` 改模块级单例 `wordBookService`。
- `src/navigation.ts` 类型化路由；修正指向不存在页面的 `report`/`practice` 导航。
- `client.ts` / `BaseService` 去调试日志。
- `SettingsPage` 按 tab 拆分（只移动不改写）。
- 验证：tsc、lint 棘轮（不回退并收紧）、`npm test`、check-ipc-contract 0 错误。

### 检查点 1
用户在 Mac 执行 `npm run verify`；修复后进入第 2 轮。

## 第 2 轮（检查点 1 已于 2026-10-06 通过）

### B5 分层收口 — inventory（2026-10-06）

生产代码中 repositories 以外的 SQL：`handlers/diagnostics.rs` 21、`ai_model_handlers.rs` 18、`tts_service.rs` 6 + `tts_handlers.rs` 4、`services/wordbook.rs` 5、`word_analysis_handlers.rs` 4。`services/study_plan.rs` 已无裸 SQL；`services/practice.rs` 的 SQL 仅在测试中。

| 命令 | 当前位置 | 应属 owner | 前端 consumer | 批次 |
| --- | --- | --- | --- | --- |
| get_study_plan_status_history | handlers/diagnostics.rs | study_plan（复用 repo `find_status_history` + service `get_status_history`） | studyService | B5a |
| get_study_plan_word_books | handlers/diagnostics.rs | study_plan | EditPlanModal | B5a |
| update_study_plan_basic_info | handlers/diagnostics.rs | study_plan service（事务） | EditPlanModal | B5a |
| update_study_plan_with_schedule | handlers/diagnostics.rs | study_plan service（事务，复用 create_* 批量写入） | EditPlanModal（status 恒为 'draft'） | B5a |
| get_calendar_month_data | handlers/diagnostics.rs | calendar（repo 两个范围查询 + service 纯函数组装） | calendarService | B5b |
| diagnose_study_plan_data / diagnose_calendar_data | handlers/diagnostics.rs | diagnostics（SQL 下沉 diagnostics_repository） | 无前端调用 | B5c |
| ai_model_handlers 全部 | ai_model_handlers.rs | ai_model service/repository | aiModelService | B5d |
| TTS 配置/缓存 | tts_service.rs、tts_handlers.rs | tts repository | ttsService | B5e |
| 单词本创建/更新 | services/wordbook.rs | wordbook_repository | wordbookService | B5f |
| 分析入库 | word_analysis_handlers.rs | 待 inventory | wordAnalysisService | B5g |

行为基线（B5a/B5b，搬迁前读代码确认）：
- `update_study_plan_basic_info`：事务内 `SELECT status … AND deleted_at IS NULL`；不存在或 `status != 'draft'` → `DatabaseError`（文案“学习计划不存在”/“只能编辑草稿状态的学习计划”）；`UPDATE name, description, updated_at`。
- `update_study_plan_with_schedule`：事务内查 `status`（不过滤 deleted_at）→ 非 draft 拒绝 → 更新 name/description/intensity/period/review/start_date/ai_plan_data/status → 删除 study_plan_words、study_plan_schedules → 由 AI 结果重建 plan_words（非法 word_id 跳过）、schedules、schedule_words（非法 word_id 报 ValidationError）。
- `get_study_plan_status_history`：`created_at AS changed_at`，`ORDER BY created_at DESC, id DESC`。
- `get_calendar_month_data`：见代码；日状态规则 not-started / completed / in-progress / overdue；月统计只计当月日期；连续天数从今天往前最多 30 天。

既有缺陷（单独修复批次 B5a-fix，不混入搬迁）：
1. `update_study_plan_with_schedule` 删除日程依赖“级联删除 schedule_words”，但 `PRAGMA foreign_keys` 未开启 → 遗留孤儿 `study_plan_schedule_words`。修复：事务内先删 schedule_words。
2. 同命令接受任意 `status` 写入 `status` 列且不更新 `unified_status`；唯一调用方恒传 `'draft'`。修复：只接受 `'draft'`，其它值 ValidationError。
3. 两个编辑命令用 `DatabaseError` 表达“不存在/非草稿” → 改为 `NotFound` / `ValidationError`（wire `code` 变化；前端只用 message）。

可接受差异：重建 schedule_words 改用 `create_schedule_words_batch`，非数字 `wordbook_id` 由“按文本写入”变为 ValidationError（与创建路径一致）。

### 其余批次
- B6 AI 模块拆分：`ai_service.rs` → `ai/{client,parsers,extraction,phonics,planning}`；合并两个进度管理器。
- B7 `PlanDetailPage` 拆分；`any` / `console` 继续棘轮下降。
- 评估 `ts-rs` / `tauri-specta` 类型生成。

## 验证策略

| 接受条件 | 最小证据 | 升级条件 |
| --- | --- | --- |
| 错误 contract | Rust 单测 + client 单测 | 检查点 1 在 tauri:dev 触发一次校验错误 |
| 练习/暂停/今日日程 | Rust service 测试 + check-sql | 检查点 1 走一遍练习流程 |
| IPC 参数 | check-ipc-contract | 单词本详情页搜索走查 |
| 前端重构无回退 | tsc + lint 棘轮 + node test | 设置页四个 tab 走查 |
