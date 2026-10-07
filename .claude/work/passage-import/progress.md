# progress：passage-import

- 2026-10-07 用户确认：B1–B5 一起做；不做 OCR（扫描版 PDF 只提示读不出文字）。
- 分工：redlark-5d 做后端 B1 / B2 / B4 / B5（预处理、翻译任务、迁移 057、docx/pdf、生词进单词本）；本会话做 B3 界面与 B5 界面。
- 契约（redlark-5d 确认版）：prepare_passage_import(request) / import_passage(request{requestId,…}) / cancel_passage_import(requestId) / get_passage_new_words(passageId) / add_passage_words_to_book(request)；Passage/PassageSummary.origin、sourceLabel；PassageSentence.paragraph；PassageTargetWord.meaning；get_passages 可选 origin。TS 类型与 passageService 方法由本会话写在 src/types/passage.ts 末尾「导入材料」。
- 前端已完成（tsc / eslint / npm test 97 通过；模拟数据截图）：ImportPassagePage + 路由 import-passage；utils/passageImport.ts（合并 / 拆篇 / base64，测试）；短文库入口与来源筛选、卡片徽标；详情页导入标记、目标词分组、NewWordsCard；PassageReader 段落间距。
- 待办：后端命令注册后联调；B5 加词后的拼读 / 例句补全调用（redlark-5d 确认后接）；CLAUDE.md §4.2/§5.1 同步（路由 import-passage、新命令）；tauri:dev 走查。
- 2026-10-07 用户追加：单词本「从文本提取」也支持同样的资料，并统一交互。做法：共用组件 `components/MaterialInput`（粘贴 / 选择或拖入文件 → read_material_file 读成清理过的文本填进同一个可编辑文本框）；`services/materialService.ts`。短文导入改为 read → prepare({text, fileName})。入口统一：单词本「添加单词 ▾」= AI 生成 / 从我的材料提取 / 手动；短文库「新建短文 ▾」= AI 写短文 / 从我的材料导入；空状态同样两个按钮。
- redlark-5d 后端已注册全部命令；add_passage_words_to_book 一步完成拼读分析，前端不再接 analyze。check-ipc-contract / check-type-sync errors=0；tsc、lint 棘轮 0/0、npm test 97 通过。待 tauri:dev 端到端走查。
- 2026-10-07 用户追加：生词可直接新建单词本（典型用法：导入 PDF → 拆成多篇 → 用真实材料整理单词本）。共用 `components/BookTargetPicker`（现有单词本 / 新建单词本…+ 名称，默认「材料名 生词」，场景写「从材料「…」里整理的生词」）；短文详情 NewWordsCard 支持新建；导入完成页新增 `pages/passage-import/CollectWordsCard`：汇总这批短文的生词（去重）→ 新建 / 加入单词本，逐篇调用 add_passage_words_to_book（后出现的同名词由后端直接关联）。
