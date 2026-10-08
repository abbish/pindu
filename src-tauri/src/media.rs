//! ffmpeg / ffprobe 调用（唯一 owner）：定位程序、读取视频信息、转码与精确切分（带进度与取消）、波形峰值、缩略图。
//!
//! - 程序位置：设置里指定的目录（`media.ffmpeg_dir`）> 随应用自带的（与主程序同目录，tauri externalBin；构建见 `scripts/ffmpeg/`）
//!   > 开发版环境变量 `PINDU_FFMPEG_DIR` > PATH 与常见安装位置。
//! - 输出统一为浏览器能直接播放的 H.264 + AAC mp4（`+faststart`）：优先硬件编码器（macOS videotoolbox、Windows Media Foundation），
//!   没有时用 libopenh264 / libx264。切分重新编码，起止精确到帧（流复制只能切在关键帧上）。

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

/// 设置里指定 ffmpeg 所在目录的键（app_settings）
pub const FFMPEG_DIR_SETTING: &str = "media.ffmpeg_dir";
/// 输出视频最长边不超过 720p（学习用足够清楚，文件小）
const MAX_HEIGHT: u32 = 720;
const VIDEO_BITRATE: &str = "2500k";
const AUDIO_BITRATE: &str = "128k";
/// 波形每秒的峰值个数
pub const PEAKS_PER_SECOND: u32 = 50;
const PEAK_SAMPLE_RATE: u32 = 8000;
/// 检查取消的间隔
const CANCEL_POLL: Duration = Duration::from_millis(300);

#[derive(Debug, Clone)]
pub struct MediaTools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    /// 选定的 H.264 编码器
    pub encoder: String,
}

/// 给设置页看的状态
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaToolsStatus {
    pub available: bool,
    /// ffmpeg 所在目录
    pub dir: Option<String>,
    pub version: Option<String>,
    pub encoder: Option<String>,
    /// 用的是随应用自带的
    pub built_in: bool,
}

/// ffprobe 读出的视频信息
#[derive(Debug, Clone, PartialEq)]
pub struct ProbeInfo {
    pub duration_ms: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub format_name: String,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
}

impl ProbeInfo {
    /// 编辑器（WebView）能直接播放：mp4 / mov 容器里的 H.264 + AAC / MP3（或没有声音）
    pub fn browser_playable(&self) -> bool {
        let container = self.format_name.contains("mp4") || self.format_name.contains("mov");
        let video = self.video_codec.as_deref() == Some("h264");
        let audio = matches!(
            self.audio_codec.as_deref(),
            None | Some("aac") | Some("mp3")
        );
        container && video && audio
    }
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// 随应用自带的 ffmpeg 所在目录：tauri 把 externalBin 放在主程序旁边（macOS 为 Contents/MacOS）
fn built_in_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(Path::to_path_buf)
}

/// 按优先级列出可能放 ffmpeg 的目录
fn candidate_dirs(setting: Option<&str>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(dir) = setting.filter(|d| !d.trim().is_empty()) {
        dirs.push(PathBuf::from(dir.trim()));
    }
    if let Some(dir) = built_in_dir() {
        dirs.push(dir);
    }
    #[cfg(debug_assertions)]
    if let Ok(dir) = std::env::var("PINDU_FFMPEG_DIR") {
        dirs.push(PathBuf::from(dir));
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(dir));
    }
    dirs
}

/// 按优先级找 ffmpeg
pub async fn locate(setting: Option<&str>) -> Option<MediaTools> {
    for dir in candidate_dirs(setting) {
        if let Some(tools) = locate_in(&dir).await {
            return Some(tools);
        }
    }
    None
}

/// 某个目录里的 ffmpeg 与 ffprobe（两个都在才算），并选定编码器
pub async fn locate_in(dir: &Path) -> Option<MediaTools> {
    let ffmpeg = dir.join(exe("ffmpeg"));
    let ffprobe = dir.join(exe("ffprobe"));
    if !ffmpeg.is_file() || !ffprobe.is_file() {
        return None;
    }
    let encoder = pick_encoder(&ffmpeg).await?;
    Some(MediaTools {
        ffmpeg,
        ffprobe,
        encoder,
    })
}

