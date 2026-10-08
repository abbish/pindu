//! 本机媒体服务（唯一 owner）：把数据目录下 `videos/` 里的视频、缩略图经 `http://127.0.0.1:<端口>/<令牌>/...` 给编辑器和短片播放器。
//!
//! 为什么不用 asset 协议：macOS 的 WKWebView 经自定义协议播放大视频不可靠（图片正常、视频不播），
//! 播放器需要标准 HTTP 的 Range 分段读取。
//!
//! 安全：只监听 127.0.0.1；路径第一段是每次启动随机生成的令牌；只服务 videos/ 目录下的文件（规范化后检查前缀）；只支持 GET / HEAD。

use crate::logger::Logger;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

/// 一次分段响应最多返回的字节数（播放器会接着要下一段）
const MAX_CHUNK: u64 = 4 * 1024 * 1024;
const COPY_BUF: usize = 256 * 1024;

#[derive(Clone)]
pub struct MediaServer {
    base: String,
    root: PathBuf,
}

impl MediaServer {
    /// 启动服务（随机端口）；失败返回 None（视频播放不可用，其它功能不受影响）
    pub async fn start(root: PathBuf, logger: Logger) -> std::io::Result<Self> {
        std::fs::create_dir_all(&root)?;
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let port = listener.local_addr()?.port();
        let token = uuid::Uuid::new_v4().simple().to_string();
        let root = root.canonicalize()?;
        let server = Self {
            base: format!("http://127.0.0.1:{port}/{token}"),
            root: root.clone(),
        };
        let token = Arc::new(token);
        tauri::async_runtime::spawn(async move {
            loop {
                let stream = match listener.accept().await {
                    Ok((stream, _)) => stream,
                    Err(e) => {
                        logger.warn("MEDIA", "视频播放服务接受连接失败", Some(&e.to_string()));
                        continue;
                    }
                };
                let (root, token, logger) = (root.clone(), token.clone(), logger.clone());
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = serve(stream, &root, &token, &logger).await {
                        // 播放器拖动进度、关掉页面时会中途断开，属正常
                        if !matches!(
                            e.kind(),
                            ErrorKind::BrokenPipe
                                | ErrorKind::ConnectionReset
                                | ErrorKind::ConnectionAborted
                                | ErrorKind::UnexpectedEof
                        ) {
                            logger.warn("MEDIA", "视频播放服务读写失败", Some(&e.to_string()));
                        }
                    }
                });
            }
        });
        Ok(server)
    }

    /// 绝对路径 → 播放地址；文件不存在或不在 videos/ 下时返回 None
    pub fn url(&self, path: &Path) -> Option<String> {
        let full = path.canonicalize().ok()?;
        let relative = full.strip_prefix(&self.root).ok()?;
        let encoded: Vec<String> = relative
            .components()
            .map(|c| encode(&c.as_os_str().to_string_lossy()))
            .collect();
        Some(format!("{}/{}", self.base, encoded.join("/")))
    }
}

fn encode(segment: &str) -> String {
    segment
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn decode(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = segment.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// 请求路径 → root 下的文件；令牌不对、含 `..`、越出 root 都拒绝
fn resolve(root: &Path, token: &str, target: &str) -> Option<PathBuf> {
    let path = target.split('?').next()?;
    let mut parts = path.trim_start_matches('/').split('/');
    if parts.next()? != token {
        return None;
    }
    let mut file = root.to_path_buf();
    for part in parts {
        let part = decode(part)?;
        let p = Path::new(&part);
        if part.is_empty() || p.components().any(|c| !matches!(c, Component::Normal(_))) {
            return None;
        }
        file.push(p);
    }
    let file = file.canonicalize().ok()?;
    (file.starts_with(root) && file.is_file()).then_some(file)
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

/// `bytes=start-end` / `bytes=start-` / `bytes=-suffix` → [start, end]（含），按 MAX_CHUNK 截短
fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header
        .trim()
        .strip_prefix("bytes=")?
        .split(',')
        .next()?
        .trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", suffix) => {
            let n: u64 = suffix.parse().ok()?;
            (len.saturating_sub(n), len.checked_sub(1)?)
        }
        (s, "") => (s.parse().ok()?, len.checked_sub(1)?),
        (s, e) => (
            s.parse().ok()?,
            e.parse::<u64>().ok()?.min(len.checked_sub(1)?),
        ),
    };
    if start > end || start >= len {
        return None;
    }
    Some((start, end.min(start + MAX_CHUNK - 1)))
}

