//! 视频没有字幕时，在本机识别英文语音生成字幕（D61）：随应用分发的 whisper-cli（`scripts/whisper/`）+ small.en 模型。
//!
//! - 模型第一次用时下载到 `<数据目录>/models/`（HuggingFace，失败换国内镜像；校验 sha256），之后离线可用；
//! - ffmpeg 抽出 16kHz 单声道 wav → whisper-cli 出 srt（实测默认参数时间轴最准，不开 VAD，见 work item evidence）→
//!   和导入的字幕走同一个解析（`subtitle::build_cues`：去掉 (music) 之类的音效标注、只留英文）；
//! - 识别全在本机，音频不上传。

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::media::MediaTools;
use crate::repositories::settings_repository::SettingsRepository;
use crate::repositories::video_repository::VideoRepository;
use crate::services::subtitle::{self, Cue};
use crate::services::video::video_dir;
use crate::types::video::{SpeechModelInfo, SpeechModels};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// 可选的识别模型（都只认英语）。small.en 是默认：实测时间轴最稳；large-v3-turbo 时间轴会漂，不提供（D61）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpeechModel {
    pub id: &'static str,
    pub label: &'static str,
    /// 给用户的一句说明
    pub note: &'static str,
    bytes: u64,
    sha256: &'static str,
}

pub const MODELS: [SpeechModel; 3] = [
    SpeechModel {
        id: "base.en",
        label: "快速",
        note: "最快，准确度一般",
        bytes: 147_964_211,
        sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    },
    SpeechModel {
        id: "small.en",
        label: "推荐",
        note: "准确度和速度兼顾",
        bytes: 487_614_201,
        sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
    },
    SpeechModel {
        id: "medium.en",
        label: "更准确",
        note: "最准，识别慢几倍",
        bytes: 1_533_774_781,
        sha256: "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356",
    },
];
pub const DEFAULT_MODEL: &str = "small.en";

/// 模型的下载来源（文件都按 sha256 校验，镜像给的文件不对会被拦下）。国内多数网络连不上 Hugging Face 官方，自动时排在最后
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DownloadSource {
    pub id: &'static str,
    pub label: &'static str,
    /// 文件地址：`{}` 换成文件名
    url: &'static str,
}

pub const SOURCES: [DownloadSource; 3] = [
    DownloadSource {
        id: "hf-mirror",
        label: "HF 国内镜像",
        url: "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/{}",
    },
    DownloadSource {
        id: "modelscope",
        label: "魔搭社区",
        url: "https://www.modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/{}",
    },
    DownloadSource {
        id: "huggingface",
        label: "Hugging Face 官方",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
    },
];
/// 下载时带上的客户端标识（魔搭不带时拒绝：403）
const USER_AGENT: &str = concat!("Pindu/", env!("CARGO_PKG_VERSION"));
/// 选用的下载来源（app_settings）：auto 按顺序试
const SOURCE_SETTING: &str = "speech.source";
pub const AUTO_SOURCE: &str = "auto";
/// 选用的模型（app_settings）
const MODEL_SETTING: &str = "speech.model";

/// 识别出的字幕记作这个名字（视频的「字幕」一栏显示）
pub const RECOGNIZED_NAME: &str = "自动识别的字幕";
const CANCEL_POLL: Duration = Duration::from_millis(300);

pub fn find_model(id: &str) -> AppResult<&'static SpeechModel> {
    MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| AppError::ValidationError("没有这个识别模型".to_string()))
}

impl SpeechModel {
    fn file(&self) -> String {
        format!("ggml-{}.bin", self.id)
    }
    fn path(&self, data_dir: &Path) -> PathBuf {
        models_dir(data_dir).join(self.file())
    }
    fn part_path(&self, data_dir: &Path) -> PathBuf {
        models_dir(data_dir).join(format!("{}.part", self.file()))
    }
    fn ready(&self, data_dir: &Path) -> bool {
        std::fs::metadata(self.path(data_dir)).is_ok_and(|m| m.len() == self.bytes)
    }
}

