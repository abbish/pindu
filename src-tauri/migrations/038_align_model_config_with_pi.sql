-- 模型配置对齐 pi 的模型体系（docs/agent-harness/DESIGN.md §4、DECISIONS D04）。
-- 只加列（可空或带默认值），不重建表；回填仅针对地址仍为种子值的四个种子提供商。

-- 提供商：映射的 pi 内置 provider（为空 = 自定义端点）与自定义端点的接口类型
ALTER TABLE ai_providers ADD COLUMN pi_provider TEXT;
ALTER TABLE ai_providers ADD COLUMN api TEXT NOT NULL DEFAULT 'openai-completions';

-- 模型：思考档（off/minimal/low/medium/high/xhigh/max，空 = 任务默认）、额外采样参数（JSON 对象）、
-- 上下文窗口与是否推理模型（仅自定义模型需要）
ALTER TABLE ai_models ADD COLUMN thinking_level TEXT;
ALTER TABLE ai_models ADD COLUMN extra_params TEXT;
ALTER TABLE ai_models ADD COLUMN context_window INTEGER;
ALTER TABLE ai_models ADD COLUMN reasoning BOOLEAN;

UPDATE ai_providers SET pi_provider = 'openrouter'
WHERE name = 'openrouter' AND base_url = 'https://openrouter.ai/api/v1';

UPDATE ai_providers SET pi_provider = 'moonshotai-cn'
WHERE name = 'moonshot' AND base_url = 'https://api.moonshot.cn/v1';

UPDATE ai_providers SET pi_provider = 'deepseek'
WHERE name = 'deepseek' AND base_url IN ('https://api.deepseek.com', 'https://api.deepseek.com/v1');

UPDATE ai_providers SET pi_provider = 'minimax-cn'
WHERE name = 'minimax' AND base_url = 'https://api.minimaxi.com/v1';

UPDATE ai_providers SET pi_provider = 'minimax'
WHERE name = 'minimax' AND base_url = 'https://api.minimax.io/v1';
