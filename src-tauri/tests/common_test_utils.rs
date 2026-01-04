// 测试工具模块
use sqlx::{Row, SqlitePool};
use std::path::PathBuf;

/// 创建内存测试数据库
pub async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePool::connect(":memory:")
        .await
        .expect("Failed to create test database");

    // 运行迁移
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations");

    pool
}

/// 清理测试数据库
pub async fn teardown_test_db(pool: &SqlitePool) {
    pool.close().await;
}

/// 插入测试数据 - AI 提供商
pub async fn insert_test_ai_provider(pool: &SqlitePool) -> i64 {
    let query = r#"
        INSERT INTO ai_providers (name, display_name, base_url, api_key, description, is_active)
        VALUES ('test_provider', 'Test Provider', 'https://api.test.com', 'test_key_12345', 'Test provider for testing', 1)
    "#;

    sqlx::query(query)
        .execute(pool)
        .await
        .expect("Failed to insert test AI provider");

    // 获取插入的 ID
    let row = sqlx::query("SELECT last_insert_rowid() as id")
        .fetch_one(pool)
        .await
        .expect("Failed to get last insert ID");

    row.get("id")
}

/// 插入测试数据 - AI 模型
pub async fn insert_test_ai_model(pool: &SqlitePool, provider_id: i64) -> i64 {
    let query = r#"
        INSERT INTO ai_models (provider_id, name, display_name, model_id, description, max_tokens, temperature, is_active, is_default)
        VALUES (?, 'test_model', 'Test Model', 'gpt-test', 'Test model for testing', 2000, 0.7, 1, 1)
    "#;

    sqlx::query(query)
        .bind(provider_id)
        .execute(pool)
        .await
        .expect("Failed to insert test AI model");

    let row = sqlx::query("SELECT last_insert_rowid() as id")
        .fetch_one(pool)
        .await
        .expect("Failed to get last insert ID");

    row.get("id")
}

/// 插入测试数据 - 单词本
pub async fn insert_test_word_book(pool: &SqlitePool) -> i64 {
    let query = r#"
        INSERT INTO word_books (title, description, icon, icon_color, total_words, linked_plans, status)
        VALUES ('Test Book', 'Test Description', '📚', '#FF5733', 0, 0, 'normal')
    "#;

    sqlx::query(query)
        .execute(pool)
        .await
        .expect("Failed to insert test word book");

    let row = sqlx::query("SELECT last_insert_rowid() as id")
        .fetch_one(pool)
        .await
        .expect("Failed to get last insert ID");

    row.get("id")
}

/// 清理所有测试数据
pub async fn cleanup_test_data(pool: &SqlitePool) {
    let tables = vec![
        "word_practice_records",
        "practice_sessions",
        "study_plan_schedule_words",
        "study_plan_schedules",
        "study_plan_words",
        "study_plans",
        "words",
        "word_book_theme_tags",
        "theme_tags",
        "word_books",
        "ai_models",
        "ai_providers",
    ];

    for table in tables {
        sqlx::query(&format!("DELETE FROM {}", table))
            .execute(pool)
            .await
            .ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_setup_test_db() {
        let pool = setup_test_db().await;
        assert!(pool.size() > 0);
        teardown_test_db(&pool).await;
    }

    #[tokio::test]
    async fn test_insert_test_ai_provider() {
        let pool = setup_test_db().await;
        let id = insert_test_ai_provider(&pool).await;
        assert!(id > 0);

        // 验证数据已插入
        let row = sqlx::query("SELECT * FROM ai_providers WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(row.get::<String, _>("display_name"), "Test Provider");

        teardown_test_db(&pool).await;
    }

    #[tokio::test]
    async fn test_insert_test_word_book() {
        let pool = setup_test_db().await;
        let id = insert_test_word_book(&pool).await;
        assert!(id > 0);

        // 验证数据已插入
        let row = sqlx::query("SELECT * FROM word_books WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(row.get::<String, _>("title"), "Test Book");

        teardown_test_db(&pool).await;
    }
}
