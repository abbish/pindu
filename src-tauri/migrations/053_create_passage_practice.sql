-- 短文练习（阅读 + 听力）：用单词本 / 学习计划里的词生成短文，配选词填空、选择、判断与开放题。
-- 短文挂在单词本下（删除单词本时一并删除）；计划生成的短文另记 plan_id / schedule_id（删计划不删短文）。
-- 统计独立于单词练习，不影响记忆等级（DECISIONS D23）。

CREATE TABLE passages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_book_id INTEGER NOT NULL REFERENCES word_books(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES study_plans(id) ON DELETE SET NULL,
    schedule_id INTEGER REFERENCES study_plan_schedules(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    -- [{"en": "...", "zh": "..."}]，en 中用 [[词]] 标出选词填空的空位
    sentences TEXT NOT NULL,
    -- [{"wordId": 1, "word": "customs"}]
    target_words TEXT NOT NULL,
    level TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    model_name TEXT,
    prompt_fingerprint TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_passages_word_book ON passages(word_book_id);
CREATE INDEX idx_passages_plan ON passages(plan_id);
CREATE UNIQUE INDEX idx_passages_schedule ON passages(schedule_id) WHERE schedule_id IS NOT NULL;

CREATE TABLE passage_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    -- choice / true_false / open（选词填空由正文标记派生，不存题目行）
    kind TEXT NOT NULL,
    stem TEXT NOT NULL,
    -- choice 的选项（JSON 字符串数组）；其它为 NULL
    options TEXT,
    -- choice：正确选项下标；true_false：true / false；open：NULL
    answer TEXT,
    explanation TEXT,
    reference_answer TEXT,
    -- open 的评分要点（JSON 字符串数组）
    rubric TEXT
);

CREATE INDEX idx_passage_questions_passage ON passage_questions(passage_id, sort_order);

CREATE TABLE passage_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES study_plans(id) ON DELETE SET NULL,
    schedule_id INTEGER REFERENCES study_plan_schedules(id) ON DELETE SET NULL,
    -- reading / listening
    mode TEXT NOT NULL,
    -- in_progress / completed
    status TEXT NOT NULL,
    -- 作答与判分结果（JSON）
    answers TEXT,
    objective_correct INTEGER NOT NULL DEFAULT 0,
    objective_total INTEGER NOT NULL DEFAULT 0,
    open_score INTEGER,
    open_total INTEGER,
    active_time INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX idx_passage_attempts_passage ON passage_attempts(passage_id);
CREATE INDEX idx_passage_attempts_plan ON passage_attempts(plan_id, status);

-- 计划里短文练习的频率：0 = 关闭，1 / 2 / 3 = 每 N 天一篇
ALTER TABLE study_plans ADD COLUMN passage_interval_days INTEGER NOT NULL DEFAULT 0;