async fn pick_encoder(ffmpeg: &Path) -> Option<String> {
    let output = Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .stdin(Stdio::null())
        .output()
        .await
        .ok()?;
    let list = String::from_utf8_lossy(&output.stdout);
    let has = |name: &str| {
        list.lines()
            .any(|l| l.split_whitespace().nth(1) == Some(name))
    };
    let preferred: &[&str] = if cfg!(target_os = "macos") {
        &["h264_videotoolbox", "libopenh264", "libx264"]
    } else if cfg!(windows) {
        &["h264_mf", "libopenh264", "libx264"]
    } else {
        &["libopenh264", "libx264"]
    };
    preferred
        .iter()
        .find(|e| has(e))
        .map(|e| e.to_string())
        .filter(|_| has("aac"))
}

impl MediaTools {
    pub async fn status(tools: Option<&MediaTools>) -> MediaToolsStatus {
        let Some(tools) = tools else {
            return MediaToolsStatus {
                available: false,
                dir: None,
                version: None,
                encoder: None,
                built_in: false,
            };
        };
        let version = Command::new(&tools.ffmpeg)
            .arg("-version")
            .stdin(Stdio::null())
            .output()
            .await
            .ok()
            .and_then(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .next()
                    .map(str::to_string)
            });
        let dir = tools.ffmpeg.parent().map(Path::to_path_buf);
        MediaToolsStatus {
            available: true,
            built_in: dir.is_some() && dir == built_in_dir(),
            dir: dir.map(|d| d.display().to_string()),
            version,
            encoder: Some(tools.encoder.clone()),
        }
    }

    /// 读取视频信息
    pub async fn probe(&self, path: &Path) -> AppResult<ProbeInfo> {
        let output = Command::new(&self.ffprobe)
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
            ])
            .arg(path)
            .stdin(Stdio::null())
            .output()
            .await
            .map_err(|e| media_error(format!("无法运行 ffprobe：{e}")))?;
        if !output.status.success() {
            return Err(AppError::ValidationError(format!(
                "读不出这个视频：{}",
                last_line(&String::from_utf8_lossy(&output.stderr))
            )));
        }
        parse_probe(&String::from_utf8_lossy(&output.stdout))
    }

    /// 转成编辑器能播放的 mp4（不改时长）
    pub async fn make_proxy(
        &self,
        src: &Path,
        out: &Path,
        duration_ms: i64,
        on_progress: impl FnMut(f64),
        cancelled: impl Fn() -> bool,
    ) -> AppResult<()> {
        let mut args = vec!["-i".into(), path_arg(src)];
        args.extend(self.encode_args());
        args.push(path_arg(out));
        self.run(args, duration_ms, on_progress, cancelled).await
    }

    /// 精确切出 [start_ms, end_ms)
    pub async fn cut(
        &self,
        src: &Path,
        start_ms: i64,
        end_ms: i64,
        out: &Path,
        on_progress: impl FnMut(f64),
        cancelled: impl Fn() -> bool,
    ) -> AppResult<()> {
        let duration = (end_ms - start_ms).max(1);
        let mut args = vec![
            "-ss".into(),
            seconds(start_ms),
            "-i".into(),
            path_arg(src),
            "-t".into(),
            seconds(duration),
        ];
        args.extend(self.encode_args());
        args.push(path_arg(out));
        self.run(args, duration, on_progress, cancelled).await
    }

    /// 某个时刻的一帧做封面
    pub async fn poster(&self, src: &Path, at_ms: i64, out: &Path) -> AppResult<()> {
        let args = vec![
            "-ss".into(),
            seconds(at_ms),
            "-i".into(),
            path_arg(src),
            "-frames:v".into(),
            "1".into(),
            "-vf".into(),
            "scale=-2:360".into(),
            "-q:v".into(),
            "4".into(),
            path_arg(out),
        ];
        self.run(args, 0, |_| {}, || false).await
    }

    /// 时间轴缩略图：每 `interval_s` 秒一张（只解码关键帧，很快），文件名 thumb_0001.jpg…，返回张数
    pub async fn filmstrip(&self, src: &Path, out_dir: &Path, interval_s: u32) -> AppResult<usize> {
        std::fs::create_dir_all(out_dir).map_err(io_error)?;
        let args = vec![
            "-skip_frame".into(),
            "nokey".into(),
            "-i".into(),
            path_arg(src),
            "-vf".into(),
            format!("fps=1/{interval_s},scale=-2:90"),
            "-q:v".into(),
            "6".into(),
            path_arg(&out_dir.join("thumb_%04d.jpg")),
        ];
        self.run(args, 0, |_| {}, || false).await?;
        Ok(std::fs::read_dir(out_dir)
            .map_err(io_error)?
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with("thumb_"))
            .count())
    }

    /// 波形峰值：每秒 PEAKS_PER_SECOND 个，0–1（没有声音时全是 0）
    pub async fn peaks(&self, src: &Path) -> AppResult<Vec<f32>> {
        let mut child = Command::new(&self.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(src)
            .args(["-vn", "-ac", "1", "-ar"])
            .arg(PEAK_SAMPLE_RATE.to_string())
            .args(["-f", "s16le", "-"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| media_error(format!("无法运行 ffmpeg：{e}")))?;
        let mut raw = Vec::new();
        if let Some(mut stdout) = child.stdout.take() {
            stdout.read_to_end(&mut raw).await.map_err(io_error)?;
        }
        // -loglevel error 的输出很少，读完 stdout 再读不会堵住
        let mut stderr = String::new();
        if let Some(mut err) = child.stderr.take() {
            let _ = err.read_to_string(&mut stderr).await;
        }
        let status = child.wait().await.map_err(io_error)?;
        if !status.success() && raw.is_empty() {
            return Err(media_error(format!("读不出音轨：{}", last_line(&stderr))));
        }
        Ok(peaks_from_pcm(
            &raw,
            (PEAK_SAMPLE_RATE / PEAKS_PER_SECOND) as usize,
        ))
    }

    fn encode_args(&self) -> Vec<String> {
        let mut args = vec![
            "-vf".to_string(),
            format!("scale=-2:'min({MAX_HEIGHT},ih)'"),
            "-c:v".into(),
            self.encoder.clone(),
            "-b:v".into(),
            VIDEO_BITRATE.into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ];
        if self.encoder == "libx264" {
            args.extend(["-preset".into(), "veryfast".into()]);
        }
        args.extend([
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            AUDIO_BITRATE.into(),
            "-ac".into(),
            "2".into(),
            "-movflags".into(),
            "+faststart".into(),
        ]);
        args
    }

    /// 运行 ffmpeg：`-progress pipe:1` 读进度（0–1），定期检查取消（取消时结束进程，返回 CANCELLED 错误）
    async fn run(
        &self,
        args: Vec<String>,
        duration_ms: i64,
        mut on_progress: impl FnMut(f64),
        cancelled: impl Fn() -> bool,
    ) -> AppResult<()> {
        let mut child = Command::new(&self.ffmpeg)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-loglevel",
                "error",
                "-progress",
                "pipe:1",
                "-nostats",
            ])
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| media_error(format!("无法运行 ffmpeg：{e}")))?;
        let mut stderr = child.stderr.take();
        let stderr_task = tokio::spawn(async move {
            let mut text = String::new();
            if let Some(err) = stderr.as_mut() {
                let _ = err.read_to_string(&mut text).await;
            }
            text
        });
        if let Some(stdout) = child.stdout.take() {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match tokio::time::timeout(CANCEL_POLL, lines.next_line()).await {
                    Ok(Ok(Some(line))) => {
                        if let Some(us) = line.strip_prefix("out_time_us=") {
                            if let (Ok(us), true) = (us.trim().parse::<i64>(), duration_ms > 0) {
                                on_progress(
                                    (us as f64 / 1000.0 / duration_ms as f64).clamp(0.0, 1.0),
                                );
                            }
                        }
                    }
                    Ok(_) => break,
                    Err(_) => {}
                }
                if cancelled() {
                    let _ = child.kill().await;
                    return Err(AppError::ValidationError(
                        crate::agent::session::CANCELLED.to_string(),
                    ));
                }
            }
        }
        let status = child.wait().await.map_err(io_error)?;
        let stderr = stderr_task.await.unwrap_or_default();
        if !status.success() {
            return Err(media_error(format!(
                "ffmpeg 处理失败：{}",
                last_line(&stderr)
            )));
        }
        Ok(())
    }
}

