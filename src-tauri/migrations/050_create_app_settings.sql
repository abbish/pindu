-- 应用设置（键值）：目前用于 AI 助手（pi agent）的按任务模型与批量分析参数。
-- 值为文本；缺省时由代码给默认值（见 services/agent_settings.rs）。
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
