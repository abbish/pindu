-- 添加学习计划生命周期管理支持
-- 为学习计划添加软删除、生命周期状态和状态变更历史记录

-- 1. 为学习计划表添加新字段
-- 添加软删除支持
ALTER TABLE study_plans ADD COLUMN deleted_at DATETIME DEFAULT NULL;

-- 添加生命周期状态字段（独立于管理状态）
ALTER TABLE study_plans ADD COLUMN lifecycle_status TEXT DEFAULT 'pending';

-- 添加实际开始时间
ALTER TABLE study_plans ADD COLUMN actual_start_date DATETIME DEFAULT NULL;

-- 添加实际完成时间  
ALTER TABLE study_plans ADD COLUMN actual_end_date DATETIME DEFAULT NULL;

-- 2. 创建学习计划状态变更历史表
CREATE TABLE IF NOT EXISTS study_plan_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    from_status TEXT,                    -- 变更前的管理状态
    to_status TEXT,                      -- 变更后的管理状态
    from_lifecycle_status TEXT,          -- 变更前的生命周期状态
    to_lifecycle_status TEXT,            -- 变更后的生命周期状态
    reason TEXT,                         -- 状态变更原因
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (plan_id) REFERENCES study_plans(id) ON DELETE CASCADE
);

-- 3. 创建索引
CREATE INDEX IF NOT EXISTS idx_study_plans_deleted_at ON study_plans(deleted_at);
CREATE INDEX IF NOT EXISTS idx_study_plans_lifecycle_status ON study_plans(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_study_plans_actual_start_date ON study_plans(actual_start_date);
CREATE INDEX IF NOT EXISTS idx_study_plan_status_history_plan_id ON study_plan_status_history(plan_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_status_history_created_at ON study_plan_status_history(created_at);

-- 4. 迁移现有数据
-- 将现有的学习计划状态迁移到新的状态模型
-- 现有的 'active' -> 'normal' + 'active'
-- 现有的 'paused' -> 'normal' + 'pending' 
-- 现有的 'completed' -> 'normal' + 'completed'
-- 现有的 'draft' -> 'draft' + 'pending'

UPDATE study_plans SET 
    status = CASE 
        WHEN status = 'active' THEN 'normal'
        WHEN status = 'paused' THEN 'normal' 
        WHEN status = 'completed' THEN 'normal'
        WHEN status = 'draft' THEN 'draft'
        ELSE 'normal'
    END,
    lifecycle_status = CASE 
        WHEN status = 'active' THEN 'active'
        WHEN status = 'paused' THEN 'pending'
        WHEN status = 'completed' THEN 'completed' 
        WHEN status = 'draft' THEN 'pending'
        ELSE 'pending'
    END;

-- 5. 为现有学习计划创建初始状态历史记录
INSERT INTO study_plan_status_history (plan_id, to_status, to_lifecycle_status, reason)
SELECT id, status, lifecycle_status, 'Initial migration to lifecycle management'
FROM study_plans;
