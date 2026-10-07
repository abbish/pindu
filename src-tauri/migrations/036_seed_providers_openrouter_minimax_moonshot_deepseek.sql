-- 初始化的 AI 提供商收敛为四个：OpenRouter、MiniMax、月之暗面（Moonshot）、DeepSeek。
-- 四者都提供 OpenAI 兼容的 GET {base_url}/models，可在设置页「同步模型」读取列表后勾选添加，因此不预置模型。
-- 034 加入的「火山方舟」仅在用户从未配置过（仍为占位 Key 且没有模型）时移除；用户配置过的保留。可重复执行。

INSERT OR IGNORE INTO ai_providers (name, display_name, base_url, api_key, description)
VALUES ('deepseek', 'DeepSeek', 'https://api.deepseek.com', 'PLEASE_SET_YOUR_API_KEY', 'DeepSeek 官方 API（OpenAI 兼容）');

INSERT OR IGNORE INTO ai_providers (name, display_name, base_url, api_key, description)
VALUES ('minimax', 'MiniMax', 'https://api.minimaxi.com/v1', 'PLEASE_SET_YOUR_API_KEY', 'MiniMax 官方 API（OpenAI 兼容，中国大陆站点；海外账号请把地址改为 https://api.minimax.io/v1）');

DELETE FROM ai_providers
WHERE name = 'volcengine_ark'
  AND api_key = 'PLEASE_SET_YOUR_API_KEY'
  AND NOT EXISTS (SELECT 1 FROM ai_models WHERE ai_models.provider_id = ai_providers.id);
