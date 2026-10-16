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
/// 给 whisper 的开头提示：带标点和大小写的一句话。不给时 small.en 常写出全小写、没有标点的字幕，
/// 一条里混着几句话的边界，之后怎么整理都断不对
const PUNCTUATION_PROMPT: &str = "Hello, everyone. Welcome back to the program.";

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
    // 上次已经下完、没来得及改名就退出了：校验通过直接用，不再重下
    if std::fs::metadata(&part).is_ok_and(|m| m.len() == model.bytes) {
        if sha256_file_async(&part).await? == model.sha256 {
            std::fs::rename(&part, &target)
                .map_err(|e| AppError::InternalError(format!("保存识别模型失败：{e}")))?;
            return Ok(target);
        }
        let _ = std::fs::remove_file(&part);
    }
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
            Ok(()) => match sha256_file_async(&part).await {
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
    std::fs::create_dir_all(models_dir(data_dir))
        .map_err(|e| AppError::InternalError(format!("准备模型目录失败：{e}")))?;
    // 复制到导入专用的临时文件（不和下载续传的 .part 混用），校验复制好的那份再放到位
    let temp = models_dir(data_dir).join(format!("{}.import", model.file()));
    let result = (|| {
        std::fs::copy(file, &temp).map_err(|e| match Failure::from_io(&e) {
            Failure::Disk(text) => AppError::ExternalServiceError(format!("没能导入模型：{text}")),
            _ => AppError::InternalError(format!("没能导入模型：{e}")),
        })?;
        if sha256_file(&temp)? != model.sha256 {
            return Err(wrong());
        }
        std::fs::rename(&temp, model.path(data_dir))
            .map_err(|e| AppError::InternalError(format!("没能导入模型：{e}")))
    })();
    let _ = std::fs::remove_file(&temp);
    result
}

/// 在后台线程算 sha256（模型最大 1.5GB，不占用异步任务的线程）
async fn sha256_file_async(path: &Path) -> AppResult<String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || sha256_file(&path))
        .await
        .map_err(|e| AppError::InternalError(format!("校验识别模型失败：{e}")))?
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
    // 开发版还可以用环境变量指定目录（正式版不改 dirs）
    #[cfg_attr(not(debug_assertions), allow(unused_mut))]
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

/// 运行 whisper-cli，输出 `<out_prefix>.srt` 与逐词时间 `<out_prefix>.json`；进度（0–1）与识别出的句子随时回报
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
        .args(["-l", "en", "-osrt", "-ojf", "-pp", "-np"])
        .arg("--prompt")
        .arg(PUNCTUATION_PROMPT)
        .arg("-t")
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

fn no_speech() -> AppError {
    AppError::ValidationError("没有识别出英文对白：这个视频可能没有英文语音".to_string())
}

/// 识别出的字幕（srt）→ 字幕条（与导入的字幕同一个解析）；逐词结果读不了时用；几乎没有英文时说明原因
pub fn cues_from_recognized(srt: &str) -> AppResult<Vec<Cue>> {
    subtitle::build_cues(srt, None).map_err(|_| no_speech())
}

/// 识别出的一个词
#[derive(Debug, Clone, PartialEq)]
struct Word {
    text: String,
    start_ms: i64,
    end_ms: i64,
    /// 这个词前面换了一个人说话（`>>` / `-`）
    new_speaker: bool,
}

/// whisper 完整 JSON（`-ojf`）→ 词：token 以空格开头是新词，否则接在上一个词后面（标点、词的后半）；
/// 去掉特殊 token、音效标注（[Music] / (laughs)）、开头提示被原样写出来的段（静音时会有）
/// 一个音效标注（`[Music]`、`(laughs)`）最多这么多个 token；超过还没闭合，就当成不是标注
const MAX_MARK_TOKENS: usize = 8;

