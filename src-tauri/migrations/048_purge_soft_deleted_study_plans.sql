-- 学习计划删除已改为物理删除；清理历史上软删除（列表里早已隐藏）的计划及其全部子数据。
-- 子表显式按依赖顺序删除，不依赖外键级联是否开启。
CREATE TEMP TABLE purge_plans AS
SELECT id FROM study_plans
WHERE deleted_at IS NOT NULL OR unified_status = 'Deleted' OR status = 'deleted';

DELETE FROM word_practice_records
WHERE session_id IN (SELECT id FROM practice_sessions WHERE plan_id IN (SELECT id FROM purge_plans));
DELETE FROM practice_pause_records
WHERE session_id IN (SELECT id FROM practice_sessions WHERE plan_id IN (SELECT id FROM purge_plans));
DELETE FROM practice_sessions WHERE plan_id IN (SELECT id FROM purge_plans);
DELETE FROM study_timer_records WHERE plan_id IN (SELECT id FROM purge_plans);
DELETE FROM study_sessions WHERE plan_id IN (SELECT id FROM purge_plans);
DELETE FROM study_plan_schedule_words
WHERE schedule_id IN (SELECT id FROM study_plan_schedules WHERE plan_id IN (SELECT id FROM purge_plans));
DELETE FROM study_plan_schedules WHERE plan_id IN (SELECT id FROM purge_plans);
DELETE FROM study_plan_words WHERE plan_id IN (SELECT id FROM purge_plans);
DELETE FROM study_plan_status_history WHERE plan_id IN (SELECT id FROM purge_plans);
DELETE FROM study_plans WHERE id IN (SELECT id FROM purge_plans);

DROP TABLE purge_plans;
