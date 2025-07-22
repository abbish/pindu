-- 创建单词练习会话表
CREATE TABLE IF NOT EXISTS practice_sessions (
    id TEXT PRIMARY KEY,                    -- UUID格式的会话ID
    plan_id INTEGER NOT NULL,               -- 关联的学习计划ID
    schedule_id INTEGER NOT NULL,           -- 关联的日程ID
    schedule_date TEXT NOT NULL,            -- 日程日期 YYYY-MM-DD
    start_time TEXT NOT NULL,               -- 开始时间 ISO 8601
    end_time TEXT,                          -- 结束时间 ISO 8601
    total_time INTEGER DEFAULT 0,           -- 总时间（包含暂停，毫秒）
    active_time INTEGER DEFAULT 0,          -- 实际练习时间（毫秒）
    pause_count INTEGER DEFAULT 0,          -- 暂停次数
    completed BOOLEAN DEFAULT FALSE,        -- 是否完成
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (plan_id) REFERENCES study_plans (id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES study_plan_schedules (id) ON DELETE CASCADE
);

-- 创建单词练习记录表
CREATE TABLE IF NOT EXISTS word_practice_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,               -- 关联的练习会话ID
    word_id INTEGER NOT NULL,               -- 单词ID
    plan_word_id INTEGER NOT NULL,          -- study_plan_schedule_words 表的 ID
    step INTEGER NOT NULL,                  -- 练习步骤 1, 2, 3
    user_input TEXT NOT NULL,               -- 用户输入
    is_correct BOOLEAN NOT NULL,            -- 是否正确
    time_spent INTEGER NOT NULL,            -- 用时（毫秒）
    attempts INTEGER DEFAULT 1,             -- 尝试次数
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES practice_sessions (id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words (id) ON DELETE CASCADE,
    FOREIGN KEY (plan_word_id) REFERENCES study_plan_schedule_words (id) ON DELETE CASCADE
);

-- 创建练习暂停记录表
CREATE TABLE IF NOT EXISTS practice_pause_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,               -- 关联的练习会话ID
    pause_start TEXT NOT NULL,              -- 暂停开始时间 ISO 8601
    pause_end TEXT,                         -- 暂停结束时间 ISO 8601
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES practice_sessions (id) ON DELETE CASCADE
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_practice_sessions_plan_id ON practice_sessions(plan_id);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_schedule_id ON practice_sessions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_schedule_date ON practice_sessions(schedule_date);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_completed ON practice_sessions(completed);

CREATE INDEX IF NOT EXISTS idx_word_practice_records_session_id ON word_practice_records(session_id);
CREATE INDEX IF NOT EXISTS idx_word_practice_records_word_id ON word_practice_records(word_id);
CREATE INDEX IF NOT EXISTS idx_word_practice_records_plan_word_id ON word_practice_records(plan_word_id);
CREATE INDEX IF NOT EXISTS idx_word_practice_records_step ON word_practice_records(step);

CREATE INDEX IF NOT EXISTS idx_practice_pause_records_session_id ON practice_pause_records(session_id);
