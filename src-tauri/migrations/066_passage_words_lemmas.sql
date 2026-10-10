-- 短文词索引改为同时存原形（D47：词形库 WordNet + morphy，went 也存 go、children 也存 child），按原形一次查到。
-- 旧索引只存了原文里的写法：清空后由 PassageWordRepository::index_missing 在第一次查询时按新规则补建。只删索引，不动短文本身。
DELETE FROM passage_words;
