-- 更新TTS语音配置，使用ElevenLabs官方推荐的免费语音
-- 参考: https://elevenlabs.io/docs/voices/premade-voices

-- 首先清理现有的语音配置
DELETE FROM tts_voices WHERE provider_id = (SELECT id FROM tts_providers WHERE name = 'elevenlabs');

-- 插入官方推荐的免费预训练语音
INSERT INTO tts_voices (provider_id, voice_id, voice_name, display_name, language, gender, model_id, is_default) 
VALUES 
-- Rachel - 美式女声 (官方推荐)
(
    (SELECT id FROM tts_providers WHERE name = 'elevenlabs'),
    '21m00Tcm4TlvDq8ikWAM',
    'Rachel',
    'Rachel (美式女声)',
    'en',
    'female',
    'eleven_multilingual_v2',
    1
),
-- Drew - 美式男声 (官方推荐)
(
    (SELECT id FROM tts_providers WHERE name = 'elevenlabs'),
    '29vD33N1CtxCmqQRPOHJ',
    'Drew',
    'Drew (美式男声)',
    'en',
    'male',
    'eleven_multilingual_v2',
    0
),
-- Clyde - 美式男声 (官方推荐)
(
    (SELECT id FROM tts_providers WHERE name = 'elevenlabs'),
    '2EiwWnXFnvU5JabPnv8n',
    'Clyde',
    'Clyde (美式男声)',
    'en',
    'male',
    'eleven_multilingual_v2',
    0
),
-- Bella - 美式女声 (官方推荐)
(
    (SELECT id FROM tts_providers WHERE name = 'elevenlabs'),
    'EXAVITQu4vr4xnSDxMaL',
    'Bella',
    'Bella (美式女声)',
    'en',
    'female',
    'eleven_multilingual_v2',
    0
);
