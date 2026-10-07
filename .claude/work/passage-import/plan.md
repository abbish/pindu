# 技术方案：导入自己的材料生成短文（passage-import）

> 状态：方案待用户确认（2026-10-07）。确认前不动代码。

## 目标与边界

- **用户结果**：用户粘贴一段英文，或选一个文件（课文、新闻、故事、字幕等），得到一篇或几篇「短文」，和 AI 写的短文一样能朗读（逐词高亮、聚焦朗读、盲听、听后回忆）、出阅读理解题、做阅读 / 听力练习、加进计划。
- **接受条件**
  1. 原文一字不改：句子就是用户的原文，AI 只做翻译、起标题、估水平、挑重点词；校验保证英文没有被改写。
  2. 粘贴文本和 .txt / .md / .srt / .vtt 文件可以导入（B1–B3）；.docx / .pdf 在 B4。
  3. 长材料按段落自动拆成几篇，用户导入前可以调整拆分和标题。
  4. 导入的短文在短文库里有「我的材料」标记与筛选；出题、朗读、练习、加计划的行为与 AI 短文一致。
  5. 可选：把原文里属于所选单词本的词标为目标词（点词看单词卡片）；AI 挑出的生词可一键加进单词本（B5）。
  6. 隐私说明：导入时提示材料会发送给「设置 → AI 模型」里配置的模型做翻译。
- **非目标（本期不做）**：网址抓取；扫描版 PDF / 图片 OCR；把材料改写到更低难度（单独功能，见「后续」）；非英文材料。
- **当前事实**
  - 短文数据：`passages.sentences` 是 JSON `[{en, zh}]`，`target_words`、`scene`、`level`、`word_count`；来源表 `passage_sources(kind book|plan, ref_id NOT NULL)`（迁移 055）。没有「原文来自哪里」的字段。
  - 下游都只依赖 `sentences` 和 `target_words`：出题提示词 `passage_questions.md` 选词填空「优先挖目标词，其次上下文能判断的实词」，所以没有目标词也能出题；朗读、练习按句子工作；计划只引用 `passage_id`。导入的短文不需要改下游。
  - 已有文件读取先例：`AddWordsDialog.tsx:handleFile`（`<input type=file>` + `file.text()`，限制 .txt/.md、5MB）。没有 dialog / fs 插件。
  - 短文写入路径：`services/passage.rs::generate` → agent 任务 `passage_generate.md` + `submit_passage` → `passage_rules::passage_from_submission` 校验 → repository 保存。
- **关键未知项**（B1 前用小样本验证）：长材料一次翻译多少句合适（每批句数 / 并发，沿用 `agent.batch_size` 的思路）；字幕文件的句子合并质量。

## 信息流与责任

```
材料（粘贴 / 文件）
 └─ 前端读取文本（txt/md/srt/vtt：file.text()；docx/pdf：B4 把字节交给 Rust 解析）
     └─ prepare_passage_import（Rust，确定性，不用 AI）
         清理（字幕时间轴、页眉页码、断行连字符、多余空白）→ 语言检查 → 分段 → 分句 → 按篇幅拆成几篇
         → 返回预览：每篇的标题建议（首行标题 / 文件名）、段落与句子、词数、警告
     └─ 用户在预览里调整：合并 / 拆分篇、改标题、选目标词来源（不用 / 所选单词本）
     └─ import_passages（Rust + agent 任务 passage_translate）
         每篇：AI 逐句翻译 + 起标题（用户没填时）+ 估 CEFR 水平 + 挑 5–12 个重点词
         submit_translation 工具校验：译文条数 = 句子条数、每条非空；英文不回传（原文由 Rust 保存，AI 无法改写）
         目标词：单词本匹配（确定性，带 wordId）∪ AI 重点词（required = false，wordId 为空或命中单词本）
         保存：passages（origin = imported, source_label = 文件名 / 「粘贴的文本」）
     └─ 短文详情页（已有）：朗读、出题、练习、加计划
```

- 分句、清理、拆篇用代码做（可测试、可重复、不花额度）；模型只做翻译和判断。这符合 CLAUDE.md §4.4 的原则。
- 翻译是新的 agent 任务（提示词 + `submit_*` 工具 + Rust 校验），不新增直连调用，也不新增第三个进度管理器：多篇导入的进度复用 `progress_manager` 或按篇调用、前端逐篇显示状态（倾向后者，和「AI 内容规划」逐篇生成一致）。

