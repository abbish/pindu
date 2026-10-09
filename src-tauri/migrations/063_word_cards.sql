-- 单词卡：短文目标词里没有收进单词本的词，也有完整的学习资料（音标、词性、释义、音节与拼读、例句）。
-- 按小写单词存一份（各短文共用），由批量拼读分析任务生成；收进单词本后以单词本里的为准。
CREATE TABLE word_cards (
    word_key TEXT PRIMARY KEY,
    word TEXT NOT NULL,
    meaning TEXT NOT NULL DEFAULT '',
    pos_abbreviation TEXT NOT NULL DEFAULT '',
    pos_chinese TEXT NOT NULL DEFAULT '',
    ipa TEXT NOT NULL DEFAULT '',
    syllables TEXT NOT NULL DEFAULT '',
    phonics_rule TEXT NOT NULL DEFAULT '',
    analysis_explanation TEXT NOT NULL DEFAULT '',
    examples TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
