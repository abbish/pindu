-- 单词例句改为一对多：每个单词多条例句（拼读分析时生成 5 条以上），练习页右栏列出并可逐条朗读。
-- 040 的 words.example_sentence / example_translation 自此不再读写，已有数据迁入本表（sort_order = 0）。
CREATE TABLE IF NOT EXISTS word_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    sentence TEXT NOT NULL,
    translation TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_word_examples_word_id ON word_examples (word_id, sort_order);

INSERT INTO word_examples (word_id, sentence, translation, sort_order)
SELECT id, trim(example_sentence), trim(COALESCE(example_translation, '')), 0
FROM words
WHERE example_sentence IS NOT NULL AND trim(example_sentence) != '';
