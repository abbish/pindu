-- 修复学习计划日程单词表的唯一约束问题
-- 允许同一个单词在同一天进行多次复习（不同的review_count）

-- 问题描述：
-- 当前约束 UNIQUE(schedule_id, word_id, is_review) 不允许同一个单词在同一天进行多次复习
-- 但AI生成的学习计划中，同一个单词可能需要在同一天复习多次（review_count=1,2,3...）
-- 需要将约束修改为 UNIQUE(schedule_id, word_id, is_review, review_count)

-- SQLite不支持直接修改约束，需要重建表

-- 1. 创建新的临时表，使用修正后的约束
CREATE TABLE IF NOT EXISTS study_plan_schedule_words_temp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    wordbook_id INTEGER NOT NULL,
    is_review BOOLEAN NOT NULL DEFAULT FALSE,
    review_count INTEGER DEFAULT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    difficulty_level INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES study_plan_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
    FOREIGN KEY (wordbook_id) REFERENCES word_books(id) ON DELETE CASCADE,
    -- 修正后的唯一约束：允许同一个单词在同一天以不同复习次数出现
    UNIQUE(schedule_id, word_id, is_review, review_count)
);

-- 2. 复制现有数据到新表
INSERT INTO study_plan_schedule_words_temp (
    id, schedule_id, word_id, wordbook_id, is_review, 
    review_count, priority, difficulty_level, created_at
)
SELECT 
    id, schedule_id, word_id, wordbook_id, is_review, 
    review_count, priority, difficulty_level, created_at
FROM study_plan_schedule_words;

-- 3. 删除旧表
DROP TABLE study_plan_schedule_words;

-- 4. 重命名新表
ALTER TABLE study_plan_schedule_words_temp RENAME TO study_plan_schedule_words;

-- 5. 重新创建索引
CREATE INDEX IF NOT EXISTS idx_study_plan_schedule_words_schedule_id ON study_plan_schedule_words(schedule_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_schedule_words_word_id ON study_plan_schedule_words(word_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_schedule_words_wordbook_id ON study_plan_schedule_words(wordbook_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_schedule_words_is_review ON study_plan_schedule_words(is_review);
CREATE INDEX IF NOT EXISTS idx_study_plan_schedule_words_review_count ON study_plan_schedule_words(review_count);

-- 6. 添加复合索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_study_plan_schedule_words_composite ON study_plan_schedule_words(schedule_id, word_id, is_review);
