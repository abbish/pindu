-- 单词讲解缓存记录生成时的提示词指纹（学习者档案 / 讲解风格 / 讲解模板渲染后的 SHA-256 前 16 位）。
-- 档案变化后旧讲解视为过期；本列为 NULL 的旧记录按默认档案（小学生）生成，仅在当前档案仍为默认时继续使用。
ALTER TABLE word_explanations ADD COLUMN prompt_fingerprint TEXT;
