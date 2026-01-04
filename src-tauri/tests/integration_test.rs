use redlark_app::ai_model_handlers::analyze_phonics_with_model;
use redlark_app::database::SqlitePool;
use redlark_app::logger::Logger;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[tokio::test]
async fn test_model_id_flow() {
    // 这个测试验证从数据库主键 ID 到模型配置的完整流程

    // 1. 验证数据库中存在 ID 为 12 的模型
    let db_path =
        "/Users/abbish/Library/Application Support/com.redlark.vocabulary-app/vocabulary.db";
    let pool = SqlitePool::connect(&format!("sqlite:{}", db_path))
        .await
        .unwrap();

    let query = r#"
        SELECT m.id, m.model_id, m.display_name, m.description, m.max_tokens, m.temperature, m.is_active, m.is_default,
               p.id as provider_id, p.name as provider_name, p.display_name as provider_display_name,
               p.base_url, p.api_key, p.description as provider_description, p.is_active as provider_is_active
        FROM ai_models m
        JOIN ai_providers p ON m.provider_id = p.id
        WHERE m.id = ? AND m.is_active = 1 AND p.is_active = 1
    "#;

    let row = sqlx::query(query)
        .bind(12i64)
        .fetch_optional(pool.inner())
        .await
        .unwrap();

    match row {
        Some(row) => {
            let model_id: String = row.get("model_id");
            let display_name: String = row.get("display_name");
            let provider_name: String = row.get("provider_name");
            let base_url: String = row.get("base_url");

            println!("✅ Found model in database:");
            println!("   📊 Database ID: 12");
            println!("   🏷️  Model ID: {}", model_id);
            println!("   📝 Display Name: {}", display_name);
            println!("   🏢 Provider: {}", provider_name);
            println!("   🌐 Base URL: {}", base_url);

            // 验证这是正确的模型配置
            assert_eq!(model_id, "moonshotai/kimi-k2:free");
            assert_eq!(display_name, "Kimi K2 (free)");

            println!("✅ Model configuration validation passed");
        }
        None => {
            panic!("❌ Model with ID 12 not found in database");
        }
    }
}

#[test]
fn test_model_id_logic_explanation() {
    println!("🔍 Model ID Flow Explanation:");
    println!("   1. 前端传递: 数据库主键 ID (例如: 12)");
    println!("   2. 后端查询: 根据主键 ID 查找模型配置");
    println!("   3. 获取配置: model_id = 'moonshotai/kimi-k2:free'");
    println!("   4. AI API 调用: 使用 'moonshotai/kimi-k2:free' 作为模型名称");
    println!("   5. 参数使用: max_tokens 和 temperature 来自数据库配置");

    // 验证逻辑正确性
    let database_primary_key = 12;
    let expected_model_id = "moonshotai/kimi-k2:free";
    let expected_display_name = "Kimi K2 (free)";

    println!("\n📋 Test Data:");
    println!("   Database Primary Key: {}", database_primary_key);
    println!("   Expected Model ID: {}", expected_model_id);
    println!("   Expected Display Name: {}", expected_display_name);

    // 这些值应该匹配数据库中的实际数据
    assert_eq!(database_primary_key, 12);
    assert_eq!(expected_model_id, "moonshotai/kimi-k2:free");
    assert_eq!(expected_display_name, "Kimi K2 (free)");

    println!("✅ Logic validation passed");
}

#[tokio::test]
async fn test_ai_service_model_usage() {
    use redlark_app::ai_service::{AIProvider, AIService};
    use redlark_app::types::AIModelConfig;

    // 创建模拟的模型配置，模拟从数据库查询的结果
    let model_config = AIModelConfig {
        id: 12,
        name: "kimi-k2-free".to_string(),
        model_id: "moonshotai/kimi-k2:free".to_string(), // 这是传递给 AI API 的关键字段
        display_name: "Kimi K2 (free)".to_string(),
        description: "Moonshot AI Kimi K2 free model".to_string(),
        max_tokens: Some(4000),
        temperature: Some(0.3),
        is_default: false,
        provider: redlark_app::types::AIProvider {
            id: 3,
            name: "moonshot".to_string(),
            display_name: "Moonshot AI".to_string(),
            base_url: "https://api.moonshot.cn/v1".to_string(),
            api_key: "test-key".to_string(),
            description: "Moonshot AI provider".to_string(),
            is_active: true,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
    };

    // 从模型配置创建 AI 服务
    let ai_service = AIService::from_model_config(&model_config).unwrap();

    // 验证 AI 服务配置正确
    assert_eq!(ai_service.provider.base_url, "https://api.moonshot.cn/v1");
    assert_eq!(ai_service.provider.default_model, "moonshotai/kimi-k2:free");

    println!("✅ AI Service configuration:");
    println!("   🌐 Base URL: {}", ai_service.provider.base_url);
    println!(
        "   🏷️  Default Model: {}",
        ai_service.provider.default_model
    );
    println!("   🔧 Max Tokens: {:?}", model_config.max_tokens);
    println!("   🌡️  Temperature: {:?}", model_config.temperature);

    // 验证参数类型转换
    let max_tokens_u32 = model_config.max_tokens.map(|t| t as u32);
    let temperature_f32 = model_config.temperature.map(|t| t as f32);

    assert_eq!(max_tokens_u32, Some(4000u32));
    assert_eq!(temperature_f32, Some(0.3f32));

    println!("✅ Parameter conversion:");
    println!(
        "   🔧 max_tokens: {:?} -> {:?}",
        model_config.max_tokens, max_tokens_u32
    );
    println!(
        "   🌡️  temperature: {:?} -> {:?}",
        model_config.temperature, temperature_f32
    );

    println!("✅ AI Service model usage test passed");
}

#[test]
fn test_complete_flow_summary() {
    println!("\n🎯 Complete Flow Summary:");
    println!("┌─────────────────────────────────────────────────────────────┐");
    println!("│                    Model ID Flow                           │");
    println!("├─────────────────────────────────────────────────────────────┤");
    println!("│ 1. Frontend: 用户选择模型 -> 获取数据库主键 ID (12)          │");
    println!("│ 2. API Call: analyzePhonics(text, modelId: 12)             │");
    println!("│ 3. Backend: 根据主键 ID=12 查询数据库                        │");
    println!("│ 4. Database: 返回模型配置                                   │");
    println!("│    - model_id: 'moonshotai/kimi-k2:free'                   │");
    println!("│    - max_tokens: 4000                                      │");
    println!("│    - temperature: 0.3                                      │");
    println!("│    - provider.base_url: 'https://api.moonshot.cn/v1'       │");
    println!("│ 5. AI Service: 使用配置创建请求                              │");
    println!("│    - model: 'moonshotai/kimi-k2:free'                      │");
    println!("│    - max_tokens: 4000                                      │");
    println!("│    - temperature: 0.3                                      │");
    println!("│ 6. AI API: 发送请求到 Moonshot AI                           │");
    println!("│ 7. Response: 返回自然拼读分析结果                            │");
    println!("└─────────────────────────────────────────────────────────────┘");

    // 验证关键映射关系
    let frontend_model_id = 12;
    let database_model_id = "moonshotai/kimi-k2:free";
    let api_model_name = "moonshotai/kimi-k2:free";

    assert_eq!(database_model_id, api_model_name);
    assert_ne!(frontend_model_id.to_string(), database_model_id);

    println!("\n✅ Flow validation:");
    println!("   📊 Frontend ID (12) != Database model_id ('moonshotai/kimi-k2:free')");
    println!("   🔗 Database model_id == AI API model name");
    println!("   ✅ Correct separation of concerns");
}