async fn serve(
    stream: TcpStream,
    root: &Path,
    token: &str,
    logger: &Logger,
) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream);
    loop {
        // 请求行 + 头（支持 keep-alive，同一连接上多次分段请求）
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).await? == 0 {
            return Ok(());
        }
        let mut range = None;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).await? == 0 {
                return Ok(());
            }
            let line = line.trim_end();
            if line.is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                if name.eq_ignore_ascii_case("range") {
                    range = Some(value.trim().to_string());
                }
            }
        }
        let mut parts = request_line.split_whitespace();
        let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        let stream = reader.get_mut();
        if method != "GET" && method != "HEAD" {
            write_status(stream, "405 Method Not Allowed").await?;
            continue;
        }
        let Some(path) = resolve(root, token, target) else {
            // 不记路径：里面有令牌
            logger.warn("MEDIA", "视频播放服务找不到请求的文件", None);
            write_status(stream, "404 Not Found").await?;
            continue;
        };
        let mut file = tokio::fs::File::open(&path).await?;
        let len = file.metadata().await?.len();
        let (status, start, end) = match range.as_deref() {
            Some(header) => match parse_range(header, len) {
                Some((s, e)) => ("206 Partial Content", s, e),
                None => {
                    let head = format!(
                        "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
                    );
                    stream.write_all(head.as_bytes()).await?;
                    continue;
                }
            },
            None => ("200 OK", 0, len.saturating_sub(1)),
        };
        let body_len = if len == 0 { 0 } else { end - start + 1 };
        let mut head = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {}\r\nContent-Length: {body_len}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\n",
            content_type(&path)
        );
        if status.starts_with("206") {
            head.push_str(&format!("Content-Range: bytes {start}-{end}/{len}\r\n"));
        }
        head.push_str("\r\n");
        stream.write_all(head.as_bytes()).await?;
        if method == "GET" && body_len > 0 {
            file.seek(std::io::SeekFrom::Start(start)).await?;
            let mut remaining = body_len;
            let mut buf = vec![0u8; COPY_BUF];
            while remaining > 0 {
                let want = remaining.min(COPY_BUF as u64) as usize;
                let n = file.read(&mut buf[..want]).await?;
                if n == 0 {
                    break;
                }
                stream.write_all(&buf[..n]).await?;
                remaining -= n as u64;
            }
        }
        stream.flush().await?;
    }
}

async fn write_status(stream: &mut TcpStream, status: &str) -> std::io::Result<()> {
    stream
        .write_all(format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\n\r\n").as_bytes())
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-1", 100), Some((0, 1)));
        assert_eq!(parse_range("bytes=10-", 100), Some((10, 99)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=90-200", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("items=0-1", 100), None);
        // 太大的分段截短
        let big = 100 * MAX_CHUNK;
        assert_eq!(parse_range("bytes=0-", big), Some((0, MAX_CHUNK - 1)));
    }

    #[test]
    fn only_files_under_root_with_the_token() {
        let root = std::env::temp_dir().join(format!("pindu-media-{}", std::process::id()));
        std::fs::create_dir_all(root.join("1/clips")).unwrap();
        std::fs::write(root.join("1/clips/a b.mp4"), b"x").unwrap();
        std::fs::write(root.parent().unwrap().join("secret.txt"), b"s").unwrap();
        let root = root.canonicalize().unwrap();
        assert!(resolve(&root, "tok", "/tok/1/clips/a%20b.mp4").is_some());
        assert!(resolve(&root, "bad", "/tok/1/clips/a%20b.mp4").is_none());
        assert!(resolve(&root, "tok", "/tok/../secret.txt").is_none());
        assert!(resolve(&root, "tok", "/tok/%2E%2E/secret.txt").is_none());
        assert!(resolve(&root, "tok", "/tok/1/clips").is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn encode_and_decode_round_trip() {
        let name = "片段 1 (a).mp4";
        assert_eq!(decode(&encode(name)).unwrap(), name);
    }

    #[tokio::test]
    async fn serves_ranges_over_http() {
        let root = std::env::temp_dir().join(format!("pindu-media-http-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("v.mp4"), (0..200u8).collect::<Vec<_>>()).unwrap();
        let server =
            MediaServer::start(root.clone(), (*crate::test_support::test_logger()).clone())
                .await
                .unwrap();
        let url = server.url(&root.join("v.mp4")).unwrap();
        let client = reqwest::Client::new();
        let resp = client
            .get(&url)
            .header("Range", "bytes=10-19")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 206);
        assert_eq!(resp.headers()["content-type"], "video/mp4");
        assert_eq!(resp.headers()["content-range"], "bytes 10-19/200");
        assert_eq!(
            resp.bytes().await.unwrap().to_vec(),
            (10..20u8).collect::<Vec<_>>()
        );
        let whole = client.get(&url).send().await.unwrap();
        assert_eq!(whole.status(), 200);
        assert_eq!(whole.bytes().await.unwrap().len(), 200);
        let missing = client
            .get(url.replace("v.mp4", "x.mp4"))
            .send()
            .await
            .unwrap();
        assert_eq!(missing.status(), 404);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
