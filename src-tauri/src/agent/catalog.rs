//! pi 内置模型目录：由 `redlark-agent --redlark-catalog` 输出（不启动 agent、不联网），进程内缓存。
//! 用途：设置页的内置提供商下拉、思考档选项、“同步模型”列表（含上下文 / 价格）。

use super::config::AgentPaths;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::OnceCell;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    pub id: String,
    pub name: String,
    pub api: String,
    pub reasoning: bool,
    pub context_window: i64,
    pub max_tokens: i64,
    pub input: Vec<String>,
    /// 美元 / 百万 token
    pub cost_input: f64,
    pub cost_output: f64,
    /// pi 对该模型支持的思考档
    pub thinking_levels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogProvider {
    pub id: String,
    /// pi 给出的展示名称（旧版 sidecar 没有时为空）
    #[serde(default)]
    pub name: String,
    pub base_url: String,
    pub api: String,
    /// pi 对 API 密钥的说明；不支持密钥鉴权时为 None
    #[serde(default)]
    pub api_key_label: Option<String>,
    #[serde(default, rename = "supportsOAuth")]
    pub supports_oauth: bool,
    /// 只填 API 密钥就能用（pi 支持密钥鉴权且地址固定）
    #[serde(default)]
    pub key_only: bool,
    pub models: Vec<CatalogModel>,
}

/// 设置页下拉使用的提供商摘要（不带模型列表）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogProviderSummary {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api: String,
    pub api_key_label: Option<String>,
    #[serde(rename = "supportsOAuth")]
    pub supports_oauth: bool,
    pub key_only: bool,
    pub model_count: usize,
}

impl From<&CatalogProvider> for CatalogProviderSummary {
    fn from(p: &CatalogProvider) -> Self {
        Self {
            id: p.id.clone(),
            name: if p.name.is_empty() {
                p.id.clone()
            } else {
                p.name.clone()
            },
            base_url: p.base_url.clone(),
            api: p.api.clone(),
            api_key_label: p.api_key_label.clone(),
            supports_oauth: p.supports_oauth,
            key_only: p.key_only,
            model_count: p.models.len(),
        }
    }
}

static CATALOG: OnceCell<Arc<Vec<CatalogProvider>>> = OnceCell::const_new();

pub fn parse_catalog(json: &[u8]) -> AppResult<Vec<CatalogProvider>> {
    serde_json::from_slice(json)
        .map_err(|e| AppError::ExternalServiceError(format!("无法解析 pi 模型目录：{}", e)))
}

async fn fetch_catalog(paths: &AgentPaths) -> AppResult<Arc<Vec<CatalogProvider>>> {
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        tokio::process::Command::new(&paths.program)
            .arg("--redlark-catalog")
            .env("PI_OFFLINE", "1")
            .env("PI_TELEMETRY", "0")
            .env("PI_CODING_AGENT_DIR", paths.root.join("catalog"))
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| AppError::ExternalServiceError("读取 pi 模型目录超时".to_string()))?
    .map_err(|e| {
        AppError::ExternalServiceError(format!(
            "{}（{}）：{}",
            super::session::SPAWN_FAILURE,
            paths.program.display(),
            e
        ))
    })?;
    if !output.status.success() {
        return Err(AppError::ExternalServiceError(format!(
            "读取 pi 模型目录失败：{}",
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(300)
                .collect::<String>()
        )));
    }
    Ok(Arc::new(parse_catalog(&output.stdout)?))
}

/// 读取目录（首次调用启动一次 sidecar，之后用缓存；目录随 sidecar 版本固定）
pub async fn load_catalog(paths: &AgentPaths) -> AppResult<Arc<Vec<CatalogProvider>>> {
    CATALOG
        .get_or_try_init(|| fetch_catalog(paths))
        .await
        .cloned()
}

/// 某个内置 provider 的模型列表
pub fn provider_models<'a>(
    catalog: &'a [CatalogProvider],
    provider_id: &str,
) -> &'a [CatalogModel] {
    catalog
        .iter()
        .find(|p| p.id == provider_id)
        .map(|p| p.models.as_slice())
        .unwrap_or(&[])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sidecar_catalog_output() {
        let json = br#"[{"id":"moonshotai-cn","baseUrl":"https://api.moonshot.cn/v1","api":"openai-completions",
            "models":[{"id":"kimi-k3","name":"Kimi K3","api":"openai-completions","reasoning":true,
            "contextWindow":1048576,"maxTokens":1048576,"input":["text","image"],"costInput":3,"costOutput":15,
            "thinkingLevels":["low","high","max"]}]}]"#;
        let catalog = parse_catalog(json).unwrap();
        let models = provider_models(&catalog, "moonshotai-cn");
        assert_eq!(models[0].thinking_levels, vec!["low", "high", "max"]);
        assert_eq!(CatalogProviderSummary::from(&catalog[0]).model_count, 1);
        assert!(provider_models(&catalog, "unknown").is_empty());
        assert!(parse_catalog(b"not json").is_err());
    }

    #[test]
    fn summary_carries_pi_provider_metadata() {
        let json = br#"[{"id":"deepseek","name":"DeepSeek","baseUrl":"https://api.deepseek.com","api":"openai-completions",
            "apiKeyLabel":"DeepSeek API key","supportsOAuth":false,"keyOnly":true,"models":[]},
            {"id":"old-sidecar","baseUrl":"","api":"","models":[]}]"#;
        let catalog = parse_catalog(json).unwrap();
        let deepseek = CatalogProviderSummary::from(&catalog[0]);
        assert_eq!(deepseek.name, "DeepSeek");
        assert_eq!(deepseek.api_key_label.as_deref(), Some("DeepSeek API key"));
        assert!(deepseek.key_only);
        let value = serde_json::to_value(&deepseek).unwrap();
        assert_eq!(value["supportsOAuth"], false);
        assert_eq!(value["apiKeyLabel"], "DeepSeek API key");
        // 旧版 sidecar 没有这些字段：名称退回 id，按不可直接使用处理
        let old = CatalogProviderSummary::from(&catalog[1]);
        assert_eq!(old.name, "old-sidecar");
        assert!(!old.key_only);
    }
}
