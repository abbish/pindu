-- 迁移 060 升级测试的数据：059 时的形状（主题、单词本关联、导入的短文、已切出的片段）
INSERT INTO theme_tags (id, name, icon, color, created_at) VALUES (100, '自驾旅行 ', '✈️', 'primary', '2026-10-08T00:00:00.000Z');
INSERT INTO theme_tags (id, name, icon, color, created_at) VALUES (101, 'TED', '', 'primary', '2026-10-08T00:00:00.000Z');
INSERT INTO theme_tags (id, name, icon, color, created_at) VALUES (102, 'ted', '🎤', 'primary', '2026-10-08T00:00:00.000Z');
INSERT INTO word_books (id, title, description, created_at, updated_at) VALUES (900, 'b', '', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
INSERT INTO word_book_theme_tags (word_book_id, theme_tag_id) VALUES (900, 100), (900, 101), (900, 102);
INSERT INTO passages (id, title, sentences, target_words, level, word_count, origin, created_at, updated_at)
VALUES (900, 'Ordering', '[{"en":"Are you ready to order?","zh":"","paragraph":true,"startMs":0,"endMs":900}]',
        '[{"wordId":null,"word":"menu","required":false,"meaning":null}]', 'a2', 5, 'imported',
        '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
INSERT INTO videos (id, title, source_name, cues, status, created_at, updated_at)
VALUES (900, 'v', 'v.mp4', '[]', 'done', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
INSERT INTO video_clips (video_id, passage_id, seq, start_ms, end_ms, file, created_at)
VALUES (900, 900, 1, 0, 1000, 'clips/1.mp4', '2026-10-08T00:00:00.000Z');
