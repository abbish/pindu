//! 视频没有字幕时，在本机识别英文语音生成字幕（D61）：随应用分发的 whisper-cli（`scripts/whisper/`）+ small.en 模型。
//!
//! - 模型第一次用时下载到 `<数据目录>/models/`（HuggingFace，失败换国内镜像；校验 sha256），之后离线可用；
//! - ffmpeg 抽出 16kHz 单声道 wav → whisper-cli 出 srt（实测默认参数时间轴最准，不开 VAD，见 work item evidence）→
//!   和导入的字幕走同一个解析（`subtitle::build_cues`：去掉 (music) 之类的音效标注、只留英文）；
//! - 识别全在本机，音频不上传。

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::media::MediaTools;
use crate::repositories::video_repository::VideoRepository;
use crate::services::subtitle::{self, Cue};
use crate::services::video::video_dir;
use crate::types::video::SpeechModelStatus;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// 识别模型（英语，约 490MB；实测时间轴比 large-v3-turbo 准，见 D61）
const MODEL_FILE: &str = "ggml-small.en.bin";
const MODEL_BYTES: u64 = 487_614_201;
const MODEL_SHA256: &str = "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d";
const MODEL_URLS: [&str; 2] = [
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
];
/// 识别出的字幕记作这个名字（视频的「字幕」一栏显示）
pub const RECOGNIZED_NAME: &str = "自动识别的字幕";
const CANCEL_POLL: Duration = Duration::from_millis(300);

fn models_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("models")
}

fn model_path(data_dir: &Path) -> PathBuf {
    models_dir(data_dir).join(MODEL_FILE)
}

fn model_ready(data_dir: &Path) -> bool {
    std::fs::metadata(model_path(data_dir)).is_ok_and(|m| m.len() == MODEL_BYTES)
}

/// 设置页：模型下载了没有
pub fn model_status(data_dir: &Path) -> SpeechModelStatus {
    let size = std::fs::metadata(model_path(data_dir))
        .map(|m| m.len())
        .unwrap_or(0);
    SpeechModelStatus {
        downloaded: size == MODEL_BYTES,
        size_bytes: size as i64,
        download_bytes: MODEL_BYTES as i64,
    }
}

/// 删除下载的模型（之后识别时再下载）
pub fn delete_model(data_dir: &Path) -> AppResult<()> {
    for path in [model_path(data_dir), part_path(data_dir)] {
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| AppError::InternalError(format!("删除识别模型失败：{e}")))?;
        }
    }
    Ok(())
}

fn part_path(data_dir: &Path) -> PathBuf {
    models_dir(data_dir).join(format!("{MODEL_FILE}.part"))
}

fn cancelled_error() -> AppError {
    AppError::ValidationError(crate::agent::session::CANCELLED.to_string())
}

/// 没有模型时下载（进度 0–1），校验后放到位
async fn ensure_model(
    data_dir: &Path,
    logger: &Logger,
    mut on_progress: impl FnMut(f64),
    cancelled: impl Fn() -> bool,
) -> AppResult<PathBuf> {
    let target = model_path(data_dir);
    if model_ready(data_dir) {
        return Ok(target);
    }
    std::fs::create_dir_all(models_dir(data_dir))
        .map_err(|e| AppError::InternalError(format!("准备模型目录失败：{e}")))?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| AppError::ExternalServiceError(format!("无法下载识别模型：{e}")))?;
    let mut last_error = String::new();
    for url in MODEL_URLS {
        match download(
            &client,
            url,
            &part_path(data_dir),
            &mut on_progress,
            &cancelled,
        )
        .await
        {
            Ok(()) => {
                let hash = sha256_file(&part_path(data_dir))?;
                if hash != MODEL_SHA256 {
                    let _ = std::fs::remove_file(part_path(data_dir));
                    last_error = "下载的模型文件不完整".to_string();
                    logger.warn("VIDEO", &format!("识别模型校验失败：{url}"), Some(&hash));
                    continue;
                }
                std::fs::rename(part_path(data_dir), &target)
                    .map_err(|e| AppError::InternalError(format!("保存识别模型失败：{e}")))?;
                logger.info("VIDEO", &format!("识别模型已下载：{url}"));
                return Ok(target);
            }
            Err(e) if cancelled() => {
                let _ = std::fs::remove_file(part_path(data_dir));
                return Err(e);
            }
            Err(e) => {
                logger.warn(
                    "VIDEO",
                    &format!("下载识别模型失败：{url}"),
                    Some(&e.to_string()),
                );
                last_error = e.to_string();
            }
        }
    }
    let _ = std::fs::remove_file(part_path(data_dir));
    Err(AppError::ExternalServiceError(format!(
        "没能下载语音识别模型，请检查网络后重试（{last_error}）"
    )))
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
        .map_err(|e| AppError::ExternalServiceError(e.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::ExternalServiceError(format!(
            "HTTP {}",
            response.status()
        )));
    }
    let total = response.content_length().unwrap_or(MODEL_BYTES).max(1);
    let mut file = tokio::fs::File::create(to)
        .await
        .map_err(|e| AppError::InternalError(format!("保存识别模型失败：{e}")))?;
    let mut done = 0u64;
    loop {
        let chunk = tokio::time::timeout(Duration::from_secs(60), response.chunk())
            .await
            .map_err(|_| AppError::ExternalServiceError("下载超时".to_string()))?
            .map_err(|e| AppError::ExternalServiceError(e.to_string()))?;
        let Some(chunk) = chunk else { break };
        if cancelled() {
            return Err(cancelled_error());
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::InternalError(format!("保存识别模型失败：{e}")))?;
        done += chunk.len() as u64;
        on_progress((done as f64 / total as f64).min(1.0));
    }
    file.flush()
        .await
        .map_err(|e| AppError::InternalError(format!("保存识别模型失败：{e}")))?;
    Ok(())
}