fn models_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("models")
}

/// 选用的模型（没设置或不认识时用默认的）
pub async fn selected_model(pool: &SqlitePool) -> &'static SpeechModel {
    let id = SettingsRepository::get(pool, MODEL_SETTING)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    find_model(&id).unwrap_or_else(|_| find_model(DEFAULT_MODEL).expect("默认模型"))
}

pub async fn select_model(pool: &SqlitePool, id: &str) -> AppResult<()> {
    find_model(id)?;
    let mut conn = pool.acquire().await?;
    SettingsRepository::set(&mut conn, MODEL_SETTING, Some(id)).await
}

/// 设置页：各模型下载了没有、选用的是哪个
pub fn models_status(data_dir: &Path, selected: &SpeechModel, source: &str) -> SpeechModels {
    SpeechModels {
        selected: selected.id.to_string(),
        source: source.to_string(),
        sources: SOURCES
            .iter()
            .map(|s| crate::types::video::SpeechSourceInfo {
                id: s.id.to_string(),
                label: s.label.to_string(),
            })
            .collect(),
        models: MODELS
            .iter()
            .map(|m| {
                let size = std::fs::metadata(m.path(data_dir))
                    .map(|f| f.len())
                    .unwrap_or(0);
                SpeechModelInfo {
                    id: m.id.to_string(),
                    label: m.label.to_string(),
                    note: m.note.to_string(),
                    downloaded: size == m.bytes,
                    partial_bytes: std::fs::metadata(m.part_path(data_dir))
                        .map(|f| f.len() as i64)
                        .unwrap_or(0),
                    download_bytes: m.bytes as i64,
                }
            })
            .collect(),
    }
}

/// 删除下载的模型（之后识别时再下载）
pub fn delete_model(data_dir: &Path, model: &SpeechModel) -> AppResult<()> {
    for path in [model.path(data_dir), model.part_path(data_dir)] {
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| AppError::InternalError(format!("删除识别模型失败：{e}")))?;
        }
    }
    Ok(())
}

fn cancelled_error() -> AppError {
    AppError::ValidationError(crate::agent::session::CANCELLED.to_string())
}

impl DownloadSource {
    fn url_of(&self, model: &SpeechModel) -> String {
        self.url.replace("{}", &model.file())
    }
}

/// 选用的下载来源：auto 或某个来源的 id
pub async fn selected_source(pool: &SqlitePool) -> String {
    SettingsRepository::get(pool, SOURCE_SETTING)
        .await
        .ok()
        .flatten()
        .filter(|id| id == AUTO_SOURCE || SOURCES.iter().any(|s| s.id == id))
        .unwrap_or_else(|| AUTO_SOURCE.to_string())
}

pub async fn select_source(pool: &SqlitePool, id: &str) -> AppResult<()> {
    if id != AUTO_SOURCE && !SOURCES.iter().any(|s| s.id == id) {
        return Err(AppError::ValidationError("没有这个下载来源".to_string()));
    }
    let mut conn = pool.acquire().await?;
    SettingsRepository::set(&mut conn, SOURCE_SETTING, Some(id)).await
}

/// 按选用的来源决定试哪些：指定了就只用它，自动时按顺序都试
fn sources_to_try(selected: &str) -> Vec<&'static DownloadSource> {
    match SOURCES.iter().find(|s| s.id == selected) {
        Some(source) => vec![source],
        None => SOURCES.iter().collect(),
    }
}

/// 下载出错的种类（给用户的说法不同）
#[derive(Debug, Clone, PartialEq)]
enum Failure {
    /// 连不上（域名解析不了、被拦、拒绝连接）
    Connect,
    /// 太慢或中途断了
    Stalled,
    /// 来源返回了错误（如文件不在了）
    Http(u16),
    /// 磁盘满了或写不进去
    Disk(String),
    /// 下完了但校验不对
    Corrupt,
    Cancelled,
}

