# 工作简述：架构优化与重构（2026-10）

- 用户目标：按 2026-10-06 架构评估的方向做一次全面优化与重构；先升级 harness（方法与规范），再动代码。
- 成功标准：
  1. harness 提供重构所需的规范与可执行验证工具，且规范与代码现状一致；
  2. 每个代码批次都有可复查证据（本地可跑的检查 + 用户 Mac 上 `scripts/verify.sh` 日志）；
  3. 不引入行为回归；发现的既有回归按 contract 修复并说明。
- 范围：src-tauri（错误 contract、事务、分层收口、AI 模块拆分、测试基建）、src（死代码、service、路由类型、大页面拆分、日志/any 治理）、harness（skills、脚本、CLAUDE.md）。
- 非目标：引入路由/状态/UI 库；全量改 `sqlx::query!`；CSP 收紧（需真机验证，列为发布项）；改动用户未提交的 `Cargo.toml` / `tauri.conf.json` 产品名改动。
- 关键约束：
  - 2026-10-06 起在用户 Mac 本机的 Claude Code 中继续，具备 cargo/npm 工具链，agent 可直接运行 `bash scripts/verify.sh`；`tauri:dev` 手工走查仍需用户。
  - 迁移只增不改；`git status` 中用户的 3 个未提交文件不动。
- 已确认事实：见 analysis.md。
- 用户决定：先建立方法和规范，再动手；接受分轮检查点。
