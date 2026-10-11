-- 题组分阅读 / 听力：各自生成、各自删除，作答与计划任务跟着各自的题组（D53）。
-- 以前一套题两种方式共用：每套旧题组复制一份听力用的（题目一起复制），原来那份归阅读；
-- 听力作答与计划里的听力任务移到复制的那份，作答里记的题目编号按题目顺序换成新题目的编号。
-- 迁移后两个页签看到的与之前相同，此后互不影响。

ALTER TABLE passage_question_sets ADD COLUMN mode TEXT NOT NULL DEFAULT 'reading';
-- 迁移用：复制出来的听力题组记下原来的题组，最后删除这一列
ALTER TABLE passage_question_sets ADD COLUMN copied_from INTEGER;

INSERT INTO passage_question_sets
    (passage_id, name, spec, cloze_distractors, model_name, prompt_fingerprint, created_at, mode, copied_from)
SELECT passage_id, name, spec, cloze_distractors, model_name, prompt_fingerprint, created_at, 'listening', id
FROM passage_question_sets
WHERE mode = 'reading' AND copied_from IS NULL;

INSERT INTO passage_questions
    (set_id, sort_order, kind, stem, options, answer, explanation, reference_answer, rubric, sentence_index)
SELECT n.id, q.sort_order, q.kind, q.stem, q.options, q.answer, q.explanation, q.reference_answer, q.rubric, q.sentence_index
FROM passage_questions q
JOIN passage_question_sets n ON n.copied_from = q.set_id;

-- 听力作答里的题目编号（clozeResults / questionResults 的 questionId）换成复制后对应的题目
UPDATE passage_attempts
SET answers = json_set(
    answers,
    '$.clozeResults',
    json((
        SELECT json_group_array(json_set(e.value, '$.questionId', COALESCE(nq.id, json_extract(e.value, '$.questionId'))) ORDER BY CAST(e.key AS INTEGER))
        FROM json_each(passage_attempts.answers, '$.clozeResults') e
        LEFT JOIN passage_questions oq ON oq.id = json_extract(e.value, '$.questionId')
        LEFT JOIN passage_question_sets n ON n.copied_from = oq.set_id
        LEFT JOIN passage_questions nq ON nq.set_id = n.id AND nq.sort_order = oq.sort_order
    )),
    '$.questionResults',
    json((
        SELECT json_group_array(json_set(e.value, '$.questionId', COALESCE(nq.id, json_extract(e.value, '$.questionId'))) ORDER BY CAST(e.key AS INTEGER))
        FROM json_each(passage_attempts.answers, '$.questionResults') e
        LEFT JOIN passage_questions oq ON oq.id = json_extract(e.value, '$.questionId')
        LEFT JOIN passage_question_sets n ON n.copied_from = oq.set_id
        LEFT JOIN passage_questions nq ON nq.set_id = n.id AND nq.sort_order = oq.sort_order
    ))
)
WHERE mode = 'listening'
  AND answers IS NOT NULL
  AND json_valid(answers)
  AND set_id IN (SELECT copied_from FROM passage_question_sets WHERE copied_from IS NOT NULL);

UPDATE passage_attempts
SET set_id = (SELECT n.id FROM passage_question_sets n WHERE n.copied_from = passage_attempts.set_id)
WHERE mode = 'listening'
  AND set_id IN (SELECT copied_from FROM passage_question_sets WHERE copied_from IS NOT NULL);

UPDATE study_plan_passages
SET set_id = (SELECT n.id FROM passage_question_sets n WHERE n.copied_from = study_plan_passages.set_id)
WHERE mode = 'listening'
  AND set_id IN (SELECT copied_from FROM passage_question_sets WHERE copied_from IS NOT NULL);

ALTER TABLE passage_question_sets DROP COLUMN copied_from;

CREATE INDEX idx_passage_question_sets_passage_mode ON passage_question_sets (passage_id, mode);
