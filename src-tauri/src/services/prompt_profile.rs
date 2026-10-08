//! 学习者档案与 AI 风格（设置页「AI 助手 → 学习者与风格」）：保存在 app_settings 的 `prompt.profile`（JSON），
//! 各 AI 任务按它渲染系统提示词（模板与片段见 `crate::prompts`）。

use crate::error::{AppError, AppResult};
use crate::prompts::{self, PromptProfile, PromptTask};
use crate::repositories::settings_repository::SettingsRepository;
use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::Arc;

const PROFILE_KEY: &str = "prompt.profile";

/// 渲染后的系统提示词（只读预览）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPreview {
    pub task: String,
    pub label: String,
    pub content: String,
}

pub struct PromptProfileService;

impl PromptProfileService {
    /// 当前档案；未设置或存的内容无法解析时用默认档案（小学生），缺的字段取默认值
    pub async fn load(pool: &SqlitePool) -> AppResult<PromptProfile> {
        let stored = SettingsRepository::get(pool, PROFILE_KEY).await?;
        Ok(stored
            .and_then(|json| serde_json::from_str::<PromptProfile>(&json).ok())
            .filter(|p| p.validate().is_ok())
            .unwrap_or_default())
    }

    pub async fn save(pool: &SqlitePool, profile: &PromptProfile) -> AppResult<PromptProfile> {
        profile.validate().map_err(AppError::ValidationError)?;
        let mut normalized = profile.clone();
        normalized.tutor_name = normalized.tutor_name.trim().to_string();
        normalized.interests = normalized
            .interests
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        normalized.custom.retain(|_, v| {
            *v = v.trim().to_string();
            !v.is_empty()
        });
        let json = serde_json::to_string(&normalized)
            .map_err(|e| AppError::InternalError(format!("保存学习者档案失败：{}", e)))?;
        let mut conn = pool.acquire().await?;
        SettingsRepository::set(&mut conn, PROFILE_KEY, Some(&json)).await?;
        Ok(normalized)
    }

    /// 套用预设：替换学习者、语言与风格，保留兴趣场景、老师称呼与补充要求
    pub async fn apply_preset(pool: &SqlitePool, preset: &str) -> AppResult<PromptProfile> {
        let base = PromptProfile::preset(preset)
            .ok_or_else(|| AppError::ValidationError(format!("未知的预设：{}", preset)))?;
        let current = Self::load(pool).await?;
        let profile = PromptProfile {
            interests: current.interests,
            tutor_name: current.tutor_name,
            custom: current.custom,
            ..base
        };
        Self::save(pool, &profile).await
    }

    /// 按（尚未保存的）档案渲染各任务的系统提示词，供设置页预览
    pub fn preview(profile: &PromptProfile) -> AppResult<Vec<PromptPreview>> {
        profile.validate().map_err(AppError::ValidationError)?;
        let rules = prompts::extract_mode_rules("focus", crate::agent::tasks::FOCUS_STOPWORDS);
        Ok(PromptTask::ALL
            .into_iter()
            .map(|task| PromptPreview {
                task: task.key().to_string(),
                label: task.label().to_string(),
                content: prompts::system_prompt(task, profile, &[("mode_rules", &rules)]),
            })
            .collect())
    }

    /// 单词本场景（标题 + 描述 + 主题标签），作为 AI 任务用户消息里的背景；没有单词本或已删除时为空
    pub async fn book_scene(
        pool: &Arc<SqlitePool>,
        logger: &Arc<crate::logger::Logger>,
        book_id: Option<crate::types::common::Id>,
    ) -> AppResult<String> {
        let Some(book_id) = book_id else {
            return Ok(String::new());
        };
        let book = crate::repositories::wordbook_repository::WordBookRepository::new(
            pool.clone(),
            logger.clone(),
        )
        .find_by_id(book_id)
        .await?;
        Ok(book
            .map(|b| {
                let tags: Vec<String> = b
                    .theme_tags
                    .unwrap_or_default()
                    .into_iter()
                    .map(|t| t.name)
                    .collect();
                prompts::book_scene(&b.title, &b.description, &tags)
            })
            .unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::memory_pool;

    #[tokio::test]
    async fn profile_round_trips_and_presets_keep_personal_fields() {
        let pool = memory_pool().await;
        assert_eq!(
            PromptProfileService::load(&pool).await.unwrap(),
            PromptProfile::default()
        );

        let mut p = PromptProfile::preset("primary").unwrap();
        p.interests = vec![" 足球 ".into(), "".into()];
        p.tutor_name = " Lark ".into();
        p.custom.insert("explain".into(), "  ".into());
        p.custom.insert("tutor".into(), "多用英文".into());
        let saved = PromptProfileService::save(&pool, &p).await.unwrap();
        assert_eq!(saved.interests, vec!["足球"]);
        assert_eq!(saved.tutor_name, "Lark");
        assert!(!saved.custom.contains_key("explain"));
        assert_eq!(PromptProfileService::load(&pool).await.unwrap(), saved);

        let adult = PromptProfileService::apply_preset(&pool, "adult")
            .await
            .unwrap();
        assert_eq!(adult.learner, "adult");
        assert_eq!(adult.tutor_style, "concise");
        assert_eq!(adult.interests, vec!["足球"]);
        assert_eq!(
            adult.custom.get("tutor").map(String::as_str),
            Some("多用英文")
        );
        assert!(PromptProfileService::apply_preset(&pool, "x")
            .await
            .is_err());

        let mut bad = PromptProfile::preset("primary").unwrap();
        bad.language = "fr".into();
        assert!(PromptProfileService::save(&pool, &bad).await.is_err());
    }

    #[test]
    fn preview_renders_every_task() {
        let previews = PromptProfileService::preview(&PromptProfile::default()).unwrap();
        assert_eq!(previews.len(), PromptTask::ALL.len());
        assert!(previews.iter().all(|p| !p.content.contains("{{")));
    }
}
