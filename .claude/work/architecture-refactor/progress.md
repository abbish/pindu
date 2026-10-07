# 进度

- 当前状态：active —— 第 2 轮代码批次全部完成，等待用户 tauri:dev 走查与几项决策（2026-10-06）
- 当前批次：无进行中批次；B4–B8、B6 与第 3、4 轮清理已完成（见 evidence.md）

## 已完成
- harness：playbook（行为锁定/无编译器纪律/检查点）、事务与 repository 约定、Rust 测试标准、错误 contract、前端规范、验证矩阵
- 工具：scripts/verify.sh、check-sql.py、check-ipc-contract.py、schema-snapshot.py、lint-ratchet.mjs、test-resolve-hook.mjs；eslint.config.js；npm scripts（verify / lint / lint:ratchet / test）
- B0 测试基建：src-tauri/src/test_support.rs；删除失效的 tests/*.rs 与 test_statistics.rs
- B1 错误 contract：error.rs 手写 Serialize {code,message} + 4 个单测；src/api/errors.ts（+5 个 node 测试，已通过）；client.ts 精简；ApiResult 增加 code
- B2 SQL 故障：暂停/恢复列名、今日日程 progress_percentage（+回归测试）、状态历史 changed_at、lib.rs 重复注册
- B3 练习完成：事务内 完成会话 → study_sessions → refresh_completion；幂等；pause_count；7 个 service 测试；完成数 SQL 已在真实 schema 上验证
- B4 前端：get_words_by_book 参数改 camelCase；删除 5 个调用不存在命令的方法、statisticsService、CreatePlanPage、api/endpoints.ts、@tauri-apps/plugin-sql；WordBookService 单例；src/navigation.ts 类型化路由（修复 'practice'→'word-practice'、'report'→'plan-detail'、plan-detail 缺参不再打开 id=1）；useAudioPlayer async executor；console 清理（183→3）；aiModelService 单例；SettingsPage 按 tab 拆分（2405→124 行，pages/settings/）；设置页写入判 success；AIProvider 类型对齐 AIProviderSafe（详见 evidence.md）

## 本地已验证（agent 环境）
- check-sql：165 条 SQL 0 失败；check-ipc-contract：0 错误；tsc 通过；node --test 5/5 通过

## 本机已验证（2026-10-06，macOS，logs/verify-20261006-181512.log）
- `npm run verify` 9/9 PASS：check-sql、check-ipc、tsc、eslint 棘轮、node --test、cargo fmt/check/clippy/test（16 个 Rust 测试）
- 修复：wordbook_repository 旧测试（CreateWordBookRequest.description 为 String；改用 test_support；“空列表”断言与 001 种子数据冲突，改为“新建后出现在 find_all”）
- 全 crate 执行了一次 `cargo fmt`（36 文件纯格式化，含本工作未触及的文件）
- 基线：eslint no-explicit-any 95 / no-console 183（.eslint-baseline.json）；clippy 83 条警告、cargo check 32 条（只减不增）

## 第 5 轮（真实应用自主回归，见 evidence.md）
- agent 用隔离 HOME 启动 debug 应用并实际操作走查；发现 10 个问题已修复并复测；verify 11/11（新增 check-css-vars），57 个 Rust 测试

## 未验证
- 真实 AI Provider 链路（提词 / 批量拼读分析 / 生成计划）与 TTS 发音：隔离环境无真实密钥，需用户在自己的数据上跑一次

## 第 2 轮已完成
- B5a–B5g：见 evidence.md；verify 9/9（logs/verify-20261006-184904.log），44 个 Rust 测试
- 修复的安全问题：`get_all_ai_models` 返回 AI Key 明文；`get_elevenlabs_config` 返回 ElevenLabs Key 明文；`update_elevenlabs_config` 与 `ai_service` 日志写入密钥
- 修复的缺陷：clear_tts_cache 假实现；单词本 create 可能返回错误 ID；delete_ai_provider 非事务；编辑计划接受任意 status；AIModelQuery 契约
- 重要发现：外键实际开启，历史重建 study_plans 的迁移会级联清空子表（已实测、已更正规范与 CLAUDE.md；需告知用户）

- B7 PlanDetailPage 拆分 + B8 字段 contract 对账（新脚本 check-type-sync.py；修复日历月统计/今日日程/计划统计/日历计划名的“恒为 0/undefined”）：见 evidence.md；verify 10/10（logs/verify-20261006-185813.log）

- B6 AI 模块拆分（parsers 有 fixture 测试；修复 CSV 围栏导致表头被当单词）：verify 10/10（logs/verify-20261006-190313.log），53 个 Rust 测试

## 下一步
1. 用户用真实密钥跑一次 AI 提词 / 批量分析 / 生成计划 + TTS 试听
2. 待用户决策：
   - 是否提交（当前全部为未提交改动；建议按批次分多个 commit）
   - 完成页“详细报告”改为跳转计划详情页
   - 两个进度管理器是否合并（连同轮询改事件推送方案）
   - 删除未接线的 StartStudyPlanPage / FinishStudyPlanPage
3. 可选后续：evidence.md 第 5 轮“仅记录未修”列表；CreatePlanPageV2 / PlanDetailPage / WordPracticePage / WordBookDetailPage 仍 > 600 行