impl Failure {
    /// 还没拿到响应时出错：超时也算连不上（国内连 Hugging Face 多半是这样）
    fn from_send(e: &reqwest::Error) -> Self {
        if e.is_timeout() || e.is_connect() || e.is_request() {
            Failure::Connect
        } else {
            Failure::from_reqwest(e)
        }
    }

    /// 下载过程中出错
    fn from_reqwest(e: &reqwest::Error) -> Self {
        if e.is_timeout() {
            Failure::Stalled
        } else if e.is_connect() {
            Failure::Connect
        } else if let Some(status) = e.status() {
            Failure::Http(status.as_u16())
        } else {
            Failure::Stalled
        }
    }

    fn from_io(e: &std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::StorageFull {
            Failure::Disk("磁盘空间不够".to_string())
        } else {
            Failure::Disk(format!("写不进模型目录：{e}"))
        }
    }

    /// 一个来源失败的说法
    fn text(&self, source: &DownloadSource) -> String {
        match self {
            Failure::Connect => format!("{}连不上", source.label),
            Failure::Stalled => format!("{}太慢或中途断了", source.label),
            Failure::Http(404) => format!("{}上找不到这个文件", source.label),
            Failure::Http(code) => format!("{}返回错误（{code}）", source.label),
            Failure::Disk(text) => text.clone(),
            Failure::Corrupt => format!("从{}下载的文件校验不通过", source.label),
            Failure::Cancelled => "已停止".to_string(),
        }
    }
}

/// 没有这个模型时下载（进度 0–1），校验后放到位。
/// 断了的下载留着 `.part`，下次（换来源也行，文件相同）接着下
pub async fn ensure_model(
    data_dir: &Path,
    model: &SpeechModel,
    source: &str,
    logger: &Logger,
    mut on_progress: impl FnMut(f64),
    cancelled: impl Fn() -> bool,
) -> AppResult<PathBuf> {
    let target = model.path(data_dir);
    if model.ready(data_dir) {
        return Ok(target);
    }
    std::fs::create_dir_all(models_dir(data_dir))
        .map_err(|e| AppError::InternalError(format!("准备模型目录失败：{e}")))?;
    let client = http_client()?;
    let part = model.part_path(data_dir);
    let mut reasons = Vec::new();
    for source in sources_to_try(source) {
        let url = source.url_of(model);
        let failure = match download(
            &client,
            &url,
            &part,
            model.bytes,
            &mut on_progress,
            &cancelled,
        )
        .await
        {
            Ok(()) => match sha256_file(&part) {
                Ok(hash) if hash == model.sha256 => {
                    std::fs::rename(&part, &target)
                        .map_err(|e| AppError::InternalError(format!("保存识别模型失败：{e}")))?;
                    logger.info("VIDEO", &format!("识别模型已下载：{url}"));
                    return Ok(target);
                }
                _ => {
                    // 文件不对：删掉，不让下一个来源接着这份续
                    let _ = std::fs::remove_file(&part);
                    Failure::Corrupt
                }
            },
            Err(failure) => failure,
        };
        if failure == Failure::Cancelled {
            return Err(cancelled_error());
        }
        logger.warn(
            "VIDEO",
            &format!("下载识别模型失败：{url}"),
            Some(&format!("{failure:?}")),
        );
        if let Failure::Disk(text) = &failure {
            return Err(AppError::ExternalServiceError(format!(
                "没能保存语音识别模型：{text}（需要约 {}）",
                human_bytes(model.bytes)
            )));
        }
        reasons.push(failure.text(source));
    }
    Err(AppError::ExternalServiceError(format!(
        "没能下载识别模型：{}。可以在设置里换个下载来源，或从文件导入",
        reasons.join("；")
    )))
}

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::ExternalServiceError(format!("无法下载识别模型：{e}")))
}

fn human_bytes(bytes: u64) -> String {
    if bytes >= 1 << 30 {
        format!("{:.1} GB", bytes as f64 / (1u64 << 30) as f64)
    } else {
        format!("{} MB", bytes >> 20)
    }
}

