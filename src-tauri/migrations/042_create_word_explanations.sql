-- 单词深度讲解（练习页右栏「单词讲解」）：agent 实时生成的 Markdown，每个单词缓存一份，可刷新重新生成。
CREATE TABLE IF NOT EXISTS word_explanations (
    word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    model_name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
