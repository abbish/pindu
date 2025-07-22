-- 023_remove_lifecycle_status.sql
-- 移除lifecycle_status字段，完全迁移到unified_status
-- 这个迁移脚本将重建study_plans表，移除lifecycle_status字段

-- 1. 创建无lifecycle_status字段的新表
CREATE TABLE study_plans_unified (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'normal',
    unified_status TEXT DEFAULT 'Draft',
    total_words INTEGER DEFAULT 0,
    learned_words INTEGER DEFAULT 0,
    accuracy_rate REAL DEFAULT 0.0,
    mastery_level INTEGER DEFAULT 0,
    intensity_level TEXT,
    study_period_days INTEGER,
    review_frequency INTEGER,
    start_date TEXT,
    end_date TEXT,
    actual_start_date TEXT,
    actual_end_date TEXT,
    actual_terminated_date TEXT,
    ai_plan_data TEXT,
    deleted_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. 复制数据到新表，确保unified_status正确设置
INSERT INTO study_plans_unified (
    id, name, description, status, unified_status,
    total_words, learned_words, accuracy_rate, mastery_level,
    intensity_level, study_period_days, review_frequency,
    start_date, end_date, actual_start_date, actual_end_date, actual_terminated_date,
    ai_plan_data, deleted_at, created_at, updated_at
)
SELECT 
    id, name, description, status,
    -- 确保unified_status正确设置
    COALESCE(
        unified_status,
        CASE 
            WHEN status = 'deleted' THEN 'Deleted'
            WHEN status = 'draft' THEN 'Draft'
            WHEN status = 'normal' AND lifecycle_status = 'pending' THEN 'Pending'
            WHEN status = 'normal' AND lifecycle_status = 'active' THEN 'Active'
            WHEN status = 'normal' AND lifecycle_status = 'completed' THEN 'Completed'
            WHEN status = 'normal' AND lifecycle_status = 'terminated' THEN 'Terminated'
            ELSE 'Draft'
        END
    ) as unified_status,
    total_words, learned_words, accuracy_rate, mastery_level,
    intensity_level, study_period_days, review_frequency,
    start_date, end_date, actual_start_date, actual_end_date, actual_terminated_date,
    ai_plan_data, deleted_at, created_at, updated_at
FROM study_plans;

-- 3. 删除旧表
DROP TABLE study_plans;

-- 4. 重命名新表
ALTER TABLE study_plans_unified RENAME TO study_plans;

-- 5. 重建索引（不包含lifecycle_status）
CREATE INDEX idx_study_plans_unified_status ON study_plans(unified_status);
CREATE INDEX idx_study_plans_status ON study_plans(status);
CREATE INDEX idx_study_plans_deleted_at ON study_plans(deleted_at);
CREATE INDEX idx_study_plans_created_at ON study_plans(created_at);

-- 6. 验证数据完整性
UPDATE study_plans 
SET unified_status = 'Draft' 
WHERE unified_status IS NULL OR unified_status = '';

UPDATE study_plans 
SET status = 'normal' 
WHERE status IS NULL OR status = '';

-- 7. 清理状态历史表中的lifecycle_status相关记录（可选）
-- 保留历史记录但不再使用lifecycle_status字段
-- 如果需要完全清理，可以删除整个表或重建表结构

-- 8. 迁移完成
-- 现在所有代码都应该只使用unified_status字段