/// 解析 ffprobe 的 JSON 输出
fn parse_probe(json: &str) -> AppResult<ProbeInfo> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| media_error(format!("ffprobe 输出无法解析：{e}")))?;
    let streams = value["streams"].as_array().cloned().unwrap_or_default();
    let stream = |kind: &str| {
        streams
            .iter()
            .find(|s| s["codec_type"] == kind && s["disposition"]["attached_pic"] != 1)
    };
    let video = stream("video")
        .ok_or_else(|| AppError::ValidationError("这个文件里没有视频画面".to_string()))?;
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);
    if duration <= 0.0 {
        return Err(AppError::ValidationError("读不出视频时长".to_string()));
    }
    Ok(ProbeInfo {
        duration_ms: (duration * 1000.0).round() as i64,
        width: video["width"].as_i64(),
        height: video["height"].as_i64(),
        format_name: value["format"]["format_name"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        video_codec: video["codec_name"].as_str().map(str::to_string),
        audio_codec: stream("audio")
            .and_then(|a| a["codec_name"].as_str())
            .map(str::to_string),
    })
}

/// 16 位单声道 PCM → 每 `window` 个采样取一个最大振幅（0–1，保留两位小数）
fn peaks_from_pcm(raw: &[u8], window: usize) -> Vec<f32> {
    raw.chunks(window.max(1) * 2)
        .map(|chunk| {
            let max = chunk
                .chunks_exact(2)
                .map(|b| i16::from_le_bytes([b[0], b[1]]).unsigned_abs())
                .max()
                .unwrap_or(0);
            ((f32::from(max) / f32::from(i16::MAX)).min(1.0) * 100.0).round() / 100.0
        })
        .collect()
}

