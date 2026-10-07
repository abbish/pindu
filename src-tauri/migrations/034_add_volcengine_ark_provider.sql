-- 新增「火山方舟」AI 提供商（OpenAI 兼容接口），与豆包语音合成共用火山引擎账号。
-- 不预置模型：方舟的模型 / 接入点 ID 因账号而异，由用户在设置页「同步模型」或手动添加。
INSERT OR IGNORE INTO ai_providers (name, display_name, base_url, api_key, description)
VALUES ('volcengine_ark', '火山方舟', 'https://ark.cn-beijing.volces.com/api/v3', 'PLEASE_SET_YOUR_API_KEY', '火山引擎方舟大模型服务（豆包等），OpenAI 兼容接口');
