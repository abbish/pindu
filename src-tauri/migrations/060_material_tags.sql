-- 素材之间的关联（test-feedback-20261009，DECISIONS D37）
-- tags：单词本 / 短文（含视频切片）/ 原始视频共用的标签；原单词本「主题」theme_tags 迁入（同名合并，保留 id 与图标，color 不再使用）。
-- material_tags：素材 ↔ 标签。kind = word_book / passage / video，ref_id 指向对应表的 id（没有外键，删除素材时由触发器清理）。
-- passage_words：短文的词索引（单词 ↔ 素材）。正文里每个小写词形一行（sentence = 第一次出现的句子下标），
--   目标词另标 key（正文里没出现的 sentence = -1）。写短文时同一事务里维护；旧短文在第一次查询时由程序补齐。
-- videos.subtitle_offset_ms：字幕时间纠偏（毫秒，正数 = 字幕延后），不改 cues 里的原始时间。
-- 视频切片的来源（「视频」）由 video_clips 推导，不改 passages.origin（它有 CHECK 约束）。

CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    icon TEXT,
    created_at TEXT NOT NULL
);

INSERT INTO tags (id, name, icon, created_at)
SELECT id, TRIM(name), NULLIF(TRIM(icon), ''), COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM theme_tags
WHERE id IN (SELECT MIN(id) FROM theme_tags GROUP BY LOWER(TRIM(name)));

CREATE TABLE material_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('word_book', 'passage', 'video')),
    ref_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE (kind, ref_id, tag_id)
);

CREATE INDEX idx_material_tags_tag ON material_tags(tag_id, kind);
CREATE INDEX idx_material_tags_ref ON material_tags(kind, ref_id);

INSERT OR IGNORE INTO material_tags (kind, ref_id, tag_id, created_at)
SELECT 'word_book', wbtt.word_book_id, t.id, COALESCE(wbtt.created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM word_book_theme_tags wbtt
JOIN theme_tags tt ON tt.id = wbtt.theme_tag_id
JOIN tags t ON t.name = TRIM(tt.name)
WHERE wbtt.word_book_id IN (SELECT id FROM word_books);

DROP TABLE word_book_theme_tags;
DROP TABLE theme_tags;

CREATE TRIGGER material_tags_word_book_deleted AFTER DELETE ON word_books
BEGIN
    DELETE FROM material_tags WHERE kind = 'word_book' AND ref_id = OLD.id;
END;

CREATE TRIGGER material_tags_passage_deleted AFTER DELETE ON passages
BEGIN
    DELETE FROM material_tags WHERE kind = 'passage' AND ref_id = OLD.id;
END;

CREATE TRIGGER material_tags_video_deleted AFTER DELETE ON videos
BEGIN
    DELETE FROM material_tags WHERE kind = 'video' AND ref_id = OLD.id;
END;

CREATE TABLE passage_words (
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    sentence INTEGER NOT NULL,
    key INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (passage_id, word)
) WITHOUT ROWID;

CREATE INDEX idx_passage_words_word ON passage_words(word);

ALTER TABLE videos ADD COLUMN subtitle_offset_ms INTEGER NOT NULL DEFAULT 0;
