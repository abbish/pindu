//! AI 模型业务逻辑服务
//!
//! 封装 AI 模型相关的业务逻辑

use crate::agent::catalog::{provider_models, CatalogModel, CatalogProvider};
use crate::agent::AgentPaths;
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::ai_model_repository::AIModelRepository;
use crate::types::ai_model::{
    AIModelConfig, AIModelConfigSafe, AIModelQuery, AIModelUpdate, AIProviderSafe,
    AIProviderUpdate, ModelGenerationSettings, NewAIModel, NewAIProvider, RemoteModelInfo,
    TestAIModelResult,
};
use crate::types::common::Id;
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

/// AI 模型服务
///
/// 负责 AI 模型的业务逻辑处理
pub struct AIModelService {
    repository: AIModelRepository,
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl AIModelService {
    /// 创建新的服务实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: AIModelRepository::new(pool.clone(), logger.clone()),
            pool,
            logger,
        }
    }

    /// 获取 AI 模型配置（根据 ID 或默认模型）
    pub async fn get_model_config(&self, model_id: Option<Id>) -> AppResult<AIModelConfig> {
        let model_config = if let Some(id) = model_id {
            self.repository
                .find_model_config_by_id(id)
                .await?
                .ok_or_else(|| {
                    AppError::ValidationError(format!(
                        "AI model with id {} not found or inactive",
                        id
                    ))
                })?
        } else {
            self.repository
                .find_default_model_config()
                .await?
                .ok_or_else(|| {
                    AppError::ValidationError(
                        "还没有设置默认 AI 模型，请到「设置 → AI 模型」添加模型并设为默认"
                            .to_string(),
                    )
                })?
        };

        // 检查 API Key 是否有效
        if !model_config.provider.has_api_key() {
            return Err(AppError::ValidationError(format!(
                "AI模型 '{}' 的API Key未配置。请前往设置页面配置有效的API Key。",
                model_config.display_name
            )));
        }

        Ok(model_config)
    }

    // ==================== 提供商 ====================

    /// 提供商列表（脱敏）；`include_inactive` 为 true 时包含禁用的
    pub async fn get_providers(&self, include_inactive: bool) -> AppResult<Vec<AIProviderSafe>> {
        let providers = self.repository.find_providers(include_inactive).await?;
        Ok(providers.into_iter().map(AIProviderSafe::from).collect())
    }

    /// 新建提供商
    pub async fn create_provider(&self, provider: NewAIProvider) -> AppResult<Id> {
        if provider.name.trim().is_empty() {
            return Err(AppError::ValidationError("请填写提供商标识".to_string()));
        }
        if provider.display_name.trim().is_empty() {
            return Err(AppError::ValidationError("请填写提供商名称".to_string()));
        }
        validate_provider_api(Some(&provider.api), provider.pi_provider.as_deref())?;
        self.repository.insert_provider(&provider).await
    }

    /// 部分更新提供商
    pub async fn update_provider(
        &self,
        provider_id: Id,
        update: AIProviderUpdate,
    ) -> AppResult<()> {
        let has_updates = update.display_name.is_some()
            || update.base_url.is_some()
            || update.api_key.is_some()
            || update.description.is_some()
            || update.is_active.is_some()
            || update.pi_provider.is_some()
            || update.api.is_some();
        if !has_updates {
            return Err(AppError::ValidationError("没有要保存的修改".to_string()));
        }
        validate_provider_api(update.api.as_deref(), update.pi_provider.as_deref())?;
        if self
            .repository
            .update_provider(provider_id, &update)
            .await?
            == 0
        {
            return Err(AppError::NotFound(
                "找不到这个 AI 提供商，它可能已被删除".to_string(),
            ));
        }
        Ok(())
    }

    /// 删除提供商及其全部模型（同一事务）
    pub async fn delete_provider(&self, provider_id: Id) -> AppResult<()> {
        let mut tx = self.pool.begin().await?;
        let deleted_models = self
            .repository
            .delete_models_by_provider(&mut tx, provider_id)
            .await?;
        if self
            .repository
            .delete_provider(&mut tx, provider_id)
            .await?
            == 0
        {
            return Err(AppError::NotFound(
                "找不到这个 AI 提供商，它可能已被删除".to_string(),
            ));
        }
        tx.commit().await?;

        if deleted_models > 0 {
            self.logger.database_operation(
                "DELETE",
                "ai_models",
                true,
                Some(&format!(
                    "Deleted {} associated models for provider: {}",
                    deleted_models, provider_id
                )),
            );
        }
        Ok(())
    }

    // ==================== 模型 ====================

    /// 全部模型（含禁用的，用于设置页，脱敏）
    pub async fn get_all_models(
        &self,
        query: Option<AIModelQuery>,
    ) -> AppResult<Vec<AIModelConfigSafe>> {
        let models = self.repository.find_models(query.as_ref(), true).await?;
        Ok(models.into_iter().map(AIModelConfigSafe::from).collect())
    }

    /// 设为默认模型：同一事务内清除其它默认标记
    pub async fn set_default_model(&self, model_id: Id) -> AppResult<()> {
        let mut tx = self.pool.begin().await?;
        self.repository.clear_default_flags(&mut tx).await?;
        if self.repository.set_default_flag(&mut tx, model_id).await? == 0 {
            return Err(AppError::NotFound(
                "找不到这个模型，它可能已被删除".to_string(),
            ));
        }
        tx.commit().await?;
        Ok(())
    }

    /// 新建模型（提供商必须存在且启用）
    pub async fn create_model(&self, model: NewAIModel) -> AppResult<Id> {
        if model.name.trim().is_empty() {
            return Err(AppError::ValidationError("请填写模型标识".to_string()));
        }
        if model.display_name.trim().is_empty() {
            return Err(AppError::ValidationError("请填写模型显示名称".to_string()));
        }
        if model.model_id.trim().is_empty() {
            return Err(AppError::ValidationError("请填写模型 ID".to_string()));
        }
        validate_generation(&model.generation)?;
        if !self
            .repository
            .is_provider_active(model.provider_id)
            .await?
        {
            return Err(AppError::ValidationError(
                "这个 AI 提供商不存在或已停用".to_string(),
            ));
        }
        self.repository.insert_model(&model).await
    }

    /// 部分更新模型
    pub async fn update_model(&self, model_id: Id, update: AIModelUpdate) -> AppResult<()> {
        let has_updates = update.display_name.is_some()
            || update.model_id.is_some()
            || update.description.is_some()
            || update.is_active.is_some()
            || update.is_default.is_some()
            || update.generation.is_some();
        if !has_updates {
            return Err(AppError::ValidationError("没有要保存的修改".to_string()));
        }
        if let Some(generation) = &update.generation {
            validate_generation(generation)?;
        }
        if self.repository.update_model(model_id, &update).await? == 0 {
            return Err(AppError::NotFound(
                "找不到这个模型，它可能已被删除".to_string(),
            ));
        }
        Ok(())
    }

    /// 删除模型
    pub async fn delete_model(&self, model_id: Id) -> AppResult<()> {
        if self.repository.delete_model(model_id).await? == 0 {
            return Err(AppError::NotFound(
                "找不到这个模型，它可能已被删除".to_string(),
            ));
        }
        Ok(())
    }

    // ==================== AI 调用 ====================

    /// 向指定模型发送一条简单对话，验证连通性
    pub async fn test_model(
        &self,
        model_id: Id,
        test_text: Option<String>,
        paths: &AgentPaths,
    ) -> AppResult<TestAIModelResult> {
        let text_to_test = test_text.unwrap_or_else(|| "Hello".to_string());
        let model_config = self
            .repository
            .find_model_config_by_id(model_id)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "所选模型（{}）不存在或已停用，请到「设置 → AI 模型」检查",
                    model_id
                ))
            })?;
        let (reply, stats) =
            crate::agent::tasks::test_model(paths, &model_config, &text_to_test, &self.logger)
                .await?;
        self.logger.info(
            "TEST_AI_MODEL",
            &format!(
                "model {} ({}) ok, tokens={} cost={}",
                model_config.id, model_config.model_id, stats["tokens"]["total"], stats["cost"]
            ),
        );
        Ok(TestAIModelResult {
            success: true,
            message: reply,
        })
    }
    /// 可添加的模型列表：映射了 pi 内置 provider 时以 pi 目录为主（含上下文 / 思考档 / 价格），
    /// 再合并提供商 `{base_url}/models`（OpenAI 兼容）；远端读取失败时只返回目录。未映射时只读远端。
    pub async fn list_remote_models(
        &self,
        provider_id: Id,
        catalog: Option<&[CatalogProvider]>,
    ) -> AppResult<Vec<RemoteModelInfo>> {
        let provider = self
            .repository
            .find_provider_by_id(provider_id)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!("找不到 AI 提供商 {}，它可能已被删除", provider_id))
            })?;

        let existing: HashSet<String> = self
            .repository
            .find_models(
                Some(&AIModelQuery {
                    provider_id: Some(provider_id),
                    is_active: None,
                    is_default: None,
                }),
                true,
            )
            .await?
            .into_iter()
            .map(|m| m.model_id)
            .collect();

        let remote = self.fetch_remote_models(&provider, &existing).await;
        let catalog_models = match (catalog, provider.pi_provider.as_deref()) {
            (Some(catalog), Some(pi)) => provider_models(catalog, pi),
            _ => &[],
        };
        match Some(catalog_models).filter(|c| !c.is_empty()) {
            Some(catalog) => {
                let remote = remote.unwrap_or_else(|e| {
                    self.logger.info(
                        "AI_MODELS",
                        &format!("远端模型列表不可用，仅使用 pi 目录：{}", e),
                    );
                    Vec::new()
                });
                Ok(merge_catalog_models(catalog, remote, &existing))
            }
            None => remote,
        }
    }

    /// 读取提供商 `{base_url}/models`；有真实 Key 时带 `Authorization: Bearer`
    async fn fetch_remote_models(
        &self,
        provider: &crate::types::ai_model::AIProvider,
        existing: &HashSet<String>,
    ) -> AppResult<Vec<RemoteModelInfo>> {
        let url = format!("{}/models", provider.base_url.trim_end_matches('/'));
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| AppError::InternalError(format!("无法创建网络请求：{}", e)))?;
        let mut request = client.get(&url);
        if provider.has_api_key() {
            request = request.bearer_auth(&provider.api_key);
        }
        let response = request
            .send()
            .await
            .map_err(|e| AppError::ExternalServiceError(format!("请求 {} 失败: {}", url, e)))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| AppError::ExternalServiceError(format!("读取模型列表失败: {}", e)))?;
        if !status.is_success() {
            let snippet: String = body.chars().take(200).collect();
            let advice = match (status.as_u16(), provider.has_api_key()) {
                (401 | 403, false) => "该提供商需要 API Key：请先点「编辑提供商」填写后再同步",
                (401 | 403, true) => "API Key 无效或无权限：请检查「编辑提供商」中的密钥",
                (404, _) => "该地址不支持列出模型：请确认 API 地址，或手动添加模型",
                _ => "可稍后重试，或手动添加模型",
            };
            return Err(AppError::ExternalServiceError(format!(
                "读取模型列表失败（HTTP {}）。{}。服务端返回：{}",
                status.as_u16(),
                advice,
                snippet
            )));
        }

        let models = parse_remote_models(&body, existing)?;
        self.logger.info(
            "AI_MODELS",
            &format!("Listed {} remote models from {}", models.len(), url),
        );
        Ok(models)
    }
}

