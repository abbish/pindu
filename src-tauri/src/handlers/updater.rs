//! 应用内更新（tauri-plugin-updater）：检查 → 下载并安装（进度经 Channel 推送）→ 重启。
//!
//! 更新源是 GitHub Releases 上的 `latest.json`（tauri.conf.json `plugins.updater.endpoints`）；
//! 下载的安装包用内置公钥验签，签名不对就拒绝安装。开发版可用环境变量 `PINDU_UPDATE_ENDPOINT` 临时换更新地址（本地测试）。
//! 有 AI 任务（agent sidecar）在运行时不安装；开始安装后不再启动新的 sidecar（见 `agent::session`）。

use crate::agent::session::{begin_update_install, cancel_update_install};
use crate::error::{AppError, AppResult};
use crate::handlers::finish;
use crate::logger::Logger;
use crate::types::common::{UpdateInfo, UpdateProgress};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

/// 最近一次检查到、等待安装的更新（安装失败时保留，便于重试）
#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

/// 前端据此把错误说成“更新服务器”的问题（而不是 AI 服务），见 `src/api/errors.ts`
const CHECK_FAILED: &str = "检查更新失败";
const INSTALL_FAILED: &str = "安装更新失败";

fn updater(app: &AppHandle) -> AppResult<Updater> {
    #[allow(unused_mut)]
    let mut builder = app.updater_builder();
    #[cfg(debug_assertions)]
    if let Some(url) = std::env::var("PINDU_UPDATE_ENDPOINT")
        .ok()
        .filter(|v| !v.is_empty())
    {
        let url = url
            .parse()
            .map_err(|e| AppError::ValidationError(format!("更新地址无效：{e}")))?;
        builder = builder
            .endpoints(vec![url])
            .map_err(|e| AppError::ValidationError(format!("更新地址无效：{e}")))?;
    }
    builder
        .build()
        .map_err(|e| AppError::InternalError(format!("无法初始化更新：{e}")))
}

/// 能否在应用内安装：Linux 只有 AppImage 支持，deb / rpm 装的只提示去下载
fn can_install() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

/// 检查更新：有新版本返回版本信息（并记下，供 install_update 使用），已是最新返回 None
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> AppResult<Option<UpdateInfo>> {
    let logger = app.state::<Logger>().inner().clone();
    logger.api_request("check_for_update", None);
    let result = async {
        let update = updater(&app)?
            .check()
            .await
            .map_err(|e| AppError::ExternalServiceError(format!("{CHECK_FAILED}：{e}")))?;
        let info = update.as_ref().map(|u| UpdateInfo {
            version: u.version.clone(),
            current_version: u.current_version.clone(),
            notes: u.body.clone(),
            can_install: can_install(),
        });
        *app.state::<PendingUpdate>().0.lock().unwrap() = update;
        Ok(info)
    }
    .await;
    finish(&logger, "check_for_update", result)
}

/// 下载并安装检查到的更新；进度（已下载字节 / 总字节）经 `on_progress` 推送。
/// Windows 上安装器会接管并关闭应用；其它系统安装完成后由前端调用 restart_app。
#[tauri::command]
pub async fn install_update(app: AppHandle, on_progress: Channel<UpdateProgress>) -> AppResult<()> {
    let logger = app.state::<Logger>().inner().clone();
    logger.api_request("install_update", None);
    // 克隆而不是取走：安装失败时还能直接重试
    let pending = app.state::<PendingUpdate>().0.lock().unwrap().clone();
    let result = async {
        let update = pending.ok_or_else(|| {
            AppError::ValidationError("没有待安装的更新，请先检查更新".to_string())
        })?;
        if !can_install() {
            return Err(AppError::ValidationError(
                "这种安装方式不支持应用内更新，请下载新的安装包".to_string(),
            ));
        }
        let active = app.state::<crate::jobs::Jobs>().active_titles();
        if !active.is_empty() {
            return Err(AppError::ValidationError(format!(
                "「{}」等 {} 个后台任务正在进行，等它们完成后再更新",
                active[0],
                active.len()
            )));
        }
        if let Err(n) = begin_update_install() {
            return Err(AppError::ValidationError(format!(
                "有 {n} 个 AI 任务正在进行，等它们完成后再更新"
            )));
        }
        let mut downloaded: u64 = 0;
        let mut last_percent: Option<u64> = None;
        let installed = update
            .download_and_install(
                |chunk, total| {
                    downloaded += chunk as u64;
                    // 按百分比节流，避免每个数据块都推一次
                    let percent = total.map(|t| downloaded * 100 / t.max(1));
                    if percent.is_none() || percent != last_percent {
                        last_percent = percent;
                        let _ = on_progress.send(UpdateProgress { downloaded, total });
                    }
                },
                || {},
            )
            .await
            .map_err(|e| AppError::ExternalServiceError(format!("{INSTALL_FAILED}：{e}")));
        match installed {
            Ok(()) => {
                *app.state::<PendingUpdate>().0.lock().unwrap() = None;
                logger.info("UPDATE", &format!("Installed {}", update.version));
                Ok(())
            }
            Err(e) => {
                cancel_update_install();
                Err(e)
            }
        }
    }
    .await;
    finish(&logger, "install_update", result)
}

/// 重启应用（安装更新后）
#[tauri::command]
pub async fn restart_app(app: AppHandle) -> AppResult<()> {
    app.state::<Logger>()
        .info("UPDATE", "Restarting to finish update");
    app.restart()
}
