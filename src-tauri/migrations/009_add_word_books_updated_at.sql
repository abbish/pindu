-- 为 word_books 表添加 updated_at 字段
-- 这个字段用于跟踪单词本的最后更新时间

-- 添加字段，不使用DEFAULT子句
ALTER TABLE word_books ADD COLUMN updated_at DATETIME;

-- 为现有记录设置 updated_at 为当前时间
UPDATE word_books SET updated_at = datetime('now');

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_word_books_updated_at ON word_books(updated_at);
