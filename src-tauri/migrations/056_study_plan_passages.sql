-- 学习计划接入短文（C4，DECISIONS D29）
-- 计划的练习内容：words 只练单词（已有计划）/ passages 只练短文 / both 两者都练
-- 计划里的短文任务 = 短文库里的一篇短文 + 指定一套题组（为空表示只朗读、自由学习）+ 练习方式；
-- 从计划开始日起每 passage_interval_days 天一篇，完成后锁定日期。

ALTER TABLE study_plans ADD COLUMN practice_content TEXT NOT NULL DEFAULT 'words'
    CHECK (practice_content IN ('words', 'passages', 'both'));
ALTER TABLE study_plans ADD COLUMN passage_interval_days INTEGER NOT NULL DEFAULT 2
    CHECK (passage_interval_days BETWEEN 1 AND 30);

CREATE TABLE study_plan_passages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    -- 为空：没有题组，只朗读 / 自由学习，点「读完了」算完成
    set_id INTEGER REFERENCES passage_question_sets(id) ON DELETE SET NULL,
    mode TEXT NOT NULL DEFAULT 'reading' CHECK (mode IN ('reading', 'listening')),
    sort_order INTEGER NOT NULL,
    -- 本地日历日期 YYYY-MM-DD
    scheduled_date TEXT NOT NULL,
    -- 完成时刻（UTC）；完成后日期与题组锁定
    completed_at TEXT,
    -- 完成这项任务的作答（只读任务为空）
    attempt_id INTEGER REFERENCES passage_attempts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    UNIQUE (plan_id, passage_id)
);

CREATE INDEX idx_study_plan_passages_plan ON study_plan_passages(plan_id, sort_order);
CREATE INDEX idx_study_plan_passages_date ON study_plan_passages(scheduled_date);
CREATE INDEX idx_study_plan_passages_passage ON study_plan_passages(passage_id);
CREATE INDEX idx_study_plan_passages_set ON study_plan_passages(set_id);
