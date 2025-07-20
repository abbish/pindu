-- 修复统一状态约束 - SQLite兼容版本
-- 由于SQLite不支持ALTER TABLE ADD CONSTRAINT，我们需要重建表来添加约束

-- 1. 创建带约束的新表
CREATE TABLE study_plans_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'normal' CHECK (status IN ('normal', 'draft', 'deleted')),
    lifecycle_status TEXT DEFAULT 'pending' CHECK (lifecycle_status IN ('pending', 'active', 'completed', 'terminated')),
    unified_status TEXT DEFAULT 'Draft' CHECK (unified_status IN ('Draft', 'Pending', 'Active', 'Paused', 'Completed', 'Terminated', 'Deleted')),
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

-- 2. 复制数据到新表
INSERT INTO study_plans_new (
    id, name, description, status, lifecycle_status, unified_status,
    total_words, learned_words, accuracy_rate, mastery_level,
    intensity_level, study_period_days, review_frequency,
    start_date, end_date, actual_start_date, actual_end_date, actual_terminated_date,
    ai_plan_data, deleted_at, created_at, updated_at
)
SELECT
    id, name, description, status, lifecycle_status,
    -- 根据旧状态计算unified_status
    CASE
        WHEN status = 'deleted' THEN 'Deleted'
        WHEN status = 'draft' THEN 'Draft'
        WHEN status = 'normal' AND lifecycle_status = 'pending' THEN 'Pending'
        WHEN status = 'normal' AND lifecycle_status = 'active' THEN 'Active'
        WHEN status = 'normal' AND lifecycle_status = 'completed' THEN 'Completed'
        WHEN status = 'normal' AND lifecycle_status = 'terminated' THEN 'Terminated'
        ELSE 'Draft'
    END as unified_status,
    total_words, learned_words, accuracy_rate, mastery_level,
    intensity_level, study_period_days, review_frequency,
    start_date, end_date, actual_start_date, actual_end_date, actual_terminated_date,
    ai_plan_data, deleted_at, created_at, updated_at
FROM study_plans;

-- 3. 删除旧表
DROP TABLE study_plans;

-- 4. 重命名新表
ALTER TABLE study_plans_new RENAME TO study_plans;

-- 5. 重建索引
CREATE INDEX idx_study_plans_unified_status ON study_plans(unified_status);
CREATE INDEX idx_study_plans_unified_status_created ON study_plans(unified_status, created_at);
CREATE INDEX idx_study_plans_status ON study_plans(status);
CREATE INDEX idx_study_plans_lifecycle_status ON study_plans(lifecycle_status);
CREATE INDEX idx_study_plans_deleted_at ON study_plans(deleted_at);

-- 6. 更新状态历史表的约束（如果需要）
-- 由于状态历史表可能有外键约束，我们需要小心处理
-- 这里只添加新字段的约束验证

-- 7. 验证数据完整性
-- 检查是否所有记录都有有效的unified_status
UPDATE study_plans 
SET unified_status = 'Draft' 
WHERE unified_status IS NULL OR unified_status NOT IN ('Draft', 'Pending', 'Active', 'Paused', 'Completed', 'Terminated', 'Deleted');

-- 8. 迁移完成
-- SQLx会自动记录迁移状态，无需手动插入记录
