//! 局域网设备互传命令（设置 → 附近的设备）：开关与名字、附近的设备、配对与取消配对。
//! 业务在 `lan::LanNode`（数据库打开后由 lib.rs 创建并 manage）。

use super::finish;
use crate::error::{AppError, AppResult};
use crate::lan::LanNode;
use crate::logger::Logger;
use crate::types::lan::{
    LanStatus, NearbyDevice, PairRequest, PairedDevice, PairingStarted, UpdateLanSettingsRequest,
};
use tauri::{AppHandle, Manager};

fn node(app: &AppHandle) -> AppResult<LanNode> {
    app.try_state::<LanNode>()
        .map(|n| n.inner().clone())
        .ok_or_else(|| AppError::InternalError("设备互传还没有准备好，请稍后再试".into()))
}

fn short(fingerprint: &str) -> &str {
    &fingerprint[..fingerprint.len().min(12)]
}

#[tauri::command]
pub async fn get_lan_status(app: AppHandle) -> AppResult<LanStatus> {
    Ok(node(&app)?.status())
}

#[tauri::command]
pub async fn update_lan_settings(
    app: AppHandle,
    request: UpdateLanSettingsRequest,
) -> AppResult<LanStatus> {
    let logger = app.state::<Logger>();
    let cmd = "update_lan_settings";
    logger.api_request(
        cmd,
        Some(&format!(
            "enabled={} alias={}",
            request.enabled, request.alias
        )),
    );
    let result = match node(&app) {
        Ok(n) => n.update_settings(request.enabled, &request.alias).await,
        Err(e) => Err(e),
    };
    finish(&logger, cmd, result)
}

#[tauri::command]
pub async fn get_nearby_devices(app: AppHandle) -> AppResult<Vec<NearbyDevice>> {
    node(&app)?.nearby().await
}

#[tauri::command]
pub async fn refresh_nearby_devices(app: AppHandle) -> AppResult<()> {
    node(&app)?.refresh();
    Ok(())
}

#[tauri::command]
pub async fn add_device_by_address(app: AppHandle, address: String) -> AppResult<NearbyDevice> {
    let logger = app.state::<Logger>();
    let cmd = "add_device_by_address";
    logger.api_request(cmd, Some(&address));
    let result = match node(&app) {
        Ok(n) => n.add_by_address(&address).await,
        Err(e) => Err(e),
    };
    finish(&logger, cmd, result)
}

#[tauri::command]
pub async fn start_pairing(app: AppHandle, fingerprint: String) -> AppResult<PairingStarted> {
    let logger = app.state::<Logger>();
    let cmd = "start_pairing";
    logger.api_request(cmd, Some(short(&fingerprint)));
    let result = match node(&app) {
        Ok(n) => n.start_pairing(&fingerprint).await,
        Err(e) => Err(e),
    };
    finish(&logger, cmd, result)
}

#[tauri::command]
pub async fn cancel_pairing(app: AppHandle, pairing_id: String) -> AppResult<()> {
    node(&app)?.cancel_pairing(&pairing_id);
    Ok(())
}

#[tauri::command]
pub async fn respond_pair_request(
    app: AppHandle,
    request_id: String,
    accept: bool,
) -> AppResult<()> {
    let logger = app.state::<Logger>();
    let cmd = "respond_pair_request";
    logger.api_request(cmd, Some(&format!("{request_id} accept={accept}")));
    let result = node(&app).and_then(|n| n.respond(&request_id, accept));
    finish(&logger, cmd, result)
}

#[tauri::command]
pub async fn get_pending_pair_requests(app: AppHandle) -> AppResult<Vec<PairRequest>> {
    Ok(node(&app)?.pending_requests())
}

#[tauri::command]
pub async fn get_paired_devices(app: AppHandle) -> AppResult<Vec<PairedDevice>> {
    node(&app)?.paired().await
}

#[tauri::command]
pub async fn unpair_device(app: AppHandle, fingerprint: String) -> AppResult<()> {
    let logger = app.state::<Logger>();
    let cmd = "unpair_device";
    logger.api_request(cmd, Some(short(&fingerprint)));
    let result = match node(&app) {
        Ok(n) => n.unpair(&fingerprint).await,
        Err(e) => Err(e),
    };
    finish(&logger, cmd, result)
}
