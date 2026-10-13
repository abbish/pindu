//! 本机模型文件的下载（发音评估、语音输入共用；字幕识别的模型更大，另有断点续传与来源选择，见 subtitle_recognition）：
//! 依次试几个地址，边下边算 sha256，校验通过才放到位；30 秒没收到数据算断了，停止随时生效。

use crate::error::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncWriteExt;

/// 一个模型文件
pub struct ModelFile {
    /// 存到模型目录下的文件名（可带子目录）
    pub name: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    /// 下载地址（按顺序试）
    pub urls: &'static [&'static str],
}

/// 一块数据多久没到算断了
const STALL: Duration = Duration::from_secs(30);
/// 等数据时多久看一次是否取消
const CANCEL_POLL: Duration = Duration::from_millis(500);

pub fn models_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("models")
}

impl ModelFile {
    pub fn path(&self, data_dir: &Path) -> PathBuf {
        models_dir(data_dir).join(self.name)
    }

    pub fn ready(&self, data_dir: &Path) -> bool {
        std::fs::metadata(self.path(data_dir)).is_ok_and(|m| m.len() == self.bytes)
    }

    pub fn delete(&self, data_dir: &Path) -> AppResult<()> {
        match std::fs::remove_file(self.path(data_dir)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(AppError::InternalError(format!("删除模型失败：{e}"))),
        }
    }
}

/// 没有就下载（依次试各地址），进度是这个文件的 0–1；`what` 用在出错提示里（如「发音评估模型」）
pub async fn ensure(
    data_dir: &Path,
    file: &ModelFile,
    what: &str,
    mut on_progress: impl FnMut(f64),
    cancelled: impl Fn() -> bool,
) -> AppResult<PathBuf> {
    let target = file.path(data_dir);
    if file.ready(data_dir) {
        return Ok(target);
    }
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| AppError::InternalError(format!("准备模型目录失败：{e}")))?;
    }
    let part = target.with_extension("part");
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::ExternalServiceError(format!("无法下载{what}：{e}")))?;
    let mut reasons = Vec::new();
    for url in file.urls {
        match download(&client, url, file, &part, &mut on_progress, &cancelled).await {
            Ok(()) => {
                std::fs::rename(&part, &target)
                    .map_err(|e| AppError::InternalError(format!("保存{what}失败：{e}")))?;
                return Ok(target);
            }
            Err(e) if cancelled() => {
                let _ = std::fs::remove_file(&part);
                return Err(e);
            }
            Err(e) => reasons.push(e.to_string()),
        }
    }
    let _ = std::fs::remove_file(&part);
    tracing::warn!("{what}下载失败：{}", reasons.join("；"));
    Err(AppError::ExternalServiceError(format!(
        "{what}下载不下来，请检查网络后再试"
    )))
}

async fn download(
    client: &reqwest::Client,
    url: &str,
    file: &ModelFile,
    to: &Path,
    on_progress: &mut impl FnMut(f64),
    cancelled: &impl Fn() -> bool,
) -> AppResult<()> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::ExternalServiceError(format!("{url}：{e}")))?;
    if !response.status().is_success() {
        return Err(AppError::ExternalServiceError(format!(
            "{url}：HTTP {}",
            response.status()
        )));
    }
    let mut out = tokio::fs::File::create(to)
        .await
        .map_err(|e| AppError::InternalError(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut got = 0u64;
    loop {
        // 边等数据边看是否取消；太久没有数据算断了（不然会一直挂着）
        let mut waited = Duration::ZERO;
        let next = loop {
            if cancelled() {
                return Err(AppError::ValidationError("已停止下载".to_string()));
            }
            match tokio::time::timeout(CANCEL_POLL, response.chunk()).await {
                Ok(next) => break next,
                Err(_) => {
                    waited += CANCEL_POLL;
                    if waited >= STALL {
                        return Err(AppError::ExternalServiceError(format!(
                            "{url}：太久没有收到数据"
                        )));
                    }
                }
            }
        };
        let Some(chunk) =
            next.map_err(|e| AppError::ExternalServiceError(format!("{url}：{e}")))?
        else {
            break;
        };
        hasher.update(&chunk);
        out.write_all(&chunk)
            .await
            .map_err(|e| AppError::InternalError(e.to_string()))?;
        got += chunk.len() as u64;
        on_progress((got as f64 / file.bytes as f64).min(1.0));
    }
    out.flush()
        .await
        .map_err(|e| AppError::InternalError(e.to_string()))?;
    let digest: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if digest != file.sha256 {
        return Err(AppError::ExternalServiceError(format!(
            "{url}：文件校验不对"
        )));
    }
    Ok(())
}
