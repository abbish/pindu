# brief：内置 agent harness 选型 spike

## 目标
评估一个可内置、可直接执行的轻量 agent harness，用来替换 RedLark 自研的 LLM 调用（提词、拼读分析、学习计划），
并支撑未来的「学生与 AI 场景自由对话」「辅助练习助手」等多轮交互功能。不是 LangChain 类 agent framework。

## 用户决定（2026-10-06）
- 选型要考虑未来多轮对话 / 练习助手，不只是一次性结构化任务。
- 按计划先做 spike：首选 pi（@earendil-works/pi-coding-agent），RPC 模式作为 Tauri sidecar；备选 Goose（Rust）。

## spike 范围
- A 结构化任务：提词，通过自定义工具 `submit_words` 交付结构化结果，与现有实现对比（准确率、耗时、token、可用提供商）。
- B 多轮对话：场景对话 + 练习助手工具（会话保持、流式文本、工具调用、上下文）。
- 关键约束：禁用全部内置 shell/文件工具；配置目录与用户 ~/.pi 隔离；不发遥测；密钥不落盘、不进日志。
- 产出：可复现脚本（spikes/agent-harness/）、度量数据、打包方式与体积、Rust 侧对接草图、推荐结论。

## 非目标
- 本 spike 不改应用代码、不接 UI；不替换现有实现（结论通过后再规划迁移批次）。
