-- 添加自然拼读分析相关字段
-- 为 words 表添加新的自然拼读分析字段

-- 添加词性相关字段
ALTER TABLE words ADD COLUMN pos_abbreviation TEXT;
ALTER TABLE words ADD COLUMN pos_english TEXT;
ALTER TABLE words ADD COLUMN pos_chinese TEXT;

-- 添加自然拼读规则字段
ALTER TABLE words ADD COLUMN phonics_rule TEXT;

-- 添加分析解释字段
ALTER TABLE words ADD COLUMN analysis_explanation TEXT;

-- 添加频率字段（数字类型）
ALTER TABLE words ADD COLUMN word_frequency INTEGER DEFAULT 1;

-- 更新现有记录的默认值
UPDATE words SET 
    pos_abbreviation = 'n.',
    pos_english = 'Noun',
    pos_chinese = '名词',
    phonics_rule = 'Unknown',
    analysis_explanation = '暂无分析',
    word_frequency = 1
WHERE pos_abbreviation IS NULL;
