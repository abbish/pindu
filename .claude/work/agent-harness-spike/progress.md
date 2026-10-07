# progress

状态：spike 完成，等待用户决策是否进入落地（plan.md H1–H5）
已完成：
- pi 1.0.4 文档调研（RPC/SDK/工具/提供商/隔离/打包）
- 场景 A 提词：4 组对比（当前实现 / 直连 low / pi low / pi low + tokenize 工具），见 evidence.md
- 场景 B 场景对话：工具、流式、上下文、重启恢复会话全部通过（npm 版与单文件版各一次）
- 单文件 sidecar：bun 编译自建 host.ts，70MB、无需 Node
最近证据：evidence.md；数据 spikes/agent-harness/results/
下一步：用户确认后从 H1（sidecar 基建 + Rust AgentManager）开始；需要其它提供商测试 Key
阻塞：无
