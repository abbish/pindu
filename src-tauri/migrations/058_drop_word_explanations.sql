-- 单词讲解改为每次实时生成、不再缓存（D31）：删除讲解缓存表（只是可重新生成的 AI 输出，没有用户数据）
DROP TABLE IF EXISTS word_explanations;
