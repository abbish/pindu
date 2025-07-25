-- 创建ElevenLabs配置表
CREATE TABLE IF NOT EXISTS elevenlabs_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key TEXT NOT NULL DEFAULT 'PLEASE_SET_YOUR_API_KEY',
    model_id TEXT NOT NULL DEFAULT 'eleven_multilingual_v2',
    voice_stability REAL NOT NULL DEFAULT 0.75,
    voice_similarity REAL NOT NULL DEFAULT 0.75,
    voice_style REAL DEFAULT 0.0,
    voice_boost BOOLEAN NOT NULL DEFAULT 1,
    optimize_streaming_latency INTEGER DEFAULT 0,
    output_format TEXT NOT NULL DEFAULT 'mp3_44100_128',
    default_voice_id TEXT DEFAULT 'JBFqnCBsd6RMkjVDRZzb',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认配置
INSERT OR IGNORE INTO elevenlabs_config (id) VALUES (1);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_elevenlabs_config_updated_at ON elevenlabs_config(updated_at);
