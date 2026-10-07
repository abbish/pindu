-- 短文改为独立素材（DECISIONS D23）：不再依附单词本 / 计划，改为记录来源（单词本、学习计划，可多个）。
-- 053 未发布，只在开发测试库里有数据：这里直接删除 053 的三张短文表与 study_plans.passage_interval_days，按新结构重建。
-- （子表先删，避免外键级联；SQLite 3.35+ 支持 DROP COLUMN。）

DROP TABLE IF EXISTS passage_attempts;
DROP TABLE IF EXISTS passage_questions;
DROP TABLE IF EXISTS passages;
ALTER TABLE study_plans DROP COLUMN passage_interval_days;

CREATE TABLE passages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    -- [{"en": "...", "zh": "..."}]，en 中用 [[词]] 标出选词填空的空位
    sentences TEXT NOT NULL,
    -- [{"wordId": 1, "word": "customs"}]；手动输入的词 wordId 为 null
    target_words TEXT NOT NULL,
    -- 生成时用的场景（用户写的主题，或所选单词本的场景）
    scene TEXT,
    level TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    model_name TEXT,
    prompt_fingerprint TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 来源：删除单词本 / 计划不删短文（ref_id 不设外键，name 为创建时的名称快照）
CREATE TABLE passage_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    -- book / plan
    kind TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    -- plan 的选词范围：hard / learned / due
    detail TEXT
);

CREATE INDEX idx_passage_sources_ref ON passage_sources(kind, ref_id);
CREATE INDEX idx_passage_sources_passage ON passage_sources(passage_id);

CREATE TABLE passage_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    -- choice / true_false / open（选词填空由正文标记派生，不存题目行）
    kind TEXT NOT NULL,
    stem TEXT NOT NULL,
    options TEXT,
    answer TEXT,
    explanation TEXT,
    reference_answer TEXT,
    rubric TEXT
);

CREATE INDEX idx_passage_questions_passage ON passage_questions(passage_id, sort_order);

CREATE TABLE passage_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    -- 计划里的短文练习（计划接入后使用）；自由练习为 NULL
    plan_id INTEGER REFERENCES study_plans(id) ON DELETE SET NULL,
    schedule_id INTEGER REFERENCES study_plan_schedules(id) ON DELETE SET NULL,
    -- reading / listening
    mode TEXT NOT NULL,
    -- in_progress / completed
    status TEXT NOT NULL,
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