/// 生成参数校验（不填 = 不发送，使用 pi 目录或服务端默认）：
/// 输出上限 1–2,000,000、温度 0–2、思考档为 pi 支持的档位、额外参数为 JSON 对象、上下文窗口为正数。
fn validate_generation(g: &ModelGenerationSettings) -> AppResult<()> {
    let invalid = |msg: &str| Err(AppError::ValidationError(msg.to_string()));
    if g.max_tokens.is_some_and(|v| !(1..=2_000_000).contains(&v)) {
        return invalid("最大输出 token 需在 1–2000000 之间，或留空使用默认");
    }
    if g.temperature.is_some_and(|v| !(0.0..=2.0).contains(&v)) {
        return invalid("温度需在 0–2 之间，或留空使用服务端默认");
    }
    if let Some(level) = &g.thinking_level {
        if !crate::agent::config::THINKING_LEVELS.contains(&level.as_str()) {
            return invalid(
                "思考档需为 off / minimal / low / medium / high / xhigh / max，或留空使用任务默认",
            );
        }
    }
    if g.extra_params.as_ref().is_some_and(|v| !v.is_object()) {
        return invalid("额外参数需为 JSON 对象，例如 {\"top_p\": 0.95}");
    }
    if g.context_window.is_some_and(|v| v <= 0) {
        return invalid("上下文窗口需为正数，或留空");
    }
    Ok(())
}

