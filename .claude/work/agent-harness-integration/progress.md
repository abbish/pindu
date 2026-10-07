# progress

状态：全部 LLM 功能已迁移到 agent（2026-10-07）；提示词按场景优化完成；待用户实机走查学习计划创建
已完成：
- H1 sidecar 基建、H1b 设置页（pi 模型体系）、H2 提词、H3 批量拼读（见下方历史条目与 evidence）
- H4 全部迁移（D12 / D13）：
  - 学习计划：模型只给学习顺序 + 难度 / 优先级（submit_learning_order），日程由 services/study_planning.rs 确定性计算；规划进度沿用原轮询契约，取消经 sidecar abort
  - 测试模型改走 agent；删除无界面入口的单词级拼读 / analyze_text_with_batching / WordImporter；删除 ai_service（async-openai、csv 依赖）与回退开关
  - 进度：planning_progress.rs（PlanningProgressState）与 EnhancedProgressManager 各司其职
- 提示词优化（agent/eval 前后对比）：phonics_batch.md 面向小学生重写讲解规范；extract_words.md 释义按语境；新增 study_plan_order.md
- 修复：练习页拼读块缺失（建单词本时由音节生成 phonics_segments + 迁移 039 回填）；提词确认步骤取消勾选无效；草稿重新规划解析失败会丢日程（先解析后写入）且不更新总词数 / 结束日期；规划周期选项重复；取消规划后前端可能进入下一步
- 文档：CLAUDE.md §1/§3/§4.4/§6/§8/§9、DESIGN.md、DECISIONS D12–D13（D08 回退部分标注已被取代）、deliver-ai-prompt Skill 重写并同步 catalog / README / 相关 Skill
- H4b（D14）：单词例句随拼读分析生成（迁移 040、练习页三步展示 + 朗读、单词本详情页展示 + 朗读）；TTS 增加 word / sentence 风格指令并进入缓存键
最近证据：evidence.md「H4」「H4b」节；verify 13/13（logs/verify-20261007-*.log）
下一步：
0. 用户试听 scratchpad/tts-ab A/B 样本，决定是否保留语音指令；新建单词本走查例句与例句朗读
1. 用户实机走查：创建学习计划（AI 规划 → 预览 → 保存）、编辑草稿重新规划、练习页第三步拼读块
2. H5 场景对话 MVP（持久会话、流式事件推送前端、record_mistake 落库）
3. 可选：进度轮询改事件推送（plans/batch-analysis-event-driven-design.md）
阻塞：无；DeepSeek / MiniMax / OpenRouter 仍无测试 Key
