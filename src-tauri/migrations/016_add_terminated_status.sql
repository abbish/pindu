-- 添加"已终止"状态支持
-- 添加实际终止时间字段，状态验证改为程序逻辑处理

-- 添加实际终止时间字段
ALTER TABLE study_plans ADD COLUMN actual_terminated_date DATETIME DEFAULT NULL;
