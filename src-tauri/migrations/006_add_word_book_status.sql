-- 添加单词本状态字段
-- 为 word_books 表添加 status 字段，支持 normal、draft、deleted 状态

ALTER TABLE word_books ADD COLUMN status TEXT DEFAULT 'normal' CHECK (status IN ('normal', 'draft', 'deleted'));

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_word_books_status ON word_books(status);

-- 根据现有的 deleted_at 字段更新状态
UPDATE word_books SET status = 'deleted' WHERE deleted_at IS NOT NULL;
UPDATE word_books SET status = 'normal' WHERE deleted_at IS NULL;
