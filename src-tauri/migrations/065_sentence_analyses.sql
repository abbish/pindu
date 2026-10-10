-- 句子分析：短文 / 视频台词里一句话的句式、语法点、交际功能、词组与发音要点（AI 生成）。
-- 按句子文字（小写、空白归一）存一份，各短文共用；重新分析时覆盖。analysis 为 JSON。
CREATE TABLE sentence_analyses (
    sentence_key TEXT PRIMARY KEY,
    sentence TEXT NOT NULL,
    analysis TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
