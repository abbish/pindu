//! 测试支撑：内存 SQLite（含全部迁移）、测试日志器、最小种子数据。
//!
//! 规范：`.claude/skills/deliver-backend-rust/references/rust-test-standard.md`
//! - 内存库必须单连接：SQLite `:memory:` 每个连接是独立数据库。
//! - 单连接还意味着：事务持有连接期间再用 pool 查询会等待超时——这正好让测试
//!   暴露“事务内混用 pool”的违规（见 transaction-and-repository-conventions.md）。

use crate::logger::Logger;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Duration;

/// 打开单连接内存库并执行全部迁移。
pub async fn memory_pool() -> Arc<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .min_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .acquire_timeout(Duration::from_secs(3))
        .connect("sqlite::memory:")
        .await
        .expect("打开内存 SQLite 失败");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("执行迁移失败");
    Arc::new(pool)
}

/// 写入系统临时目录的日志器，不触碰用户日志。
pub fn test_logger() -> Arc<Logger> {
    let dir = std::env::temp_dir().join(format!("redlark-test-{}", uuid::Uuid::new_v4()));
    Arc::new(Logger::new(&dir).expect("创建测试日志器失败"))
}

/// 一个学习计划下的单日日程及其单词。
pub struct ScheduleFixture {
    pub plan_id: i64,
    pub schedule_id: i64,
    /// 与 `schedule_word_ids` 一一对应
    pub word_ids: Vec<i64>,
    pub schedule_word_ids: Vec<i64>,
}

/// 种子：单词本 + `word_count` 个单词 + 计划 + 一天的日程（total_words_count = word_count）。
pub async fn seed_schedule(pool: &SqlitePool, word_count: usize) -> ScheduleFixture {
    let book_id =
        sqlx::query("INSERT INTO word_books (title, description, created_at, last_used, updated_at) VALUES ('测试单词本', '', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
            .execute(pool)
            .await
            .expect("seed word_books")
            .last_insert_rowid();

    let plan_id = sqlx::query(
        "INSERT INTO study_plans (name, status, unified_status, created_at, updated_at) VALUES ('测试计划', 'normal', 'Active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .execute(pool)
    .await
    .expect("seed study_plans")
    .last_insert_rowid();

    let schedule_id = sqlx::query(
        "INSERT INTO study_plan_schedules (plan_id, day_number, schedule_date, total_words_count, created_at, updated_at) VALUES (?, 1, '2026-10-06', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(plan_id)
    .bind(word_count as i64)
    .execute(pool)
    .await
    .expect("seed study_plan_schedules")
    .last_insert_rowid();

    let mut word_ids = Vec::with_capacity(word_count);
    let mut schedule_word_ids = Vec::with_capacity(word_count);
    for i in 0..word_count {
        let word_id =
            sqlx::query("INSERT INTO words (word, meaning, word_book_id, created_at, updated_at) VALUES (?, '含义', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
                .bind(format!("word{}", i + 1))
                .bind(book_id)
                .execute(pool)
                .await
                .expect("seed words")
                .last_insert_rowid();
        let schedule_word_id = sqlx::query(
            "INSERT INTO study_plan_schedule_words (schedule_id, word_id, wordbook_id, created_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(schedule_id)
        .bind(word_id)
        .bind(book_id)
        .execute(pool)
        .await
        .expect("seed study_plan_schedule_words")
        .last_insert_rowid();
        word_ids.push(word_id);
        schedule_word_ids.push(schedule_word_id);
    }

    ScheduleFixture {
        plan_id,
        schedule_id,
        word_ids,
        schedule_word_ids,
    }
}

/// 种子：一个练习会话。
pub async fn seed_session(
    pool: &SqlitePool,
    fx: &ScheduleFixture,
    session_id: &str,
    completed: bool,
) {
    sqlx::query(
        "INSERT INTO practice_sessions (id, plan_id, schedule_id, schedule_date, start_time, completed, created_at, updated_at) VALUES (?, ?, ?, '2026-10-06', '2026-10-06T08:00:00.000Z', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(session_id)
    .bind(fx.plan_id)
    .bind(fx.schedule_id)
    .bind(completed)
    .execute(pool)
    .await
    .expect("seed practice_sessions");
}

/// 种子：一条单词步骤作答记录。`created_at` 决定“首次作答”的顺序（任意可解析格式，写入时归一为规范格式）。
pub async fn seed_step(
    pool: &SqlitePool,
    session_id: &str,
    word_id: i64,
    plan_word_id: i64,
    step: i32,
    is_correct: bool,
    created_at: &str,
) {
    sqlx::query(
        "INSERT INTO word_practice_records (session_id, word_id, plan_word_id, step, user_input, is_correct, time_spent, attempts, created_at) VALUES (?, ?, ?, ?, '', ?, 1000, 1, ?)",
    )
    .bind(session_id)
    .bind(word_id)
    .bind(plan_word_id)
    .bind(step)
    .bind(is_correct)
    .bind(
        crate::time::parse_instant(created_at)
            .map(crate::time::format_instant)
            .expect("seed_step: created_at 不是可解析的时刻"),
    )
    .execute(pool)
    .await
    .expect("seed word_practice_records");
}

/// 种子：某单词在会话中三步首次作答全部正确。
pub async fn seed_passed_word(
    pool: &SqlitePool,
    session_id: &str,
    word_id: i64,
    plan_word_id: i64,
    day: &str,
) {
    for step in 1..=3 {
        seed_step(
            pool,
            session_id,
            word_id,
            plan_word_id,
            step,
            true,
            &format!("{}T10:00:0{}+00:00", day, step),
        )
        .await;
    }
}