/// 自定义端点接口类型与 pi 内置 provider id 的格式校验（id 本身由设置页从 pi 目录中选择）
const PROVIDER_APIS: [&str; 3] = [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
];

fn validate_provider_api(api: Option<&str>, pi_provider: Option<&str>) -> AppResult<()> {
    if let Some(api) = api {
        if !PROVIDER_APIS.contains(&api) {
            return Err(AppError::ValidationError(format!(
                "接口类型需为 {} 之一",
                PROVIDER_APIS.join(" / ")
            )));
        }
    }
    if let Some(id) = pi_provider.map(str::trim).filter(|s| !s.is_empty()) {
        if !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(AppError::ValidationError(format!(
                "pi 提供商 ID 格式不正确：{}",
                id
            )));
        }
    }
    Ok(())
}

/// 合并 pi 目录与远端列表：目录模型带完整能力信息；远端独有的模型追加（`in_catalog = false`），按 id 排序
fn merge_catalog_models(
    catalog: &[CatalogModel],
    remote: Vec<RemoteModelInfo>,
    existing: &HashSet<String>,
) -> Vec<RemoteModelInfo> {
    let mut merged: Vec<RemoteModelInfo> = catalog
        .iter()
        .map(|m| RemoteModelInfo {
            id: m.id.clone(),
            name: Some(m.name.clone()),
            context_length: Some(m.context_window),
            already_added: existing.contains(&m.id),
            in_catalog: true,
            thinking_levels: m.thinking_levels.clone(),
            reasoning: Some(m.reasoning),
            cost_input: Some(m.cost_input),
            cost_output: Some(m.cost_output),
        })
        .collect();
    let known: HashSet<String> = merged.iter().map(|m| m.id.clone()).collect();
    merged.extend(remote.into_iter().filter(|m| !known.contains(&m.id)));
    merged.sort_by(|a, b| a.id.cmp(&b.id));
    merged
}

