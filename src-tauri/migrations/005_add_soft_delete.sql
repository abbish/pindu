-- 添加软删除支持
-- 为 word_books 表添加 deleted_at 字段

ALTER TABLE word_books ADD COLUMN deleted_at DATETIME DEFAULT NULL;

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_word_books_deleted_at ON word_books(deleted_at);

-- 为现有记录设置 deleted_at 为 NULL（已经是默认值，但确保一致性）
UPDATE word_books SET deleted_at = NULL WHERE deleted_at IS NULL;
