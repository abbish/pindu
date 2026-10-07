-- 刷新种子 AI 模型：003 插入的 OpenRouter 免费模型已下架（2026-10 实测 /api/v1/models 不再返回）。
-- 原则：只改仍保持种子原值的行；用户自己改过的模型、自己选的默认模型不覆盖。可重复执行。

-- 1. 新增当前可用的模型（用户删掉了 openrouter 提供商则不插入）
INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'gemini-3.8-flash', 'Google Gemini 3.8 Flash', 'google/gemini-3.8-flash', 'Google Gemini 3.8 Flash，速度快、成本低，适合批量拼读分析', 16000, 0.01, 0 FROM ai_providers WHERE name = 'openrouter';

INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'deepseek/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash，性价比高', 16000, 0.01, 0 FROM ai_providers WHERE name = 'openrouter';

INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'kimi-k3', 'Kimi K3', 'moonshotai/kimi-k3', '月之暗面 Kimi K3 旗舰模型', 16000, 0.01, 0 FROM ai_providers WHERE name = 'openrouter';

INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'qwen3.8-flash', 'Qwen 3.8 Flash', 'qwen/qwen3.8-flash', '通义千问 3.8 Flash，低成本', 16000, 0.01, 0 FROM ai_providers WHERE name = 'openrouter';

INSERT OR IGNORE INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_default)
SELECT id, 'seed-2.1-turbo', '豆包 Seed 2.1 Turbo', 'bytedance-seed/seed-2-1-turbo', '字节跳动豆包 Seed 2.1 Turbo', 16000, 0.01, 0 FROM ai_providers WHERE name = 'openrouter';

-- 2. 停用已下架的免费模型（model_id 仍为种子原值才动）
UPDATE ai_models
SET is_active = 0, is_default = 0, updated_at = CURRENT_TIMESTAMP
WHERE model_id IN ('moonshotai/kimi-k2:free', 'deepseek/deepseek-chat-v3-0324:free', 'deepseek/deepseek-r1-0528:free')
  AND provider_id IN (SELECT id FROM ai_providers WHERE name = 'openrouter');

-- 3. 默认模型：当前默认已不可用，或仍是种子默认 gemini-2.5-pro 时，切到 gemini-3.8-flash；用户自选的默认保留
UPDATE ai_models
SET is_default = 0, updated_at = CURRENT_TIMESTAMP
WHERE is_default = 1
  AND (is_active = 0 OR (name = 'gemini-2.5-pro' AND model_id = 'google/gemini-2.5-pro'));

UPDATE ai_models
SET is_default = 1, updated_at = CURRENT_TIMESTAMP
WHERE name = 'gemini-3.8-flash'
  AND provider_id IN (SELECT id FROM ai_providers WHERE name = 'openrouter')
  AND NOT EXISTS (SELECT 1 FROM ai_models WHERE is_default = 1);

-- 4. 003 把上下文长度误填为 max_tokens（代码里它是输出上限），仅修正仍为种子原值的行
UPDATE ai_models SET max_tokens = 16000, updated_at = CURRENT_TIMESTAMP
WHERE model_id = 'google/gemini-2.5-pro' AND max_tokens = 2097152;

UPDATE ai_models SET max_tokens = 16000, updated_at = CURRENT_TIMESTAMP
WHERE model_id = 'kimi-k2-0711-preview' AND max_tokens = 200000;
