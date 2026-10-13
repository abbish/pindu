//! 语音输入：一小段录音在本机转成文字（AI 老师对话、开放题口头回答），中英文都认。
//! 模型 SenseVoice-Small（阿里通义 FunAudioLLM，int8 ONNX，约 228MB，sherpa-onnx 导出版；FunASR 模型协议 1.1：
//! 注明出处、保留模型名），第一次用时下载到 `<数据目录>/models/sense-voice-small/`，用 `ort` 在本机推理。
//! 前处理与解码照 sherpa-onnx：fbank（`fbank::SENSE_VOICE`）→ 低帧率拼帧（7 帧拼一帧、每 6 帧取一次）→ 归一化
//! → 模型 → 逐帧取最大、去掉前 4 个标记（语言 / 情绪 / 事件 / 文本规整）、合并重复、去掉空白。
//! 选型实测见 `.claude/work/pronunciation-spike/evidence.md`。

use crate::error::{AppError, AppResult};
use crate::model_download::ModelFile;
use crate::pronunciation::fbank;
use ort::session::Session;
use ort::value::Tensor;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

pub const MODEL: ModelFile = ModelFile {
    name: "sense-voice-small/model.int8.onnx",
    bytes: 239_233_841,
    sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
    urls: &[
        "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx",
        "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx",
    ],
};

pub const TOKENS: ModelFile = ModelFile {
    name: "sense-voice-small/tokens.txt",
    bytes: 315_894,
    sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
    urls: &[
        "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt",
        "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt",
    ],
};

pub const BYTES: u64 = MODEL.bytes + TOKENS.bytes;
/// 一次最长 60 秒
pub const MAX_SECONDS: usize = 60;
/// 输出开头的 4 个标记：语言、情绪、事件、是否规整
const PREFIX_TOKENS: usize = 4;
const BLANK: usize = 0;

/// 说的是什么语言（模型的语言编号在模型元数据里）
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Language {
    /// 中文为主（夹着英文单词也认）
    Zh,
    En,
}

pub fn ready(data_dir: &Path) -> bool {
    MODEL.ready(data_dir) && TOKENS.ready(data_dir)
}

/// 没有就下载（词表很小，进度按模型算）
pub async fn ensure(
    data_dir: &Path,
    on_progress: impl FnMut(f64),
    cancelled: impl Fn() -> bool,
) -> AppResult<()> {
    crate::model_download::ensure(data_dir, &TOKENS, "语音输入模型", |_| {}, &cancelled).await?;
    crate::model_download::ensure(data_dir, &MODEL, "语音输入模型", on_progress, &cancelled)
        .await?;
    Ok(())
}

/// 删掉模型；推理会话同时卸载
pub fn delete(data_dir: &Path) -> AppResult<()> {
    *engine_lock() = None;
    MODEL.delete(data_dir)?;
    TOKENS.delete(data_dir)
}

struct Engine {
    session: Session,
    tokens: Vec<String>,
    neg_mean: Vec<f32>,
    inv_stddev: Vec<f32>,
    lfr_window: usize,
    lfr_shift: usize,
    lang_zh: i32,
    lang_en: i32,
    with_itn: i32,
}

static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);
/// 上次用的时刻：空闲 `IDLE_UNLOAD` 后卸载（模型常驻内存要几百 MB）
static LAST_USED: Mutex<Option<std::time::Instant>> = Mutex::new(None);
pub const IDLE_UNLOAD: std::time::Duration = std::time::Duration::from_secs(600);

/// 空闲够久就卸载；正在识别（拿着锁）时不动，下次用时重新加载
pub fn unload_if_idle() {
    let idle = LAST_USED
        .lock()
        .map(|t| t.is_some_and(|t| t.elapsed() >= IDLE_UNLOAD))
        .unwrap_or(false);
    if idle {
        if let Ok(mut engine) = ENGINE.try_lock() {
            *engine = None;
        }
    }
}

fn engine_lock() -> MutexGuard<'static, Option<Engine>> {
    ENGINE.lock().unwrap_or_else(|e| e.into_inner())
}

