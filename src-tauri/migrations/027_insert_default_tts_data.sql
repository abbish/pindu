-- 插入默认ElevenLabs提供商配置
INSERT OR IGNORE INTO tts_providers (name, display_name, base_url, api_key, description) 
VALUES ('elevenlabs', 'ElevenLabs', 'https://api.elevenlabs.io', 'PLEASE_SET_YOUR_API_KEY', 'ElevenLabs Text-to-Speech服务');

-- 插入默认语音配置
INSERT OR IGNORE INTO tts_voices (provider_id, voice_id, voice_name, display_name, language, model_id, is_default) 
VALUES (
    (SELECT id FROM tts_providers WHERE name = 'elevenlabs'),
    'JBFqnCBsd6RMkjVDRZzb', 
    'George', 
    'George (英式男声)', 
    'en', 
    'eleven_multilingual_v2', 
    1
);

-- 插入更多常用语音选项
INSERT OR IGNORE INTO tts_voices (provider_id, voice_id, voice_name, display_name, language, gender, model_id, is_default) 
VALUES 
(
    (SELECT id FROM tts_providers WHERE name = 'elevenlabs'),
    'EXAVITQu4vr4xnSDxMaL',
    'Bella',
    'Bella (美式女声)',
    'en',
    'female',
    'eleven_multilingual_v2',
    0
),
(
    (SELECT id FROM tts_providers WHERE name = 'elevenlabs'),
    'ErXwobaYiN019PkySvjV',
    'Antoni',
    'Antoni (美式男声)',
    'en',
    'male',
    'eleven_multilingual_v2',
    0
),
(
    (SELECT id FROM tts_providers WHERE name = 'elevenlabs'),
    'VR6AewLTigWG4xSOukaG',
    'Arnold',
    'Arnold (美式男声)',
    'en',
    'male',
    'eleven_multilingual_v2',
    0
);
