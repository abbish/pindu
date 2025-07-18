-- 移除phonetic字段，只保留ipa字段
-- 这个迁移将删除phonetic字段，只使用ipa字段作为音标

-- 创建新的words表结构（不包含phonetic字段）
CREATE TABLE words_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    meaning TEXT NOT NULL,
    description TEXT,
    ipa TEXT,
    syllables TEXT,
    phonics_segments TEXT,
    image_path TEXT,
    audio_path TEXT,
    part_of_speech TEXT,
    category_id INTEGER,
    word_book_id INTEGER,
    pos_abbreviation TEXT,
    pos_english TEXT,
    pos_chinese TEXT,
    phonics_rule TEXT,
    analysis_explanation TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (word_book_id) REFERENCES word_books(id) ON DELETE SET NULL
);

-- 复制数据到新表，如果ipa为空则使用phonetic的值
INSERT INTO words_new (
    id, word, meaning, description, ipa, syllables, phonics_segments,
    image_path, audio_path, part_of_speech, category_id, word_book_id,
    pos_abbreviation, pos_english, pos_chinese, phonics_rule, analysis_explanation,
    created_at, updated_at
)
SELECT 
    id, word, meaning, description, 
    COALESCE(ipa, phonetic) as ipa,  -- 如果ipa为空，使用phonetic的值
    syllables, phonics_segments,
    image_path, audio_path, part_of_speech, category_id, word_book_id,
    pos_abbreviation, pos_english, pos_chinese, phonics_rule, analysis_explanation,
    created_at, updated_at
FROM words;

-- 删除旧表
DROP TABLE words;

-- 重命名新表
ALTER TABLE words_new RENAME TO words;
