//! 「设置 → AI 任务」：按任务选择模型、批量分析参数、等待与重试、后台任务数、AI 老师对话的权限与推荐

use crate::error::AppResult;
use crate::logger::Logger;
use crate::services::agent_settings::{
    AgentSettings, AgentSettingsService, UpdateAgentSettingsRequest,
};
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

fn service(app: &AppHandle) -> AgentSettingsService {
    AgentSettingsService::new(
        Arc::new(app.state::<SqlitePool>().inner().clone()),
        Arc::new(app.state::<Logger>().inner().clone()),
    )
}

#[tauri::command]
pub async fn get_agent_settings(app: AppHandle) -> AppResult<AgentSettings> {
    let logger = app.state::<Logger>();
    logger.api_request("get_agent_settings", None);
    let result = service(&app).get().await;
    logger.api_response(
        "get_agent_settings",
        result.is_ok(),
        result.as_ref().err().map(|e| e.to_string()).as_deref(),
    );
    result
}

#[tauri::command]
pub async fn update_agent_settings(
    app: AppHandle,
    request: UpdateAgentSettingsRequest,
) -> AppResult<AgentSettings> {
    let logger = app.state::<Logger>();
    logger.api_request("update_agent_settings", Some(&format!("{:?}", request)));
    let result = service(&app).update(request).await;
    if let Ok(settings) = &result {
        app.state::<crate::jobs::Jobs>()
            .set_agent_slots(settings.job_slots as usize);
        // AI 老师对话按新设置（模型、权限、推荐）重新启动：空闲的对话进程先关掉，下次发消息时接着原来的对话
        app.state::<crate::agent::chat::ChatHub>()
            .close_idle(std::time::Duration::ZERO)
            .await;
    }
    logger.api_response(
        "update_agent_settings",
        result.is_ok(),
        result.as_ref().err().map(|e| e.to_string()).as_deref(),
    );
    result
}
