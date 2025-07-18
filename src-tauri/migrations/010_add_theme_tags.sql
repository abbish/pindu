-- 添加主题标签支持
-- 为单词本添加多个主题标签支持

-- 创建主题标签表
CREATE TABLE IF NOT EXISTS theme_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建单词本主题标签关联表
CREATE TABLE IF NOT EXISTS word_book_theme_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_book_id INTEGER NOT NULL,
    theme_tag_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (word_book_id) REFERENCES word_books(id) ON DELETE CASCADE,
    FOREIGN KEY (theme_tag_id) REFERENCES theme_tags(id) ON DELETE CASCADE,
    UNIQUE(word_book_id, theme_tag_id)
);

-- 插入默认主题标签
INSERT OR IGNORE INTO theme_tags (name, icon, color) VALUES
('学习', '📚', '#3B82F6'),
('商务', '💼', '#10B981'),
('旅行', '✈️', '#F59E0B'),
('日常', '🏠', '#EF4444'),
('科学', '🔬', '#8B5CF6'),
('艺术', '🎨', '#EC4899');

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_word_book_theme_tags_book_id ON word_book_theme_tags(word_book_id);
CREATE INDEX IF NOT EXISTS idx_word_book_theme_tags_theme_id ON word_book_theme_tags(theme_tag_id);
