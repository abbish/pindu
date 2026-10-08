-- 视频库（video-library，DECISIONS D34）
-- videos：导入的视频。文件放在 <数据目录>/videos/<id>/，这里只存文件名。
--   source_file 原视频（删除原视频释放空间后为 NULL）；media_file 编辑器播放用的文件（原视频浏览器能直接播放时等于 source_file，否则是转出来的 proxy.mp4）。
--   cues：带时间的字幕 JSON [{startMs, endMs, en, zh}]；plan：切分规划草稿 JSON（编辑器自动保存）。
--   status：importing 导入中 / ready 可以规划和编辑 / processing 切分处理中 / done 短片已生成 / failed 导入或处理失败（error 是原因）。
-- video_clips：切出来的短片，每段对应一篇短文（passages），文件在 videos/<id>/clips/。删除视频或短文时连带删除。

CREATE TABLE videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_file TEXT,
    media_file TEXT,
    subtitle_name TEXT,
    cues TEXT NOT NULL DEFAULT '[]',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    plan TEXT,
    status TEXT NOT NULL DEFAULT 'importing'
        CHECK (status IN ('importing', 'ready', 'processing', 'done', 'failed')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE video_clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    passage_id INTEGER NOT NULL UNIQUE REFERENCES passages(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    file TEXT NOT NULL,
    poster_file TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_video_clips_video ON video_clips(video_id, seq);