fn sha256_file(path: &Path) -> AppResult<String> {
    use sha2::Digest;
    use std::io::Read;
    let mut file = std::fs::File::open(path)
        .map_err(|e| AppError::InternalError(format!("读取识别模型失败：{e}")))?;
    let mut hasher = sha2::Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| AppError::InternalError(format!("读取识别模型失败：{e}")))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// 随应用自带的 whisper-cli（开发版可用 PINDU_WHISPER_DIR 指定目录）
fn whisper_cli() -> AppResult<PathBuf> {
    let name = if cfg!(windows) {
        "whisper-cli.exe"
    } else {
        "whisper-cli"
    };
    let mut dirs: Vec<PathBuf> = crate::media::built_in_dir().into_iter().collect();
    #[cfg(debug_assertions)]
    if let Ok(dir) = std::env::var("PINDU_WHISPER_DIR") {
        dirs.push(PathBuf::from(dir));
    }
    dirs.into_iter()
        .map(|d| d.join(name))
        .find(|p| p.is_file())
        .ok_or_else(|| {
            AppError::ExternalServiceError("找不到语音识别组件，请重新安装拼读".to_string())
        })
}

/// whisper-cli 的进度行：`whisper_print_progress_callback: progress =  35%`
fn parse_progress(line: &str) -> Option<f64> {
    let rest = line.split("progress =").nth(1)?;
    rest.trim()
        .trim_end_matches('%')
        .trim()
        .parse::<f64>()
        .ok()
        .map(|p| (p / 100.0).clamp(0.0, 1.0))
}

/// 识别线程数：留一半核给界面，至少 2、最多 8
fn threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| (n.get() / 2).clamp(2, 8))
        .unwrap_or(4)
}

/// 运行 whisper-cli，输出 `<out_prefix>.srt`
async fn run_whisper(
    model: &Path,
    wav: &Path,
    out_prefix: &Path,
    mut on_progress: impl FnMut(f64),
    cancelled: impl Fn() -> bool,
) -> AppResult<PathBuf> {
    let mut child = crate::process::command(whisper_cli()?)
        .arg("-m")
        .arg(model)
        .arg("-f")
        .arg(wav)
        .args(["-l", "en", "-osrt", "-pp", "-np", "-t"])
        .arg(threads().to_string())
        .arg("-of")
        .arg(out_prefix)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| AppError::ExternalServiceError(format!("无法运行语音识别：{e}")))?;
    let mut tail: Vec<String> = Vec::new();
    if let Some(stderr) = child.stderr.take() {
        let mut lines = BufReader::new(stderr).lines();
        loop {
            match tokio::time::timeout(CANCEL_POLL, lines.next_line()).await {
                Ok(Ok(Some(line))) => {
                    if let Some(p) = parse_progress(&line) {
                        on_progress(p);
                    } else if !line.trim().is_empty() {
                        tail.push(line);
                        if tail.len() > 5 {
                            tail.remove(0);
                        }
                    }
                }
                Ok(_) => break,
                Err(_) => {}
            }
            if cancelled() {
                let _ = child.kill().await;
                return Err(cancelled_error());
            }
        }
    }
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::ExternalServiceError(format!("语音识别出错：{e}")))?;
    let srt = out_prefix.with_extension("srt");
    if !status.success() || !srt.is_file() {
        return Err(AppError::ExternalServiceError(format!(
            "语音识别没有完成：{}",
            tail.last().cloned().unwrap_or_default()
        )));
    }
    Ok(srt)
}

