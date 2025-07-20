-- 添加学习计时器记录表
-- 用于记录每个日程的学习时间，支持暂停/继续功能

-- 学习计时器记录表
CREATE TABLE IF NOT EXISTS study_timer_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,                    -- 学习计划ID
    schedule_id INTEGER NOT NULL,                -- 日程ID
    session_id TEXT NOT NULL,                    -- 学习会话ID（用于区分不同的学习会话）
    start_time DATETIME NOT NULL,                -- 开始时间
    end_time DATETIME,                           -- 结束时间（NULL表示正在进行中）
    duration_seconds INTEGER DEFAULT 0,          -- 持续时间（秒）
    is_paused BOOLEAN DEFAULT FALSE,             -- 是否暂停
    pause_start_time DATETIME,                   -- 暂停开始时间
    total_pause_duration INTEGER DEFAULT 0,      -- 总暂停时间（秒）
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (plan_id) REFERENCES study_plans(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES study_plan_schedules(id) ON DELETE CASCADE
);

-- 学习会话暂停记录表（详细记录每次暂停）
CREATE TABLE IF NOT EXISTS study_pause_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timer_record_id INTEGER NOT NULL,            -- 计时器记录ID
    pause_start_time DATETIME NOT NULL,          -- 暂停开始时间
    pause_end_time DATETIME,                     -- 暂停结束时间（NULL表示仍在暂停中）
    pause_duration INTEGER DEFAULT 0,            -- 暂停持续时间（秒）
    pause_reason TEXT,                           -- 暂停原因（可选）
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (timer_record_id) REFERENCES study_timer_records(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_study_timer_records_plan_id ON study_timer_records(plan_id);
CREATE INDEX IF NOT EXISTS idx_study_timer_records_schedule_id ON study_timer_records(schedule_id);
CREATE INDEX IF NOT EXISTS idx_study_timer_records_session_id ON study_timer_records(session_id);
CREATE INDEX IF NOT EXISTS idx_study_timer_records_status ON study_timer_records(status);
CREATE INDEX IF NOT EXISTS idx_study_timer_records_start_time ON study_timer_records(start_time);

CREATE INDEX IF NOT EXISTS idx_study_pause_records_timer_id ON study_pause_records(timer_record_id);
CREATE INDEX IF NOT EXISTS idx_study_pause_records_pause_start ON study_pause_records(pause_start_time);
