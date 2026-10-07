# 架构级重构 Playbook（RedLark）

适用：跨多个 handler/service/repository 迁移 owner、拆解“名不副实”模块、拆分超大文件、统一事务/错误/前端 service 风格、恢复被历史重构破坏的行为。普通 refactor 不读本文。

本仓库的教训（2026-10 评估）：2026-01 的“三层重构”在搬迁时把 `complete_practice_session` 的日程/统计写入丢成了 `TODO` 空函数，`cargo test` 也早已无法编译，没有任何保护发现它。因此本 playbook 的第一原则是：**先锁定行为，再移动代码；搬迁中不留空实现。**

## 1. 行为锁定（每个重构批次之前）

对本批要触达的每个命令/函数，记录 **行为基线**，写在 `plan.md` 的“行为基线”表：

| 命令 | 读 | 写（表.列） | 事务 | 幂等/重复调用 | 错误路径 | 前端 consumer |
| --- | --- | --- | --- | --- | --- | --- |

取证方法（由便宜到贵）：

1. **读当前代码**的完整调用链：handler → service → repository，列出所有 SQL 写入。
2. **对照历史版本**：被重构过的代码必须与重构前比对。`git log --oneline -- <path>` 找到重构提交，`git show <commit>^:<old-path>` 取旧实现（handlers.rs 拆分前：`git show 32b60ff^:src-tauri/src/handlers.rs`）。差异逐项判定：有意变化（写进接受条件）/ 回归（进入修复批次）/ 旧实现本身的缺陷（单列）。
3. **对照真实 schema**：`python3 scripts/schema-snapshot.py --table <t>` 得到迁移终态的列；不以迁移文件片段或 Rust struct 推断列是否存在。
4. **能写测试就写测试**：按 `../../deliver-backend-rust/references/rust-test-standard.md` 写 characterization 测试，断言写入结果而不是调用次数。

基线未建立的命令不进入搬迁批次。

## 2. 批次形状

- **inventory 批次**：只产出机制矩阵和行为基线，不改代码。
- **搬迁批次**：一个功能域一批；命令名、参数、返回形状不变，前端零改动是默认接受条件。先原样搬到正确 owner，再在下一批下沉 SQL。
- **修复批次**：行为基线中发现的回归/缺陷单独成批，接受条件写清“修复后的行为”，不混在搬迁里。
- **拆分批次**（超大文件）：先按职责切文件、保持函数体不变；再在后续批次缩短函数。

机制矩阵（写在 plan.md）：

| 命令 / 函数 | 当前位置 | 应属 owner | 直接 consumer | 含裸 SQL | 行为基线已建 | 批次 |
| --- | --- | --- | --- | --- | --- | --- |

## 3. 搬迁中的硬规则

- **不留空实现**：搬迁后出现 `TODO` / `unimplemented!` / 返回 `Ok(())` 的空函数等于删除行为，是回归。确需延期必须在 plan 中登记并在接受条件写明“本批不保留 X 行为”，经用户确认。
- **不吞错误**：旧代码中 `if let Err(e) = ... { logger... }` 吞掉写入失败的，搬迁时要判断：该写入是否属于 contract？属于 → 改为 `?` 传播并在事务内；不属于 → 删除该写入。不原样保留“失败也算成功”。
- **事务边界随用例走**：一个用户动作对应的多表写入在 service 层一个事务内完成，约定见 `../../deliver-backend-rust/references/transaction-and-repository-conventions.md`。
- 不为重构引入新的抽象层（trait object、泛型 repository、DI 容器）。
- `lib.rs` 的 `generate_handler!` 是唯一注册点；搬迁后 `python3 scripts/check-ipc-contract.py` 必须通过。

## 4. 无编译器时的纪律

本仓库的 agent 环境可能无法编译 Rust（网络策略拦截 crates.io）。此时：

- 每批 Rust 改动限制在**可逐行审查**的规模；大文件拆分优先“移动而不改写”。
- 改动后立即运行本地可跑的检查：`scripts/check-sql.py`（SQL 对真实 schema 做 `EXPLAIN`）、`scripts/check-ipc-contract.py`、`tsc`、ESLint、`node --test`。
- 在批次交接中明确列出“需在具备工具链的机器上运行 `bash scripts/verify.sh`”，并且**不得声称编译或测试通过**。
- 连续批次之间设置检查点：上一批 Rust 未经 verify.sh 确认编译通过前，不开始依赖它的下一批（例如分层搬迁依赖事务约定的 repository 签名）。

## 5. 检查点

每个检查点：

1. 用户运行 `bash scripts/verify.sh`，日志写入 `.claude/work/<work-id>/logs/verify-<timestamp>.log`。
2. agent 读取日志，失败项归属到批次，修复后再请求一次。
3. 在 `evidence.md` 记录检查点结论（哪些项通过、哪些项未运行及原因）。

## 6. 测试决定

- 搬迁批次：先补 characterization 测试再搬；测试断言数据库写入结果和返回值。
- 修复批次：先写能表达正确行为的测试（在旧实现上应失败），再改。
- 不为“重构完成”补只断言调用发生的测试；不连接用户真实数据库的测试不算回归资产。

## 7. 停止条件

- 任一批搬迁后 verify.sh 失败且一次修复不能定位 → 回退该批（`git checkout -- <files>`，迁移文件除外），不带着红灯继续。
- 发现前端调用点与 Rust 签名本来就不一致 → 先进 `sdd-analyze`，记为独立缺陷。
- 行为基线中出现无法判定的差异（不知道旧行为是否是有意的）→ 问用户，不自行决定。
