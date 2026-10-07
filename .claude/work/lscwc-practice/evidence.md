# evidence

## 批次 1（2026-10-07）
- 单测：practiceQueue 4 个（交错顺序与小测、恢复跳过已做步骤、重考位置不晚于下一步与次数上限、单词组）；spellingCheck 3 个（大小写、替换 / 漏写 / 多写、错误对应拼读块：nite→igh、elefant→ph、sed→ai）；practiceReveal 3 个（含“盖-写时任何等级都不显示字母”）。前端测试共 35。
- 后端兼容：submit_step_result 追加记录，find_word_states_by_session 每步只取第一次作答 → 重考与小测不改变成绩；current_step 推导不受影响。
- verify 13/13（tsc、eslint 棘轮、css-vars、Rust 全部）；Vite 正常编译相关模块。
- 未验证：实机交互（需用户走查）。

## 批次 1 补充：结果页检查点（2026-10-07）
- 迁移 044：word_practice_records.kind（learn / retry / review，默认 learn）；submit_step_result 接受可选 kind 并校验。
- 每词状态新增 retryCounts / fixedSteps / reviewCorrect；成绩（stepResults）只看首次 learn 作答；日程完成数 SQL 显式限定 kind = learn。
- 结果页：每词 4 个检查点（刚学写 / 隔词写 / 听写 / 小测），状态一次就对 / 查后改对 / 没写对 / 没做；「完全掌握」= 三步首答全对且小测未写错（日程完成数不受小测影响）。
- 测试：Rust 新增 2 个（重考与小测不改变首答成绩、kind 校验；小测写错进入需要复习但日程仍计完成）；前端 practiceCheckpoints 2 个；verify 13/13；测试库已应用迁移 044。

## 修复：中文输入法选词回车误提交（2026-10-07）
- 原因：WebKit 确认选词时先触发 compositionend、再触发 keydown(Enter)，此时 isComposing 已为 false。
- 修复：utils/imeEnter.ts（isComposing / keyCode 229 / 组字中 / compositionend 后 80ms 内的回车都忽略；非英文字符检测）+ hooks/useImeGuard.ts；练习卡片、WordCard、SpellingPractice 三处拼写输入统一使用。练习卡片混入中文时不提交，浮出“请切换到英文输入法”。
- 单测 3 个（imeEnter）；前端测试 40、tsc、eslint 棘轮通过；实机待用户验证。

## AI 讲解锁定 + 查后停留 + AI 老师答疑（2026-10-07，D19）
- 盖·写时 AI 讲解页签锁定（无绕过）；查时页签提示“去看看”；改对后停留到 Enter /「下一题」。
- ask_word_tutor：Rust 单测 2 个（问题长度 / 角色校验；上下文含单词资料、讲解、最近 12 条对话）；真实试跑 3 问（eval-tutor.mjs）回答准确、简短、跑题被拉回。
- verify 13/13；测试 App 已重启；实机待用户确认。

## 修复：一次答对的短暂停留误触发讲解生成（2026-10-07）
- 现象：讲解页签停留时，一次答对的 0.7s 停留让页签短暂可用 → 无缓存时立即生成（约 25s / ¥0.1），随即进入下一题被锁。
- 修复：打开页签只读缓存；没有缓存时仅在“看·说 / 查 / 改对后停留”环节、且页签停留 ≥1.2s 才自动生成；一次答对的停留只显示「让 AI 老师讲一讲」按钮。
- tsc / eslint 棘轮 / 前端测试 40 通过；实机待用户确认。
- 进入盖·写时右栏自动切回「例句」页签（2026-10-07）