/// 解析 OpenAI 兼容 `/models` 响应：`{"data":[{"id", "name"?, "context_length"?}]}`；
/// 也接受 `{"models":[...]}`、顶层数组，以及用 `model` 字段表示 ID 的条目。
/// 结果按 id 排序、去重，`already_added` 依据本地同提供商下的 model_id。
fn parse_remote_models(body: &str, existing: &HashSet<String>) -> AppResult<Vec<RemoteModelInfo>> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| AppError::ExternalServiceError(format!("模型列表不是有效 JSON: {}", e)))?;
    // OpenAI 规范为 {"data":[...]}；兼容个别厂商的 {"models":[...]} 或顶层数组
    let items = value
        .get("data")
        .and_then(|d| d.as_array())
        .or_else(|| value.get("models").and_then(|d| d.as_array()))
        .or_else(|| value.as_array())
        .ok_or_else(|| AppError::ExternalServiceError("模型列表缺少 data 数组".to_string()))?;

    let mut models: Vec<RemoteModelInfo> = items
        .iter()
        .filter_map(|item| {
            let id = item
                .get("id")
                .or_else(|| item.get("model"))?
                .as_str()?
                .trim();
            if id.is_empty() {
                return None;
            }
            Some(RemoteModelInfo {
                id: id.to_string(),
                name: item
                    .get("name")
                    .and_then(|n| n.as_str())
                    .map(str::to_string),
                context_length: item.get("context_length").and_then(|c| c.as_i64()),
                already_added: existing.contains(id),
                ..Default::default()
            })
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, test_logger};

    const SECRET: &str = "sk-test-secret-value-1234567890";

    async fn setup() -> (AIModelService, Arc<SqlitePool>, Id) {
        let pool = memory_pool().await;
        let service = AIModelService::new(pool.clone(), test_logger());
        let provider_id = service
            .create_provider(NewAIProvider {
                name: "test-provider".to_string(),
                display_name: "Test Provider".to_string(),
                base_url: "https://example.invalid/v1".to_string(),
                api_key: SECRET.to_string(),
                description: None,
                pi_provider: None,
                api: "openai-completions".to_string(),
            })
            .await
            .unwrap();
        (service, pool, provider_id)
    }

    fn new_model(provider_id: Id, name: &str) -> NewAIModel {
        NewAIModel {
            provider_id,
            name: name.to_string(),
            display_name: name.to_string(),
            model_id: format!("{}-id", name),
            description: None,
            generation: ModelGenerationSettings {
                max_tokens: Some(1000),
                temperature: Some(0.2),
                ..Default::default()
            },
        }
    }

    #[tokio::test]
    async fn generation_settings_are_replaced_as_a_whole_and_validated() {
        let (service, _pool, provider_id) = setup().await;
        let id = service
            .create_model(new_model(provider_id, "k3"))
            .await
            .unwrap();

        // 整体替换：未给出的项置空（请求中不发送）
        let settings = ModelGenerationSettings {
            temperature: Some(1.0),
            thinking_level: Some("low".to_string()),
            extra_params: Some(serde_json::json!({ "top_p": 0.95 })),
            ..Default::default()
        };
        service
            .update_model(
                id,
                AIModelUpdate {
                    generation: Some(settings.clone()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let config = service.get_model_config(Some(id)).await.unwrap();
        assert_eq!(config.max_tokens, None);
        assert_eq!(config.temperature, Some(1.0));
        assert_eq!(config.thinking_level.as_deref(), Some("low"));
        assert_eq!(
            config.extra_params,
            Some(serde_json::json!({ "top_p": 0.95 }))
        );
        assert_eq!((config.context_window, config.reasoning), (None, None));

        // 只改显示名不影响生成参数
        service
            .update_model(
                id,
                AIModelUpdate {
                    display_name: Some("Kimi K3".to_string()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            service
                .get_model_config(Some(id))
                .await
                .unwrap()
                .thinking_level
                .as_deref(),
            Some("low")
        );

        let invalid = [
            ModelGenerationSettings {
                max_tokens: Some(0),
                ..Default::default()
            },
            ModelGenerationSettings {
                temperature: Some(2.5),
                ..Default::default()
            },
            ModelGenerationSettings {
                thinking_level: Some("turbo".to_string()),
                ..Default::default()
            },
            ModelGenerationSettings {
                extra_params: Some(serde_json::json!([1])),
                ..Default::default()
            },
            ModelGenerationSettings {
                context_window: Some(-1),
                ..Default::default()
            },
        ];
        for generation in invalid {
            assert!(matches!(
                service
                    .update_model(
                        id,
                        AIModelUpdate {
                            generation: Some(generation),
                            ..Default::default()
                        },
                    )
                    .await,
                Err(AppError::ValidationError(_))
            ));
        }
        let mut bad = new_model(provider_id, "bad");
        bad.generation.temperature = Some(-0.1);
        assert!(matches!(
            service.create_model(bad).await,
            Err(AppError::ValidationError(_))
        ));
    }

    #[tokio::test]
    async fn provider_pi_mapping_can_be_set_and_cleared() {
        let (service, _pool, provider_id) = setup().await;
        let update = |pi: &str, api: Option<&str>| AIProviderUpdate {
            pi_provider: Some(pi.to_string()),
            api: api.map(str::to_string),
            ..Default::default()
        };
        service
            .update_provider(provider_id, update("deepseek", None))
            .await
            .unwrap();
        let find = |providers: Vec<AIProviderSafe>| {
            providers.into_iter().find(|p| p.id == provider_id).unwrap()
        };
        assert_eq!(
            find(service.get_providers(true).await.unwrap())
                .pi_provider
                .as_deref(),
            Some("deepseek")
        );
        service
            .update_provider(provider_id, update("", Some("anthropic-messages")))
            .await
            .unwrap();
        let p = find(service.get_providers(true).await.unwrap());
        assert_eq!(
            (p.pi_provider, p.api.as_str()),
            (None, "anthropic-messages")
        );
        for bad in [update("bad id!", None), update("", Some("grpc"))] {
            assert!(matches!(
                service.update_provider(provider_id, bad).await,
                Err(AppError::ValidationError(_))
            ));
        }
    }

    #[test]
    fn model_query_accepts_camel_case_fields_from_frontend() {
        let q: AIModelQuery =
            serde_json::from_value(serde_json::json!({"providerId": 3, "isDefault": true}))
                .unwrap();
        assert_eq!((q.provider_id, q.is_default), (Some(3), Some(true)));
    }

    /// 回归（2026-10 真实应用走查）：种子占位密钥曾显示为“已配置（PLEA****）”
    #[test]
    fn parses_openai_compatible_model_list() {
        let body = r#"{"data":[
            {"id":"qwen/qwen3.8-flash","name":"Qwen 3.8 Flash","context_length":1000000},
            {"id":"google/gemini-3.8-flash","name":"Gemini 3.8 Flash","context_length":1048576},
            {"id":"google/gemini-3.8-flash"},
            {"id":"  "},
            {"object":"model"}
        ]}"#;
        let existing: HashSet<String> = ["qwen/qwen3.8-flash".to_string()].into();
        let models = parse_remote_models(body, &existing).unwrap();
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["google/gemini-3.8-flash", "qwen/qwen3.8-flash"]);
        assert_eq!(models[0].context_length, Some(1048576));
        assert!(!models[0].already_added);
        assert!(models[1].already_added);
    }

    #[test]
    fn catalog_models_are_merged_with_remote_extras() {
        let catalog = vec![CatalogModel {
            id: "kimi-k3".to_string(),
            name: "Kimi K3".to_string(),
            api: "openai-completions".to_string(),
            reasoning: true,
            context_window: 1_048_576,
            max_tokens: 1_048_576,
            input: vec!["text".to_string()],
            cost_input: 3.0,
            cost_output: 15.0,
            thinking_levels: vec!["low".to_string(), "high".to_string()],
        }];
        let remote = parse_remote_models(
            r#"{"data":[{"id":"kimi-k3"},{"id":"moonshot-v1-8k"}]}"#,
            &HashSet::new(),
        )
        .unwrap();
        let existing: HashSet<String> = ["kimi-k3".to_string()].into();
        let merged = merge_catalog_models(&catalog, remote, &existing);
        assert_eq!(merged.len(), 2);
        let k3 = &merged[0];
        assert!(k3.in_catalog && k3.already_added);
        assert_eq!(k3.thinking_levels, vec!["low", "high"]);
        assert_eq!(k3.cost_output, Some(15.0));
        let extra = &merged[1];
        assert_eq!(extra.id, "moonshot-v1-8k");
        assert!(!extra.in_catalog && extra.thinking_levels.is_empty());
    }

    #[test]
    fn parses_bare_array_and_rejects_garbage() {
        let models = parse_remote_models(r#"[{"id":"moonshot-v1-8k"}]"#, &HashSet::new()).unwrap();
        assert_eq!(models[0].id, "moonshot-v1-8k");
        assert!(models[0].name.is_none());
        let models = parse_remote_models(
            r#"{"models":[{"model":"MiniMax-M3"},{"id":"abab7-chat"}]}"#,
            &HashSet::new(),
        )
        .unwrap();
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["MiniMax-M3", "abab7-chat"]);
        assert!(parse_remote_models("<html>404</html>", &HashSet::new()).is_err());
        assert!(parse_remote_models(r#"{"error":"x"}"#, &HashSet::new()).is_err());
    }

    #[tokio::test]
    async fn listing_remote_models_of_unknown_provider_is_not_found() {
        let (service, _pool, _provider_id) = setup().await;
        let err = service.list_remote_models(9999, None).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn seeded_placeholder_key_is_reported_as_not_configured() {
        let (service, _pool, _provider_id) = setup().await;
        let providers = service.get_providers(true).await.unwrap();
        let seeded = providers
            .iter()
            .find(|p| p.name == "openrouter")
            .expect("迁移 003 种子提供商");
        assert!(!seeded.has_api_key);
        assert!(seeded.api_key_preview.is_none());
    }

    #[tokio::test]
    async fn list_responses_never_contain_the_api_key() {
        let (service, _pool, provider_id) = setup().await;
        service
            .create_model(new_model(provider_id, "m1"))
            .await
            .unwrap();
        service
            .update_model(
                service.get_all_models(None).await.unwrap()[0].id,
                AIModelUpdate {
                    is_active: Some(false),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let json = serde_json::to_string(&(
            service.get_providers(true).await.unwrap(),
            service.get_providers(false).await.unwrap(),
            service.get_all_models(None).await.unwrap(),
        ))
        .unwrap();
        assert!(!json.contains(SECRET), "API Key 泄露到返回值");
        assert!(json.contains("\"hasApiKey\":true"));
    }

    #[tokio::test]
    async fn setting_default_model_clears_all_other_defaults() {
        let (service, pool, provider_id) = setup().await;
        let a = service
            .create_model(new_model(provider_id, "a"))
            .await
            .unwrap();
        let b = service
            .create_model(new_model(provider_id, "b"))
            .await
            .unwrap();

        service.set_default_model(a).await.unwrap();
        service.set_default_model(b).await.unwrap();

        let defaults: Vec<Id> = sqlx::query_scalar("SELECT id FROM ai_models WHERE is_default = 1")
            .fetch_all(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(defaults, vec![b]);
        assert!(matches!(
            service.set_default_model(99_999).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn deleting_provider_removes_its_models() {
        let (service, pool, provider_id) = setup().await;
        service
            .create_model(new_model(provider_id, "a"))
            .await
            .unwrap();

        service.delete_provider(provider_id).await.unwrap();

        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ai_models WHERE provider_id = ?")
                .bind(provider_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!(remaining, 0);
        assert!(matches!(
            service.delete_provider(provider_id).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn updating_provider_with_none_keeps_existing_api_key() {
        let (service, pool, provider_id) = setup().await;

        service
            .update_provider(
                provider_id,
                AIProviderUpdate {
                    display_name: Some("Renamed".to_string()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let (name, key): (String, String) =
            sqlx::query_as("SELECT display_name, api_key FROM ai_providers WHERE id = ?")
                .bind(provider_id)
                .fetch_one(pool.as_ref())
                .await
                .unwrap();
        assert_eq!((name.as_str(), key.as_str()), ("Renamed", SECRET));
    }

    #[tokio::test]
    async fn invalid_writes_are_rejected() {
        let (service, _pool, provider_id) = setup().await;

        assert!(matches!(
            service
                .update_provider(provider_id, AIProviderUpdate::default())
                .await,
            Err(AppError::ValidationError(_))
        ));
        assert!(matches!(
            service.update_model(1, AIModelUpdate::default()).await,
            Err(AppError::ValidationError(_))
        ));
        assert!(matches!(
            service.create_model(new_model(provider_id, " ")).await,
            Err(AppError::ValidationError(_))
        ));

        service
            .update_provider(
                provider_id,
                AIProviderUpdate {
                    is_active: Some(false),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(matches!(
            service.create_model(new_model(provider_id, "x")).await,
            Err(AppError::ValidationError(_))
        ));
        assert!(matches!(
            service.delete_model(99_999).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn model_filters_by_provider_and_hides_inactive_from_active_list() {
        let (service, _pool, provider_id) = setup().await;
        let a = service
            .create_model(new_model(provider_id, "a"))
            .await
            .unwrap();
        let b = service
            .create_model(new_model(provider_id, "b"))
            .await
            .unwrap();
        service
            .update_model(
                b,
                AIModelUpdate {
                    is_active: Some(false),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let query = || {
            Some(AIModelQuery {
                provider_id: Some(provider_id),
                is_active: None,
                is_default: None,
            })
        };

        let all: Vec<Id> = service
            .get_all_models(query())
            .await
            .unwrap()
            .iter()
            .map(|m| m.id)
            .collect();
        // 设置页列出全部模型（含停用的）
        assert_eq!(all, vec![a, b]);
    }
}
