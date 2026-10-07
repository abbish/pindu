-- 导入自己的材料（passage-import，DECISIONS D30）
-- origin：generated AI 写的 / imported 用户导入的材料；source_label：导入时的文件名或「粘贴的文本」
-- 已有短文都是 AI 写的，默认 generated。段落标记存在 sentences JSON 里（paragraph），不需要改表。

ALTER TABLE passages ADD COLUMN origin TEXT NOT NULL DEFAULT 'generated'
    CHECK (origin IN ('generated', 'imported'));
ALTER TABLE passages ADD COLUMN source_label TEXT;

CREATE INDEX idx_passages_origin ON passages(origin);