/// 识别出的字幕 → 字幕条（与导入的字幕同一个解析）；几乎没有英文时说明原因
pub fn cues_from_recognized(srt: &str) -> AppResult<Vec<Cue>> {
    subtitle::build_cues(srt, None).map_err(|_| {
        AppError::ValidationError("没有识别出英文对白：这个视频可能没有英文语音".to_string())
    })
}

/// 给一个已导入的视频识别字幕（后台任务，media 队列：排在导入任务之后）
pub struct RecognizeJob {
    pub pool: Arc<SqlitePool>,
    pub logger: Arc<Logger>,
    pub tools: MediaTools,
    pub data_dir: PathBuf,
    pub video_id: i64,
}

impl RecognizeJob {
    /// 识别并写回字幕，返回字幕条数
    pub async fn run(&self, ctx: &crate::jobs::JobCtx) -> AppResult<usize> {
        let video = VideoRepository::get(&self.pool, self.video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("视频已经删除".to_string()))?;
        if video.status == "failed" || video.status == "importing" {
            return Err(AppError::ValidationError(
                "视频没有导入成功，不能识别字幕".to_string(),
            ));
        }
        if video.cue_count > 0 {
            return Err(AppError::ValidationError(
                "这个视频已经有字幕了".to_string(),
            ));
        }
        let dir = video_dir(&self.data_dir, self.video_id);
        let src = video
            .source_file
            .as_deref()
            .or(video.media_file.as_deref())
            .map(|f| dir.join(f))
            .filter(|p| p.is_file())
            .ok_or_else(|| AppError::NotFound("找不到视频文件".to_string()))?;

        // 进度：下载模型（第一次）占 0–40，抽音频 40–50（不用下载时 0–10），识别其余
        let downloading = !model_ready(&self.data_dir);
        let (audio_from, recognize_from) = if downloading { (40, 50) } else { (0, 10) };
        if downloading {
            ctx.stage("下载语音识别模型（只需一次）");
        }
        let model = ensure_model(
            &self.data_dir,
            &self.logger,
            |f| ctx.progress((f * 40.0) as u64, 100),
            || ctx.is_cancelled(),
        )
        .await?;

        ctx.stage("准备音频");
        let work = dir.join("recognize");
        std::fs::create_dir_all(&work)
            .map_err(|e| AppError::InternalError(format!("准备识别目录失败：{e}")))?;
        let wav = work.join("speech.wav");
        let result = async {
            self.tools
                .speech_audio(
                    &src,
                    &wav,
                    video.duration_ms,
                    |f| {
                        ctx.progress(
                            audio_from + (f * (recognize_from - audio_from) as f64) as u64,
                            100,
                        )
                    },
                    || ctx.is_cancelled(),
                )
                .await?;
            ctx.stage("识别英文语音");
            let srt = run_whisper(
                &model,
                &wav,
                &work.join("speech"),
                |f| {
                    ctx.progress(
                        recognize_from + (f * (100 - recognize_from) as f64) as u64,
                        100,
                    )
                },
                || ctx.is_cancelled(),
            )
            .await?;
            let text = std::fs::read_to_string(&srt)
                .map_err(|e| AppError::InternalError(format!("读取识别结果失败：{e}")))?;
            cues_from_recognized(&text)
        }
        .await;
        let _ = std::fs::remove_dir_all(&work);
        let cues = result?;
        VideoRepository::set_subtitles(&self.pool, self.video_id, RECOGNIZED_NAME, &cues).await?;
        self.logger.info(
            "VIDEO",
            &format!("视频 {} 识别出 {} 条字幕", self.video_id, cues.len()),
        );
        Ok(cues.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_lines_and_recognized_cues() {
        assert_eq!(
            parse_progress("whisper_print_progress_callback: progress =  35%"),
            Some(0.35)
        );
        assert_eq!(
            parse_progress("whisper_print_progress_callback: progress = 100%"),
            Some(1.0)
        );
        assert_eq!(parse_progress("read_audio_data: reading audio data"), None);

        // 整条是音效标注的去掉，行内的标注去掉，说话人短横去掉
        let srt = "1\n00:00:01,000 --> 00:00:03,000\n(suspenseful music)\n\n2\n00:00:03,000 --> 00:00:05,000\n - That was Jacob back there, wasn't it?\n\n3\n00:00:05,000 --> 00:00:06,000\n[engine revs] Hold on!\n";
        let cues = cues_from_recognized(srt).unwrap();
        let texts: Vec<&str> = cues.iter().map(|c| c.en.as_str()).collect();
        assert_eq!(texts, ["That was Jacob back there, wasn't it?", "Hold on!"]);
        assert_eq!(cues[0].start_ms, 3000);

        let err = cues_from_recognized("1\n00:00:01,000 --> 00:00:03,000\n(music)\n").unwrap_err();
        assert!(err.to_string().contains("没有识别出英文对白"));
    }

    #[test]
    fn model_status_and_delete() {
        let dir = std::env::temp_dir().join(format!("pindu-model-{}", std::process::id()));
        std::fs::create_dir_all(models_dir(&dir)).unwrap();
        assert!(!model_status(&dir).downloaded);
        std::fs::write(part_path(&dir), b"partial").unwrap();
        std::fs::write(model_path(&dir), b"too small").unwrap();
        let status = model_status(&dir);
        assert!(
            !status.downloaded
                && status.size_bytes == 9
                && status.download_bytes == MODEL_BYTES as i64
        );
        delete_model(&dir).unwrap();
        assert!(!model_path(&dir).exists() && !part_path(&dir).exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}

/// 用真实的 ffmpeg / whisper-cli / 模型识别一段视频（`PINDU_FFMPEG_DIR`、`PINDU_WHISPER_DIR`、`PINDU_TEST_DATA`（里面有 models/ggml-small.en.bin）、
/// `PINDU_TEST_VIDEO`）：`cargo test real_recognize -- --ignored --nocapture`
#[cfg(test)]
mod real {
    use super::*;

    /// 真实下载模型（约 490MB）到临时目录并校验：`cargo test real_model_download -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn real_model_download() {
        let dir = std::env::temp_dir().join(format!("pindu-model-dl-{}", std::process::id()));
        let logger = crate::test_support::test_logger();
        let mut last = 0.0;
        let started = std::time::Instant::now();
        let path = ensure_model(&dir, &logger, |p| last = p, || false)
            .await
            .unwrap();
        println!(
            "下载完成：{:.1}s，进度 {last}",
            started.elapsed().as_secs_f64()
        );
        assert!(model_status(&dir).downloaded && last >= 0.99 && path.is_file());
        // 已有模型：不再下载
        ensure_model(&dir, &logger, |_| panic!("不该再下载"), || false)
            .await
            .unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    #[ignore]
    async fn real_recognize() {
        let tools = crate::media::locate_in(Path::new(&std::env::var("PINDU_FFMPEG_DIR").unwrap()))
            .await
            .expect("ffmpeg");
        let data = PathBuf::from(std::env::var("PINDU_TEST_DATA").unwrap());
        assert!(model_ready(&data), "模型不在 {}", data.display());
        let video = PathBuf::from(std::env::var("PINDU_TEST_VIDEO").unwrap());
        let work = std::env::temp_dir().join(format!("pindu-asr-{}", std::process::id()));
        std::fs::create_dir_all(&work).unwrap();
        let wav = work.join("speech.wav");
        let started = std::time::Instant::now();
        tools
            .speech_audio(&video, &wav, 0, |_| {}, || false)
            .await
            .unwrap();
        let mut last = 0.0;
        let srt = run_whisper(
            &model_path(&data),
            &wav,
            &work.join("speech"),
            |p| last = p,
            || false,
        )
        .await
        .unwrap();
        let cues = cues_from_recognized(&std::fs::read_to_string(srt).unwrap()).unwrap();
        println!(
            "{} 条，用时 {:.1}s，最后进度 {last}",
            cues.len(),
            started.elapsed().as_secs_f64()
        );
        for c in cues.iter().take(4) {
            println!("{:>6} {}", c.start_ms, c.en);
        }
        assert!(!cues.is_empty() && last >= 0.99);
        std::fs::remove_dir_all(&work).ok();
    }
}
