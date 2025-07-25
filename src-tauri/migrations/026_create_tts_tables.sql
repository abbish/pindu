-- 创建TTS服务提供商表
CREATE TABLE IF NOT EXISTS tts_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,           -- 'elevenlabs'
    display_name TEXT NOT NULL,          -- 'ElevenLabs'
    base_url TEXT NOT NULL,              -- 'https://api.elevenlabs.io'
    api_key TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 创建TTS语音模型配置表
CREATE TABLE IF NOT EXISTS tts_voices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    voice_id TEXT NOT NULL,              -- ElevenLabs的voice_id
    voice_name TEXT NOT NULL,            -- 语音名称
    display_name TEXT NOT NULL,          -- 显示名称
    language TEXT NOT NULL DEFAULT 'en', -- 语言代码
    gender TEXT,                         -- 'male', 'female'
    description TEXT,
    model_id TEXT DEFAULT 'eleven_multilingual_v2',
    is_active BOOLEAN NOT NULL DEFAULT 1,
    is_default BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (provider_id) REFERENCES tts_providers (id) ON DELETE CASCADE
);

-- 创建语音缓存表
CREATE TABLE IF NOT EXISTS tts_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text_hash TEXT NOT NULL UNIQUE,      -- 文本的SHA256哈希
    original_text TEXT NOT NULL,         -- 原始文本
    voice_id TEXT NOT NULL,              -- 使用的语音ID
    model_id TEXT NOT NULL,              -- 使用的模型ID
    file_path TEXT NOT NULL,             -- 音频文件路径
    file_size INTEGER NOT NULL,          -- 文件大小（字节）
    duration_ms INTEGER,                 -- 音频时长（毫秒）
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    use_count INTEGER NOT NULL DEFAULT 1
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_tts_voices_provider_id ON tts_voices(provider_id);
CREATE INDEX IF NOT EXISTS idx_tts_voices_is_default ON tts_voices(is_default);
CREATE INDEX IF NOT EXISTS idx_tts_cache_text_hash ON tts_cache(text_hash);
CREATE INDEX IF NOT EXISTS idx_tts_cache_last_used ON tts_cache(last_used);
