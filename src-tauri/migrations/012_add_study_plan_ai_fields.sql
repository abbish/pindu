-- 为学习计划表添加AI规划相关字段
-- 这些字段用于存储AI规划的参数和结果

-- 添加学习强度等级字段
ALTER TABLE study_plans ADD COLUMN intensity_level TEXT;

-- 添加学习周期天数字段
ALTER TABLE study_plans ADD COLUMN study_period_days INTEGER;

-- 添加复习频率字段
ALTER TABLE study_plans ADD COLUMN review_frequency INTEGER;

-- 添加计划开始日期字段
ALTER TABLE study_plans ADD COLUMN start_date DATE;

-- 添加计划结束日期字段
ALTER TABLE study_plans ADD COLUMN end_date DATE;

-- 添加AI规划数据字段（存储JSON格式的AI规划结果）
ALTER TABLE study_plans ADD COLUMN ai_plan_data TEXT;
