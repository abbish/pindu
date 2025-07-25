-- 清理第一版多提供商TTS架构的遗留表和数据
-- 现在只使用ElevenLabs专用的elevenlabs_config表

-- 删除旧的多提供商架构表
DROP TABLE IF EXISTS tts_voices;
DROP TABLE IF EXISTS tts_providers;

-- 删除相关索引（如果存在）
DROP INDEX IF EXISTS idx_tts_voices_provider_id;
DROP INDEX IF EXISTS idx_tts_voices_is_default;

-- 保留tts_cache表，但简化其结构，移除provider相关字段
-- 注意：这里不删除tts_cache表，因为缓存功能仍然有用
-- 只是将来会直接使用voice_id而不是通过provider_id关联

-- 更新elevenlabs_config表，确保有默认的语音配置
-- 添加一些常用的语音选项到配置中（作为JSON或者单独字段）

-- 如果elevenlabs_config表中没有默认语音ID，设置一个
UPDATE elevenlabs_config 
SET default_voice_id = '21m00Tcm4TlvDq8ikWAM'  -- Rachel (美式女声)
WHERE id = 1 AND (default_voice_id IS NULL OR default_voice_id = '' OR default_voice_id = 'JBFqnCBsd6RMkjVDRZzb');