fn load(data_dir: &Path) -> AppResult<Engine> {
    // 检查过之后模型被删了：按没下载处理，界面会引导重新下载
    let fail = |e: String| {
        if ready(data_dir) {
            AppError::InternalError(format!("加载语音输入模型失败：{e}"))
        } else {
            AppError::NotFound("语音输入模型还没有下载".to_string())
        }
    };
    let session = Session::builder()
        .map_err(|e| fail(e.to_string()))?
        .with_intra_threads(2)
        .map_err(|e| fail(e.to_string()))?
        .commit_from_file(MODEL.path(data_dir))
        .map_err(|e| fail(e.to_string()))?;
    let meta = session.metadata().map_err(|e| fail(e.to_string()))?;
    let get = |k: &str| meta.custom(k).ok_or_else(|| fail(format!("模型缺少 {k}")));
    let floats = |k: &str| -> AppResult<Vec<f32>> {
        get(k)?
            .split(',')
            .map(|v| {
                v.trim()
                    .parse::<f32>()
                    .map_err(|e| fail(format!("{k}：{e}")))
            })
            .collect()
    };
    let int = |k: &str| -> AppResult<i32> {
        get(k)?
            .trim()
            .parse::<i32>()
            .map_err(|e| fail(format!("{k}：{e}")))
    };
    let (neg_mean, inv_stddev) = (floats("neg_mean")?, floats("inv_stddev")?);
    let (lfr_window, lfr_shift) = (
        int("lfr_window_size")? as usize,
        int("lfr_window_shift")? as usize,
    );
    let (lang_zh, lang_en, with_itn) = (int("lang_zh")?, int("lang_en")?, int("with_itn")?);
    drop(meta);
    let raw = std::fs::read_to_string(TOKENS.path(data_dir)).map_err(|e| fail(e.to_string()))?;
    let mut tokens = Vec::new();
    for line in raw.lines() {
        let (text, id) = line
            .rsplit_once(' ')
            .ok_or_else(|| fail("词表格式不对".into()))?;
        let id: usize = id.parse().map_err(|_| fail("词表格式不对".into()))?;
        if tokens.len() <= id {
            tokens.resize(id + 1, String::new());
        }
        tokens[id] = text.to_string();
    }
    if neg_mean.len() != fbank::NUM_BINS * lfr_window || inv_stddev.len() != neg_mean.len() {
        return Err(fail("归一化参数长度不对".into()));
    }
    Ok(Engine {
        session,
        tokens,
        neg_mean,
        inv_stddev,
        lfr_window,
        lfr_shift,
        lang_zh,
        lang_en,
        with_itn,
    })
}

/// 低帧率拼帧 + 归一化（照 sherpa-onnx 的 ApplyLfr / ApplyCMVN）：第 i 帧以 i × shift 为中心、左边 (window - 1) / 2 帧，
/// 越过开头用第一帧、越过结尾用最后一帧；共 1 + (帧数 - 1) / shift 帧
fn lfr_cmvn(
    feats: &[f32],
    window: usize,
    shift: usize,
    neg_mean: &[f32],
    inv_stddev: &[f32],
) -> (usize, Vec<f32>) {
    let dim = fbank::NUM_BINS;
    let frames = feats.len() / dim;
    if frames == 0 {
        return (0, Vec::new());
    }
    let out_frames = 1 + (frames - 1) / shift;
    let out_dim = dim * window;
    let left = (window - 1) / 2;
    let mut out = Vec::with_capacity(out_frames * out_dim);
    for i in 0..out_frames {
        for k in 0..window {
            let j = (i * shift + k).saturating_sub(left).min(frames - 1);
            out.extend_from_slice(&feats[j * dim..(j + 1) * dim]);
        }
    }
    for (k, v) in out.iter_mut().enumerate() {
        let d = k % out_dim;
        *v = (*v + neg_mean[d]) * inv_stddev[d];
    }
    (out_frames, out)
}

/// 逐帧取最大的标记 → 文字：合并重复、去掉空白，再去掉开头 4 个标记（语言 / 情绪 / 事件 / 规整），▁ 换成空格
fn decode(ids: &[usize], tokens: &[String]) -> String {
    let mut kept = Vec::new();
    let mut prev = None;
    for &id in ids {
        if Some(id) != prev && id != BLANK {
            kept.push(id);
        }
        prev = Some(id);
    }
    kept.iter()
        .skip(PREFIX_TOKENS)
        .filter_map(|&id| tokens.get(id))
        .map(String::as_str)
        .collect::<String>()
        .replace('▁', " ")
        .trim()
        .to_string()
}

