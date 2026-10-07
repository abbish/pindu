# evidence

## H1 + H2（2026-10-06）
- `bash scripts/verify.sh`：13/13 PASS（新增 agent tsc、agent node --test 7 个）。Rust 测试 88 个（新增：protocol 3、session 4〔内存管道回放录制输出：正常结束 / 中途退出 / 超时 / 命令被拒〕、config 5、tasks 4、seed 迁移等）。
- 录制 fixture `src-tauri/src/agent/fixtures/extract_words_run.jsonl`：真实 K3 运行 180 行，已确认不含密钥。
- sidecar 编译：`node agent/scripts/build.mjs` → `src-tauri/binaries/redlark-agent-aarch64-apple-darwin`（70MB）；`cargo build` 时 tauri-build 复制为 `target/debug/redlark-agent`（打包后与主程序同目录，Rust 按此定位）。
- models.json 机制实测（--list-models）：内置 provider 追加模型 ✅、modelOverrides 覆盖 maxTokens ✅、自定义 provider `$ENV` 取 Key ✅、内置 provider 在 models.json 中以 `$REDLARK_KEY_<id>` 注入 Key ✅（不再依赖 MOONSHOT_API_KEY）。
- 真实端到端（Rust → sidecar → K3）：`REDLARK_E2E_MOONSHOT_KEY=… cargo test agent::tasks::tests::real_extraction -- --ignored`：27.2s，17 词，kite=2，focus 模式无 the/is，全部带释义，运行目录已清理。
- 隔离测试库重启后迁移到 038：四个种子提供商 pi_provider 回填正确（openrouter / moonshotai-cn / deepseek / minimax-cn），未配置的火山方舟已按 036 移除，默认模型 K3 不变。
- 实机 UI 走查：打开单词本页后，屏幕上出现**第三方菜单栏应用的菜单**（Option Setting / Routing Setting / Clear all service statistics …）覆盖窗口，点击本应用无法关闭；为避免误点他人应用的菜单项，停止 UI 自动化。提词 UI 走查待用户关闭该菜单后补做。

## H2 补充 + H1b（2026-10-07）
- 实机 UI 提词（创建单词本 → 提取单词，K3，重点模式）：26.3s，19 词，带释义 / 词性 / 频率；运行目录事后为空。发现专有名词被小写（tom）→ 修复后真实调用得到 Tom / Sunday / Lily，其余小写；测试覆盖模型把普通名词误写成 Cat 的情况。
- sidecar `--redlark-catalog`：41 个提供商、1537 个模型、378KB（修复了直接 exit 截断管道输出的问题）；K3 思考档 low/high/max。
- 设置页实机：提供商卡片显示 `pi：moonshotai-cn` 等映射；目录加载 `get_agent_catalog_providers` 返回 41；Moonshot「同步模型」列出 4 个目录模型（思考档 / 上下文 / 价格，K3 标记已添加，远端 /models 4 个已合并）；K3 编辑弹窗显示目录能力、回填 32000 / 1；填写额外参数 `{"top_p":0.95}` 保存后数据库 extra_params 写入、其余参数不变。
- 额外参数到达模型的证明：同配置下 top_p=0.95 正常完成（36s），top_p=0.1 被 K3 拒绝 `invalid top_p: only 0.95 is allowed for this model`，错误原样返回。
- 测试：Rust 91 个（新增 catalog 解析、目录 / 远端合并、生成参数整体替换与校验、提供商映射设置 / 清除）；前端 21 个（modelGeneration 4 个）；agent 8 个；verify 13/13。

## H3 拼读分析（2026-10-07）
- agent 测试 11 个（新增 submit_phonics 校验 3 个）；Rust 93 个（新增提交结果限定请求词 / 缺失词、任务只开放 submit_phonics）；verify 13/13。
- 真实调用（ignored 测试，K3 low）：elephant / kite / Sunday / night / table 5/5，音节全部拼回原词，规则合理（kite 魔法e、table 辅音+le、night 元音组合），41.9s、约 $0.009，校验退回 0 次。
- 实机全流程（创建单词本 → 提取单词 → 批量分析）：提词 7 词 16.2s；批量分析分 2 批并发（5 词 23.6s、2 词 10.2s），总计 23.64s，7/7 完成，界面显示音节 / 音标 / 规则 / 中文讲解；日志无回退。
- 未覆盖：校验退回→重交的真实路径（本次模型一次通过；逻辑由 agent 单测与协议层错误工具结果处理覆盖）。