fn seconds(ms: i64) -> String {
    format!("{:.3}", ms as f64 / 1000.0)
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn last_line(text: &str) -> String {
    text.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("没有更多信息")
        .trim()
        .to_string()
}

fn media_error(message: String) -> AppError {
    AppError::ExternalServiceError(message)
}

fn io_error(e: std::io::Error) -> AppError {
    AppError::InternalError(format!("读写视频文件失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROBE: &str = r#"{
      "streams": [
        {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080, "disposition": {"attached_pic": 0}},
        {"codec_type": "audio", "codec_name": "aac"}
      ],
      "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "600.021"}
    }"#;

    #[test]
    fn probe_reads_duration_size_and_codecs() {
        let info = parse_probe(PROBE).unwrap();
        assert_eq!(info.duration_ms, 600_021);
        assert_eq!((info.width, info.height), (Some(1920), Some(1080)));
        assert!(info.browser_playable());
    }

    #[test]
    fn mkv_or_hevc_is_not_browser_playable() {
        let mkv = PROBE.replace("mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm");
        assert!(!parse_probe(&mkv).unwrap().browser_playable());
        let hevc = PROBE.replace("\"h264\"", "\"hevc\"");
        assert!(!parse_probe(&hevc).unwrap().browser_playable());
        let silent = r#"{"streams":[{"codec_type":"video","codec_name":"h264"}],"format":{"format_name":"mp4","duration":"3"}}"#;
        assert!(parse_probe(silent).unwrap().browser_playable());
    }

    #[test]
    fn audio_only_or_broken_files_are_rejected() {
        let audio = r#"{"streams":[{"codec_type":"audio","codec_name":"mp3"}],"format":{"format_name":"mp3","duration":"3"}}"#;
        assert!(matches!(
            parse_probe(audio),
            Err(AppError::ValidationError(_))
        ));
        let no_duration = r#"{"streams":[{"codec_type":"video","codec_name":"h264"}],"format":{"format_name":"mp4"}}"#;
        assert!(parse_probe(no_duration).is_err());
        assert!(parse_probe("not json").is_err());
    }

    #[test]
    fn peaks_take_max_amplitude_per_window() {
        let samples: Vec<i16> = vec![0, 100, -16384, 5, 32767, 0, 0, 0, 0];
        let raw: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let peaks = peaks_from_pcm(&raw, 3);
        assert_eq!(peaks, vec![0.5, 1.0, 0.0]);
    }

    #[test]
    fn candidate_dirs_put_setting_first_then_built_in() {
        let built_in = built_in_dir().unwrap();
        let dirs = candidate_dirs(Some("/custom"));
        assert_eq!(dirs[0], PathBuf::from("/custom"));
        assert_eq!(dirs[1], built_in);
        assert_eq!(candidate_dirs(Some("  "))[0], built_in);
    }

    #[test]
    fn seconds_keep_milliseconds() {
        assert_eq!(seconds(3217), "3.217");
        assert_eq!(seconds(0), "0.000");
    }
}
