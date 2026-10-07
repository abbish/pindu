-- 单词例句：创建单词本时由拼读分析一并生成，练习页与单词本详情页展示并可朗读（TTS 缓存）。
-- 只新增可空列，已有单词保持 NULL（界面不显示例句）。
ALTER TABLE words ADD COLUMN example_sentence TEXT;
ALTER TABLE words ADD COLUMN example_translation TEXT;
