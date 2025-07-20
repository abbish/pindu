-- 修复学习计划状态值不一致问题
-- 确保数据库中的状态值与类型定义一致

-- 修复管理状态值
-- 确保只有 'normal', 'draft', 'deleted' 三种状态
UPDATE study_plans SET 
    status = CASE 
        WHEN status = 'active' THEN 'normal'
        WHEN status = 'paused' THEN 'normal'
        WHEN status = 'completed' THEN 'normal'
        WHEN status = 'terminated' THEN 'normal'
        WHEN status = 'draft' THEN 'draft'
        WHEN status = 'deleted' THEN 'deleted'
        ELSE 'normal'
    END
WHERE status NOT IN ('normal', 'draft', 'deleted');

-- 修复生命周期状态值
-- 确保只有 'pending', 'active', 'completed', 'terminated' 四种状态
UPDATE study_plans SET 
    lifecycle_status = CASE 
        WHEN lifecycle_status = 'paused' THEN 'pending'
        WHEN lifecycle_status NOT IN ('pending', 'active', 'completed', 'terminated') THEN 'pending'
        ELSE lifecycle_status
    END
WHERE lifecycle_status NOT IN ('pending', 'active', 'completed', 'terminated');

-- 记录状态修复历史
INSERT INTO study_plan_status_history (plan_id, to_status, to_lifecycle_status, reason)
SELECT id, status, lifecycle_status, 'Status values normalization - migration 018'
FROM study_plans
WHERE id NOT IN (
    SELECT DISTINCT plan_id 
    FROM study_plan_status_history 
    WHERE reason = 'Status values normalization - migration 018'
);
