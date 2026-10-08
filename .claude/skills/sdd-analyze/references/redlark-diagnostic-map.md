# RedLark 诊断证据地图

说明证据在哪里、怎么取、常见症状对应哪条链路。个案结论不写回本文。

## 证据源

| 证据 | 位置 / 取法 | 能证明 | 不能证明 |
| --- | --- | --- | --- |
| 后端日志 | `<app_data_dir>/logs/app.log`；或设置页 LogViewer / `get_system_logs` 命令。每个 handler 入口 `api_request(cmd, params)`、出口 `api_response(cmd, ok, msg)` | 命令是否到达后端、入参实际值、service 返回成功/错误消息 | SQL 实际执行了什么、前端拿到后怎么渲染 |
| WebView 控制台 | `tauri:dev` 自动打开 DevTools；`TauriApiClient.invoke` 打印 command/args/result | 前端发出的 command 与参数（camelCase）、收到的 `ApiResult` | 后端内部分支 |
| SQLite 实际数据 | `sqlite3 "<app_data_dir>/vocabulary.db"`；macOS 路径 `~/Library/Application Support/com.redlark.pindu-app/vocabulary.db`。查 `_sqlx_migrations` 看已应用迁移 | 权威状态、迁移是否落地、历史数据形状 | 为什么写成这样 |
| Rust 编译/clippy | `cargo check` / `cargo clippy`（在 `src-tauri/`） | 重复命令定义、类型不匹配、未注册导出 | 运行时反序列化 |
| 测试 | `cargo test`（crate 内测试，内存 SQLite）；`npm test` | 被覆盖的用例、聚合口径、错误形状 | 未覆盖路径 |
| 静态检查 | `scripts/check-sql.py`（SQL 对迁移终态 schema）、`scripts/check-ipc-contract.py`、`scripts/schema-snapshot.py --table t` | SQL 引用的表/列是否存在、命令注册与参数名 | bind 类型/顺序、运行时拼接的 SQL |
| AI 链路 | app.log 中 `AGENT` 行（任务名、用时、tokens、校验退回次数、stderr）；设置页「测试」；`agent/eval` 固定输入重跑；`cargo test agent::tasks::tests::real_ -- --ignored` | 发给 sidecar 的参数与提示词、工具调用参数（tool_execution_end）、Rust 校正丢弃了什么 | 模型“为什么”这么答 |
| 进度 | `jobs.rs` 后台任务；`job-updated` 事件（进度节流 200ms）+ `list_jobs` | 任务快照（status / stage / current / detail / error） | 节流期间的中间态；重启前的任务（只放内存） |

## 症状 → 首查链路

| 症状 | 最可能的分歧点 | 先查 |
| --- | --- | --- |
| 前端报 `command xxx not found` | `lib.rs` `generate_handler!` 未注册 / 命令名拼写 | `python3 scripts/check-ipc-contract.py` |
| 后端报 `no such column` / 某命令永远失败 | repository SQL 与迁移终态不符（重构时列名写错） | `python3 scripts/check-sql.py`；`schema-snapshot.py --table <t>` |
| `invalid args ... missing field` / 参数为 `null` | 前端传了 snake_case 或字段名不符；Rust 侧 `Option` 与前端 `undefined` | 控制台 args vs handler 签名；见 `tauri-ipc-contract.md` |
| 前端类型有值但显示 undefined | Rust struct 的 serde 输出是 snake_case，TS 类型按 camelCase 写（或反之，`types/tts.rs` 有 `rename_all`） | 对照 `types/*.rs` 的 serde 属性与 `src/types/*.ts` |
| 应用启动即崩 / 白屏 | 迁移失败 panic（`lib.rs` 对 migrate 失败是 panic） | `app.log` 的 `DATABASE` 分类；`_sqlx_migrations` 最后一行 |
| 迁移在空库 OK，在老库失败 | 历史数据不满足新约束 / 旧迁移曾被修改导致 checksum 不符 | 用真实库副本复现；`sqlx-migration-standards.md` |
| 学习计划状态显示/可用操作不对 | `unified_status` 与 `status` 不一致；前端 `canTransitionTo` 与后端转换规则漂移 | 查 `study_plans` 行；对照 `services/study_plan.rs` 与 `src/types/study.ts` |
| 日历 / 统计数字与明细不符 | 聚合 SQL 口径（`calendar_repository.rs` / `statistics_repository.rs`）vs 明细表；`study_plan_schedules` 与 `practice_sessions` 关联 | 先用 sqlite3 手算同一口径 |
| AI 分析“卡住”或进度不动 | 任务在排队（agent 队列同时 2 个）；任务内部没有报进度；取消标志已设但还没到检查点 | `app.log` 的 AI 分类；`list_jobs` 的 status / stage |
| AI 返回解析失败 | 模型未按 JSON 返回 / 字段名漂移 / 代码块包裹 | 打印原始响应；对照 `prompts/*.md` 的输出要求与 `Json*Response` |
| 练习会话丢失 / 重复 | `practice_sessions.completed` 与 `word_practice_records` 不一致；`get_incomplete_practice_sessions` 口径 | 查两表实际行 |
| TTS 无声 / 报错 | `volcengine_tts_config` 鉴权未配置；音色与资源 ID 不匹配（55000000）；Key 无效（45000010）；缓存文件路径失效 | `get_tts_config` 的 configured / effectiveResourceId；app.log 中 TTS 错误的 code；`tts_cache` 行与文件是否存在 |

## 取证时的边界

- 不读取或输出 `ai_providers.api_key` / `volcengine_tts_config.api_key / access_key` 的完整值；只确认非空。
- 用真实库诊断时先复制一份，不在用户正在使用的库上做写操作。
- 一次 AI 输出只算一个样本；归因前至少固定输入重跑一次。
