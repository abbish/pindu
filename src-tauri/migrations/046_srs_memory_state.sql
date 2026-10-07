-- 自适应间隔复习（Leitner）：每个计划单词的记忆状态；计划新增“每天新词数”参数。
-- 日期列为本地日历日期 YYYY-MM-DD（不含时刻）。
ALTER TABLE study_plan_words ADD COLUMN srs_box INTEGER NOT NULL DEFAULT 0;      -- 0 未学；1–5 记忆等级
ALTER TABLE study_plan_words ADD COLUMN srs_due TEXT;                            -- 下次复习日期
ALTER TABLE study_plan_words ADD COLUMN srs_last TEXT;                           -- 上次练习日期
ALTER TABLE study_plan_words ADD COLUMN srs_lapses INTEGER NOT NULL DEFAULT 0;   -- 复习答错次数
ALTER TABLE study_plan_words ADD COLUMN srs_reviews INTEGER NOT NULL DEFAULT 0;  -- 复习次数

ALTER TABLE study_plans ADD COLUMN daily_new_words INTEGER;                       -- 每天新词数（旧计划为 NULL）

CREATE INDEX IF NOT EXISTS idx_study_plan_words_srs_due ON study_plan_words (plan_id, srs_due);

-- 回填：已在完成的练习里学过的词进入第 1 级，从最后一次练习的次日开始复习
UPDATE study_plan_words
SET srs_box = 1,
    srs_last = (
        SELECT MAX(DATE(ps.end_time, 'localtime'))
        FROM practice_sessions ps
        JOIN study_plan_schedule_words sw ON sw.schedule_id = ps.schedule_id
        WHERE ps.plan_id = study_plan_words.plan_id
          AND ps.completed = TRUE
          AND sw.word_id = study_plan_words.word_id
    )
WHERE EXISTS (
    SELECT 1
    FROM practice_sessions ps
    JOIN study_plan_schedule_words sw ON sw.schedule_id = ps.schedule_id
    WHERE ps.plan_id = study_plan_words.plan_id
      AND ps.completed = TRUE
      AND sw.word_id = study_plan_words.word_id
);
UPDATE study_plan_words SET srs_due = DATE(srs_last, '+1 day') WHERE srs_box = 1 AND srs_last IS NOT NULL;
