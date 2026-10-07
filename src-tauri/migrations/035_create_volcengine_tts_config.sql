-- 语音合成改为火山引擎豆包语音（V3 HTTP 单向流式）。单行配置表（id = 1）。
-- 鉴权二选一：新控制台 API Key（api_key），或旧控制台 AppID + Access Token（app_id + access_key）。
-- resource_id 为空表示按音色自动推断（*_uranus_bigtts → seed-tts-2.0 等）。
-- elevenlabs_config 保留为遗留表，不再读写（不删除用户数据）。
CREATE TABLE IF NOT EXISTS volcengine_tts_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    api_key TEXT NOT NULL DEFAULT '',
    app_id TEXT NOT NULL DEFAULT '',
    access_key TEXT NOT NULL DEFAULT '',
    resource_id TEXT NOT NULL DEFAULT '',
    default_voice_id TEXT NOT NULL DEFAULT 'en_male_tim_uranus_bigtts',
    speech_rate INTEGER NOT NULL DEFAULT 0,
    sample_rate INTEGER NOT NULL DEFAULT 24000,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO volcengine_tts_config (id) VALUES (1);
