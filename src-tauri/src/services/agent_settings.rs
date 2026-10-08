//! AI 助手（pi agent）设置：按任务选择模型、批量分析的每批词数与并发数。
//!
//! 模型解析顺序：命令里显式传的模型 > 任务设置 > 默认模型。任务设置指向的模型被删除或停用时，
//! 回退到默认模型（不报错），设置页会把它显示为“跟随默认模型”。

use crate::error::{AppError, AppResult};
use crate::repositories::settings_repository::SettingsRepository;
use crate::types::ai_model::AIModelConfig;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;

/// 使用 AI 的任务
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentTaskKind {
    Extract,
    Phonics,
    Plan,
    Explain,
    Tutor,
    Examples,
    Passage,
}

impl AgentTaskKind {
    pub const ALL: [AgentTaskKind; 7] = [
        AgentTaskKind::Extract,
        AgentTaskKind::Phonics,
        AgentTaskKind::Examples,
        AgentTaskKind::Plan,
        AgentTaskKind::Explain,
        AgentTaskKind::Tutor,
        AgentTaskKind::Passage,
    ];

    pub fn key(self) -> &'static str {
        match self {
            AgentTaskKind::Extract => "extract",
            AgentTaskKind::Phonics => "phonics",
            AgentTaskKind::Plan => "plan",
            AgentTaskKind::Explain => "explain",
            AgentTaskKind::Tutor => "tutor",
            AgentTaskKind::Examples => "examples",
            AgentTaskKind::Passage => "passage",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|t| t.key() == key)
    }

    fn label(self) -> &'static str {
        match self {
            AgentTaskKind::Extract => "提取 / 生成单词",
            AgentTaskKind::Phonics => "拼读分析",
            AgentTaskKind::Plan => "学习计划排序",
            AgentTaskKind::Explain => "AI 讲解",
            AgentTaskKind::Tutor => "AI 老师答疑",
            AgentTaskKind::Examples => "例句补充",
            AgentTaskKind::Passage => "短文库",
        }
    }

    fn description(self) -> &'static str {
        match self {
            AgentTaskKind::Extract => "从课文或文章里找出要学的单词，或按描述生成单词本",
            AgentTaskKind::Phonics => {
                "导入单词时拆音节、写拼读讲解、生成例句；准确性最重要，建议用能力强的模型"
            }
            AgentTaskKind::Examples => "在练习里补充或重新生成例句",
            AgentTaskKind::Plan => "新建计划时评估难度、安排学习顺序",
            AgentTaskKind::Explain => "练习时的单词深度讲解；建议用能力强的模型",
            AgentTaskKind::Tutor => "练习时向 AI 老师提问；回答要快，可用速度快、价格低的模型",
            AgentTaskKind::Passage => "写阅读短文、出阅读理解题、给开放题评分；建议用能力强的模型",
        }
    }

    fn setting_key(self) -> String {
        format!("agent.model.{}", self.key())
    }
}

/// 批量分析的每批词数（每次请求分析几个词）
pub const BATCH_SIZE_RANGE: std::ops::RangeInclusive<i64> = 3..=20;
pub const DEFAULT_BATCH_SIZE: i64 = 5;
/// 同时进行的请求数（服务商限流时调低）
pub const CONCURRENCY_RANGE: std::ops::RangeInclusive<i64> = 1..=5;
pub const DEFAULT_CONCURRENCY: i64 = 3;

/// 一个任务的模型设置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskModel {
    pub task: String,
    pub label: String,
    pub description: String,
    /// 指定的模型；None = 跟随默认模型
    pub model_id: Option<i64>,
}

/// AI 助手设置（设置页读取）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
    pub task_models: Vec<AgentTaskModel>,
    pub batch_size: i64,
    pub max_concurrency: i64,
}

/// 更新请求：只改传了的字段；`task_models` 里 model_id 为 None 表示恢复跟随默认模型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentSettingsRequest {
    #[serde(default)]
    pub task_models: Option<Vec<TaskModelChoice>>,
    #[serde(default)]
    pub batch_size: Option<i64>,
    #[serde(default)]
    pub max_concurrency: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskModelChoice {
    pub task: String,
    pub model_id: Option<i64>,
}

pub struct AgentSettingsService {
    pool: Arc<SqlitePool>,
    logger: Arc<crate::logger::Logger>,
}

