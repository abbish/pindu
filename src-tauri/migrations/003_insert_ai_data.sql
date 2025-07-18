-- 插入默认的AI提供商
INSERT OR IGNORE INTO ai_providers (name, display_name, base_url, api_key, description) VALUES
('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'PLEASE_SET_YOUR_API_KEY', 'OpenRouter多模型聚合服务'),
('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', 'PLEASE_SET_YOUR_API_KEY', 'DeepSeek AI服务'),
('moonshot', '月之暗面', 'https://api.moonshot.cn/v1', 'PLEASE_SET_YOUR_API_KEY', '月之暗面 Kimi AI服务');

-- 插入默认的AI模型

-- OpenRouter 模型
INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'gemini-2.5-pro', 'Google Gemini 2.5 Pro', 'google/gemini-2.5-pro', 'Google最新的Gemini 2.5 Pro模型', 2097152, 0.01, 0 FROM ai_providers WHERE name = 'openrouter';

INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'kimi-k2-free', 'Kimi K2 (免费)', 'moonshotai/kimi-k2:free', '月之暗面Kimi K2免费版本', 200000, 0.01, 0 FROM ai_providers WHERE name = 'openrouter';

INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'deepseek-chat-v3-free', 'DeepSeek Chat V3 (免费)', 'deepseek/deepseek-chat-v3-0324:free', 'DeepSeek Chat V3免费版本', 64000, 0.01, 0 FROM ai_providers WHERE name = 'openrouter';

INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'deepseek-r1-free', 'DeepSeek R1 (免费)', 'deepseek/deepseek-r1-0528:free', 'DeepSeek R1推理模型免费版本', 64000, 0.01, 0 FROM ai_providers WHERE name = 'openrouter';

-- DeepSeek 官方模型
INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'deepseek-chat', 'DeepSeek Chat', 'deepseek-chat', 'DeepSeek官方对话模型', 64000, 0.01, 1 FROM ai_providers WHERE name = 'deepseek';

INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'deepseek-reasoner', 'DeepSeek Reasoner', 'deepseek-reasoner', 'DeepSeek官方推理模型', 64000, 0.01, 0 FROM ai_providers WHERE name = 'deepseek';

-- 月之暗面官方模型
INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'kimi-k2-preview', 'Kimi K2 Preview', 'kimi-k2-0711-preview', '月之暗面Kimi K2预览版本', 200000, 0.01, 0 FROM ai_providers WHERE name = 'moonshot';
