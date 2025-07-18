-- 添加学习计划日程表
-- 用于存储AI生成的每日学习计划

-- 创建学习计划日程表
CREATE TABLE IF NOT EXISTS study_plan_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    day_number INTEGER NOT NULL, -- 第几天 (1, 2, 3...)
    schedule_date DATE NOT NULL, -- 具体日期 (YYYY-MM-DD)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES study_plans(id) ON DELETE CASCADE,
    UNIQUE(plan_id, day_number),
    UNIQUE(plan_id, schedule_date)
);

-- 创建学习计划日程单词表
CREATE TABLE IF NOT EXISTS study_plan_schedule_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    wordbook_id INTEGER NOT NULL, -- 单词来源的单词本ID
    is_review BOOLEAN NOT NULL DEFAULT FALSE, -- 是否为复习单词
    review_count INTEGER DEFAULT NULL, -- 复习次数（仅复习单词有此字段）
    priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
    difficulty_level INTEGER NOT NULL CHECK (difficulty_level BETWEEN 1 AND 5) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES study_plan_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
    FOREIGN KEY (wordbook_id) REFERENCES word_books(id) ON DELETE CASCADE,
    UNIQUE(schedule_id, word_id)
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_study_plan_schedules_plan_id ON study_plan_schedules(plan_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_schedules_date ON study_plan_schedules(schedule_date);
CREATE INDEX IF NOT EXISTS idx_study_plan_schedule_words_schedule_id ON study_plan_schedule_words(schedule_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_schedule_words_word_id ON study_plan_schedule_words(word_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_schedule_words_wordbook_id ON study_plan_schedule_words(wordbook_id);
