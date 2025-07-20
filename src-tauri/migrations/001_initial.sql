-- 创建分类表
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#4ECDC4',
    icon TEXT NOT NULL DEFAULT 'book',
    word_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建单词本表
CREATE TABLE IF NOT EXISTS word_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'book',
    icon_color TEXT NOT NULL DEFAULT 'blue',
    total_words INTEGER NOT NULL DEFAULT 0,
    linked_plans INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建单词表
CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    meaning TEXT NOT NULL,
    description TEXT,
    phonetic TEXT,
    ipa TEXT,
    syllables TEXT,
    phonics_segments TEXT,
    image_path TEXT,
    audio_path TEXT,
    part_of_speech TEXT,
    difficulty_level INTEGER CHECK (difficulty_level BETWEEN 1 AND 5),
    category_id INTEGER,
    word_book_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (word_book_id) REFERENCES word_books(id) ON DELETE SET NULL
);

-- 创建学习计划表
CREATE TABLE IF NOT EXISTS study_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    total_words INTEGER NOT NULL DEFAULT 0,
    learned_words INTEGER NOT NULL DEFAULT 0,
    accuracy_rate REAL NOT NULL DEFAULT 0.0,
    mastery_level INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建学习计划单词关联表
CREATE TABLE IF NOT EXISTS study_plan_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    learned BOOLEAN NOT NULL DEFAULT FALSE,
    correct_count INTEGER NOT NULL DEFAULT 0,
    total_attempts INTEGER NOT NULL DEFAULT 0,
    last_studied DATETIME,
    next_review DATETIME,
    mastery_score REAL NOT NULL DEFAULT 0.0,
    FOREIGN KEY (plan_id) REFERENCES study_plans(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
    UNIQUE(plan_id, word_id)
);

-- 创建学习会话表
CREATE TABLE IF NOT EXISTS study_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    words_studied INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    total_time_seconds INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (plan_id) REFERENCES study_plans(id) ON DELETE CASCADE
);

-- 创建学习统计表
CREATE TABLE IF NOT EXISTS study_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL UNIQUE,
    words_learned INTEGER NOT NULL DEFAULT 0,
    words_reviewed INTEGER NOT NULL DEFAULT 0,
    total_study_time INTEGER NOT NULL DEFAULT 0,
    accuracy_rate REAL NOT NULL DEFAULT 0.0,
    streak_days INTEGER NOT NULL DEFAULT 0
);

-- 插入默认分类数据
INSERT OR IGNORE INTO categories (name, description, color, icon) VALUES
('基础词汇', '日常生活常用单词', '#4ECDC4', 'book'),
('动物世界', '各种动物的英文名称', '#FF9500', 'paw'),
('颜色大全', '常见颜色的英文表达', '#9C27B0', 'palette'),
('数字与时间', '数字和时间相关词汇', '#4CAF50', 'clock'),
('家庭用品', '家中常见物品名称', '#2196F3', 'home');

-- 插入默认单词本数据
INSERT OR IGNORE INTO word_books (title, description, icon, icon_color, total_words) VALUES
('基础英语词汇', '适合初学者的基础词汇集合', 'book', 'blue', 0),
('动物世界探索', '各种动物的英文名称学习', 'paw', 'green', 0),
('颜色认知训练', '常见颜色的英文表达', 'palette', 'purple', 0),
('数字时间概念', '数字和时间相关词汇学习', 'clock', 'orange', 0);

-- 插入示例单词数据
INSERT OR IGNORE INTO words (word, meaning, phonetic, ipa, syllables, phonics_segments, difficulty_level, category_id, word_book_id) 
SELECT 
    w.word, w.meaning, w.phonetic, w.ipa, w.syllables, w.phonics_segments, w.difficulty_level, c.id, wb.id
FROM (
    SELECT 'Apple' as word, '苹果' as meaning, '/ˈæpl/' as phonetic, '/ˈæpl/' as ipa, 'Ap-ple' as syllables, '["Ap", "ple"]' as phonics_segments, 1 as difficulty_level, '基础词汇' as category_name, '基础英语词汇' as book_name
    UNION ALL SELECT 'Water', '水', '/ˈwɔːtər/', '/ˈwɔːtər/', 'Wa-ter', '["Wa", "ter"]', 1, '基础词汇', '基础英语词汇'
    UNION ALL SELECT 'Book', '书', '/bʊk/', '/bʊk/', 'Book', '["B", "ook"]', 1, '基础词汇', '基础英语词汇'
    UNION ALL SELECT 'Cat', '猫', '/kæt/', '/kæt/', 'Cat', '["C", "at"]', 1, '动物世界', '动物世界探索'
    UNION ALL SELECT 'Dog', '狗', '/dɔːɡ/', '/dɔːɡ/', 'Dog', '["D", "og"]', 1, '动物世界', '动物世界探索'
    UNION ALL SELECT 'Elephant', '大象', '/ˈelɪfənt/', '/ˈelɪfənt/', 'El-e-phant', '["El", "e", "phant"]', 2, '动物世界', '动物世界探索'
    UNION ALL SELECT 'Red', '红色', '/red/', '/red/', 'Red', '["R", "ed"]', 1, '颜色大全', '颜色认知训练'
    UNION ALL SELECT 'Blue', '蓝色', '/bluː/', '/bluː/', 'Blue', '["Bl", "ue"]', 1, '颜色大全', '颜色认知训练'
    UNION ALL SELECT 'Green', '绿色', '/ɡriːn/', '/ɡriːn/', 'Green', '["Gr", "een"]', 1, '颜色大全', '颜色认知训练'
    UNION ALL SELECT 'One', '一', '/wʌn/', '/wʌn/', 'One', '["O", "ne"]', 1, '数字与时间', '数字时间概念'
    UNION ALL SELECT 'Two', '二', '/tuː/', '/tuː/', 'Two', '["T", "wo"]', 1, '数字与时间', '数字时间概念'
    UNION ALL SELECT 'Three', '三', '/θriː/', '/θriː/', 'Three', '["Th", "ree"]', 1, '数字与时间', '数字时间概念'
) w
JOIN categories c ON c.name = w.category_name
JOIN word_books wb ON wb.title = w.book_name;

-- 更新分类的单词数量
UPDATE categories SET word_count = (
    SELECT COUNT(*) FROM words WHERE words.category_id = categories.id
);

-- 更新单词本的单词数量
UPDATE word_books SET total_words = (
    SELECT COUNT(*) FROM words WHERE words.word_book_id = word_books.id
);
