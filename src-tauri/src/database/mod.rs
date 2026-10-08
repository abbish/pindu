use sqlx::migrate::Migrator;
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::path::Path;

/// 本版本内置的全部迁移（`src-tauri/migrations/`，编译进二进制）。启动时的升级流程见 `startup.rs`。
pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// 打开（不存在则创建）数据库文件：WAL、synchronous=Normal、外键开启（sqlx 默认）。
/// 用文件路径而不是 `sqlite:` URL 拼接，路径里有空格、`#`、`?` 或 Windows 反斜杠也能正确打开。
pub async fn connect(db_path: &Path) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);
    SqlitePool::connect_with(options).await
}

/// 把整个数据库（含 WAL 中已提交的内容）复制成一个独立的新文件；目标文件必须不存在
pub async fn vacuum_into(pool: &SqlitePool, target: &Path) -> Result<(), sqlx::Error> {
    sqlx::query("VACUUM INTO ?")
        .bind(target.to_string_lossy().to_string())
        .execute(pool)
        .await
        .map(|_| ())
}

/// 种子数据迁移的行为测试：迁移在 `memory_pool()` 中已执行一次；这里把库改回“迁移前 + 用户改动”的
/// 状态后再执行一次迁移脚本（脚本设计为可重复执行），断言只动种子原值、不覆盖用户选择。
#[cfg(test)]
mod seed_migration_tests {
    use crate::test_support::memory_pool;
    use sqlx::SqlitePool;

    const REFRESH_033: &str = include_str!("../../migrations/033_refresh_seed_ai_models.sql");
    const ADD_ARK_034: &str = include_str!("../../migrations/034_add_volcengine_ark_provider.sql");
    const PROVIDERS_036: &str = include_str!(
        "../../migrations/036_seed_providers_openrouter_minimax_moonshot_deepseek.sql"
    );

    async fn model(pool: &SqlitePool, name: &str) -> (bool, bool, i64) {
        sqlx::query_as("SELECT is_active, is_default, max_tokens FROM ai_models WHERE name = ?")
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap_or_else(|_| panic!("模型 {name} 不存在"))
    }

    async fn default_models(pool: &SqlitePool) -> Vec<String> {
        sqlx::query_scalar("SELECT name FROM ai_models WHERE is_default = 1")
            .fetch_all(pool)
            .await
            .unwrap()
    }

