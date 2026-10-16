-- 场景片段的内容讲解（AI 生成的 Markdown）：讲了什么、背景、句式、词汇与表达、听的时候注意什么。
-- 一个片段（短文）一份，重新生成时覆盖；删短文时一并删除。
CREATE TABLE passage_guides (
    passage_id INTEGER PRIMARY KEY REFERENCES passages(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    model_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
