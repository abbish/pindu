# 事务与 Repository 约定（sqlx 0.8 / SQLite）

本文件是 RedLark 后端“谁开事务、repository 方法长什么样”的唯一规范。`deliver-backend-rust` 与 `architecture-refactor-playbook` 引用它。

## 1. 原则

- **一个用户动作 = 一个事务**。当一个命令要写多张表（或先读后写依赖一致性）时，service 层开启事务，所有写入在同一事务内完成，最后 `commit`。任一步失败 → 函数返回 `Err`，事务随 `Drop` 自动回滚。
- **事务由 service 持有**。handler 不开事务；repository 不自己开事务（历史上 `study_plan_repository` / `statistics_repository` 内部开事务的方法，迁移时上移到 service）。
- **repository 只负责 SQL**：一个方法一个语义动作（插入会话、更新计数……），不做跨表编排。
- **不吞写入错误**。`if let Err(e) = query.execute(..) { logger... }` 只允许用于明确“非 contract”的旁路写入（例如诊断日志表）；属于 contract 的写入一律 `?`。

## 2. 方法签名

写方法（以及需要在事务内读一致数据的读方法）接收连接：

```rust
use sqlx::SqliteConnection;

impl PracticeRepository {
    /// 将会话标记为完成（在调用方事务内执行）
    pub async fn mark_session_completed(
        &self,
        conn: &mut SqliteConnection,
        session_id: &str,
        end_time: &str,
        total_time: i64,
        active_time: i64,
    ) -> AppResult<()> {
        sqlx::query("UPDATE practice_sessions SET completed = TRUE, end_time = ?, total_time = ?, active_time = ?, updated_at = ? WHERE id = ?")
            .bind(end_time).bind(total_time).bind(active_time).bind(end_time).bind(session_id)
            .execute(&mut *conn)          // 重借用，conn 可继续使用
            .await?;
        Ok(())
    }
}
```

service 中：

```rust
let mut tx = self.pool.begin().await?;
self.practice_repo.mark_session_completed(&mut tx, session_id, &now, total_time, active_time).await?;
self.schedule_repo.refresh_completion(&mut tx, schedule_id).await?;
tx.commit().await?;
```

- `&mut tx`（`Transaction<'_, Sqlite>`）通过 DerefMut 自动强转为 `&mut SqliteConnection`。
- 非事务调用方用 `let mut conn = self.pool.acquire().await?;` 再传 `&mut conn`。
- 纯读、无一致性要求的方法继续接收 `&self` 并使用 `self.pool.as_ref()`，不必改签名。

## 3. 渐进迁移

- 不一次性改写所有 repository。**触达哪个写方法，就把它改为接收 `conn`**；旧的 pool 版本若仍有调用方，暂时保留并在内部 `acquire()` 后委托给新方法，不复制 SQL。
- 一个用例改为事务化时，其涉及的所有写方法必须都已是 `conn` 版本，不允许事务内混用 `self.pool` 写入（那会在事务外另起连接，SQLite 下还可能因写锁导致 `database is locked`）。
- service 需要 pool 开事务：service 结构体持有 `pool: Arc<SqlitePool>`（与 repository 共享同一个 Arc）。

## 4. SQLite 特性提醒

- 连接池中多个连接 + 一个长事务写锁 → 其它写连接等待 `busy_timeout`（sqlx 默认 5s）。事务要短：先在事务外完成 AI 调用、计算，再开事务写入。
- 「先读后写」且可能被并发触发的事务（页面打开时多个请求都会走的同步，如 `srs::sync_today`）用 `srs::begin_write`（`BEGIN IMMEDIATE`）开事务。普通 `pool.begin()` 是 DEFERRED：WAL 下两个事务都读过后再升级为写，后写的一方直接返回 `database is locked`，不走 busy_timeout 等待（前端显示「数据正忙」）。回归测试见 `services::srs::tests::concurrent_syncs_do_not_fail_with_database_locked`（文件库 + 多连接）。
- `PRAGMA foreign_keys` 是开启的（sqlx 默认），schema 中的 `ON DELETE CASCADE` 生效：删除计划/日程会连带删除其单词关联、练习会话与作答记录。删除父行前确认这是预期行为；需要保留历史的场景用软删除（`deleted_at`）。迁移中重建被引用表的风险见 `sqlx-migration-standards.md`。
- `RETURNING` 子句可用（SQLite 3.35+，sqlx 捆绑版本满足），优先于 `SELECT last_insert_rowid()`。

## 5. 验证

- 事务化的用例至少一条测试：构造中途失败（例如让第二步写入违反约束或传入不存在的 id），断言第一步写入未落库。见 `rust-test-standard.md`。
- `python3 scripts/check-sql.py` 校验 repository 中的 SQL 在真实 schema 上可被 `EXPLAIN`。
