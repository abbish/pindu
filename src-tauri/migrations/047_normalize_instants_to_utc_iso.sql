-- 047：时刻统一为 UTC 规范格式 YYYY-MM-DDTHH:MM:SS.sssZ（定长毫秒 + Z）
-- 规范：.claude/skills/deliver-contract-and-data/references/time-and-timezone.md
--
-- 历史上有两种 UTC 写法：SQLite 默认的 'YYYY-MM-DD HH:MM:SS'（无时区标记）与 Rust to_rfc3339()
-- （纳秒 + '+00:00'）。两者都按 UTC 解释，strftime 转换是同一时刻的等值改写（julianday 不变），
-- 不改表结构、不改 DEFAULT、不重建表、不删数据；无法解析的值与 NULL 原样保留。
-- 列 DEFAULT 仍是旧格式：业务写入一律显式绑定 time::now_utc() / SQL 规范表达式（T2）。

-- 1. 先删掉 study_plans 的 updated_at 触发器（否则下面改 study_plans 时会把 updated_at 覆盖成旧格式的“现在”）
DROP TRIGGER IF EXISTS update_study_plans_updated_at;

-- 2. word_books.updated_at 没有 DEFAULT，新建的单词本为 NULL：用创建时间补齐
UPDATE word_books SET updated_at = created_at WHERE updated_at IS NULL AND created_at IS NOT NULL;

-- 3. 归一全部时刻列

UPDATE ai_models SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE ai_models SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);
UPDATE ai_providers SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE ai_providers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);
UPDATE categories SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE elevenlabs_config SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE elevenlabs_config SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);
UPDATE practice_pause_records SET pause_start = strftime('%Y-%m-%dT%H:%M:%fZ', pause_start)
 WHERE typeof(pause_start) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', pause_start) IS NOT NULL AND pause_start <> strftime('%Y-%m-%dT%H:%M:%fZ', pause_start);
UPDATE practice_pause_records SET pause_end = strftime('%Y-%m-%dT%H:%M:%fZ', pause_end)
 WHERE typeof(pause_end) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', pause_end) IS NOT NULL AND pause_end <> strftime('%Y-%m-%dT%H:%M:%fZ', pause_end);
UPDATE practice_pause_records SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE practice_sessions SET start_time = strftime('%Y-%m-%dT%H:%M:%fZ', start_time)
 WHERE typeof(start_time) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', start_time) IS NOT NULL AND start_time <> strftime('%Y-%m-%dT%H:%M:%fZ', start_time);
UPDATE practice_sessions SET end_time = strftime('%Y-%m-%dT%H:%M:%fZ', end_time)
 WHERE typeof(end_time) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', end_time) IS NOT NULL AND end_time <> strftime('%Y-%m-%dT%H:%M:%fZ', end_time);
UPDATE practice_sessions SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE practice_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);
UPDATE study_pause_records SET pause_start_time = strftime('%Y-%m-%dT%H:%M:%fZ', pause_start_time)
 WHERE typeof(pause_start_time) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', pause_start_time) IS NOT NULL AND pause_start_time <> strftime('%Y-%m-%dT%H:%M:%fZ', pause_start_time);
UPDATE study_pause_records SET pause_end_time = strftime('%Y-%m-%dT%H:%M:%fZ', pause_end_time)
 WHERE typeof(pause_end_time) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', pause_end_time) IS NOT NULL AND pause_end_time <> strftime('%Y-%m-%dT%H:%M:%fZ', pause_end_time);
UPDATE study_pause_records SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE study_plan_schedule_words SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE study_plan_schedules SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE study_plan_schedules SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);
UPDATE study_plan_status_history SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE study_plans SET actual_start_date = strftime('%Y-%m-%dT%H:%M:%fZ', actual_start_date)
 WHERE typeof(actual_start_date) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', actual_start_date) IS NOT NULL AND actual_start_date <> strftime('%Y-%m-%dT%H:%M:%fZ', actual_start_date);
UPDATE study_plans SET actual_end_date = strftime('%Y-%m-%dT%H:%M:%fZ', actual_end_date)
 WHERE typeof(actual_end_date) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', actual_end_date) IS NOT NULL AND actual_end_date <> strftime('%Y-%m-%dT%H:%M:%fZ', actual_end_date);
UPDATE study_plans SET actual_terminated_date = strftime('%Y-%m-%dT%H:%M:%fZ', actual_terminated_date)
 WHERE typeof(actual_terminated_date) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', actual_terminated_date) IS NOT NULL AND actual_terminated_date <> strftime('%Y-%m-%dT%H:%M:%fZ', actual_terminated_date);
UPDATE study_plans SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at)
 WHERE typeof(deleted_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS NOT NULL AND deleted_at <> strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at);
UPDATE study_plans SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE study_plans SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);
UPDATE study_sessions SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', started_at)
 WHERE typeof(started_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', started_at) IS NOT NULL AND started_at <> strftime('%Y-%m-%dT%H:%M:%fZ', started_at);
UPDATE study_sessions SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', finished_at)
 WHERE typeof(finished_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', finished_at) IS NOT NULL AND finished_at <> strftime('%Y-%m-%dT%H:%M:%fZ', finished_at);
UPDATE study_timer_records SET start_time = strftime('%Y-%m-%dT%H:%M:%fZ', start_time)
 WHERE typeof(start_time) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', start_time) IS NOT NULL AND start_time <> strftime('%Y-%m-%dT%H:%M:%fZ', start_time);
UPDATE study_timer_records SET end_time = strftime('%Y-%m-%dT%H:%M:%fZ', end_time)
 WHERE typeof(end_time) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', end_time) IS NOT NULL AND end_time <> strftime('%Y-%m-%dT%H:%M:%fZ', end_time);
UPDATE study_timer_records SET pause_start_time = strftime('%Y-%m-%dT%H:%M:%fZ', pause_start_time)
 WHERE typeof(pause_start_time) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', pause_start_time) IS NOT NULL AND pause_start_time <> strftime('%Y-%m-%dT%H:%M:%fZ', pause_start_time);
UPDATE study_timer_records SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE study_timer_records SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);
UPDATE theme_tags SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE tts_cache SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE tts_cache SET last_used = strftime('%Y-%m-%dT%H:%M:%fZ', last_used)
 WHERE typeof(last_used) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', last_used) IS NOT NULL AND last_used <> strftime('%Y-%m-%dT%H:%M:%fZ', last_used);
UPDATE volcengine_tts_config SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE volcengine_tts_config SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);
UPDATE word_book_theme_tags SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE word_books SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE word_books SET last_used = strftime('%Y-%m-%dT%H:%M:%fZ', last_used)
 WHERE typeof(last_used) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', last_used) IS NOT NULL AND last_used <> strftime('%Y-%m-%dT%H:%M:%fZ', last_used);
UPDATE word_books SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at)
 WHERE typeof(deleted_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS NOT NULL AND deleted_at <> strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at);
UPDATE word_books SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);
UPDATE word_examples SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE word_explanations SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE word_explanations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);
UPDATE word_practice_records SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE words SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
 WHERE typeof(created_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);
UPDATE words SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE typeof(updated_at) = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);

-- 4. 重建触发器：只在语句本身没有改 updated_at 时补写，格式为规范格式
CREATE TRIGGER update_study_plans_updated_at
    AFTER UPDATE ON study_plans
    FOR EACH ROW
    WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE study_plans SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
