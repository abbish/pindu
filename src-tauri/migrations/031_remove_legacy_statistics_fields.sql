-- 移除学习计划表中的遗留统计字段
-- 这些字段已不再使用，所有统计数据通过 StudyPlanStatistics API 实时计算

-- 1. 创建新的学习计划表结构（不包含遗留统计字段）
CREATE TABLE study_plans_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'normal' CHECK (status IN ('normal', 'draft', 'deleted')),
    unified_status TEXT DEFAULT 'Draft' CHECK (unified_status IN ('Draft', 'Pending', 'Active', 'Paused', 'Completed', 'Terminated', 'Deleted')),
    total_words INTEGER DEFAULT 0,
    -- 移除 learned_words 字段 - 使用 StudyPlanStatistics API 获取实时数据
    -- 移除 accuracy_rate 字段 - 使用 StudyPlanStatistics API 获取实时数据
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 复制数据到新表（排除遗留字段）
INSERT INTO study_plans_new (
    id, name, description, status, unified_status,
    total_words, mastery_level, intensity_level, study_period_days,
    review_frequency, start_date, end_date, actual_start_date,
    actual_end_date, actual_terminated_date, ai_plan_data,
    deleted_at, created_at, updated_at
)
SELECT
    id, name, description, status, unified_status,
    total_words, mastery_level, intensity_level, study_period_days,
    review_frequency, start_date, end_date, actual_start_date,
    actual_end_date, actual_terminated_date, ai_plan_data,
    deleted_at, created_at, updated_at
FROM study_plans;

-- 3. 删除旧表
DROP TABLE study_plans;

-- 4. 重命名新表
ALTER TABLE study_plans_new RENAME TO study_plans;

-- 5. 重新创建索引
CREATE INDEX IF NOT EXISTS idx_study_plans_status ON study_plans(status);
CREATE INDEX IF NOT EXISTS idx_study_plans_unified_status ON study_plans(unified_status);
CREATE INDEX IF NOT EXISTS idx_study_plans_start_date ON study_plans(start_date);
CREATE INDEX IF NOT EXISTS idx_study_plans_deleted_at ON study_plans(deleted_at);

-- 6. 重新创建触发器（如果有的话）
-- 更新时间触发器
CREATE TRIGGER IF NOT EXISTS update_study_plans_updated_at
    AFTER UPDATE ON study_plans
    FOR EACH ROW
BEGIN
    UPDATE study_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- 7. 验证数据完整性
-- 检查数据是否正确迁移
-- SELECT COUNT(*) FROM study_plans; -- 应该与原表记录数相同

-- 8. 添加迁移记录注释
-- 此迁移移除了以下遗留字段：
-- - learned_words: 已学单词数（使用 StudyPlanStatistics API 替代）
-- - accuracy_rate: 正确率（使用 StudyPlanStatistics API 替代）
-- 
-- 这些字段的数据现在通过以下方式获取：
-- - 前端：调用 studyService.getStudyPlanStatistics(planId)
-- - 后端：使用 get_study_plan_statistics 命令
-- 
-- 优势：
-- 1. 数据实时性：统计数据基于实际练习记录计算
-- 2. 数据一致性：避免缓存字段与实际数据不同步
-- 3. 代码简洁性：减少数据维护逻辑
-- 4. 扩展性：更容易添加新的统计指标
