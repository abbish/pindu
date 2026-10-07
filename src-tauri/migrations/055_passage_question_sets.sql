-- 短文与阅读理解题分离（DECISIONS D23 修订）：短文只保存正文与翻译；阅读理解题按「题组」单独生成，一篇短文可以有多套。
-- 053 / 054 未发布，只在开发测试库里有数据：这里删除 054 的短文表，按新结构重建（不涉及 study_plans 等其它表）。

DROP TABLE IF EXISTS passage_attempts;
DROP TABLE IF EXISTS passage_questions;
DROP TABLE IF EXISTS passage_sources;
DROP TABLE IF EXISTS passages;

CREATE TABLE passages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    -- [{"en": "...", "zh": "..."}]（纯文本，不含标记）
    sentences TEXT NOT NULL,
    -- [{"wordId": 1, "word": "customs", "required": true}]：required = 用户指定必须出现；false = AI 从来源中挑选；手动输入的词 wordId 为 null
    target_words TEXT NOT NULL,
    -- 生成时用的场景（自定主题，或所选单词本的场景）
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
    -- plan 的选词范围：learned / hard / due
    detail TEXT
);

CREATE INDEX idx_passage_sources_ref ON passage_sources(kind, ref_id);
CREATE INDEX idx_passage_sources_passage ON passage_sources(passage_id);

-- 阅读理解题组：一篇短文可以有多套
CREATE TABLE passage_question_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- 生成参数：{"cloze": 5, "choice": 3, "trueFalse": 2, "open": 1, "difficulty": "standard"}
    spec TEXT NOT NULL,
    -- 选词填空的干扰词（JSON 字符串数组）
    cloze_distractors TEXT,
    model_name TEXT,
    prompt_fingerprint TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_passage_question_sets_passage ON passage_question_sets(passage_id);

CREATE TABLE passage_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER NOT NULL REFERENCES passage_question_sets(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    -- cloze 选词填空 / choice 选择 / true_false 判断 / open 开放题
    kind TEXT NOT NULL,
    -- cloze：被挖空的词（与原文中的写法一致）；其它：题干
    stem TEXT NOT NULL,
    -- choice 的选项（JSON 字符串数组）
    options TEXT,
    -- cloze：被挖空的词；choice：正确选项下标；true_false：true / false；open：NULL
    answer TEXT,
    explanation TEXT,
    reference_answer TEXT,
    -- open 的评分要点（JSON 字符串数组）
    rubric TEXT,
    -- cloze：空位所在句子的下标（从 0 开始）
    sentence_index INTEGER
);

CREATE INDEX idx_passage_questions_set ON passage_questions(set_id, sort_order);

CREATE TABLE passage_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER NOT NULL REFERENCES passage_question_sets(id) ON DELETE CASCADE,
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

CREATE INDEX idx_passage_attempts_set ON passage_attempts(set_id);
CREATE INDEX idx_passage_attempts_passage ON passage_attempts(passage_id);
CREATE INDEX idx_passage_attempts_plan ON passage_attempts(plan_id, status);
