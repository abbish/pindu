-- 单词讲解的提示词版本：讲解规范升级后，旧版本的缓存视为过期，打开时自动按新规范重新生成。
ALTER TABLE word_explanations ADD COLUMN prompt_version INTEGER NOT NULL DEFAULT 1;
