# 时间与时区约定（RedLark）

时间相关的唯一规范。用户决定（2026-10-07）：**数据存储一律 UTC，使用时按客户端时区正确展示**。
CLAUDE.md §7.5 只保留硬规则摘要，细节以本文为准。迁移进度见 `.claude/work/timezone-convention/`。

## 1. 两类时间值（命名即类型）

| 类型 | 含义 | 存储 / IPC 格式 | 字段命名 |
|---|---|---|---|
| **时刻 instant** | 绝对时间点 | UTC 定长 `YYYY-MM-DDTHH:MM:SS.sssZ` | `*_at` / `*_time` |
| **日历日期 local date** | 用户本地日历上的一天 | `YYYY-MM-DD`，**永不做时区换算** | `*_date` |

- 规范格式可由两侧逐字节一致地生成：Rust `Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)`，SQLite `strftime('%Y-%m-%dT%H:%M:%fZ','now')`。定长 → 字符串比较 / 排序即时间先后。
- 历史上的两种格式（SQLite 默认 `YYYY-MM-DD HH:MM:SS`、`to_rfc3339()` 的纳秒 + `+00:00`）在迁移完成前仍会出现：**读取一律经解析函数**（前端 `parseInstant`，后端 `time::parse_instant`），不要按字符串跨列 / 跨格式比较时刻。
- 已知例外（命名与类型不符，读写时以本条为准）：
  - `study_plans.actual_start_date / actual_end_date / actual_terminated_date` 名为 date，实为**时刻**；
  - `study_plan_words.srs_due / srs_last`（迁移 046，间隔复习）是**日历日期** `YYYY-MM-DD`（下次复习日 / 上次练习日）。
  之后的新字段严格按命名规则。
- 日志（logger）用本地时间 + 偏移，是诊断输出，不是业务数据。

## 2. “今天”与按天归组

- 桌面应用：后端进程与 WebView 共用系统时区，“客户端时区” = 进程本地时区。
- 后端：“今天”只经 `time::local_today()`，**一次请求只取一次**并向下传参；时刻归日用 `DATE(x,'localtime')` 或 `time::local_date_of`。
- 前端：组件里用 `useToday()`（跨零点自动更新），纯函数用 `localToday()` / `toLocalDateKey()`。
- **禁止**：截取 UTC 字符串（`toISOString().slice(0,10)`、`created_at[..10]`）当日期；`new Date('YYYY-MM-DD')`（UTC 零点，西半球差一天）。
- 日历日期之间的比较、加减在“日”上做：字符串比较（定长零填充）或 `NaiveDate` / `addLocalDays` / `localDaysBetween`。
- 周从周一开始（全局日历与计划日历一致；计划日历的后端网格仍为周日起，随 T2 统一）。

## 3. 前端：唯一入口 `src/utils/datetime.ts`

| 需要 | 用 |
|---|---|
| 解析时刻 / 日历日期 | `parseInstant` / `parseLocalDate`；排序用 `instantMs` |
| 今天、日期键、加减、相差天数、时刻归日 | `useToday()`（hooks）/ `localToday` / `toLocalDateKey` / `addLocalDays` / `localDaysBetween` / `localDateOf` |
| 展示（zh-CN，本机时区） | `formatDate`（10月7日 / 2025年12月31日）、`formatMonth`、`formatWeekday`、`formatTime`、`formatDateTime`、`formatRelative`（刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 日期）、`formatRelativeDay`、`formatDuration` |

ESLint（`eslint.config.js`，error）在 `utils/datetime.ts` 之外禁止：单参数 `new Date(值)`、`Date.parse`、`toLocaleDateString` / `toLocaleTimeString`、截取 `toISOString()`。`new Date()`（现在）与 `new Date(y, m, d)`（本地构造）允许。

## 4. 后端：唯一入口 `src-tauri/src/time.rs`（T2 引入）

- `now_utc() -> String`、`SQL_NOW_UTC`（SQL 表达式常量）、`local_today() -> NaiveDate`、`local_date_of(&str)`、`parse_instant(&str)`（兼容旧格式）。
- 写入时刻：SQL 显式绑定 `now_utc()`，或在 SQL 文本里直接写与 `SQL_NOW_UTC` 相同的 `strftime('%Y-%m-%dT%H:%M:%fZ','now')`（静态 SQL 便于 check-sql 检查）；**不依赖列 DEFAULT**——INSERT 必须列出全部时刻列（旧 DEFAULT 是 SQLite 默认格式；SQLite 改 DEFAULT 需重建表，本项目不做）。按天偏移的比较用同一格式：`strftime('%Y-%m-%dT%H:%M:%fZ','now', '-N days')`。
- 历史值已由迁移 047 归一为规范格式（等值改写，无法解析的值原样保留），`study_plans` 的 updated_at 触发器改为“语句没写 updated_at 时才补写规范格式”。047 中的 UPDATE 列表就是全部时刻列的清单：新增时刻列时在新迁移里写规范 DEFAULT，并把它加入 `assert_instants_canonical` 的扫描（目前从 047 解析）。
- 不变量测试：`time::assert_instants_canonical(&pool)`（`#[cfg(test)]`）扫描全部时刻列；新增或修改写入路径的测试在写完后调用它。
- 新迁移（≥ 047）的时刻列 DEFAULT 用 `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`。
- serde 中时刻、日期仍是 `String`；类型注释写明是时刻（UTC）还是日历日期。

`scripts/check-time.py`（verify 中运行，棘轮基线 `.time-baseline.json`）统计 `time.rs` / `logger.rs` 之外的 `datetime('now')`、`CURRENT_TIMESTAMP`、`date('now')`、`.to_rfc3339()`、`Local::now()`、`Utc::now()`，以及新迁移的旧格式 DEFAULT：计数只减不增；清理后 `--update` 收紧。

## 5. 改动时的检查清单

- 新字段：先判定是时刻还是日历日期，按 §1 命名与格式。
- 新查询：时刻比较 / 排序只在同一规范格式的列之间，或先经 `julianday()` / `strftime` 归一；按天统计用本地日期。
- 新界面：时间显示只经 `utils/datetime` 的 format 函数；涉及“今天”的派生值依赖 `useToday()`。
- 验证：`npm test`（`datetime.test.ts` 等）、`node scripts/lint-ratchet.mjs`、`python3 scripts/check-time.py`。
