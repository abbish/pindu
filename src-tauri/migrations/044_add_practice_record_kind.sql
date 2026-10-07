-- 练习作答记录区分类型：learn（每步首次作答）/ retry（答错纠正后的重考）/ review（当轮小测）。
-- 成绩仍只取每步第一次 learn 作答；结果页据此显示“一次对 / 改正后对 / 未掌握”与小测结果。
-- 已有记录均为首次作答（默认 learn）。
ALTER TABLE word_practice_records ADD COLUMN kind TEXT NOT NULL DEFAULT 'learn';
