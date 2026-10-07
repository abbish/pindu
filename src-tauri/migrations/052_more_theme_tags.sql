-- 052：补充内置主题标签（2026-10-07 用户要求“tag 需要补充”）
-- 原有 6 个：学习 商务 旅行 日常 科学 艺术。按名称去重（theme_tags.name 唯一），已存在的不动。
-- color 为旧字段，界面不再使用，统一写 primary。
INSERT OR IGNORE INTO theme_tags (name, icon, color, created_at) VALUES
('考试', '📝', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('课本', '📖', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('阅读', '📰', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('演讲', '🎤', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('工作', '💻', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('科技', '🤖', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('自然', '🌿', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('动物', '🐾', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('食物', '🍎', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('运动', '⚽', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('健康', '🩺', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('家庭', '👨‍👩‍👧', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('节日', '🎉', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('音乐', '🎵', 'primary', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
