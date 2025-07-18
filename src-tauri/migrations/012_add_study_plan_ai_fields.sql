-- 为学习计划表添加AI规划相关字段
-- 这些字段用于存储AI规划的参数和结果

-- 添加学习强度等级字段
ALTER TABLE study_plans ADD COLUMN intensity_level TEXT CHECK (intensity_level IN ('easy', 'normal', 'intensive'));

-- 添加学习周期天数字段
ALTER TABLE study_plans ADD COLUMN study_period_days INTEGER;

-- 添加复习频率字段
ALTER TABLE study_plans ADD COLUMN review_frequency INTEGER;

-- 添加计划开始日期字段
ALTER TABLE study_plans ADD COLUMN start_date DATE;

-- 添加计划结束日期字段
ALTER TABLE study_plans ADD COLUMN end_date DATE;

-- 添加AI规划数据字段（存储完整的JSON数据）
ALTER TABLE study_plans ADD COLUMN ai_plan_data TEXT;

-- 更新status字段的约束，添加draft状态
-- 注意：SQLite不支持直接修改CHECK约束，所以我们需要重建表
CREATE TABLE study_plans_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'draft')) DEFAULT 'active',
    total_words INTEGER NOT NULL DEFAULT 0,
    learned_words INTEGER NOT NULL DEFAULT 0,
    accuracy_rate REAL NOT NULL DEFAULT 0.0,
    mastery_level INTEGER NOT NULL CHECK (mastery_level BETWEEN 1 AND 5) DEFAULT 1,
    intensity_level TEXT CHECK (intensity_level IN ('easy', 'normal', 'intensive')),
    study_period_days INTEGER,
    review_frequency INTEGER,
    start_date DATE,
    end_date DATE,
    ai_plan_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 复制现有数据
INSERT INTO study_plans_new (
    id, name, description, status, total_words, learned_words, 
    accuracy_rate, mastery_level, created_at, updated_at
)
SELECT 
    id, name, description, status, total_words, learned_words,
    accuracy_rate, mastery_level, created_at, updated_at
FROM study_plans;

-- 删除旧表
DROP TABLE study_plans;

-- 重命名新表
ALTER TABLE study_plans_new RENAME TO study_plans;
