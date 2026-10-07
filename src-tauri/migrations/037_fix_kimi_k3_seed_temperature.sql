-- Kimi K3 只接受 temperature = 1（其它值返回 invalid_request_error: only 1 is allowed for this model）。
-- 033 预置的 kimi-k3 误填 0.01；仅修正仍为种子原值的行。
UPDATE ai_models
SET temperature = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE model_id = 'moonshotai/kimi-k3' AND name = 'kimi-k3' AND temperature = 0.01;