/// 录音（16kHz 单声道 [-1, 1]）转成文字；太短时返回空字符串
pub fn transcribe(data_dir: &Path, samples: &[f32], language: Language) -> AppResult<String> {
    if !ready(data_dir) {
        return Err(AppError::NotFound("语音输入模型还没有下载".to_string()));
    }
    let feats = fbank::SENSE_VOICE.compute(samples);
    let mut guard = engine_lock();
    if let Ok(mut t) = LAST_USED.lock() {
        *t = Some(std::time::Instant::now());
    }
    if guard.is_none() {
        *guard = Some(load(data_dir)?);
    }
    let engine = guard.as_mut().expect("刚加载");
    let (frames, x) = lfr_cmvn(
        &feats,
        engine.lfr_window,
        engine.lfr_shift,
        &engine.neg_mean,
        &engine.inv_stddev,
    );
    if frames == 0 {
        return Ok(String::new());
    }
    let dim = fbank::NUM_BINS * engine.lfr_window;
    let lang = match language {
        Language::Zh => engine.lang_zh,
        Language::En => engine.lang_en,
    };
    let err = |e: ort::Error| AppError::InternalError(format!("语音输入失败：{e}"));
    let inputs = ort::inputs![
        "x" => Tensor::from_array(([1usize, frames, dim], x)).map_err(err)?,
        "x_length" => Tensor::from_array(([1usize], vec![frames as i32])).map_err(err)?,
        "language" => Tensor::from_array(([1usize], vec![lang])).map_err(err)?,
        "text_norm" => Tensor::from_array(([1usize], vec![engine.with_itn])).map_err(err)?,
    ];
    let out = engine.session.run(inputs).map_err(err)?;
    let (shape, logits) = out["logits"].try_extract_tensor::<f32>().map_err(err)?;
    let (steps, vocab) = (shape[1] as usize, shape[2] as usize);
    let ids: Vec<usize> = (0..steps)
        .map(|t| {
            let row = &logits[t * vocab..(t + 1) * vocab];
            row.iter()
                .enumerate()
                .fold(
                    (0, f32::MIN),
                    |best, (i, &v)| if v > best.1 { (i, v) } else { best },
                )
                .0
        })
        .collect();
    Ok(decode(&ids, &engine.tokens))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_ctc_and_drops_prefix_tokens() {
        let tokens: Vec<String> = [
            "<blk>",
            "<|zh|>",
            "<|NEUTRAL|>",
            "<|Speech|>",
            "<|withitn|>",
            "▁apple",
            "这",
            "个",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(
            decode(&[1, 2, 3, 4, 5, 5, 0, 6, 6, 0, 7], &tokens),
            "apple这个"
        );
    }

    #[test]
    fn stacks_frames_like_sherpa() {
        // 10 帧 × 80 维，每帧的值是帧号；7 帧拼一帧、每 6 帧取一次 → 2 帧：
        // 第 0 帧取 -3..4（开头用第 0 帧补），第 1 帧取 3..10（结尾用第 9 帧补）
        let feats: Vec<f32> = (0..10)
            .flat_map(|f| std::iter::repeat_n(f as f32, 80))
            .collect();
        let (n, out) = lfr_cmvn(&feats, 7, 6, &[0.0; 560], &[1.0; 560]);
        assert_eq!(n, 2);
        let frame = |o: usize, k: usize| out[o * 560 + k * 80];
        let first: Vec<f32> = (0..7).map(|k| frame(0, k)).collect();
        let second: Vec<f32> = (0..7).map(|k| frame(1, k)).collect();
        assert_eq!(first, [0., 0., 0., 0., 1., 2., 3.]);
        assert_eq!(second, [3., 4., 5., 6., 7., 8., 9.]);
    }

    /// 与 sherpa-onnx 的识别结果逐句对照（需要 PINDU_SENSE_VOICE_DATA：里面有 models/sense-voice-small/ 与
    /// asr-test/wav/*.wav、asr-test/sherpa-zh.txt（每行一句，按文件名顺序））。
    /// fbank 已与 kaldi-native-fbank 逐值一致；ONNX Runtime 版本不同（这里 1.28、sherpa 的 python 包 1.31），
    /// 读得含糊的个别帧可能取到不同的字，所以允许少数句子有一两个字不同
    #[test]
    #[ignore]
    fn matches_sherpa_onnx() {
        let dir = std::path::PathBuf::from(std::env::var("PINDU_SENSE_VOICE_DATA").unwrap());
        let expected = std::fs::read_to_string(dir.join("asr-test/sherpa-zh.txt")).unwrap();
        let mut files: Vec<_> = std::fs::read_dir(dir.join("asr-test/wav"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        files.sort();
        let mut same = 0;
        for (path, want) in files.iter().zip(expected.lines()) {
            let bytes = std::fs::read(path).unwrap();
            // 找 data 块（macOS 生成的 wav 前面还有 FLLR 块）
            let at = bytes.windows(4).position(|w| w == b"data").unwrap() + 8;
            let samples: Vec<f32> = bytes[at..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| i16::from_le_bytes(*b) as f32 / 32768.0)
                .collect();
            let got = transcribe(&dir, &samples, Language::Zh).unwrap();
            if got == want {
                same += 1;
            } else {
                eprintln!("不同：{got} | sherpa：{want}");
            }
        }
        eprintln!("与 sherpa 一致 {same} / {}", files.len());
        assert!(same * 10 >= files.len() * 8, "一致的不到八成");
    }
}