## H4 全部迁移 + 提示词优化（2026-10-07）
- 需求调研（只读子代理）：规划输出的消费方（预览 / 详情读 ai_plan_data；日程表、日历、练习、统计读数据库行）、旧规划无校验的失败模式、phonics_segments 从未写入、确认步骤勾选 bug、草稿重新规划丢数据。
- 学习计划（K3 low，真实调用 ignored 测试）：20 词 18.0s / $0.0076，模型给出 20/20；顺序 cat/dog/sun/red → cake/make/lake → ship/fish/shop → rain/train → night/light/right → Tom → elephant/giraffe/beautiful → environment；7 天标准强度：第 1–6 天学新词、第 7 天只复习，复习按 +1/+2/+4/+7。
- 日程算法单测 5 个（每词恰好新学一次、日期在周期内、同日不重复、间隔正确、元数据）；生成器校验 / 取消单测 2 个；协议取消单测 1 个。
- 拼读提示词评测（15 词金标准，K3 low）：
  | 指标 | 优化前 | 优化后 |
  |---|---|---|
  | 音节 / 规则 / 返回 | 1.0 / 1.0 / 1.0 | 1.0 / 1.0 / 1.0 |
  | 讲解含术语 | 0.533 | 0 |
  | 讲解举同模式例词 | 0.133 | 0.933 |
  | 释义堆叠多义 | 0.267 | 0 |
  | 美式音标 | 0.133 | 0（统一英式，与国内教材一致） |
  | 讲解平均长度 | 44.5 字 | 38.3 字 |
  | 耗时 / 费用 | 54.4s / $0.028 | 44.9s / $0.028 |
- 提词提示词评测（3 段文本）：召回 1.0 → 0.995（只漏功能词 that）；释义按语境（adult → 成年的）、专有名词保留大写。
- 实机（隔离 HOME）：迁移 039 回填 12 个词的拼读块；创建计划表单走到 AI 规划步骤后，检测到用户正在使用电脑（前台为微信），停止 UI 自动化——AI 规划→保存的界面走查留待用户。
- verify 13/13；Rust 95 个测试（3 个真实调用 ignored）；agent 13 个；前端 21 个；validate-skills 通过。

## H4b 单词例句 + TTS 风格（2026-10-07，D14）
- TTS 缓存核查：测试库 tts_cache 5 条均命中（Cat use_count=5），同文本不重复合成；豆包 2.0 同一文本连续合成 3 次结果不同（cat 时长 1.224/1.224/1.248s，加指令 1.248/1.632/1.056s）→ 差异来自首次合成的随机性，非缓存失效。
- A/B 试听样本：scratchpad/tts-ab/（A-plain-* 无指令 / B-instr-* 老师示范指令，5 词 + 1 例句），待用户试听。
- 拼读评测（15 词，K3 low，含例句）：音节 / 规则 / 返回 1.0；hasExample 1.0、例句平均 6.4 词、模板句 0；术语 0.067（tiger 讲解出现“开音节”）；49.0s / $0.031（前次 44.9s / $0.028）。
- 单测：agent 15（例句校验 2 个新增）；前端 24（exampleSentence 3 个）；Rust 新增 examples 成对保存 / 再导入保留、TTS 指令请求体与风格解析。
- verify 13/13（logs/verify-20261007-101139.log）；测试库已应用迁移 040。

## H4c 批量分析进度弹窗（2026-10-07）
- 后端缺陷（progress_manager / analyze_words_parallel）：单词状态存 HashMap → 每次轮询顺序随机；批次开始时写入伪造的完成数（批次号 × 批大小），并发下虚高、批次结束后回退，失败数被清零；成功批次中模型漏掉的词未计入失败；有失败时状态永远不会变为 completed；用时只在批次结束时更新；未开始批次的单词不在列表中。
- 修复：完成 / 失败数与用时在读取时由逐词状态与开始时间推导；登记顺序固定，全部单词先登记为等待中；单测 2 个。
- 前端：WordAnalysisProgressModal 重写——进度百分比 = 已分析 / 总数（原为 10% 偏移导致 45/99 显示 50.9%）；一行四格统计替代三处重复数字；单词状态改为限高滚动的标签网格（原表格嵌在带内边距的滚动容器中，sticky 表头上方露出滚动内容）；失败原因单独列出；颜色全部改为主题变量（支持深色模式）、图标改 FontAwesome；删除未使用的 calculateOverallProgress / formatProgressText。
- verify 13/13（logs/verify-20261007-102308.log）；测试 App 已重启。

## H4d 练习页自动朗读（2026-10-07）
- 现象：进入练习后三步都没有自动朗读。日志：每个词进入时单词语音都成功生成（如 far 10:31:39），播放环节没有声音、也没有提示。
- 已确认缺陷：ToastProvider 每次渲染新建 context 对象 → useAudioPlayer 的 playText / playWord 引用随 toast 显示 / 消失而变化 → 自动朗读 effect 被重启、正在播放的音频被中止；play() 被拒绝（如 NotAllowedError）时只设 error 状态、没有任何提示。
- 修复：toast context useMemo；useAudioPlayer 经 ref 取 toast；全应用共享一个 <audio> 元素，首次点击 / 按键用静音解锁（兼容 WebView 自动播放限制），被阻止时 toast 说明原因；自动朗读 effect 只由单词 / 步骤 / 暂停 / 结果驱动（播放函数经 ref 读取）；节奏改为“单词一遍 → 停 1 秒 → 例句一遍”。
- 验证：tsc / eslint 棘轮 / 前端测试 25 通过（新增按序号播放单词→例句用例）；实机听感待用户确认（根因是否为自动播放限制：若出现“系统阻止了自动播放”提示即可确认）。

