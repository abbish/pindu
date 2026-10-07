# sqlx / SQLite 迁移编写标准（RedLark）

本文件是 `src-tauri/migrations/` 的实现基线。只有批次触达迁移时读取。CLAUDE.md §7.1 的三条规则（只增不改、序号连续、禁止删库重建）是前提，本文说明怎样在 SQLite + sqlx 上做到。

## 机制事实

- `lib.rs` 启动时 `sqlx::migrate!("./migrations").run(&pool)`；失败 **panic**，应用起不来。
- sqlx 在 `_sqlx_migrations` 表记录每个文件的版本号（文件名前缀数字）和 **checksum**。已应用文件内容被修改 → 下次启动 `VersionMismatch` → panic。这就是“只增不改”在技术上的原因，`.claude/hooks/guard-migrations.sh` 会拦截编辑。
- 文件名格式 `NNN_description.sql`，版本 = `NNN`；当前最大为 039，下一号 **040**。不跳号、不重复。
- SQLite `ALTER TABLE` 只支持 `ADD COLUMN`、`RENAME TABLE`、`RENAME COLUMN`、`DROP COLUMN`（3.35+）。改列类型/约束/默认值必须走重建表。
- 每个迁移文件默认在一个事务中执行（sqlx 默认）；SQLite DDL 可回滚，这比 MySQL 宽松，但 **不要依赖它**来掩盖半成品脚本。
- **外键是开启的**：sqlx 0.8 的 `SqliteConnectOptions` 默认执行 `PRAGMA foreign_keys = ON`，`DatabaseManager` 未覆盖，迁移与运行时都在同一个池上执行。迁移里声明的 `FOREIGN KEY … ON DELETE CASCADE` 是生效的。（2026-10-06 用 sqlx migrator 实测；此前本文曾误写为“未开启”。）

## 粒度：一个文件一个意图

- 一个迁移文件只表达一个 schema 意图，文件名能直接说明（`040_add_words_example_sentence.sql`，不是 `040_misc_fixes.sql`）。
- 加列 + 建索引 + 回填数据可以在同一文件，因为它们服务同一意图且 SQLite 事务可回滚；但不同意图（如“加例句字段”和“修复计划状态”）分成两个文件。
- 需要重建表时，整个 `建新表 → INSERT SELECT → DROP 旧表 → RENAME` 放在同一个文件里完成，不拆到两个版本（中间状态不能是一个合法版本点）。

## ⚠ 重建被外键引用的表会级联删除子表数据

外键开启时，`DROP TABLE parent` 会先执行隐式 `DELETE FROM parent`，触发子表的 `ON DELETE CASCADE`。而 `PRAGMA foreign_keys = OFF` 在事务内是无效的，sqlx 默认把每个迁移包在事务里。

实测（2026-10-06，sqlx migrator，迁移至 030 后插入计划与日程，再执行 031）：`study_plan_schedules` 1 → 0。也就是说 020 / 021 / 023 / 031 这类重建 `study_plans` 的历史迁移，会清空当时已有计划的 `study_plan_words`、`study_plan_schedules`、`practice_sessions`（及其级联的作答记录）、`study_plan_status_history`、`study_sessions`。**不要以这些文件为重建模板。**

被引用表（`study_plans`、`study_plan_schedules`、`study_plan_schedule_words`、`practice_sessions`、`words`、`word_books`、`theme_tags`）需要重建时：

1. 优先避免重建：能用 `ADD COLUMN` / `RENAME COLUMN` / `DROP COLUMN`（3.35+）表达就不重建。
2. 必须重建时，文件首行写 `-- no-transaction`（sqlx 0.8 支持），使迁移在事务外执行，然后按 SQLite 官方 12 步流程：`PRAGMA foreign_keys = OFF;` → `BEGIN;` → 建新表 / 拷数据 / `DROP` / `RENAME` / 重建索引 → `PRAGMA foreign_key_check;` → `COMMIT;` → `PRAGMA foreign_keys = ON;`。末尾必须恢复 `ON`，因为连接会回到池中继续使用。
3. 验证必须包含**子表行数**：真实库副本上迁移前后对每个子表 `SELECT count(*)`，不只看被重建的表。

## 兼容已有数据

写迁移前先回答：

1. 新列是否 `NOT NULL`？是 → 必须给 `DEFAULT`，或先加可空列、回填、再重建表收紧。
2. 是否新增 `UNIQUE` / 唯一索引？是 → 先写一条查询确认现有数据无重复（放在 plan 的验证里，不放在迁移里）；有重复先用独立迁移清理。
3. 是否改列类型或约束？是 → 重建表模式，并逐列对照 `.schema` 把原有列定义、默认值、索引、触发器一并带过去。
4. 是否删除列？先 `rg` 确认 repository 里没有再读它；删列迁移与代码删映射同一批。
5. 是否重命名？代码引用同批改完；不保留旧名兼容视图。

## 与代码联动

同一批次必须同步：

- `repositories/*` 的 Row 映射与 SQL 列名
- `types/*.rs` 结构体字段 → `src/types/*.ts`
- 受影响 service 的校验与默认值
- `tests/` 中建库的 fixture（如果直接写 schema 而不是跑迁移，要同步）

## Plan

在 `plan.md` 写明：目标终态（`.schema` 片段）、现有数据如何兼容、是否重建表、涉及的代码映射点、回退策略（SQLite 无 down 脚本：回退 = 新增一个反向迁移，不是删文件）。

## Implement

- 以当前最大序号 +1 新建文件；只新建，不碰任何已有文件。
- 列定义写全（类型、NOT NULL、DEFAULT）；索引用 `IF NOT EXISTS`。
- 重建表时新表先叫 `<table>_new`，最后 `ALTER TABLE ... RENAME TO`；旧表的索引需要在新表上重新 `CREATE INDEX`。
- 不在迁移里写与业务无关的“顺手清理”。

## Verify

最低证据：

1. **空库首跑**：临时 app_data_dir（或删除测试用库）启动，`_sqlx_migrations` 包含新版本，`.schema <table>` 为预期终态。
2. **真实库副本**：复制用户 `vocabulary.db` 到临时目录，指向它启动，迁移成功且原有行数不变（`SELECT count(*)`）。
3. **历史文件未变**：`git diff --stat src-tauri/migrations/` 只有新增。
4. 受影响命令在 `tauri:dev` 中跑通一次。

没有真实库副本时写为残留风险，不用空库通过冒充兼容。

## 完成检查

- [ ] 文件只有一个 schema 意图，序号 = 最大 +1
- [ ] 没有修改、删除或重命名任何已有迁移
- [ ] NOT NULL 新列有 DEFAULT 或走重建表
- [ ] 重建表时列定义、索引逐项对照旧 `.schema`
- [ ] repository 映射、Rust 类型、TS 类型同批同步
- [ ] 空库与真实库副本两种启动都有证据，或明确残留风险
