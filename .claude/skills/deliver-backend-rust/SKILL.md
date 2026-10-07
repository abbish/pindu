---
name: deliver-backend-rust
description: "后端实现（Tauri 2 / Rust / sqlx / SQLite）：修改 src-tauri/src 的 handlers、services、repositories、types、lib.rs 命令注册或 migrations 时使用，由 sdd-implement 调度，或用户明确要求后端实现时直接进入。按 Handler → Service → Repository 三层完成一个连贯批次，SQL 只在 repository，迁移只增不改；不负责顶层方案，跨层 contract 收口归 deliver-contract-and-data。Keywords: backend, Rust, Tauri command, handler, service, repository, sqlx, migration, 后端, 迁移."
---

# Deliver Backend Rust

本 Skill 是后端实现能力，不是顶层开发流程。它在 `src-tauri/` 这一面完成一个连贯批次。架构、目录和硬性规范以 `CLAUDE.md` §4、§7 为准，本文不复述，只写实施要点。

## 参考基线

- 写入多张表、或改动任何 repository 写方法时读 `references/transaction-and-repository-conventions.md`。
- 写或改测试时读 `references/rust-test-standard.md`（测试在 crate 内，内存库用 `test_support`）。
- 触达 `src-tauri/migrations/` 时读 `references/sqlx-migration-standards.md`。
- 写入或比较时间、取“今天”、新增时间列时读 `../deliver-contract-and-data/references/time-and-timezone.md`（`scripts/check-time.py` 棘轮守护）。
- 改命令签名、参数或返回类型时读 `../deliver-contract-and-data/references/tauri-ipc-contract.md`。
- 改 `prompts/agent/`、`agent/src/tools/`、`agent::tasks` 的提示词 / 工具 / 结果校正时转 `../deliver-ai-prompt/SKILL.md`；sidecar 进程、RPC 协议（`agent::session` / `protocol` / `config`）与打包归本 Skill。

## 输入

- 当前批次目标与 `plan.md` 中的 owner / 联动 / 验证要求
- 涉及的 handler、service、repository、types 文件

## 负责什么

- 在后端面完成一个连贯批次
- 保持 `handler（薄）→ service（业务/事务）→ repository（SQL）` 边界
- 给出后端面最小必要验证建议

## 不负责什么

- 重新定义需求或方案
- 把跨层 contract 问题全部吸进后端硬处理
- 默认跑全量测试

## 实施规则

**Handler（`handlers/<domain>.rs`）**
- 模板：`app.state::<SqlitePool>()` / `app.state::<Logger>()` → `logger.api_request(cmd, params)` → `XxxService::new(Arc::new(pool.inner().clone()), Arc::new(logger.inner().clone()))` → `match service.xxx().await` → `api_response(cmd, ok, msg)` → `AppResult<T>`。
- 参数只用 `String / Option<String> / i64 / Option<i64> / bool / Vec<_>` 或一个 `request: XxxRequest` 结构体；不用 `Option<Id>` 别名作顶层参数。
- 不写 SQL、不写业务分支；日志参数里不得出现 api_key 明文。
- 新命令放到功能域对应的文件；不再往 `handlers/diagnostics.rs` 加非诊断命令。
- **在 `lib.rs` `generate_handler!` 注册**；`handlers/mod.rs` 已 `pub use <domain>::*`，新文件要在 mod.rs 加 `pub mod` + `pub use`。

**Service（`services/<domain>.rs`）**
- 校验失败返回 `AppError::ValidationError`；找不到返回 `AppError::NotFound`；不用 `anyhow!` 字符串直接上抛。
- 一个用户动作写多表 → service 开事务，repository 写方法接收 `&mut SqliteConnection`（约定见 `references/transaction-and-repository-conventions.md`）。
- 不留 `TODO` 空实现：返回 `Ok(())` 却什么也不做的函数等于删除行为。
- 跨域协调在 service 层做（如创建计划同时写 schedules），不让 handler 串联多个 service。

**Repository（`repositories/<domain>_repository.rs`）**
- 所有 `sqlx::query*` 在这里；方法名 `find_*/insert_*/update_*/delete_*/count_*`。
- 批量查询用 `IN (...)` 或 join，不在循环里逐条查（历史上修过多处 N+1）。
- 写方法签名 `(&self, conn: &mut SqliteConnection, ...)`，执行用 `.execute(&mut *conn)`；不在 repository 内开事务。
- 写入失败一律 `?` 传播，不用 `if let Err(e) = ... { logger }` 吞掉 contract 写入。
- Row → struct 映射字段齐全；新加列必须补映射，否则运行时 `ColumnNotFound`。
- 软删除遵循 `deleted_at IS NULL` 过滤（word_books）；学习计划状态按 `unified_status`。

**Types（`types/<domain>.rs`）**
- `#[derive(Serialize, Deserialize)]`；默认 snake_case 输出，如加 `#[serde(rename_all = "camelCase")]` 必须在 plan 中注明并同步 TS 类型。
- `Id = i64`、`Timestamp = String`（沿用 `types/common.rs`）。

**质量**
- `cargo fmt`；`cargo clippy` 零警告是基线。
- 不新增 `unwrap()` 到运行时路径；启动路径（`lib.rs` setup）除外。

## 默认执行方式

1. 确认当前批次只覆盖哪个功能域、哪几层。
2. 自下而上改：repository → service → handler → lib.rs 注册 → types。
3. 记录联动面：命令签名 / types serde 形状 / 迁移 / 测试。
4. 涉及迁移时，把空库首跑、真实库副本、终态 schema 验证入口交给 `sdd-verify`。
5. 本地先跑 `python3 scripts/check-sql.py` 与 `python3 scripts/check-ipc-contract.py`；把 `cargo check` / `cargo test <filter>`（无工具链时为 `bash scripts/verify.sh` 检查点）交给 `sdd-verify`。

## 完成条件

- 当前后端批次已完成且三层边界未被破坏
- 命令已注册，签名已交给 contract owner 同步
- 迁移批次已说明终态、兼容方式与验证入口
- 后端验证入口清楚