    async fn rerun_033(pool: &SqlitePool) {
        sqlx::raw_sql(REFRESH_033).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn fresh_install_gets_available_models_and_new_default() {
        let pool = memory_pool().await;

        assert_eq!(default_models(&pool).await, vec!["gemini-3.8-flash"]);
        for retired in ["kimi-k2-free", "deepseek-chat-v3-free", "deepseek-r1-free"] {
            assert!(!model(&pool, retired).await.0, "{retired} 应被停用");
        }
        assert_eq!(model(&pool, "gemini-2.5-pro").await, (true, false, 16000));
        assert_eq!(model(&pool, "kimi-k2-preview").await.2, 16000);
        let k3_temperature: f64 =
            sqlx::query_scalar("SELECT temperature FROM ai_models WHERE name = 'kimi-k3'")
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(k3_temperature, 1.0, "037：Kimi K3 只接受 temperature = 1");

        let providers: Vec<(String, String)> =
            sqlx::query_as("SELECT name, base_url FROM ai_providers ORDER BY name")
                .fetch_all(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(
            providers,
            vec![
                (
                    "deepseek".to_string(),
                    "https://api.deepseek.com".to_string()
                ),
                (
                    "minimax".to_string(),
                    "https://api.minimaxi.com/v1".to_string()
                ),
                (
                    "moonshot".to_string(),
                    "https://api.moonshot.cn/v1".to_string()
                ),
                (
                    "openrouter".to_string(),
                    "https://openrouter.ai/api/v1".to_string()
                ),
            ]
        );
    }

    #[tokio::test]
    async fn user_chosen_default_and_edited_models_are_kept() {
        let pool = memory_pool().await;
        // 用户：把默认设为 kimi-k2-preview；把下架的 kimi-k2-free 改成了可用的 model_id 并启用；调过 gemini 输出上限
        sqlx::raw_sql(
            "UPDATE ai_models SET is_default = 0;
             UPDATE ai_models SET is_default = 1 WHERE name = 'kimi-k2-preview';
             UPDATE ai_models SET model_id = 'moonshotai/kimi-k2', is_active = 1 WHERE name = 'kimi-k2-free';
             UPDATE ai_models SET max_tokens = 2097152 WHERE name = 'gemini-2.5-pro';",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();

        rerun_033(&pool).await;

        assert_eq!(default_models(&pool).await, vec!["kimi-k2-preview"]);
        assert!(
            model(&pool, "kimi-k2-free").await.0,
            "用户改过 model_id 的模型不应被停用"
        );
        // max_tokens 仍为种子原值才修正：这里与种子值相同，因此按规则修正
        assert_eq!(model(&pool, "gemini-2.5-pro").await.2, 16000);
    }

    #[tokio::test]
    async fn default_on_retired_model_moves_to_new_default() {
        let pool = memory_pool().await;
        sqlx::raw_sql(
            "UPDATE ai_models SET is_default = 0;
             UPDATE ai_models SET is_active = 1, is_default = 1 WHERE name = 'deepseek-r1-free';",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();

        rerun_033(&pool).await;

        assert!(!model(&pool, "deepseek-r1-free").await.0);
        assert_eq!(default_models(&pool).await, vec!["gemini-3.8-flash"]);
    }

    #[tokio::test]
    async fn refresh_is_idempotent() {
        let pool = memory_pool().await;
        let count = |p: SqlitePool| async move {
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM ai_models")
                .fetch_one(&p)
                .await
                .unwrap()
        };
        let before = count(pool.as_ref().clone()).await;
        rerun_033(&pool).await;
        assert_eq!(count(pool.as_ref().clone()).await, before);
        assert_eq!(default_models(&pool).await, vec!["gemini-3.8-flash"]);
    }

    async fn has_provider(pool: &SqlitePool, name: &str) -> bool {
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM ai_providers WHERE name = ?")
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap()
            == 1
    }

    #[tokio::test]
    async fn configured_ark_provider_is_kept_and_untouched_one_removed() {
        let pool = memory_pool().await;
        // 模拟升级前已有 034 的火山方舟：未配置 → 036 移除
        sqlx::raw_sql(ADD_ARK_034)
            .execute(pool.as_ref())
            .await
            .unwrap();
        sqlx::raw_sql(PROVIDERS_036)
            .execute(pool.as_ref())
            .await
            .unwrap();
        assert!(!has_provider(&pool, "volcengine_ark").await);

        // 用户填过 Key → 保留
        sqlx::raw_sql(ADD_ARK_034)
            .execute(pool.as_ref())
            .await
            .unwrap();
        sqlx::query(
            "UPDATE ai_providers SET api_key = 'ark-real-key' WHERE name = 'volcengine_ark'",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();
        sqlx::raw_sql(PROVIDERS_036)
            .execute(pool.as_ref())
            .await
            .unwrap();
        assert!(has_provider(&pool, "volcengine_ark").await);

        // 占位 Key 但已添加模型 → 保留
        sqlx::raw_sql(
            "UPDATE ai_providers SET api_key = 'PLEASE_SET_YOUR_API_KEY' WHERE name = 'volcengine_ark';
             INSERT INTO ai_models (provider_id, name, display_name, model_id)
             SELECT id, 'doubao', '豆包', 'doubao-seed' FROM ai_providers WHERE name = 'volcengine_ark';",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();
        sqlx::raw_sql(PROVIDERS_036)
            .execute(pool.as_ref())
            .await
            .unwrap();
        assert!(has_provider(&pool, "volcengine_ark").await);

        // 重复执行不重复插入
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM ai_providers WHERE name IN ('deepseek', 'minimax')",
        )
        .fetch_one(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn phonics_segments_are_backfilled_only_from_consistent_syllables() {
        let pool = memory_pool().await;
        sqlx::raw_sql(
            "INSERT INTO word_books (id, title, description) VALUES (900, '回填', '');
             INSERT INTO words (word, meaning, word_book_id, syllables, phonics_segments) VALUES
               ('elephant', '大象', 900, 'el-e-phant', NULL),
               ('Sunday', '星期日', 900, 'Sun-day', ''),
               ('baking', '烘烤', 900, 'ba-kin', NULL),
               ('cat', '猫', 900, 'cat', '[\"c\",\"at\"]'),
               ('dog', '狗', 900, NULL, NULL);",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/039_backfill_phonics_segments_from_syllables.sql"
        ))
        .execute(pool.as_ref())
        .await
        .unwrap();
        let rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT word, phonics_segments FROM words WHERE word_book_id = 900 ORDER BY id",
        )
        .fetch_all(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(
            rows,
            vec![
                ("elephant".into(), Some(r#"["el","e","phant"]"#.into())),
                ("Sunday".into(), Some(r#"["Sun","day"]"#.into())),
                ("baking".into(), None),
                ("cat".into(), Some(r#"["c","at"]"#.into())),
                ("dog".into(), None),
            ]
        );
    }

    #[tokio::test]
    async fn single_examples_move_into_word_examples() {
        let pool = memory_pool().await;
        sqlx::raw_sql(
            "INSERT INTO word_books (id, title, description) VALUES (901, '例句', '');
             INSERT INTO words (id, word, meaning, word_book_id, example_sentence, example_translation) VALUES
               (9001, 'cat', '猫', 901, ' The cat is sleeping. ', '猫在睡觉。'),
               (9002, 'dog', '狗', 901, 'The dog runs.', NULL),
               (9003, 'sun', '太阳', 901, '  ', '空'),
               (9004, 'red', '红色', 901, NULL, NULL);",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/041_create_word_examples.sql"
        ))
        .execute(pool.as_ref())
        .await
        .unwrap();
        let rows: Vec<(i64, String, String, i64)> = sqlx::query_as(
            "SELECT word_id, sentence, translation, sort_order FROM word_examples
             WHERE word_id BETWEEN 9001 AND 9004 ORDER BY word_id",
        )
        .fetch_all(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(
            rows,
            vec![
                (9001, "The cat is sleeping.".into(), "猫在睡觉。".into(), 0),
                (9002, "The dog runs.".into(), String::new(), 0),
            ]
        );
    }

    #[tokio::test]
    async fn practiced_schedules_are_backfilled_as_completed() {
        let pool = memory_pool().await;
        let fx = crate::test_support::seed_schedule(&pool, 2).await;
        let other = crate::test_support::seed_schedule(&pool, 1).await;
        crate::test_support::seed_session(&pool, &fx, "done", true).await;
        crate::test_support::seed_session(&pool, &other, "open", false).await;
        sqlx::query("UPDATE study_plan_schedules SET status = 'in-progress'")
            .execute(pool.as_ref())
            .await
            .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/045_backfill_schedule_practiced_status.sql"
        ))
        .execute(pool.as_ref())
        .await
        .unwrap();
        let status = |id: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, String>(
                    "SELECT status FROM study_plan_schedules WHERE id = ?",
                )
                .bind(id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap()
            }
        };
        assert_eq!(status(fx.schedule_id).await, "completed");
        assert_eq!(
            status(other.schedule_id).await,
            "in-progress",
            "未完成的会话不算练完"
        );
    }
}
