//! 把一小段录音转成文字（说出来代替打字）：听后复述、口头回答开放题、对 AI 老师说话。
//! 复用字幕识别的 whisper-cli 与模型（D61），全部在本机：已下载的模型里按 small.en（短录音实测 0.8 秒）→ base.en → medium.en 选；
//! 都没有时返回 NOT_FOUND，界面据此下载最小的 base.en。

use crate::error::{AppError, AppResult};
use crate::services::subtitle_recognition::{self, SpeechModel, MODELS};
use std::path::{Path, PathBuf};
use std::process::Stdio;

/// 短录音转文字按这个顺序选已下载的模型
const PREFERRED: [&str; 3] = ["small.en", "base.en", "medium.en"];
/// 都没下载时下载这个（最小）
pub const DOWNLOAD_FIRST: &str = "base.en";
/// 低于这个音量（RMS）当作没说话：whisper 对静音会编出「Thank you.」之类
const SILENCE_RMS: f32 = 0.005;
/// 最长 60 秒
const MAX_SECONDS: usize = 60;

/// 已下载、最适合短录音的模型
pub fn model_for_dictation(data_dir: &Path) -> Option<&'static SpeechModel> {
    PREFERRED
        .iter()
        .filter_map(|id| MODELS.iter().find(|m| m.id == *id))
        .find(|m| m.ready(data_dir))
}

fn rms(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples
        .iter()
        .map(|&s| {
            let v = s as f64 / 32768.0;
            v * v
        })
        .sum();
    (sum / samples.len() as f64).sqrt() as f32
}

/// 16kHz 单声道 16 位 PCM 写成 wav
fn write_wav(path: &Path, samples: &[i16]) -> AppResult<()> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // 单声道
    out.extend_from_slice(&16000u32.to_le_bytes());
    out.extend_from_slice(&32000u32.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    std::fs::write(path, out).map_err(|e| AppError::InternalError(format!("写录音失败：{e}")))
}

/// whisper 输出的一行行文字 → 一段话（去掉音效标注与多余空白）
pub fn clean_transcript(raw: &str) -> String {
    let text = crate::services::passage_import::strip_brackets(raw);
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 录音（16kHz 单声道 16 位 PCM）转文字；没说话时返回空字符串
pub async fn transcribe(data_dir: &Path, work_dir: &Path, samples: &[i16]) -> AppResult<String> {
    let model = model_for_dictation(data_dir)
        .ok_or_else(|| AppError::NotFound("语音识别模型还没有下载".to_string()))?;
    if samples.len() > MAX_SECONDS * 16000 {
        return Err(AppError::ValidationError("一次最多说 60 秒".to_string()));
    }
    if rms(samples) < SILENCE_RMS {
        return Ok(String::new());
    }
    std::fs::create_dir_all(work_dir)
        .map_err(|e| AppError::InternalError(format!("无法创建临时目录：{e}")))?;
    let stem: PathBuf = work_dir.join(format!("speech-{}", uuid::Uuid::new_v4()));
    let wav = stem.with_extension("wav");
    write_wav(&wav, samples)?;
    let output = crate::process::command(subtitle_recognition::whisper_cli()?)
        .arg("-m")
        .arg(model.path(data_dir))
        .arg("-f")
        .arg(&wav)
        .args(["-l", "en", "-nt", "-np", "-t"])
        .arg(subtitle_recognition::threads().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await;
    let _ = std::fs::remove_file(&wav);
    let output =
        output.map_err(|e| AppError::ExternalServiceError(format!("无法运行语音识别：{e}")))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::ExternalServiceError(format!(
            "语音识别没有完成：{}",
            err.lines().last().unwrap_or_default()
        )));
    }
    Ok(clean_transcript(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_whisper_output_and_detects_silence() {
        assert_eq!(
            clean_transcript(" [MUSIC]\n I think so.\n  Yes, I do.\n"),
            "I think so. Yes, I do."
        );
        assert!(rms(&[0; 1600]) < SILENCE_RMS);
        assert!(rms(&[3000, -3000, 3000, -3000]) > SILENCE_RMS);
    }

    #[test]
    fn wav_header_is_16k_mono() {
        let dir = std::env::temp_dir().join(format!("pindu-wav-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.wav");
        write_wav(&path, &[1, 2, 3]).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes.len(), 44 + 6);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 16000);
        std::fs::remove_dir_all(dir).ok();
    }
}
