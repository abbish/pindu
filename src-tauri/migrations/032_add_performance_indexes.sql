-- 添加性能优化索引
-- 用于优化批量查询和不区分大小写搜索

-- words 表索引
-- 优化按 word_book_id 查询单词列表
CREATE INDEX IF NOT EXISTS idx_words_word_book_id ON words(word_book_id);

-- 优化不区分大小写的单词搜索 (用于查重)
-- SQLite 可以使用 LIKE 进行不区分大小写搜索
CREATE INDEX IF NOT EXISTS idx_words_word_collate_nocase ON words(word COLLATE NOCASE);

-- 优化 word_book_id + word 组合查询
CREATE INDEX IF NOT EXISTS idx_words_word_book_id_word ON words(word_book_id, word COLLATE NOCASE);

-- word_book_theme_tags 表索引
-- 优化从主题标签查询单词本
CREATE INDEX IF NOT EXISTS idx_word_book_theme_tags_theme_tag_id ON word_book_theme_tags(theme_tag_id);

-- word_books 表索引
-- 优化按状态和时间排序的查询
CREATE INDEX IF NOT EXISTS idx_word_books_status_created_at ON word_books(status, created_at DESC);

-- 优化查询未删除的单词本
CREATE INDEX IF NOT EXISTS idx_word_books_deleted_at ON word_books(deleted_at) WHERE deleted_at IS NOT NULL;

-- study_plans 表索引
-- 优化按状态查询学习计划
CREATE INDEX IF NOT EXISTS idx_study_plans_status ON study_plans(status);

-- 优化按时间排序的学习计划查询
CREATE INDEX IF NOT EXISTS idx_study_plans_created_at ON study_plans(created_at DESC);

-- practice_sessions 表索引
-- 优化查询未完成的练习会话
CREATE INDEX IF NOT EXISTS idx_practice_sessions_completed ON practice_sessions(completed) WHERE completed = 0;

-- 优化按计划ID查询练习会话
CREATE INDEX IF NOT EXISTS idx_practice_sessions_plan_id ON practice_sessions(plan_id);

-- 优化按日程日期查询练习会话
CREATE INDEX IF NOT EXISTS idx_practice_sessions_schedule_date ON practice_sessions(schedule_date);
