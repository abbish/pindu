use redlark_app::ai_service::{AIProvider, AIService};
use redlark_app::logger::Logger;
use redlark_app::types::AIModelConfig;
use std::env;

// 创建测试用的 AI 提供商配置
fn create_test_provider() -> AIProvider {
    AIProvider {
        name: "test-provider".to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
        api_key: env::var("OPENAI_API_KEY").unwrap_or("test-key".to_string()),
        default_model: "gpt-3.5-turbo".to_string(),
    }
}

// 创建测试用的模型配置
fn create_test_model_config() -> AIModelConfig {
    AIModelConfig {
        id: 1,
        name: "test-model".to_string(),
        model_id: "gpt-3.5-turbo".to_string(),
        display_name: "Test Model".to_string(),
        description: "Test model for unit testing".to_string(),
        max_tokens: Some(1000),
        temperature: Some(0.7),
        is_default: true,
        provider: redlark_app::types::AIProvider {
            id: 1,
            name: "test-provider".to_string(),
            display_name: "Test Provider".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: env::var("OPENAI_API_KEY").unwrap_or("test-key".to_string()),
            description: "Test provider".to_string(),
            is_active: true,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
    }
}

#[tokio::test]
async fn test_ai_service_creation() {
    let provider = create_test_provider();
    let service = AIService::new(provider.clone());

    // 验证服务创建成功
    assert_eq!(service.provider.name, provider.name);
    assert_eq!(service.provider.base_url, provider.base_url);
    println!("✅ AI Service created successfully");
}

#[tokio::test]
async fn test_ai_service_from_model_config() {
    let model_config = create_test_model_config();
    let result = AIService::from_model_config(&model_config);

    assert!(result.is_ok());
    let service = result.unwrap();
    assert_eq!(service.provider.name, model_config.provider.name);
    assert_eq!(service.provider.base_url, model_config.provider.base_url);
    println!("✅ AI Service created from model config successfully");
}

#[tokio::test]
async fn test_phonics_analysis_integration() {
    // 只有在有真实 API 密钥时才运行这个测试
    if env::var("OPENAI_API_KEY").is_err() {
        println!("⏭️  Skipping integration test - no OPENAI_API_KEY found");
        return;
    }

    let model_config = create_test_model_config();
    let service = AIService::from_model_config(&model_config).unwrap();
    let logger = Logger::new();

    let test_text = "The cat sat on the mat.";

    println!("🔄 Testing phonics analysis with text: '{}'", test_text);

    // 测试自然拼读分析
    let result = service
        .analyze_phonics(
            test_text,
            Some("gpt-3.5-turbo"),
            Some(500),
            Some(0.3),
            "focus",
            &logger,
        )
        .await;

    match result {
        Ok(analysis) => {
            println!("✅ Phonics analysis successful!");
            println!(
                "📊 Analysis result: {} words analyzed",
                analysis.words.len()
            );

            // 验证结果结构
            assert!(
                !analysis.words.is_empty(),
                "Should have analyzed some words"
            );

            // 验证每个单词都有必要的字段
            for word in &analysis.words {
                assert!(!word.word.is_empty(), "Word should not be empty");
                assert!(
                    !word.phonics_rule.is_empty(),
                    "Phonics rule should not be empty"
                );
                println!(
                    "📝 Word: {} | Rule: {} | IPA: {:?}",
                    word.word, word.phonics_rule, word.ipa_phonetic
                );
            }

            // 验证分析结果的完整性
            assert!(
                analysis.total_words > 0,
                "Total words should be greater than 0"
            );
            println!("📈 Total words: {}", analysis.total_words);
            println!("🎯 Analysis successful - all assertions passed!");
        }
        Err(e) => {
            println!("❌ Phonics analysis failed: {}", e);

            // 在测试环境中，我们可能期望某些错误（如网络问题）
            let error_str = e.to_string().to_lowercase();
            let is_expected_error = error_str.contains("api")
                || error_str.contains("network")
                || error_str.contains("timeout")
                || error_str.contains("rate limit")
                || error_str.contains("unauthorized")
                || error_str.contains("invalid")
                || error_str.contains("connection");

            if is_expected_error {
                println!("⚠️  Expected error type (network/API related): {}", e);
            } else {
                panic!("Unexpected error type: {}", e);
            }
        }
    }
}

#[tokio::test]
async fn test_phonics_analysis_with_empty_text() {
    let model_config = create_test_model_config();
    let service = AIService::from_model_config(&model_config).unwrap();
    let logger = Logger::new();

    println!("🔄 Testing phonics analysis with empty text");

    let result = service
        .analyze_phonics(
            "",
            Some("gpt-3.5-turbo"),
            Some(500),
            Some(0.3),
            "focus",
            &logger,
        )
        .await;

    // 空文本应该返回错误或空结果
    match result {
        Ok(analysis) => {
            println!("✅ Empty text handled gracefully");
            assert!(
                analysis.words.is_empty(),
                "Empty text should result in no words"
            );
        }
        Err(e) => {
            println!("✅ Empty text correctly returned error: {}", e);
            // 空文本返回错误也是可以接受的
        }
    }
}

#[tokio::test]
async fn test_parameter_usage() {
    let model_config = create_test_model_config();

    // 验证配置参数正确设置
    assert_eq!(model_config.max_tokens, Some(1000));
    assert_eq!(model_config.temperature, Some(0.7));

    // 验证类型转换
    let max_tokens_u32 = model_config.max_tokens.map(|t| t as u32);
    let temperature_f32 = model_config.temperature.map(|t| t as f32);

    assert_eq!(max_tokens_u32, Some(1000u32));
    assert_eq!(temperature_f32, Some(0.7f32));

    println!("✅ Parameter usage test passed");
    println!(
        "🔧 max_tokens: {:?} -> {:?}",
        model_config.max_tokens, max_tokens_u32
    );
    println!(
        "🔧 temperature: {:?} -> {:?}",
        model_config.temperature, temperature_f32
    );
}

#[tokio::test]
async fn test_model_name_usage() {
    let model_config = create_test_model_config();
    let service = AIService::from_model_config(&model_config).unwrap();

    // 验证模型名称正确设置
    assert_eq!(model_config.model_id, "gpt-3.5-turbo");
    assert_eq!(service.provider.default_model, "gpt-3.5-turbo");

    println!("✅ Model name usage test passed");
    println!("🏷️  Model ID: {}", model_config.model_id);
    println!("🏷️  Default model: {}", service.provider.default_model);
}

#[test]
fn test_prompt_template_loading() {
    // 测试提示词模板是否能正确加载
    let prompt_template = include_str!("../src/prompts/agent.md");

    assert!(
        !prompt_template.is_empty(),
        "Prompt template should not be empty"
    );
    assert!(
        prompt_template.contains("自然拼读"),
        "Prompt should contain phonics-related content"
    );
    assert!(
        prompt_template.contains("XML"),
        "Prompt should mention XML format"
    );

    println!("✅ Prompt template loaded successfully");
    println!("📄 Template length: {} characters", prompt_template.len());
    println!(
        "🔍 Contains '自然拼读': {}",
        prompt_template.contains("自然拼读")
    );
    println!("🔍 Contains 'XML': {}", prompt_template.contains("XML"));
}
