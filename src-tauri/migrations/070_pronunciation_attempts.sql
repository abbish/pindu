-- 发音评估结果（跟读一个词或一句话，本机评估）：只记学习计划里的练习，素材上的自由跟读不记。
-- 不进单词练习的正确率与记忆等级；给计划的「发音」统计（常错的音）用。
-- detail：逐词逐音的 JSON [{word, score, phones: [{ipa, score, heardAs, likelyConfused}]}]
CREATE TABLE IF NOT EXISTS pronunciation_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
    session_id TEXT,
    source TEXT NOT NULL,
    word_id INTEGER,
    passage_id INTEGER,
    text TEXT NOT NULL,
    score INTEGER NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pronunciation_attempts_plan ON pronunciation_attempts (plan_id, created_at);
