//! AI 任务（pi agent）设置：按任务选择模型、批量分析的每批词数与并发数、等待上限与自动重试、
//! 后台同时进行的 AI 任务数，以及 AI 老师对话的权限与推荐。
//!
//! 模型解析顺序：命令里显式传的模型 > 任务设置 > 默认模型。任务设置指向的模型被删除或停用时，
//! 回退到默认模型（不报错），设置页会把它显示为“跟随默认模型”。

use crate::error::{AppError, AppResult};
use crate::repositories::settings_repository::SettingsRepository;
use crate::types::ai_model::AIModelConfig;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicI64, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// 使用 AI 的任务
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentTaskKind {
    Extract,
    Phonics,
    Plan,
    Explain,
    Tutor,
    Chat,
    Examples,
    Passage,
    Video,
}

impl AgentTaskKind {
    pub const ALL: [AgentTaskKind; 9] = [
        AgentTaskKind::Extract,
        AgentTaskKind::Phonics,
        AgentTaskKind::Examples,
        AgentTaskKind::Plan,
        AgentTaskKind::Explain,
        AgentTaskKind::Tutor,
        AgentTaskKind::Chat,
        AgentTaskKind::Passage,
        AgentTaskKind::Video,
    ];

    pub fn key(self) -> &'static str {
        match self {
            AgentTaskKind::Extract => "extract",
            AgentTaskKind::Phonics => "phonics",
            AgentTaskKind::Plan => "plan",
            AgentTaskKind::Explain => "explain",
            AgentTaskKind::Tutor => "tutor",
            AgentTaskKind::Chat => "chat",
            AgentTaskKind::Examples => "examples",
            AgentTaskKind::Passage => "passage",
            AgentTaskKind::Video => "video",
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
            AgentTaskKind::Tutor => "练习答疑",
            AgentTaskKind::Chat => "AI 老师对话",
            AgentTaskKind::Examples => "例句补充",
            AgentTaskKind::Passage => "短文库",
            AgentTaskKind::Video => "视频库",
        }
    }

    fn description(self) -> &'static str {
        match self {
            AgentTaskKind::Extract => "从课文或文章里找出要学的单词，或按描述生成词汇本；读单词海报、照片要用能看图片的模型",
            AgentTaskKind::Phonics => {
                "导入单词时拆音节、写拼读讲解、生成例句；准确性最重要，建议用能力强的模型"
            }
            AgentTaskKind::Examples => "在练习里补充或重新生成例句",
            AgentTaskKind::Plan => "新建计划时评估难度、安排学习顺序",
            AgentTaskKind::Explain => "练习时的单词深度讲解；建议用能力强的模型",
            AgentTaskKind::Tutor => "练习、看讲解时向 AI 老师提问",
            AgentTaskKind::Chat => {
                "「AI 老师」里的对话：查资料、看截图和文件、帮你整理素材；建议用能力强、能看图片的模型。没有单独设置时用「练习答疑」的模型"
            }
            AgentTaskKind::Passage => "写阅读短文、出阅读理解题、给开放题评分、读取导入的讲义和照片；建议用能力强、能看图片的模型",
            AgentTaskKind::Video => "整理字幕、规划切分视频；没有单独设置时用「短文库」的模型",
        }
    }

    /// 没有单独设置时沿用哪个任务的模型（早先这些功能用的就是它）
    fn fallback(self) -> Option<AgentTaskKind> {
        match self {
            AgentTaskKind::Video => Some(AgentTaskKind::Passage),
            AgentTaskKind::Chat => Some(AgentTaskKind::Tutor),
            _ => None,
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
/// AI 一次任务最长等多久（分钟）：长视频规划、慢模型的深度思考都可能要好几分钟
pub const TIMEOUT_MINUTES_RANGE: std::ops::RangeInclusive<i64> = 3..=60;
pub const DEFAULT_TIMEOUT_MINUTES: i64 = 15;
/// 模型服务出错（如 429 限流、过载）时自动重试的次数；0 = 不重试
pub const RETRIES_RANGE: std::ops::RangeInclusive<i64> = 0..=10;
pub const DEFAULT_RETRIES: i64 = 5;
/// 后台同时进行的 AI 任务数（写短文、出题、批量分析等排队执行）
pub const JOB_SLOTS_RANGE: std::ops::RangeInclusive<i64> = 1..=4;
pub const DEFAULT_JOB_SLOTS: i64 = 2;
/// AI 老师对话里能做哪些改动：ask_delete 删除前问 / ask_changes 每次改动都问 / view_only 只查看不改动
pub const TUTOR_PERMISSIONS: [&str; 3] = ["ask_delete", "ask_changes", "view_only"];
pub const DEFAULT_TUTOR_PERMISSION: &str = "ask_delete";

/// 当前生效的等待上限（分钟），启动时与每次保存设置后更新；agent 任务启动时读取
static TIMEOUT_MINUTES: AtomicI64 = AtomicI64::new(DEFAULT_TIMEOUT_MINUTES);

/// 当前生效的自动重试次数，启动时与每次保存设置后更新；启动 pi 时写进它的设置
static RETRIES: AtomicU32 = AtomicU32::new(DEFAULT_RETRIES as u32);

/// AI 任务的等待上限（「设置 → AI 任务」，所有 agent 任务共用）
pub fn task_timeout() -> Duration {
    Duration::from_secs(TIMEOUT_MINUTES.load(Ordering::Relaxed).max(1) as u64 * 60)
}

/// 模型服务出错时 pi 自动重试的次数（所有 agent 任务共用）
pub fn max_retries() -> u32 {
    RETRIES.load(Ordering::Relaxed)
}

/// 一个任务的模型设置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskModel {
    pub task: String,
    pub label: String,
    pub description: String,
    /// 指定的模型；None = 跟随 `fallback_task` 的设置（没有时跟随默认模型）
    pub model_id: Option<i64>,
    /// 没有单独设置时沿用哪个任务的模型（key）
    pub fallback_task: Option<String>,
}

/// AI 助手设置（设置页读取）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
    pub task_models: Vec<AgentTaskModel>,
    pub batch_size: i64,
    pub max_concurrency: i64,
    /// AI 一次任务的等待上限（分钟）
    pub timeout_minutes: i64,
    /// 模型服务出错时自动重试的次数
    pub max_retries: i64,
    /// 后台同时进行的 AI 任务数
    pub job_slots: i64,
    /// AI 老师对话能做哪些改动（见 [`TUTOR_PERMISSIONS`]）
    pub tutor_permission: String,
    /// AI 老师回答后给出下一步可以说的话
    pub tutor_suggestions: bool,
}