/// 下载到 `.part`：已有一部分时用 Range 接着下（来源不支持就从头下）
async fn download(
    client: &reqwest::Client,
    url: &str,
    to: &Path,
    expected_bytes: u64,
    on_progress: &mut impl FnMut(f64),
    cancelled: &impl Fn() -> bool,
) -> Result<(), Failure> {
    let have = std::fs::metadata(to).map(|m| m.len()).unwrap_or(0);
    let have = if have >= expected_bytes { 0 } else { have };
    let mut request = client.get(url);
    if have > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut response = request.send().await.map_err(|e| Failure::from_send(&e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(Failure::Http(status.as_u16()));
    }
    let resumed = have > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(to)
        .await
        .map_err(|e| Failure::from_io(&e))?;
    let mut done = if resumed { have } else { 0 };
    let total = expected_bytes.max(1);
    on_progress(done as f64 / total as f64);
    loop {
        if cancelled() {
            return Err(Failure::Cancelled);
        }
        let chunk = tokio::time::timeout(Duration::from_secs(30), response.chunk())
            .await
            .map_err(|_| Failure::Stalled)?
            .map_err(|e| Failure::from_reqwest(&e))?;
        let Some(chunk) = chunk else { break };
        file.write_all(&chunk)
            .await
            .map_err(|e| Failure::from_io(&e))?;
        done += chunk.len() as u64;
        on_progress((done as f64 / total as f64).min(1.0));
    }
    file.flush().await.map_err(|e| Failure::from_io(&e))?;
    if done < expected_bytes {
        return Err(Failure::Stalled);
    }
    Ok(())
}

/// 测一个来源：下载开头 2MB，记连接用时与速度（设置页「测试」）
pub async fn test_source(source: &DownloadSource) -> crate::types::video::SpeechSourceTest {
    const PROBE: u64 = 2 * 1024 * 1024;
    let model = find_model("base.en").expect("base.en");
    let started = std::time::Instant::now();
    let result = async {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| Failure::Connect)?;
        let mut response = client
            .get(source.url_of(model))
            .header(reqwest::header::RANGE, format!("bytes=0-{}", PROBE - 1))
            .send()
            .await
            .map_err(|e| Failure::from_send(&e))?;
        if !response.status().is_success() {
            return Err(Failure::Http(response.status().as_u16()));
        }
        // 速度只算拿到响应之后的那段
        let connected = started.elapsed();
        let mut got = 0u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| Failure::from_reqwest(&e))?
        {
            got += chunk.len() as u64;
            if got >= PROBE {
                break;
            }
        }
        let seconds = (started.elapsed() - connected).as_secs_f64().max(0.001);
        Ok((got as f64 / seconds) as i64)
    }
    .await;
    match result {
        Ok(speed) => crate::types::video::SpeechSourceTest {
            id: source.id.to_string(),
            label: source.label.to_string(),
            ok: true,
            bytes_per_second: speed,
            error: None,
        },
        Err(failure) => crate::types::video::SpeechSourceTest {
            id: source.id.to_string(),
            label: source.label.to_string(),
            ok: false,
            bytes_per_second: 0,
            error: Some(failure.text(source)),
        },
    }
}

