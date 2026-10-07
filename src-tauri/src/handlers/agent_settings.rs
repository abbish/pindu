//! 「设置 → AI 助手」：按任务选择模型、批量分析参数

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
    logger.api_response(
        "update_agent_settings",
        result.is_ok(),
        result.as_ref().err().map(|e| e.to_string()).as_deref(),
    );
    result
}