fn words_from_whisper(json: &serde_json::Value) -> Vec<Word> {
    let prompt: Vec<String> = PUNCTUATION_PROMPT
        .split_inclusive(['.', '?', '!'])
        .map(|s| s.trim().to_lowercase())
        .collect();
    let mut words: Vec<Word> = Vec::new();
    let mut speaker = false;
    let segments = json["transcription"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for (k, segment) in segments.iter().enumerate() {
        let text = segment["text"].as_str().unwrap_or("").trim().to_lowercase();
        // whisper 偶尔把提示句原样吐出来（常在开头或静音处）：不常说的后半句在哪都丢掉；
        // "Hello, everyone." 这样的常见开场只在开头那段丢（片中真说了不能丢）
        if prompt.contains(&text) && (k == 0 || prompt.first() != Some(&text)) {
            continue;
        }
        // 音效标注只在一段里找（一个没闭合的括号不能把后面的都吞掉），最多跳过 MAX_MARK_TOKENS 个
        let mut in_mark = 0usize;
        for token in segment["tokens"].as_array().into_iter().flatten() {
            let raw = token["text"].as_str().unwrap_or("");
            if raw.starts_with("[_") {
                continue;
            }
            let (from, to) = (
                token["offsets"]["from"].as_i64().unwrap_or(0),
                token["offsets"]["to"].as_i64().unwrap_or(0),
            );
            let piece = raw.trim();
            if piece.is_empty() {
                continue;
            }
            // 音效标注：从 [ / ( 开始到 ] / ) 结束，整段丢掉
            if (in_mark > 0 && in_mark <= MAX_MARK_TOKENS) || piece.starts_with(['[', '(']) {
                in_mark = if piece.ends_with([']', ')']) {
                    0
                } else {
                    in_mark + 1
                };
                continue;
            }
            in_mark = 0;
            if piece.contains('♪') {
                continue;
            }
            // 换人说话：`>>`，或单独的短横（不是 check-in 这种词中间的连字符）
            if piece.starts_with(">>") || (raw.starts_with(' ') && (piece == "-" || piece == "–"))
            {
                speaker = true;
                let rest = piece.trim_start_matches(['>', '-', '–']).trim();
                if rest.is_empty() {
                    continue;
                }
                words.push(Word {
                    text: rest.to_string(),
                    start_ms: from,
                    end_ms: to,
                    new_speaker: true,
                });
                speaker = false;
                continue;
            }
            match words.last_mut() {
                Some(last) if !raw.starts_with(' ') => {
                    last.text.push_str(piece);
                    last.end_ms = last.end_ms.max(to);
                }
                _ => {
                    words.push(Word {
                        text: piece.to_string(),
                        start_ms: from,
                        end_ms: to.max(from),
                        new_speaker: speaker,
                    });
                    speaker = false;
                }
            }
        }
    }
    words.retain(|w| w.text.chars().any(|c| c.is_alphanumeric()));
    words
}

/// 识别出的词 → 字幕条：一句一条（句末标点、停顿、换人说话处断开；太长的在逗号、连词、停顿处拆开，不断在虚词后，
/// 规则与导入字幕的断句同一套 `sentences::group_spans`），时间来自每个词，比按 whisper 的分段准
pub fn cues_from_whisper_json(json: &str) -> AppResult<Vec<Cue>> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::InternalError(format!("读取识别结果失败：{e}")))?;
    let words = words_from_whisper(&value);
    let spans: Vec<crate::services::sentences::Span> = words
        .iter()
        .map(|w| crate::services::sentences::Span {
            text: &w.text,
            start_ms: w.start_ms,
            end_ms: w.end_ms,
        })
        .collect();
    let cues: Vec<Cue> =
        crate::services::sentences::group_spans(&spans, |i| words[i].new_speaker.then_some(false))
            .into_iter()
            .map(|range| {
                let group = &words[range];
                Cue {
                    start_ms: group[0].start_ms,
                    end_ms: group[group.len() - 1].end_ms.max(group[0].start_ms + 1),
                    en: group
                        .iter()
                        .map(|w| w.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" "),
                    zh: String::new(),
                    join: None,
                }
            })
            .filter(|c| c.en.chars().any(|ch| ch.is_ascii_alphabetic()))
            .collect();
    if cues.is_empty() {
        return Err(no_speech());
    }
    Ok(cues)
}

