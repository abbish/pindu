//! 「设置 → AI 助手 → 学习者与风格」：学习者档案、讲解 / 答疑风格、各任务补充要求，以及系统提示词预览

use super::finish;
use crate::error::AppResult;
use crate::logger::Logger;
use crate::prompts::PromptProfile;
use crate::services::prompt_profile::{PromptPreview, PromptProfileService};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_prompt_profile(app: AppHandle) -> AppResult<PromptProfile> {
    let logger = app.state::<Logger>();
    logger.api_request("get_prompt_profile", None);
    let result = PromptProfileService::load(app.state::<SqlitePool>().inner()).await;
    finish(&logger, "get_prompt_profile", result)
}

#[tauri::command]
pub async fn update_prompt_profile(
    app: AppHandle,
    request: PromptProfile,
) -> AppResult<PromptProfile> {
    let logger = app.state::<Logger>();
    logger.api_request("update_prompt_profile", Some(&format!("{:?}", request)));
    let result = PromptProfileService::save(app.state::<SqlitePool>().inner(), &request).await;
    finish(&logger, "update_prompt_profile", result)
}

/// 套用预设（primary / secondary / adult）；保留兴趣场景、老师称呼与补充要求
#[tauri::command]
pub async fn apply_prompt_preset(app: AppHandle, preset: String) -> AppResult<PromptProfile> {
    let logger = app.state::<Logger>();
    logger.api_request("apply_prompt_preset", Some(&preset));
    let result =
        PromptProfileService::apply_preset(app.state::<SqlitePool>().inner(), &preset).await;
    finish(&logger, "apply_prompt_preset", result)
}

/// 按传入的档案（可以是尚未保存的）渲染各任务的系统提示词，只读预览
#[tauri::command]
pub async fn preview_prompts(
    app: AppHandle,
    request: PromptProfile,
) -> AppResult<Vec<PromptPreview>> {
    let logger = app.state::<Logger>();
    logger.api_request("preview_prompts", None);
    let result = PromptProfileService::preview(&request);
    finish(&logger, "preview_prompts", result)
}
