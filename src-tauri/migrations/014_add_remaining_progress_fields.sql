-- 添加剩余的进度跟踪字段
-- 这些字段在后端代码中被引用但在之前的迁移中缺失

-- 添加完成时间字段
ALTER TABLE study_plan_schedule_words ADD COLUMN completed_at DATETIME;

-- 添加学习时间字段
ALTER TABLE study_plan_schedule_words ADD COLUMN study_time_minutes INTEGER DEFAULT 0;

-- 添加正确尝试次数字段
ALTER TABLE study_plan_schedule_words ADD COLUMN correct_attempts INTEGER DEFAULT 0;

-- 添加总尝试次数字段
ALTER TABLE study_plan_schedule_words ADD COLUMN total_attempts INTEGER DEFAULT 0;

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_study_plan_schedule_words_completed ON study_plan_schedule_words(completed);
