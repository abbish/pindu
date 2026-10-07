# 方案：时间与时区统一约定

依据：2026-10-07 前后端两份只读审计（结论摘要见文末“现状”）。

## 1. 约定（目标终态）

### 1.1 两类时间值，命名即类型

| 类型 | 含义 | 存储 / 传输格式 | 字段命名 | 例 |
|---|---|---|---|---|
| **时刻 instant** | 某个绝对时间点 | UTC，固定格式 `YYYY-MM-DDTHH:MM:SS.sssZ`（毫秒、`Z` 结尾，定长） | `*_at` / `*_time` | created_at, updated_at, start_time, end_time, last_used |
| **日历日期 date** | 用户本地日历上的某一天 | `YYYY-MM-DD`，**无时区，永不换算** | `*_date` | schedule_date, start_date, end_date |

- 选 `…sssZ` 的理由：带时区标记（任何 JS 引擎、chrono、SQLite 都无歧义解析）；定长 → 字符串比较 / 排序 = 时间先后；SQLite 可直接生成：`strftime('%Y-%m-%dT%H:%M:%fZ','now')`，Rust：`Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)`，两者逐字节一致。
- 现状两种 UTC 格式都淘汰：SQLite 默认 `YYYY-MM-DD HH:MM:SS`（无时区标记，前端误读的根源）、`to_rfc3339()`（纳秒变长 + `+00:00`，与前者混比会错）。
- 例外：`study_plans.actual_start_date / actual_end_date / actual_terminated_date` 名为 date 实为时刻——按时刻处理并在类型注释中标明；新字段严格按命名规则。
- 日志文件（logger）保留本地时间 + 偏移（`+08:00`），属于给人看的诊断输出，不是业务数据。

### 1.2 “今天”与按天归组
- RedLark 是桌面应用，后端进程与 WebView 共用操作系统时区，“客户端时区” = 进程本地时区。
- 后端：“今天”只经 `time::local_today()` 取得，一次请求只取一次并向下传；时刻归入某天只用 `DATE(x,'localtime')` 或 `time::local_date_of(instant)`；**禁止截取 UTC 字符串的前 10 位当日期**。
- 前端：“今天”只经 `useToday()`（跨零点自动更新）或 `localToday()`；日历日期只用 `parseLocalDate`（`new Date(y, m-1, d)`），**禁止 `new Date('YYYY-MM-DD')`**（会当成 UTC 零点）。
- 日历日期之间的比较 / 加减在“日”上做（字符串比较或 NaiveDate），不经过时刻。

### 1.3 前端唯一入口 `src/utils/datetime.ts`
- 解析：`parseInstant(s)`（接受新格式；过渡期兼容旧 SQLite 格式与 RFC3339，按 UTC 解释）、`parseLocalDate(s)`
- 今天：`localToday()`、`toLocalDateKey(d)`、`startOfLocalDay(d)`、`useToday()` hook
- 展示（统一 zh-CN、本地时区）：`formatDate`（10月7日 / 2025年12月31日）、`formatDateTime`、`formatTime`、`formatRelative`（刚刚 / N 分钟前 / 昨天 / N 天前 → 超 7 天回落到日期）、`formatWeekday`、`formatDuration`（毫秒 → 3 分 20 秒 / mm:ss）
- 合并现有重复：dateLabel.ts、incompletePractice 的 lastActiveLabel / scheduleLabel 的日期部分、schedulePick.localToday、learningHeatmap.toLocalDateKey、timeProgress、各处时长格式化
- 页面 / 组件不得直接 `new Date(<string>)`、`Date.parse`、`toLocale*String()`（ESLint 规则 + 棘轮）

### 1.4 后端唯一入口 `src-tauri/src/time.rs`
- `now_utc() -> String`（规范格式）、`SQL_NOW_UTC`（SQL 表达式常量）、`local_today() -> NaiveDate`、`local_date_of(&str) -> Option<NaiveDate>`、`parse_instant(&str)`（兼容旧格式）
- 所有写入时刻的 SQL 显式绑定 `now_utc()` 或使用 `SQL_NOW_UTC`；不依赖列 DEFAULT（旧 DEFAULT 是 SQLite 默认格式，且 SQLite 改 DEFAULT 需要重建表，本方案不重建表）
- serde 类型里时刻仍为 `String`（规范格式），类型别名区分：`type Instant = String; type LocalDate = String;`，替换含义模糊的 `Timestamp`

