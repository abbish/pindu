-- 词汇本：条目可以是单词或词组（D45）。kind 由内容决定：带空格的是词组（phrase），其余是单词（word）。
-- phrase_type：词组的类型 phrasal_verb（短语动词）/ collocation（固定搭配）/ idiom（习语）/ fixed（固定短语），由 AI 分析给出；
-- separable：短语动词能否拆开用（pick it up）。单词卡（word_cards）同样带这三项。
ALTER TABLE words ADD COLUMN kind TEXT NOT NULL DEFAULT 'word';
ALTER TABLE words ADD COLUMN phrase_type TEXT;
ALTER TABLE words ADD COLUMN separable INTEGER NOT NULL DEFAULT 0;
UPDATE words SET kind = 'phrase' WHERE TRIM(word) LIKE '% %';

ALTER TABLE word_cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'word';
ALTER TABLE word_cards ADD COLUMN phrase_type TEXT NOT NULL DEFAULT '';
ALTER TABLE word_cards ADD COLUMN separable INTEGER NOT NULL DEFAULT 0;
UPDATE word_cards SET kind = 'phrase' WHERE TRIM(word) LIKE '% %';
