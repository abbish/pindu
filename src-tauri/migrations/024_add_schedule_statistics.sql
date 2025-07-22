-- 为学习计划日程表添加统计字段
-- 预计算单词数量统计，提高查询性能

-- 添加统计字段到 study_plan_schedules 表
ALTER TABLE study_plan_schedules ADD COLUMN new_words_count INTEGER DEFAULT 0;
ALTER TABLE study_plan_schedules ADD COLUMN review_words_count INTEGER DEFAULT 0;
ALTER TABLE study_plan_schedules ADD COLUMN total_words_count INTEGER DEFAULT 0;
ALTER TABLE study_plan_schedules ADD COLUMN completed_words_count INTEGER DEFAULT 0;
ALTER TABLE study_plan_schedules ADD COLUMN status TEXT DEFAULT 'not-started' CHECK (status IN ('not-started', 'in-progress', 'completed', 'overdue'));

-- 为现有数据计算统计值
UPDATE study_plan_schedules 
SET 
    new_words_count = (
        SELECT COUNT(*) 
        FROM study_plan_schedule_words spsw 
        WHERE spsw.schedule_id = study_plan_schedules.id 
        AND spsw.is_review = 0
    ),
    review_words_count = (
        SELECT COUNT(*) 
        FROM study_plan_schedule_words spsw 
        WHERE spsw.schedule_id = study_plan_schedules.id 
        AND spsw.is_review = 1
    ),
    total_words_count = (
        SELECT COUNT(*) 
        FROM study_plan_schedule_words spsw 
        WHERE spsw.schedule_id = study_plan_schedules.id
    ),
    completed_words_count = 0,  -- 初始状态都是未完成
    status = 'not-started'      -- 初始状态都是未开始
WHERE id IN (
    SELECT DISTINCT schedule_id 
    FROM study_plan_schedule_words
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_study_plan_schedules_status ON study_plan_schedules(status);
CREATE INDEX IF NOT EXISTS idx_study_plan_schedules_date_status ON study_plan_schedules(schedule_date, status);