/// 从文件导入模型（在别处下好的）：大小与 sha256 都对才放进模型目录
pub fn import_model_file(data_dir: &Path, model: &SpeechModel, file: &Path) -> AppResult<()> {
    let wrong = || {
        AppError::ValidationError(format!(
            "这不是「{}」模型的文件：应该是 {}（{}）",
            model.label,
            model.file(),
            human_bytes(model.bytes)
        ))
    };
    let size = std::fs::metadata(file)
        .map_err(|_| AppError::ValidationError("找不到这个文件".to_string()))?
        .len();
    if size != model.bytes {
        return Err(wrong());
    }
    if sha256_file(file)? != model.sha256 {
        return Err(wrong());
    }
    std::fs::create_dir_all(models_dir(data_dir))
        .map_err(|e| AppError::InternalError(format!("准备模型目录失败：{e}")))?;
    let part = model.part_path(data_dir);
    std::fs::copy(file, &part).map_err(|e| match Failure::from_io(&e) {
        Failure::Disk(text) => AppError::ExternalServiceError(format!("没能导入模型：{text}")),
        _ => AppError::InternalError(format!("没能导入模型：{e}")),
    })?;
    std::fs::rename(&part, model.path(data_dir))
        .map_err(|e| AppError::InternalError(format!("没能导入模型：{e}")))?;
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

/// whisper-cli 识别出一句时的输出：`[00:00:06.000 --> 00:00:12.040]   A small cat was sleeping.`
fn parse_line(line: &str) -> Option<&str> {
    let rest = line.trim_start().strip_prefix('[')?;
    let (timing, text) = rest.split_once(']')?;
    timing.contains("-->").then(|| text.trim())
}

/// 识别到现在：识别出几句、最后一句（界面实时显示）
#[derive(Debug, Default, Clone)]
pub struct Heard {
    pub lines: usize,
    pub last: String,
}

/// 运行 whisper-cli，输出 `<out_prefix>.srt`；进度（0–1）与识别出的句子随时回报
async fn run_whisper(
    model: &Path,
    wav: &Path,
    out_prefix: &Path,
    mut on_progress: impl FnMut(f64, &Heard),
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
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| AppError::ExternalServiceError(format!("无法运行语音识别：{e}")))?;
    // 识别结果逐句写在 stdout（去掉音效标注后的才算一句）
    let heard = Arc::new(Mutex::new(Heard::default()));
    if let Some(stdout) = child.stdout.take() {
        let heard = heard.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Some(text) = parse_line(&line) else {
                    continue;
                };
                let text = subtitle::strip_speaker_marks(
                    &crate::services::passage_import::strip_brackets(text),
                );
                if text.chars().any(|c| c.is_ascii_alphabetic()) {
                    if let Ok(mut h) = heard.lock() {
                        h.lines += 1;
                        h.last = text;
                    }
                }
            }
        });
    }
    let mut tail: Vec<String> = Vec::new();
    let mut progress = 0.0;
    if let Some(stderr) = child.stderr.take() {
        let mut lines = BufReader::new(stderr).lines();
        loop {
            let done = match tokio::time::timeout(CANCEL_POLL, lines.next_line()).await {
                Ok(Ok(Some(line))) => {
                    if let Some(p) = parse_progress(&line) {
                        progress = p;
                    } else if !line.trim().is_empty() {
                        tail.push(line);
                        if tail.len() > 5 {
                            tail.remove(0);
                        }
                    }
                    false
                }
                Ok(_) => true,
                Err(_) => false,
            };
            let snapshot = heard.lock().map(|h| h.clone()).unwrap_or_default();
            on_progress(progress, &snapshot);
            if done {
                break;
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
    /// 已经有字幕时换成识别出的（用户在编辑器里选了「重新识别」）
    pub replace: bool,
}

impl RecognizeJob {
    /// 识别并写回字幕，返回字幕条数
    pub async fn run(&self, ctx: &crate::jobs::JobCtx) -> AppResult<usize> {
        // 视频已经不在（如导入时停止了）：识别也就不用做了，算作取消
        let video = VideoRepository::get(&self.pool, self.video_id)
            .await?
            .ok_or_else(cancelled_error)?;
        if video.status == "failed" || video.status == "importing" {
            return Err(AppError::ValidationError(
                "视频没有导入成功，不能识别字幕".to_string(),
            ));
        }
        if video.cue_count > 0 && !self.replace {
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
        let chosen = selected_model(&self.pool).await;
        let downloading = !chosen.ready(&self.data_dir);
        let (audio_from, recognize_from) = if downloading { (40, 50) } else { (0, 10) };
        if downloading {
            ctx.stage("下载识别模型");
        }
        let source = selected_source(&self.pool).await;
        let model = ensure_model(
            &self.data_dir,
            chosen,
            &source,
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
            let mut reported = 0;
            let srt = run_whisper(
                &model,
                &wav,
                &work.join("speech"),
                |f, heard| {
                    ctx.progress(
                        recognize_from + (f * (100 - recognize_from) as f64) as u64,
                        100,
                    );
                    if heard.lines != reported {
                        reported = heard.lines;
                        ctx.detail(serde_json::json!({ "lines": heard.lines, "last": heard.last }));
                    }
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
        // 识别期间视频被删了：不算识别成功（之后也不再整理）
        if !VideoRepository::set_subtitles(&self.pool, self.video_id, RECOGNIZED_NAME, &cues)
            .await?
        {
            return Err(AppError::NotFound("视频已经删除".to_string()));
        }
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
    fn sources_order_and_failure_texts() {
        let ids = |v: Vec<&DownloadSource>| v.iter().map(|s| s.id).collect::<Vec<_>>();
        // 自动：国内的先试，官方最后
        assert_eq!(
            ids(sources_to_try(AUTO_SOURCE)),
            ["hf-mirror", "modelscope", "huggingface"]
        );
        assert_eq!(ids(sources_to_try("modelscope")), ["modelscope"]);
        let hf = &SOURCES[2];
        assert_eq!(Failure::Connect.text(hf), "Hugging Face 官方连不上");
        assert_eq!(
            Failure::Http(404).text(hf),
            "Hugging Face 官方上找不到这个文件"
        );
        assert_eq!(
            Failure::Stalled.text(&SOURCES[0]),
            "HF 国内镜像太慢或中途断了"
        );
        let full = std::io::Error::from(std::io::ErrorKind::StorageFull);
        assert_eq!(
            Failure::from_io(&full),
            Failure::Disk("磁盘空间不够".to_string())
        );
        assert_eq!(human_bytes(487_614_201), "465 MB");
        assert_eq!(human_bytes(1_533_774_781), "1.4 GB");
        assert_eq!(
            SOURCES[1].url_of(find_model("small.en").unwrap()),
            "https://www.modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/ggml-small.en.bin"
        );
    }

    #[test]
    fn importing_a_wrong_file_is_refused() {
        let dir = std::env::temp_dir().join(format!("pindu-import-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("ggml-small.en.bin");
        std::fs::write(&file, b"not a model").unwrap();
        let small = find_model("small.en").unwrap();
        let err = import_model_file(&dir, small, &file)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("这不是「推荐」模型的文件") && err.contains("ggml-small.en.bin"),
            "{err}"
        );
        assert!(!small.ready(&dir));
        std::fs::remove_dir_all(&dir).ok();
    }

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
        assert_eq!(
            parse_line("[00:00:06.000 --> 00:00:12.040]   A small cat was sleeping."),
            Some("A small cat was sleeping.")
        );
        assert_eq!(parse_line("whisper_init_from_file"), None);

        // 整条是音效标注的去掉，行内的标注去掉，说话人短横去掉
        let srt = "1\n00:00:01,000 --> 00:00:03,000\n(suspenseful music)\n\n2\n00:00:03,000 --> 00:00:05,000\n - That was Jacob back there, wasn't it?\n\n3\n00:00:05,000 --> 00:00:06,000\n[engine revs] Hold on!\n";
        let cues = cues_from_recognized(srt).unwrap();
        let texts: Vec<&str> = cues.iter().map(|c| c.en.as_str()).collect();
        assert_eq!(texts, ["That was Jacob back there, wasn't it?", "Hold on!"]);
        assert_eq!(cues[0].start_ms, 3000);

        let err = cues_from_recognized("1\n00:00:01,000 --> 00:00:03,000\n(music)\n").unwrap_err();
        assert!(err.to_string().contains("没有识别出英文对白"));
        // 只认英语的模型遇到中文语音只写这一句（实测 small.en / base.en）
        let err = cues_from_recognized(
            "1\n00:00:00,000 --> 00:00:03,840\n (speaking in foreign language)\n",
        )
        .unwrap_err();
        assert!(err.to_string().contains("没有识别出英文对白"));
    }

    #[test]
    fn model_status_and_delete() {
        let dir = std::env::temp_dir().join(format!("pindu-model-{}", std::process::id()));
        std::fs::create_dir_all(models_dir(&dir)).unwrap();
        let small = find_model(DEFAULT_MODEL).unwrap();
        assert!(find_model("large").is_err());
        assert!(models_status(&dir, small, AUTO_SOURCE)
            .models
            .iter()
            .all(|m| !m.downloaded));
        std::fs::write(small.part_path(&dir), b"partial").unwrap();
        std::fs::write(small.path(&dir), b"too small").unwrap();
        let all = models_status(&dir, small, AUTO_SOURCE);
        assert_eq!(all.selected, "small.en");
        let status = all.models.iter().find(|m| m.id == "small.en").unwrap();
        assert!(
            !status.downloaded
                && status.partial_bytes == 7
                && status.download_bytes == small.bytes as i64
        );
        delete_model(&dir, small).unwrap();
        assert!(!small.path(&dir).exists() && !small.part_path(&dir).exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}

/// 用真实的 ffmpeg / whisper-cli / 模型识别一段视频（`PINDU_FFMPEG_DIR`、`PINDU_WHISPER_DIR`、`PINDU_TEST_DATA`（里面有 models/ggml-small.en.bin）、
/// `PINDU_TEST_VIDEO`）：`cargo test real_recognize -- --ignored --nocapture`
#[cfg(test)]
mod real {
    use super::*;

    /// 测试三个下载来源（真实网络）：`cargo test real_source_test -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn real_source_test() {
        for source in &SOURCES {
            let t = test_source(source).await;
            println!(
                "{} ok={} {} KB/s {:?}",
                t.label,
                t.ok,
                t.bytes_per_second / 1024,
                t.error
            );
        }
    }

    /// 下到一半断了接着下：先下一部分放进 .part，再下载时只补剩下的（真实网络，base.en）
    #[tokio::test]
    #[ignore]
    async fn real_resume_download() {
        let dir = std::env::temp_dir().join(format!("pindu-resume-{}", std::process::id()));
        std::fs::create_dir_all(models_dir(&dir)).unwrap();
        let base = find_model("base.en").unwrap();
        let client = http_client().unwrap();
        let first = client
            .get(SOURCES[1].url_of(base))
            .header(reqwest::header::RANGE, "bytes=0-9999999")
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        std::fs::write(base.part_path(&dir), &first).unwrap();
        let mut start = None;
        let logger = crate::test_support::test_logger();
        ensure_model(
            &dir,
            base,
            "modelscope",
            &logger,
            |p| {
                start.get_or_insert(p);
            },
            || false,
        )
        .await
        .unwrap();
        println!("从 {:.1}% 接着下", start.unwrap() * 100.0);
        assert!(start.unwrap() > 0.05 && base.ready(&dir));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 真实下载模型（base.en，约 150MB）到临时目录并校验：`cargo test real_model_download -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn real_model_download() {
        let dir = std::env::temp_dir().join(format!("pindu-model-dl-{}", std::process::id()));
        let logger = crate::test_support::test_logger();
        let mut last = 0.0;
        let started = std::time::Instant::now();
        let base = find_model("base.en").unwrap();
        let path = ensure_model(&dir, base, AUTO_SOURCE, &logger, |p| last = p, || false)
            .await
            .unwrap();
        println!(
            "下载完成：{:.1}s，进度 {last}",
            started.elapsed().as_secs_f64()
        );
        assert!(base.ready(&dir) && last >= 0.99 && path.is_file());
        // 已有模型：不再下载
        ensure_model(
            &dir,
            base,
            AUTO_SOURCE,
            &logger,
            |_| panic!("不该再下载"),
            || false,
        )
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
        let small = find_model(DEFAULT_MODEL).unwrap();
        assert!(small.ready(&data), "模型不在 {}", data.display());
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
            &small.path(&data),
            &wav,
            &work.join("speech"),
            |p, _| last = p,
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
