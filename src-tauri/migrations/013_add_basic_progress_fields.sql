-- 为学习计划日程单词表添加基本进度字段
-- 最简化版本，避免复杂的迁移问题

-- 添加完成状态字段
ALTER TABLE study_plan_schedule_words ADD COLUMN completed BOOLEAN NOT NULL DEFAULT FALSE;
