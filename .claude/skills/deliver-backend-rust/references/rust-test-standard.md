# Rust 测试标准（RedLark）

## 1. 现状与决定（2026-10）

- `src-tauri/tests/*.rs` 引用不存在的 crate 名 `redlark_app`（实际为 `redlark_app_lib`）及私有模块，`cargo test` 无法编译；`src/test_statistics.rs` 连接用户真实数据库并只打印结果。二者都不是回归资产，已删除。
- 决定：**测试写在 crate 内**（`#[cfg(test)] mod tests`），可直接访问私有模块；不为测试把模块改成 `pub`。

## 2. 测试数据库

统一使用 `src/test_support.rs`（`#[cfg(test)]`）：

```rust
let pool = test_support::memory_pool().await;   // 单连接内存库 + 跑完 001..N 全部迁移
let logger = test_support::test_logger();       // 写入系统临时目录，不碰用户日志
```

- 内存库必须 `max_connections(1)`：SQLite `:memory:` 每个连接是独立数据库，多连接池会让迁移和查询落在不同库上。
- 种子数据用 `test_support` 里的 `seed_*` 辅助函数，按用例最小化插入；不依赖迁移里的默认数据之外的任何外部状态。
- 禁止连接 `vocabulary.db` 或任何用户路径。

## 3. 写什么测试

| 对象 | 断言 |
| --- | --- |
| service 用例（写多表） | 调用后查询各表的**最终行**；失败路径下各表**无部分写入** |
| repository 复杂 SQL（聚合、窗口函数） | 给定种子数据的精确计数/结果 |
| 纯函数（计算、解析、序列化） | 输入 → 输出；`AppError` 的 wire JSON |
| 状态机 | 每条允许/禁止的转换 |

- 测试名描述行为：`completing_session_records_study_session_and_schedule_progress`，不用 `test_1`。
- 不 mock 数据库；内存 SQLite 足够快。
- AI 调用不在单元测试中真实发起；解析逻辑用固定原始响应 fixture。

## 4. 运行

```bash
cd src-tauri && cargo test            # 全部
cargo test practice                    # 按名过滤
```

`bash scripts/verify.sh` 会运行全部测试并记录日志。