## H4e 练习页两栏 + 每词 5–8 条例句（2026-10-07，D15）
- 迁移 041 word_examples（测试库 99 条单例句已迁入）；Rust 测试 99+（新增迁移回填、例句保序 / 去重 / 保留 / 级联删除、提交解析）；agent 测试 15；verify 13/13（logs/verify-20261007-110900.log）。
- 评测（15 词，K3 low）：returned / syllables / rules 1.0；examples≥5 比例 1.0，平均 5.7 条、5.4 词 / 句，句首重复 0.1；142s / $0.085（D14 时 49s / $0.031），校验退回 2 次。样例 cake：I like cake. / We eat cake on my birthday. / Can I have some cake, please? …；发现个别语法瑕疵（rain → "It is rain outside."）。
- 注意：eval 默认用 target/debug/redlark-agent（cargo build 时才更新），改工具后需 REDLARK_AGENT_BIN 指向 src-tauri/binaries/ 下新编译的 sidecar。
- 实机布局走查待用户确认。

## H4f 练习作答反馈与全局提示（2026-10-07）
- 作答反馈改为左栏浮层（PracticeFeedback，不占布局、role=status）；输入框只变色 / 答错抖动，确认按钮常驻（禁用）避免高度跳动。
- 节奏：答对 0.7s、答错 1.8s（显示正确拼写）后自动进入下一步；Enter 立即继续；结果提交改为后台进行（原先等待 = 接口耗时 + 1.5/2s）。修复：反馈期间暂停 → 恢复后卡住（定时器已取消且无法继续）。
- 练习页去掉与界面重复的提示（开始练习 / 已暂停 / 已恢复）；恢复会话改为 info。
- 全局 Toast：FontAwesome 图标按类型着色、默认时长按类型（成功 2.5s / 提示 3s / 警告 4.5s / 错误 5s）、位置下移到导航栏下方、错误 role=alert。
- 验证：tsc / eslint 棘轮 / 前端测试 25 / check-css-vars / type-sync 通过；实机效果待用户确认。

## H4g 单词讲解（2026-10-07，D16）
- 真实调用 `real_explain_word_with_kimi_k3`：21.0s / 978 字 / 518 段流式增量，八节结构齐全，内容与给定拼读资料一致（魔法 e、make/name/lake、cap 易混、“e 是蛋糕上的蜡烛”记忆法、考考你带答案）。
- 单测：讲解请求包含单词资料与例句、空字段省略、去除整段代码块包裹；缓存覆盖与级联删除（迁移 042）。
- verify 13/13；测试库已应用迁移 042；Vite 已优化 react-markdown / remark-gfm。
- 实机界面待用户确认。

## H4h 讲解专业性 + 例句 AI 补充（2026-10-07，D17）
- 讲解评测（8 词：all/said/cake/night/teacher/unhappy/elephant/because）：v1 基线 low 1067 字 / 17.1s / $0.072（字母赋义、tea+cher、谐音、said 读音说法不准）；v2 正规方法 low 1258 字（仍有 eight∈-ight、cook“同音”、August au=/ɒ/ 错误）；v3 + 自查清单 + medium 1282 字 / 24.8s / $0.101，人工审阅无事实错误，方法均为词族 / 心形词 / 构词 / 音节分块 / 看-说-盖-写-查 / 边拼边说 / 画面 + 句子。结果文件 agent/eval/results/explain-*.json。
- 例句补充试跑（agent/eval/eval-examples.mjs）：all 8.6s、rain 8.2s，各 7 条，退回 0 次，约 $0.004 / 词。
- 单测：submit_examples（agent 2 个）、合并 / 方式解析 / 提交去重（Rust 2 个）、讲解缓存版本失效；verify 13/13；测试库已应用迁移 043。

## H4i 练习三步布局一致性（2026-10-07）
- 发现：第二步显示「音节」（单音节词即为答案）、三步都显示「拼读」块（如 D / og），答案一直可见。
- 改为 utils/practiceReveal.ts 统一规则：每项 show / hint（字母变格子，只给结构）/ hidden（锁定占位“答完显示”）；第一步全显示；第二步英文 → 字母格、音标保留、音节与拼读块 → 格子；第三步只留发音与中文；作答后全部揭晓。三步同一布局（信息行固定高度、单词区固定高度）。顶部加三步步骤条（已完成打勾）。步骤文案与输入框提示按步骤更新。
- 单测 3 个（含“第二、三步不以任何形式显示字母”）；前端测试 28、eslint 棘轮、tsc、css-vars 通过；实机待用户确认。