impl AgentSettingsService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<crate::logger::Logger>) -> Self {
        Self { pool, logger }
    }

    pub async fn get(&self) -> AppResult<AgentSettings> {
        let values = SettingsRepository::with_prefix(&self.pool, "agent.").await?;
        let int = |key: &str| values.get(key).and_then(|v| v.parse::<i64>().ok());
        Ok(AgentSettings {
            task_models: AgentTaskKind::ALL
                .into_iter()
                .map(|t| AgentTaskModel {
                    task: t.key().to_string(),
                    label: t.label().to_string(),
                    description: t.description().to_string(),
                    model_id: int(&t.setting_key()),
                })
                .collect(),
            batch_size: int("agent.batch_size")
                .filter(|v| BATCH_SIZE_RANGE.contains(v))
                .unwrap_or(DEFAULT_BATCH_SIZE),
            max_concurrency: int("agent.max_concurrency")
                .filter(|v| CONCURRENCY_RANGE.contains(v))
                .unwrap_or(DEFAULT_CONCURRENCY),
        })
    }

    pub async fn update(&self, request: UpdateAgentSettingsRequest) -> AppResult<AgentSettings> {
        if let Some(v) = request.batch_size {
            if !BATCH_SIZE_RANGE.contains(&v) {
                return Err(AppError::ValidationError(
                    "每批词数需在 3–20 之间".to_string(),
                ));
            }
        }
        if let Some(v) = request.max_concurrency {
            if !CONCURRENCY_RANGE.contains(&v) {
                return Err(AppError::ValidationError(
                    "同时请求数需在 1–5 之间".to_string(),
                ));
            }
        }
        let models =
            crate::services::ai_model::AIModelService::new(self.pool.clone(), self.logger.clone());
        let mut tx = self.pool.begin().await?;
        for choice in request.task_models.unwrap_or_default() {
            let task = AgentTaskKind::from_key(&choice.task)
                .ok_or_else(|| AppError::ValidationError(format!("未知的任务：{}", choice.task)))?;
            if let Some(id) = choice.model_id {
                // 只能选已启用、密钥可用的模型
                models.get_model_config(Some(id)).await?;
            }
            let value = choice.model_id.map(|id| id.to_string());
            SettingsRepository::set(&mut tx, &task.setting_key(), value.as_deref()).await?;
        }
        if let Some(v) = request.batch_size {
            SettingsRepository::set(&mut tx, "agent.batch_size", Some(&v.to_string())).await?;
        }
        if let Some(v) = request.max_concurrency {
            SettingsRepository::set(&mut tx, "agent.max_concurrency", Some(&v.to_string())).await?;
        }
        tx.commit().await?;
        self.get().await
    }

    /// 某个任务要用的模型：显式指定 > 任务设置（模型不可用时忽略）> 默认模型
    pub async fn model_for(
        &self,
        task: AgentTaskKind,
        explicit: Option<i64>,
    ) -> AppResult<AIModelConfig> {
        let models =
            crate::services::ai_model::AIModelService::new(self.pool.clone(), self.logger.clone());
        if explicit.is_some() {
            return models.get_model_config(explicit).await;
        }
        let configured = SettingsRepository::get(&self.pool, &task.setting_key())
            .await?
            .and_then(|v| v.parse::<i64>().ok());
        if let Some(id) = configured {
            match models.get_model_config(Some(id)).await {
                Ok(model) => return Ok(model),
                Err(e) => self.logger.warn(
                    "AGENT_SETTINGS",
                    &format!(
                        "任务「{}」设置的模型 {} 不可用，改用默认模型",
                        task.label(),
                        id
                    ),
                    Some(&e.to_string()),
                ),
            }
        }
        models.get_model_config(None).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, test_logger};

    #[tokio::test]
    async fn defaults_validation_and_round_trip() {
        let pool = memory_pool().await;
        let service = AgentSettingsService::new(pool.clone(), test_logger());

        let s = service.get().await.unwrap();
        assert_eq!(
            (s.batch_size, s.max_concurrency),
            (DEFAULT_BATCH_SIZE, DEFAULT_CONCURRENCY)
        );
        assert_eq!(s.task_models.len(), AgentTaskKind::ALL.len());
        assert!(s.task_models.iter().all(|t| t.model_id.is_none()));

        assert!(service
            .update(UpdateAgentSettingsRequest {
                task_models: None,
                batch_size: Some(50),
                max_concurrency: None
            })
            .await
            .is_err());
        assert!(service
            .update(UpdateAgentSettingsRequest {
                task_models: Some(vec![TaskModelChoice {
                    task: "nope".into(),
                    model_id: None
                }]),
                batch_size: None,
                max_concurrency: None
            })
            .await
            .is_err());

        let s = service
            .update(UpdateAgentSettingsRequest {
                task_models: None,
                batch_size: Some(8),
                max_concurrency: Some(1),
            })
            .await
            .unwrap();
        assert_eq!((s.batch_size, s.max_concurrency), (8, 1));
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["maxConcurrency"], 1);
        assert_eq!(v["taskModels"][0]["task"], "extract");
    }

    #[tokio::test]
    async fn task_model_falls_back_to_default_when_unset_or_unavailable() {
        let pool = memory_pool().await;
        let service = AgentSettingsService::new(pool.clone(), test_logger());
        // 一个不存在的模型 id 写进设置：解析时应忽略并回退
        let mut conn = pool.acquire().await.unwrap();
        SettingsRepository::set(&mut conn, "agent.model.tutor", Some("9999"))
            .await
            .unwrap();
        drop(conn);
        let fallback = service.model_for(AgentTaskKind::Tutor, None).await;
        let default = crate::services::ai_model::AIModelService::new(pool.clone(), test_logger())
            .get_model_config(None)
            .await;
        // 两者结果一致（测试库可能没有可用默认模型：同为错误也算一致）
        assert_eq!(fallback.is_ok(), default.is_ok());
        if let (Ok(a), Ok(b)) = (fallback, default) {
            assert_eq!(a.id, b.id);
        }
    }
}
