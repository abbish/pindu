//! 发音模型：ZIPA small CTC（int8 ONNX，约 71MB，CC-BY-4.0，`anyspeech/zipa-small-crctc-500k`）。
//! 第一次用时下载到 `<数据目录>/models/`（Hugging Face，连不上换国内镜像；按 sha256 校验），之后离线可用；
//! 用 ONNX Runtime（`ort`）在本机推理，会话加载一次后常驻。

use super::fbank;
use crate::error::{AppError, AppResult};
use ort::session::Session;
use ort::value::Tensor;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

const FILE: &str = "zipa-small-crctc-500k.int8.onnx";
pub const BYTES: u64 = 70_677_672;
const SHA256: &str = "d0e28b68164e8b1fbd6105100c01798828aa0855000ce9bbbd1a2cec233adf13";
const SOURCES: [&str; 2] = [
    "https://huggingface.co/anyspeech/zipa-small-crctc-500k/resolve/main/model.int8.onnx",
    "https://hf-mirror.com/anyspeech/zipa-small-crctc-500k/resolve/main/model.int8.onnx",
];

pub fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("models").join(FILE)
}

pub fn ready(data_dir: &Path) -> bool {
    std::fs::metadata(path(data_dir)).is_ok_and(|m| m.len() == BYTES)
}

/// 删掉模型（设置里「删除」）；会话同时卸载
pub fn delete(data_dir: &Path) -> AppResult<()> {
    if let Ok(mut s) = SESSION.lock() {
        *s = None;
    }
    match std::fs::remove_file(path(data_dir)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::InternalError(format!("删除发音模型失败：{e}"))),
    }
}

/// 没有就下载（依次试各来源），返回模型路径
pub async fn ensure(
    data_dir: &Path,
    mut on_progress: impl FnMut(f64),
    cancelled: impl Fn() -> bool,
) -> AppResult<PathBuf> {
    let target = path(data_dir);
    if ready(data_dir) {
        return Ok(target);
    }
    std::fs::create_dir_all(data_dir.join("models"))
        .map_err(|e| AppError::InternalError(format!("准备模型目录失败：{e}")))?;
    let part = target.with_extension("part");
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::ExternalServiceError(format!("无法下载发音模型：{e}")))?;
    let mut reasons = Vec::new();
    for url in SOURCES {
        match download(&client, url, &part, &mut on_progress, &cancelled).await {
            Ok(()) => {
                std::fs::rename(&part, &target)
                    .map_err(|e| AppError::InternalError(format!("保存发音模型失败：{e}")))?;
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
    tracing::warn!("发音模型下载失败：{}", reasons.join("；"));
    Err(AppError::ExternalServiceError(
        "发音评估模型下载不下来，请检查网络后再试".to_string(),
    ))
}

async fn download(
    client: &reqwest::Client,
    url: &str,
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
    let mut file = tokio::fs::File::create(to)
        .await
        .map_err(|e| AppError::InternalError(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut got = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::ExternalServiceError(format!("{url}：{e}")))?
    {
        if cancelled() {
            return Err(AppError::ValidationError("已停止下载".to_string()));
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::InternalError(e.to_string()))?;
        got += chunk.len() as u64;
        on_progress((got as f64 / BYTES as f64).min(1.0));
    }
    file.flush()
        .await
        .map_err(|e| AppError::InternalError(e.to_string()))?;
    let digest: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if digest != SHA256 {
        return Err(AppError::ExternalServiceError(format!(
            "{url}：文件校验不对"
        )));
    }
    Ok(())
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);

/// 16kHz 单声道采样 → 每帧每个字符的对数概率（帧数，字表大小，数据）
pub fn log_probs(model: &Path, samples: &[f32]) -> AppResult<(usize, usize, Vec<f32>)> {
    let feats = fbank::fbank(samples);
    let frames = feats.len() / fbank::NUM_BINS;
    if frames == 0 {
        return Err(AppError::ValidationError("录音太短了".to_string()));
    }
    let mut guard = SESSION
        .lock()
        .map_err(|_| AppError::InternalError("发音模型不可用".to_string()))?;
    if guard.is_none() {
        let load = |e: String| AppError::InternalError(format!("加载发音模型失败：{e}"));
        let session = Session::builder()
            .map_err(|e| load(e.to_string()))?
            .with_intra_threads(2)
            .map_err(|e| load(e.to_string()))?
            .commit_from_file(model)
            .map_err(|e| load(e.to_string()))?;
        *guard = Some(session);
    }
    let session = guard.as_mut().expect("刚加载");
    let ort_err = |e: ort::Error| AppError::InternalError(format!("发音评估失败：{e}"));
    let x = Tensor::from_array(([1usize, frames, fbank::NUM_BINS], feats)).map_err(ort_err)?;
    let lens = Tensor::from_array(([1usize], vec![frames as i64])).map_err(ort_err)?;
    let out = session
        .run(ort::inputs!["x" => x, "x_lens" => lens])
        .map_err(ort_err)?;
    let (shape, data) = out["log_probs"]
        .try_extract_tensor::<f32>()
        .map_err(ort_err)?;
    let (_, len_data) = out["log_probs_len"]
        .try_extract_tensor::<i64>()
        .map_err(ort_err)?;
    let vocab = shape[2] as usize;
    let valid = (len_data[0].max(0) as usize).min(shape[1] as usize);
    Ok((valid, vocab, data[..valid * vocab].to_vec()))
}