/// 更新请求：只改传了的字段；`task_models` 里 model_id 为 None 表示恢复跟随默认模型
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentSettingsRequest {
    #[serde(default)]
    pub task_models: Option<Vec<TaskModelChoice>>,
    #[serde(default)]
    pub batch_size: Option<i64>,
    #[serde(default)]
    pub max_concurrency: Option<i64>,
    #[serde(default)]
    pub timeout_minutes: Option<i64>,
    #[serde(default)]
    pub max_retries: Option<i64>,
    #[serde(default)]
    pub job_slots: Option<i64>,
    #[serde(default)]
    pub tutor_permission: Option<String>,
    #[serde(default)]
    pub tutor_suggestions: Option<bool>,
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
                    fallback_task: t.fallback().map(|f| f.key().to_string()),
                })
                .collect(),
            batch_size: int("agent.batch_size")
                .filter(|v| BATCH_SIZE_RANGE.contains(v))
                .unwrap_or(DEFAULT_BATCH_SIZE),
            max_concurrency: int("agent.max_concurrency")
                .filter(|v| CONCURRENCY_RANGE.contains(v))
                .unwrap_or(DEFAULT_CONCURRENCY),
            timeout_minutes: int("agent.timeout_minutes")
                .filter(|v| TIMEOUT_MINUTES_RANGE.contains(v))
                .unwrap_or(DEFAULT_TIMEOUT_MINUTES),
            max_retries: int("agent.max_retries")
                .filter(|v| RETRIES_RANGE.contains(v))
                .unwrap_or(DEFAULT_RETRIES),
            job_slots: int("agent.job_slots")
                .filter(|v| JOB_SLOTS_RANGE.contains(v))
                .unwrap_or(DEFAULT_JOB_SLOTS),
            tutor_permission: values
                .get("agent.tutor.permission")
                .filter(|v| TUTOR_PERMISSIONS.contains(&v.as_str()))
                .cloned()
                .unwrap_or_else(|| DEFAULT_TUTOR_PERMISSION.to_string()),
            tutor_suggestions: values
                .get("agent.tutor.suggestions")
                .map(|v| v != "0")
                .unwrap_or(true),
        })
    }

    /// 读设置并让等待上限、重试次数生效（启动时调用）；返回设置，调用方据此设置后台 AI 任务数
    pub async fn apply_runtime(&self) -> AppResult<AgentSettings> {
        let settings = self.get().await?;
        apply(&settings);
        Ok(settings)
    }

    pub async fn update(&self, request: UpdateAgentSettingsRequest) -> AppResult<AgentSettings> {
        if let Some(v) = request.batch_size {
            if !BATCH_SIZE_RANGE.contains(&v) {
                return Err(AppError::ValidationError(
                    "每批词数需在 3–20 之间".to_string(),
                ));
            }
        }
        if let Some(v) = request.timeout_minutes {
            if !TIMEOUT_MINUTES_RANGE.contains(&v) {
                return Err(AppError::ValidationError(
                    "等待上限需在 3–60 分钟之间".to_string(),
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
        if let Some(v) = request.max_retries {
            if !RETRIES_RANGE.contains(&v) {
                return Err(AppError::ValidationError(
                    "自动重试次数需在 0–10 之间".to_string(),
                ));
            }
        }
        if let Some(v) = request.job_slots {
            if !JOB_SLOTS_RANGE.contains(&v) {
                return Err(AppError::ValidationError(
                    "同时进行的后台任务数需在 1–4 之间".to_string(),
                ));
            }
        }
        if let Some(v) = &request.tutor_permission {
            if !TUTOR_PERMISSIONS.contains(&v.as_str()) {
                return Err(AppError::ValidationError(format!(
                    "AI 老师的权限取值不正确：{}",
                    v
                )));
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
        if let Some(v) = request.timeout_minutes {
            SettingsRepository::set(&mut tx, "agent.timeout_minutes", Some(&v.to_string())).await?;
        }
        if let Some(v) = request.max_retries {
            SettingsRepository::set(&mut tx, "agent.max_retries", Some(&v.to_string())).await?;
        }
        if let Some(v) = request.job_slots {
            SettingsRepository::set(&mut tx, "agent.job_slots", Some(&v.to_string())).await?;
        }
        if let Some(v) = &request.tutor_permission {
            SettingsRepository::set(&mut tx, "agent.tutor.permission", Some(v)).await?;
        }
        if let Some(v) = request.tutor_suggestions {
            SettingsRepository::set(
                &mut tx,
                "agent.tutor.suggestions",
                Some(if v { "1" } else { "0" }),
            )
            .await?;
        }
        tx.commit().await?;
        let settings = self.get().await?;
        apply(&settings);
        Ok(settings)
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
        let mut configured = SettingsRepository::get(&self.pool, &task.setting_key())
            .await?
            .and_then(|v| v.parse::<i64>().ok());
        // 没有单独设置时沿用早先用的：视频 → 短文库，AI 老师对话 → 练习答疑
        if let (None, Some(fallback)) = (configured, task.fallback()) {
            configured = SettingsRepository::get(&self.pool, &fallback.setting_key())
                .await?
                .and_then(|v| v.parse::<i64>().ok());
        }
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

/// 让进程级的设置生效（等待上限、重试次数）；后台任务数由调用方交给 `Jobs`
fn apply(settings: &AgentSettings) {
    TIMEOUT_MINUTES.store(settings.timeout_minutes, Ordering::Relaxed);
    RETRIES.store(settings.max_retries as u32, Ordering::Relaxed);
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
                max_concurrency: None,
                timeout_minutes: None,
                ..Default::default()
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
                max_concurrency: None,
                timeout_minutes: None,
                ..Default::default()
            })
            .await
            .is_err());

        let s = service
            .update(UpdateAgentSettingsRequest {
                task_models: None,
                batch_size: Some(8),
                max_concurrency: Some(1),
                timeout_minutes: None,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!((s.batch_size, s.max_concurrency), (8, 1));
        assert_eq!(s.timeout_minutes, DEFAULT_TIMEOUT_MINUTES);
        assert!(service
            .update(UpdateAgentSettingsRequest {
                task_models: None,
                batch_size: None,
                max_concurrency: None,
                timeout_minutes: Some(1),
                ..Default::default()
            })
            .await
            .is_err());
        let s = service
            .update(UpdateAgentSettingsRequest {
                task_models: None,
                batch_size: None,
                max_concurrency: None,
                timeout_minutes: Some(30),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(s.timeout_minutes, 30);
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["maxConcurrency"], 1);
        assert_eq!(v["taskModels"][0]["task"], "extract");

        // 重试次数、后台任务数、AI 老师权限与推荐：默认值、校验、保存
        assert_eq!(
            (
                s.max_retries,
                s.job_slots,
                s.tutor_permission.as_str(),
                s.tutor_suggestions
            ),
            (
                DEFAULT_RETRIES,
                DEFAULT_JOB_SLOTS,
                DEFAULT_TUTOR_PERMISSION,
                true
            )
        );
        for bad in [
            UpdateAgentSettingsRequest {
                max_retries: Some(11),
                ..Default::default()
            },
            UpdateAgentSettingsRequest {
                job_slots: Some(0),
                ..Default::default()
            },
            UpdateAgentSettingsRequest {
                tutor_permission: Some("all".into()),
                ..Default::default()
            },
        ] {
            assert!(service.update(bad).await.is_err());
        }
        let s = service
            .update(UpdateAgentSettingsRequest {
                max_retries: Some(0),
                job_slots: Some(3),
                tutor_permission: Some("view_only".into()),
                tutor_suggestions: Some(false),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(
            (
                s.max_retries,
                s.job_slots,
                s.tutor_permission.as_str(),
                s.tutor_suggestions
            ),
            (0, 3, "view_only", false)
        );
        assert_eq!(max_retries(), 0);
        service
            .update(UpdateAgentSettingsRequest {
                max_retries: Some(DEFAULT_RETRIES),
                ..Default::default()
            })
            .await
            .unwrap();
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
