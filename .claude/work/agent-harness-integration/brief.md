# brief：引入 pi agent harness（实施）

## 目标
以 pi（RPC sidecar）承载 RedLark 全部 LLM 工作：先替换提词 / 拼读分析 / 学习计划，再支撑场景对话、练习助手。
模型配置统一到 pi 的模型概念（provider 映射、思考档、samplingParams），数据库仍为真源。

## 用户决定（2026-10-06）
- 接受 sidecar 每平台约 70MB 的安装包增量；按 spike 方案实施（H1–H5）。
- 做好工作记录、方案文档与持续的决策记录：`docs/agent-harness/DESIGN.md`、`docs/agent-harness/DECISIONS.md`、本目录 progress / evidence。
- 模型配置统一到适配 pi 的数据结构。

## 成功标准
1. sidecar 随应用打包，Rust 能启动、通信、超时 / 崩溃处理，密钥不落盘不进日志。
2. 提词、拼读分析、学习计划经 harness 执行，结果质量不低于旧实现（参照评分 / 回归脚本），可回退。
3. 设置页模型配置支持 pi 概念（内置 provider、思考档、额外参数），同步模型可列出 pi 内置目录。
4. 场景对话 MVP：流式、工具、会话持久化。
5. 每批 `npm run verify` 通过；实机走查有证据。

## 约束
- 迁移只增不改；不删用户数据。
- 未获用户要求不提交 git。
- 选型依据：`.claude/work/agent-harness-spike/`。