## 技术路径与关键决定

| 决定 | 选择与依据 | 放弃的替代 | 风险 / 回退 |
| --- | --- | --- | --- |
| 原文是否让 AI 处理 | 只翻译，不改写；英文由 Rust 保存，AI 只回传译文数组 | 让 AI 返回 {en, zh}（可能悄悄改写、合并句子） | 译文对不齐：工具按条数校验退回重交 |
| 分句 | Rust 规则分句（缩写 Mr./Dr./e.g./U.S.、小数、引号、省略号），带单测；段落边界保留 | AI 分句（不稳定、费额度） | 个别句子切错：预览里可以合并 / 拆开 |
| 段落 | `PassageSentence` 增加 `paragraph: bool`（本句开始新段落，serde default false）；JSON 字段，不需迁移 | 新表存段落 | 旧数据默认 false，阅读器照旧 |
| 来源记录 | 迁移 057：`passages.origin TEXT NOT NULL DEFAULT 'generated'`、`passages.source_label TEXT` | 塞进 passage_sources（ref_id NOT NULL，语义不符） | 只加列，ALTER TABLE ADD COLUMN，旧数据自动为 generated |
| 长材料 | 预览阶段按段落拆成每篇约 120–450 词（可调），一次导入最多 20 篇 / 2 万词 | 只截取前 N 词 | 用户可合并 / 拆分；超限给出提示 |
| 文件格式 | B1：粘贴 + txt/md/srt/vtt（前端读取）；B4：docx（Rust `zip` + 读 `word/document.xml`）、pdf（`pdf-extract` 类 crate，只支持有文字层的 PDF） | 前端 JS 解析库（体积大，CLAUDE.md 不引入额外前端库） | PDF 版式复杂时段落可能乱：预览可编辑 |
| 水平 | AI 在翻译时给 CEFR（a1–b2），Rust 夹到允许值 | 纯规则估计 | 不准时详情页可改（B3 顺带加「改水平」） |
| 目标词 | 默认：原文里属于所选单词本的词（确定性匹配，带 wordId）；可选：AI 重点词 | 强制 AI 选 | 都不选也能用（出题会自己挑实词） |

## 实施批次

> 后端与短文页面目前归 redlark-5d，新建 / 导入页面的分工待用户确认（见回复）。下面按「谁做都成立」的 owner 写。

### 批次 B1：确定性的材料预处理（后端，无 AI）
- Owner / live 位置：新增 `src-tauri/src/services/passage_import.rs`（纯函数：清理、语言检查、分段分句、拆篇）；`services/passage_rules.rs` 只复用 `words_of` / `english_word_count`。当前事实：没有分句代码，`passage_from_submission` 信任 AI 给的句子。直接 consumer：B2 的导入命令、B3 的预览页。
- 变化：新增命令 `prepare_passage_import(request: PrepareImportRequest{ text, fileName?, targetWords: 120–450 }) -> ImportPreview{ items: [{title, sentences:[{en, paragraph}], wordCount}], warnings: [...] }`；字幕 .srt/.vtt 由文件名后缀决定是否去时间轴并合并断句。
- 作用机制：把杂乱输入变成稳定的句子数组，后面的翻译与保存都以它为准。
- 联动：handler `handlers/passage.rs` + `lib.rs` 注册；`types/passage.rs` + `src/types/passage.ts`；`passageService.prepareImport`；不写库。
- 完成定义与验证：`cargo test passage_import`（缩写、引号、小数、省略号、中英混排、字幕、空输入、超长输入、非英文拒绝）；`check-ipc-contract.py`、`check-type-sync.py`。停止条件：分句单测覆盖不了的常见文本 → 先在预览里给「合并 / 拆开」兜底再继续。

