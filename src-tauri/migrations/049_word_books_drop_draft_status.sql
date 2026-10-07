-- 049：单词本取消“草稿”状态（2026-10-07 用户决定）
-- 草稿唯一的作用是“不能用于学习计划”，而空单词本本来就不能用于计划；保留它只会让创建流程多一个含义不清的选择。
-- 存量草稿单词本改为正常；已删除的（status = 'deleted'）不动。只改值，不改表结构。
UPDATE word_books
   SET status = 'normal',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE status = 'draft';
