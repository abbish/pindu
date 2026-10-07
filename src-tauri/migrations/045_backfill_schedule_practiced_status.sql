-- 日程状态口径调整：有已完成的练习会话即“练完”（completed），不再要求三步首答全对
-- （否则总错一个词的日程会永远逾期）；掌握数仍是 completed_words_count。按新口径回填已有日程。
UPDATE study_plan_schedules
SET status = 'completed', updated_at = CURRENT_TIMESTAMP
WHERE status != 'completed'
  AND EXISTS (
      SELECT 1 FROM practice_sessions ps
      WHERE ps.schedule_id = study_plan_schedules.id AND ps.completed = TRUE
  );
