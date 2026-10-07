-- 练习页「拼读」块来自 words.phonics_segments（JSON 数组字符串），AI 建单词本时从未写入，导致 AI 生成的单词在练习第三步没有拼读提示。
-- 回填：仅对 phonics_segments 为空、syllables 去掉连字符后与单词拼写一致（忽略大小写）、且不含引号的行，
-- 生成 ["el","e","phant"] 形式。新数据由 services/wordbook.rs::phonics_segments_from_syllables 写入。可重复执行。
UPDATE words
SET phonics_segments = '["' || replace(trim(syllables), '-', '","') || '"]',
    updated_at = CURRENT_TIMESTAMP
WHERE (phonics_segments IS NULL OR trim(phonics_segments) = '')
  AND syllables IS NOT NULL
  AND trim(syllables) <> ''
  AND instr(syllables, '"') = 0
  AND instr(syllables, ' ') = 0
  AND instr(syllables, '--') = 0
  AND lower(replace(trim(syllables), '-', '')) = lower(word);
