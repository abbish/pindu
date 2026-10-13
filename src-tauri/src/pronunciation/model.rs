//! 发音模型：ZIPA small CTC（int8 ONNX，约 71MB，CC-BY-4.0，`anyspeech/zipa-small-crctc-500k`）。
//! 第一次用时下载到 `<数据目录>/models/`（Hugging Face，连不上换国内镜像；按 sha256 校验），之后离线可用；
//! 用 ONNX Runtime（`ort`）在本机推理，会话加载一次后常驻。

use super::fbank;
use crate::error::{AppError, AppResult};
use crate::model_download::ModelFile;
use ort::session::Session;
use ort::value::Tensor;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 发音模型文件
pub const FILE: ModelFile = ModelFile {
    name: "zipa-small-crctc-500k.int8.onnx",
    bytes: 70_677_672,
    sha256: "d0e28b68164e8b1fbd6105100c01798828aa0855000ce9bbbd1a2cec233adf13",
    urls: &[
        "https://huggingface.co/anyspeech/zipa-small-crctc-500k/resolve/main/model.int8.onnx",
        "https://hf-mirror.com/anyspeech/zipa-small-crctc-500k/resolve/main/model.int8.onnx",
    ],
};
pub const BYTES: u64 = FILE.bytes;

pub fn path(data_dir: &Path) -> PathBuf {
    FILE.path(data_dir)
}

pub fn ready(data_dir: &Path) -> bool {
    FILE.ready(data_dir)
}

/// 删掉模型（设置里「删除」）；会话同时卸载（正在评估时等它算完）
pub fn delete(data_dir: &Path) -> AppResult<()> {
    *session_lock() = None;
    FILE.delete(data_dir)
}

/// 没有就下载，返回模型路径
pub async fn ensure(
    data_dir: &Path,
    on_progress: impl FnMut(f64),
    cancelled: impl Fn() -> bool,
) -> AppResult<PathBuf> {
    crate::model_download::ensure(data_dir, &FILE, "发音评估模型", on_progress, cancelled).await
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);

/// 会话锁；上次推理出错（锁中毒）时接着用，不至于要重启
fn session_lock() -> std::sync::MutexGuard<'static, Option<Session>> {
    SESSION.lock().unwrap_or_else(|e| e.into_inner())
}

/// 16kHz 单声道采样 → 每帧每个字符的对数概率（帧数，字表大小，数据）
pub fn log_probs(model: &Path, samples: &[f32]) -> AppResult<(usize, usize, Vec<f32>)> {
    let feats = fbank::fbank(samples);
    let frames = feats.len() / fbank::NUM_BINS;
    if frames == 0 {
        return Err(AppError::ValidationError("录音太短了".to_string()));
    }
    let mut guard = session_lock();
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