## 2. 批次

| 批次 | 内容 | 验证 | 归属 |
|---|---|---|---|
| **T0 规则** | CLAUDE.md §7 增“时间与时区”硬规则；新增 `deliver-contract-and-data/references/time-and-timezone.md`（本约定的 owner）；`check-time.py`（Rust 中出现 `datetime('now')` / `CURRENT_TIMESTAMP` / `to_rfc3339()` / `Local::now()` 于 time.rs 之外即报错），接入 verify | validate-skills、脚本对当前代码给出存量清单 | 本会话 |
| **T1 前端** | `utils/datetime.ts` + 测试；迁移全部调用点；修：单词本详情与删除弹窗日期错日 / Invalid Date、timeProgress 西半球差一天、计划页日期格式不统一、日历 2030 年上限、跨零点“今天”不更新；删除死代码中的日期函数；ESLint `no-restricted-syntax`（warning + 棘轮基线） | tsc、npm test、lint 棘轮、tauri:dev 走查（UTC+8 凌晨创建的单词本显示当天） | 本会话 |
| **T2 后端取时** | `time.rs` + 单测；替换所有 `Utc::now().to_rfc3339()`、SQL 中 `datetime('now')` / `CURRENT_TIMESTAMP`、各处 `Local::now()`；插入语句显式写 created_at / updated_at；“今天”每请求取一次；不变量测试：跑一组代表性写操作后断言所有时刻列匹配规范正则 | cargo test、clippy、check-sql、check-time | 需与后端会话对齐（建议由其执行或分文件错开） |
| **T3 迁移 047**（046 已由后端会话的“自适应间隔复习”占用） | 把全部时刻列的历史值归一为规范格式（`strftime('%Y-%m-%dT%H:%M:%fZ', col)`，对两种旧格式都适用，NULL 不动）；替换 `update_study_plans_updated_at` 触发器使用规范格式；不改 DEFAULT、不重建表、不删数据 | 空库 + 真实库副本双验证：转换前后同一时刻相等（julianday 差 0）、行数不变、外键检查通过 | 同 T2 |

顺序：T0 → T1（纯前端，可立即做；`parseInstant` 兼容新旧格式，因此不依赖 T2/T3）→ T2 → T3。T2 必须先于 T3 合入，否则迁移后新写入仍会产生旧格式。

## 3. 回退
- T1：前端工具层替换，可按文件回退。
- T2：代码回退即可；已写入的规范格式数据仍可被旧代码读（SQLite 日期函数与 chrono 都能解析）。
- T3：格式转换是确定性的同值转换，不丢信息；回退无需反向迁移（旧代码可读新格式）。

## 4. 现状（审计摘要）
- 时刻有两种 UTC 格式：多数表为 SQLite 默认 `YYYY-MM-DD HH:MM:SS`（无时区标记），练习相关表为 `to_rfc3339()`（纳秒、`+00:00`）；二者字符串比较会错（`'T'` > `' '`）。目前没有现行查询跨格式比较，但练习表的列 DEFAULT 是旧格式、`practice_pause_records` 同一行混两种格式，隐患真实存在。
- 后端“今天”已全部为本地日期（`chrono::Local` / `'localtime'`），按天归组均正确；同一请求内多次取 `Local::now()`，跨零点可能不一致。
- `study_plans` 有触发器在每次 UPDATE 后写旧格式 `updated_at`（`schema-snapshot.py` 不显示触发器）。
- `word_books.updated_at` 无 DEFAULT、新建为 NULL，而 Rust 类型是非 Option 的 String（潜在读取失败，T2 一并修）。
- 前端：单词本详情“创建于 / 更新于”与删除单词本弹窗用 `new Date(旧格式)`，WKWebView 下 Invalid Date 或当本地时间（UTC+8 凌晨 0–8 点创建显示前一天）；`timeProgress` 把 `YYYY-MM-DD` 当 UTC；日期显示格式与 locale 不统一；日历年份上限 2030；“今天”不随跨零点更新；日期工具 6 处重复实现。
- 前端从不向后端发送时刻，只发日历日期与年 / 月整数。
- 周起始不一致（全局日历周一、计划日历周日）——非时区问题，T1 顺带统一为周一（需确认）。