### 批次 B2：翻译任务与保存（后端 + 提示词 + 迁移 057）
- Owner：`agent/tasks.rs` 新任务、`prompts/agent/passage_translate.md`、`agent/src/tools/passage.ts` 的 `submit_translation`、`services/passage.rs::import_one`、`repositories/passage_repository.rs` 写入 origin / source_label。当前事实：只有 generate 路径写 passages。
- 变化：迁移 `057_passage_origin.sql`（两列 ADD COLUMN）；`PassageSentence.paragraph`；命令 `import_passage(request: ImportPassageRequest{ title?, sentences, sourceLabel, bookIds, aiKeyWords: bool }) -> Passage`（一次一篇，前端逐篇调用，可取消）；`PassageSummary` / `Passage` 增加 `origin`、`sourceLabel`；`get_passages` 增加按 origin 筛选。
- 作用机制：英文只来自请求里的 sentences，工具只收 zh 数组，Rust 逐条对齐保存 → 原文不可能被改写。
- 联动：任务模型设置 `agent.model.<task>`（新增 `translate` 或复用 `passage`，按 `AgentSettingsService::model_for` 现有键）；DECISIONS 追加 D30；CLAUDE.md §4.2/§4.3/§4.4 表格同步。失败路径：模型未配置 / 超时 → `toUserMessage` 已有说法；译文条数不符 → 工具退回重交，最终失败返回「翻译没有完成」。
- 完成定义与验证：`cargo test`（保存、origin 默认值、旧数据读取、paragraph 默认 false）、`check-sql.py`、真实库副本迁移；`node agent/eval` 加一组翻译样本人工抽查；`cargo test agent::tasks::tests::real_ -- --ignored` 真实调用一次。

### 批次 B3：导入页面（前端）
- 交互模式：分步向导（与「新建短文」一致的 Stepper）：① 材料（粘贴框 + 选择文件 / 拖放，显示词数与警告）② 预览与拆分（每篇一张卡：标题可改、句子列表、合并到上一篇 / 从这里拆开；目标词来源：不用 / 选单词本；AI 重点词开关）③ 导入（逐篇状态：等待 / 翻译中 / 完成 / 失败可重试，整体可取消；完成后「打开短文」或「回短文库」）。
- 入口：短文库「新建短文」改为下拉 / 两个按钮：「AI 写短文」「导入我的材料」；路由新增 `import-passage`（navigation.ts + App.tsx + PAGE_TITLE「导入材料」）。
- 联动：短文库卡片与详情页显示「我的材料 · 文件名」；短文库加「我的材料」筛选；阅读器在 `paragraph` 处加段落间距；隐私提示一句。
- 验证：tsc / eslint / 预览截图（浅色、深色）+ tauri:dev 走查：粘贴、txt、srt、长材料拆 3 篇、单篇翻译失败重试、取消。

### 批次 B4：Word / PDF 文件
- Owner：`services/passage_import.rs` 增加 `extract_text(bytes, ext)`；命令 `read_import_file(fileName, bytesBase64)` 或前端把 `File.arrayBuffer()` 转 base64 传入；Cargo 增加 `zip`（docx）与 PDF 文字提取 crate（按体积与维护度二选一，实施前确认）。
- 验证：样本 docx（含标题、列表、表格）、文字版 PDF、扫描版 PDF（应提示「这个 PDF 没有可读取的文字」）。

### 批次 B5：生词进单词本（可选）
- 导入完成后在短文详情显示「材料里的生词」（AI 重点词里不在任何单词本的词），可勾选「加入单词本」→ 复用 `analyze_extracted_words` 管线补全拼读与例句。
- 验证：加词后短文目标词带上 wordId，点词能看到完整单词卡片。

## 验证策略

| 接受条件 / 风险 | 最小证据 | 升级条件 |
| --- | --- | --- |
| 原文不被改写 | Rust 单测：保存后的 en 与请求逐字相同；工具不接受 en 字段 | 出现不一致 → 阻断发布 |
| 分句质量 | 单测样本 + 3 份真实材料人工核对 | 错误率明显 → 预览编辑先行 |
| 翻译质量与对齐 | eval 样本人工抽查；条数校验 | 长句漏译 → 调小每批句数 |
| 迁移兼容 | 空库 + 真实库副本各启动一次，旧短文 origin = generated | 失败 → 回退迁移文件（未发布前） |
| 下游不变 | 导入短文走一遍出题、朗读、阅读 / 听力练习、加进计划 | 任何下游报错 → 修下游假设 |

## 后续（不在本期）

- 改写到指定水平（保留原意、简化词汇句式），作为导入时的可选项，生成的是一篇新短文并记录「改写自」。
- 网址导入（抓正文）；图片 / 扫描件 OCR。