/// 识别结果 → 字幕条：优先按逐词时间组句（`<prefix>.json`），读不了时退回 whisper 的分段（`<prefix>.srt`）
pub fn recognized_cues(out_prefix: &Path, logger: &Logger) -> AppResult<Vec<Cue>> {
    let json = out_prefix.with_extension("json");
    // whisper 按字节切 token，多字节字符（♪ 等）被切开时不是合法 UTF-8：按字节读、坏的字节替换掉
    let read = std::fs::read(&json).map(|b| String::from_utf8_lossy(&b).into_owned());
    if let Err(e) = &read {
        logger.warn(
            "VIDEO",
            "逐词识别结果读不了，按分段组句",
            Some(&e.to_string()),
        );
    }
    if let Ok(text) = read {
        match cues_from_whisper_json(&text) {
            Ok(cues) => return Ok(cues),
            Err(e @ AppError::ValidationError(_)) => return Err(e),
            Err(e) => logger.warn(
                "VIDEO",
                "逐词识别结果读不了，按分段组句",
                Some(&e.to_string()),
            ),
        }
    }
    let srt = std::fs::read_to_string(out_prefix.with_extension("srt"))
        .map_err(|e| AppError::InternalError(format!("读取识别结果失败：{e}")))?;
    cues_from_recognized(&srt)
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
            let out_prefix = work.join("speech");
            run_whisper(
                &model,
                &wav,
                &out_prefix,
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
            recognized_cues(&out_prefix, &self.logger)
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

    /// whisper `-ojf` 的结构：段 → token（以空格开头是新词），offsets 是毫秒
    /// 一个 token：文字、开始、结束（毫秒）
    type Token<'a> = (&'a str, i64, i64);

    fn whisper_json(segments: &[(&str, &[Token])]) -> String {
        let segs: Vec<serde_json::Value> = segments
            .iter()
            .map(|(text, tokens)| {
                let mut list =
                    vec![serde_json::json!({"text": "[_BEG_]", "offsets": {"from": 0, "to": 0}})];
                list.extend(tokens.iter().map(|(t, from, to)| {
                    serde_json::json!({"text": t, "offsets": {"from": from, "to": to}})
                }));
                serde_json::json!({"text": text, "tokens": list})
            })
            .collect();
        serde_json::json!({"transcription": segs}).to_string()
    }

    #[test]
    fn unclosed_bracket_does_not_swallow_later_segments() {
        // 一段里有个没闭合的 `(`：只跳过有限的几个 token，下一段照常识别；片中间真说了提示句也保留
        let json = whisper_json(&[
            (" (sighs", &[(" (", 0, 0), ("sighs", 0, 300)]),
            (
                " Hello, everyone.",
                &[
                    (" Hello", 1000, 1300),
                    (",", 1300, 1300),
                    (" everyone", 1300, 1800),
                    (".", 1800, 1800),
                ],
            ),
            (
                " We are leaving now.",
                &[
                    (" We", 2000, 2200),
                    (" are", 2200, 2400),
                    (" leaving", 2400, 2800),
                    (" now", 2800, 3000),
                    (".", 3000, 3000),
                ],
            ),
        ]);
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        let text: Vec<String> = words_from_whisper(&value)
            .into_iter()
            .map(|w| w.text)
            .collect();
        assert_eq!(
            text,
            ["Hello,", "everyone.", "We", "are", "leaving", "now."]
        );
    }

    #[test]
    fn recognized_words_become_sentences() {
        // whisper 的分段断在半句话里（that ‖ it's）：按词重新组句
        let json = whisper_json(&[
            (
                " The flight was delayed again. I got a message that",
                &[
                    (" The", 0, 200),
                    (" flight", 200, 600),
                    (" was", 600, 800),
                    (" delayed", 800, 1300),
                    (" again", 1300, 1700),
                    (".", 1700, 1700),
                    (" I", 2200, 2300),
                    (" got", 2300, 2500),
                    (" a", 2500, 2550),
                    (" message", 2550, 3000),
                    (" that", 3000, 3200),
                ],
            ),
            (
                " it's cancelled, Mr. Smith. [Music]",
                &[
                    (" it", 3300, 3400),
                    ("'s", 3400, 3500),
                    (" cancel", 3500, 3900),
                    ("led", 3900, 4100),
                    (",", 4100, 4100),
                    (" Mr", 4300, 4500),
                    (".", 4500, 4500),
                    (" Smith", 4500, 4900),
                    (".", 4900, 4900),
                    (" [", 5000, 5000),
                    ("Music", 5000, 5500),
                    ("]", 5500, 5500),
                ],
            ),
            (
                " >> Hello, everyone.",
                &[
                    (" >>", 8000, 8000),
                    (" Hello", 8000, 8400),
                    (",", 8400, 8400),
                    (" everyone", 8400, 9000),
                    (".", 9000, 9000),
                ],
            ),
            // 静音时 whisper 会把开头提示原样写出来
            (
                " Welcome back to the program.",
                &[
                    (" Welcome", 9500, 9800),
                    (" back", 9800, 10_000),
                    (" to", 10_000, 10_100),
                    (" the", 10_100, 10_200),
                    (" program", 10_200, 10_600),
                    (".", 10_600, 10_600),
                ],
            ),
        ]);
        let cues = cues_from_whisper_json(&json).unwrap();
        let texts: Vec<&str> = cues.iter().map(|c| c.en.as_str()).collect();
        assert_eq!(
            texts,
            [
                "The flight was delayed again.",
                "I got a message that it's cancelled, Mr. Smith.",
                "Hello, everyone."
            ]
        );
        assert_eq!((cues[1].start_ms, cues[1].end_ms), (2200, 4900));
        assert!(cues.iter().all(|c| c.join.is_none() && c.zh.is_empty()));

        // 连字符不是换人说话
        let json = whisper_json(&[(
            " check-in desk.",
            &[
                (" check", 0, 300),
                ("-", 300, 300),
                ("in", 300, 500),
                (" desk", 500, 900),
                (".", 900, 900),
            ],
        )]);
        assert_eq!(
            cues_from_whisper_json(&json).unwrap()[0].en,
            "check-in desk."
        );

        // 只有音效：没有英文对白
        let json = whisper_json(&[(
            " [Music]",
            &[(" [", 0, 0), ("Music", 0, 900), ("]", 900, 900)],
        )]);
        assert!(cues_from_whisper_json(&json)
            .unwrap_err()
            .to_string()
            .contains("没有识别出英文对白"));
    }

    #[test]
    fn long_recognized_run_on_splits_at_safe_places() {
        // 没有句号的一长串（口语常见）：在逗号 / 连词 / 停顿处拆开，不断在虚词后面
        let text = "I went to the gate and they said it was cancelled , you have to get another flight so we went back to the hotel and waited for the next one because nobody at the desk could tell us anything";
        let mut tokens: Vec<(String, i64, i64)> = Vec::new();
        let mut t = 0;
        for w in text.split(' ') {
            let token = if w == "," {
                ",".to_string()
            } else {
                format!(" {w}")
            };
            let (from, to) = if w == "," { (t, t) } else { (t, t + 300) };
            tokens.push((token, from, to));
            if w != "," {
                t += 320;
            }
        }
        let refs: Vec<Token> = tokens
            .iter()
            .map(|(a, b, c)| (a.as_str(), *b, *c))
            .collect();
        let cues = cues_from_whisper_json(&whisper_json(&[(" x", &refs)])).unwrap();
        assert!(cues.len() >= 2, "{cues:?}");
        for c in &cues[..cues.len() - 1] {
            assert!(!crate::services::sentences::dangling(&c.en), "{}", c.en);
        }
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
        let prefix = work.join("speech");
        run_whisper(&small.path(&data), &wav, &prefix, |p, _| last = p, || false)
            .await
            .unwrap();
        let logger = Logger::new(&work).unwrap();
        let cues = recognized_cues(&prefix, &logger).unwrap();
        println!(
            "{} 条，用时 {:.1}s，最后进度 {last}",
            cues.len(),
            started.elapsed().as_secs_f64()
        );
        for c in &cues {
            println!("{:>7} {:>7}  {}", c.start_ms, c.end_ms, c.en);
        }
        assert!(!cues.is_empty() && last >= 0.99);
        std::fs::remove_dir_all(&work).ok();
    }

    /// 断句评测：按清单逐个视频（片段）识别、断句，汇总质量指标，调识别或断句规则时比前后。
    /// `PINDU_EVAL_MANIFEST`：JSON 数组，每项 `{name, kind: "recognize" | "subtitle", path, start?, duration?}`
    /// （recognize 取视频的 start 秒起 duration 秒识别；subtitle 读 srt / vtt 或 videos.cues 的 JSON）；
    /// `PINDU_EVAL_OUT`：结果目录（每项的字幕条与指标，以及 summary.json）；
    /// `PINDU_EVAL_BASELINE=1` 时另按改动前的参数识别一份 `<name>.before.srt`（不加开头提示、只出 srt）。
    /// 其余环境变量同 real_recognize
    #[tokio::test]
    #[ignore]
    async fn real_segmentation_eval() {
        use crate::services::sentences::eval;
        let manifest: Vec<serde_json::Value> = serde_json::from_str(
            &std::fs::read_to_string(std::env::var("PINDU_EVAL_MANIFEST").unwrap()).unwrap(),
        )
        .unwrap();
        let out = PathBuf::from(std::env::var("PINDU_EVAL_OUT").unwrap());
        std::fs::create_dir_all(&out).unwrap();
        let baseline = std::env::var("PINDU_EVAL_BASELINE").is_ok_and(|v| v == "1");
        let tools = crate::media::locate_in(Path::new(&std::env::var("PINDU_FFMPEG_DIR").unwrap()))
            .await
            .expect("ffmpeg");
        let data = PathBuf::from(std::env::var("PINDU_TEST_DATA").unwrap());
        let model = find_model(DEFAULT_MODEL).unwrap().path(&data);
        let logger = Logger::new(&out).unwrap();
        let mut summary = serde_json::Map::new();
        for item in &manifest {
            let name = item["name"].as_str().unwrap();
            let path = item["path"].as_str().unwrap();
            let started = std::time::Instant::now();
            let cues = if item["kind"] == "subtitle" {
                let text = std::fs::read_to_string(path).unwrap();
                if path.ends_with(".json") {
                    serde_json::from_str::<Vec<Cue>>(&text).unwrap()
                } else {
                    subtitle::build_cues(&text, None).unwrap()
                }
            } else {
                let wav = out.join(format!("{name}.wav"));
                let mut args: Vec<String> = Vec::new();
                if let Some(start) = item["start"].as_f64() {
                    args.extend(["-ss".into(), start.to_string()]);
                }
                if let Some(duration) = item["duration"].as_f64() {
                    args.extend(["-t".into(), duration.to_string()]);
                }
                args.extend(["-i".into(), path.into()]);
                args.extend(
                    ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y"]
                        .map(String::from),
                );
                args.push(wav.to_string_lossy().into_owned());
                let status = crate::process::command(&tools.ffmpeg)
                    .args(["-v", "error"])
                    .args(&args)
                    .status()
                    .await
                    .unwrap();
                assert!(status.success(), "{name}: 抽音频失败");
                if baseline {
                    let status = crate::process::command(whisper_cli().unwrap())
                        .arg("-m")
                        .arg(&model)
                        .arg("-f")
                        .arg(&wav)
                        .args([
                            "-l",
                            "en",
                            "-osrt",
                            "-np",
                            "-t",
                            &threads().to_string(),
                            "-of",
                        ])
                        .arg(out.join(format!("{name}.before")))
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status()
                        .await
                        .unwrap();
                    assert!(status.success(), "{name}: 改动前参数识别失败");
                }
                let prefix = out.join(name);
                run_whisper(&model, &wav, &prefix, |_, _| {}, || false)
                    .await
                    .unwrap();
                std::fs::remove_file(&wav).ok();
                match recognized_cues(&prefix, &logger) {
                    Ok(cues) => cues,
                    Err(e) => {
                        // 没有英文对白（静音、非英语）也是一种结果
                        println!("{name:<16} {e}");
                        summary.insert(
                            name.to_string(),
                            serde_json::json!({ "error": e.to_string() }),
                        );
                        continue;
                    }
                }
            };
            let stats = eval::stats(&cues);
            std::fs::write(
                out.join(format!("{name}.cues.json")),
                serde_json::to_string_pretty(&cues).unwrap(),
            )
            .unwrap();
            println!(
                "{name:<16} 条 {:>4} 句 {:>4} 虚词断 {:>2} 无标点断 {:>3} 大写 {:>3.0}% 句末标点 {:>3.0}% 中位 {:>2} 最长 {:>2} 超长 {:>2}  {:.1}s",
                stats.cues, stats.sentences, stats.dangling_cuts, stats.bare_cuts,
                stats.capitalized * 100.0, stats.terminal * 100.0,
                stats.median_words, stats.max_words, stats.over_soft,
                started.elapsed().as_secs_f64()
            );
            for e in &stats.examples {
                println!("    {e}");
            }
            summary.insert(name.to_string(), serde_json::to_value(&stats).unwrap());
        }
        std::fs::write(
            out.join("summary.json"),
            serde_json::to_string_pretty(&summary).unwrap(),
        )
        .unwrap();
    }
}
