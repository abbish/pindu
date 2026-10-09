-- 一个视频多个切分规划（test-feedback-20261009，DECISIONS D39）
-- video_plans：同一个原始视频可以按不同主题 / 意图各规划一批片段；plan 是规划草稿 JSON（requirements、segments），
--   原来存在 videos.plan 的草稿迁成「规划 1」，videos.plan 不再使用（置空）。
-- video_clips.plan_id：短片是从哪个规划切出来的（删除规划时置空，短片作为素材保留）。
-- videos.plan_suggestions：「AI 规划」的要求建议（读字幕生成，属于视频而不是某个规划），从原草稿里的 suggestions 迁来。

CREATE TABLE video_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_video_plans_video ON video_plans(video_id, id);

INSERT INTO video_plans (video_id, name, plan, created_at, updated_at)
SELECT id, '规划 1', plan, updated_at, updated_at
FROM videos
WHERE plan IS NOT NULL AND json_valid(plan);

ALTER TABLE video_clips ADD COLUMN plan_id INTEGER REFERENCES video_plans(id) ON DELETE SET NULL;

UPDATE video_clips
SET plan_id = (SELECT vp.id FROM video_plans vp WHERE vp.video_id = video_clips.video_id ORDER BY vp.id LIMIT 1);

ALTER TABLE videos ADD COLUMN plan_suggestions TEXT;

UPDATE videos
SET plan_suggestions = json_extract(plan, '$.suggestions')
WHERE plan IS NOT NULL AND json_valid(plan) AND json_type(plan, '$.suggestions') = 'array';

UPDATE videos SET plan = NULL;
