//! 导入视频时自动找字幕：视频旁边的同名字幕文件（含 `.en` / `.chs` 等语言后缀）> 视频里自带的文字字幕轨道（导出成 srt 放进缓存）。
//! 找到的字幕按语言给出建议：英文（或中英双语）做「字幕」，中文做「第二字幕」。都没有时界面让用户选文件或自动识别语音。

use crate::error::AppResult;
use crate::logger::Logger;
use crate::media::{MediaTools, SubtitleTrack};
use crate::services::subtitle;
use crate::types::video::{SubtitleCandidate, SubtitleDiscovery};
use std::path::{Path, PathBuf};

/// 字幕文件的扩展名
const EXTENSIONS: [&str; 2] = ["srt", "vtt"];
/// 一个视频最多列出几个候选
const MAX_CANDIDATES: usize = 12;
/// 超过这个大小的不当作字幕
const MAX_BYTES: u64 = 5 * 1024 * 1024;

/// 文件名里的语言标记 → en / zh
fn language_of_token(token: &str) -> &'static str {
    match token.to_lowercase().as_str() {
        "en" | "eng" | "english" | "en-us" | "en-gb" | "英文" | "英语" => "en",
        "zh" | "chs" | "cht" | "chi" | "zho" | "sc" | "tc" | "cn" | "chinese" | "zh-cn"
        | "zh-tw" | "zh-hans" | "zh-hant" | "简体" | "繁体" | "中文" | "简中" | "繁中" => {
            "zh"
        }
        _ => "",
    }
}

/// 视频旁边的字幕文件：文件名（不分大小写）与视频同名，或是「视频名.语言.srt」；返回（路径，文件名里的语言）
pub fn sidecar_files(video: &Path, names: &[String]) -> Vec<(PathBuf, &'static str)> {
    let Some(dir) = video.parent() else {
        return Vec::new();
    };
    let stem = video
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if stem.is_empty() {
        return Vec::new();
    }
    let mut found: Vec<(PathBuf, &'static str)> = names
        .iter()
        .filter_map(|name| {
            let path = Path::new(name);
            let ext = path.extension()?.to_string_lossy().to_lowercase();
            if !EXTENSIONS.contains(&ext.as_str()) {
                return None;
            }
            let file_stem = path.file_stem()?.to_string_lossy().to_lowercase();
            let rest = if file_stem == stem {
                ""
            } else {
                file_stem.strip_prefix(&format!("{stem}."))?
            };
            let language = rest
                .split(['.', '_', '-', ' '])
                .map(language_of_token)
                .find(|l| !l.is_empty())
                .or_else(|| Some(language_of_token(rest)))
                .unwrap_or("");
            Some((dir.join(name), language))
        })
        .collect();
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found
}

/// 字幕轨道的语言：语言标签，其次轨道名
pub fn language_of_track(track: &SubtitleTrack) -> &'static str {
    let tag = language_of_token(&track.language);
    if !tag.is_empty() {
        return tag;
    }
    let title = track.title.to_lowercase();
    if title.contains("english") || title.contains("英") {
        "en"
    } else if title.contains("chinese")
        || title.contains("中")
        || title.contains("简")
        || title.contains("繁")
    {
        "zh"
    } else {
        ""
    }
}

fn track_label(track: &SubtitleTrack, language: &str) -> String {
    let name = if !track.title.trim().is_empty() {
        track.title.trim().to_string()
    } else {
        match language {
            "en" => "英文".to_string(),
            "zh" => "中文".to_string(),
            _ if !track.language.is_empty() => track.language.clone(),
            _ => format!("第 {} 条", track.index),
        }
    };
    format!("视频自带 · {name}")
}

/// 读出字幕文件，补上内容判断的语言与开头几句；读不了或太大的跳过
fn candidate(
    path: &Path,
    source: &str,
    label: String,
    language: &str,
) -> Option<SubtitleCandidate> {
    if std::fs::metadata(path).ok()?.len() > MAX_BYTES {
        return None;
    }
    let text = crate::services::passage_import::decode_text(&std::fs::read(path).ok()?);
    let by_content = subtitle::content_language(&text);
    if by_content.is_empty() {
        return None;
    }
    // 内容里是英文（含双语）就算英文：文件名标着中文的双语字幕也能做主字幕
    let language = if by_content == "en" || language.is_empty() {
        by_content
    } else {
        language
    };
    Some(SubtitleCandidate {
        path: path.to_string_lossy().into_owned(),
        source: source.to_string(),
        label,
        language: language.to_string(),
        preview: subtitle::preview(&text, 2),
    })
}

/// 建议：第一个英文的做字幕，第一个中文的做第二字幕
pub fn suggest(candidates: &[SubtitleCandidate]) -> (Option<usize>, Option<usize>) {
    (
        candidates.iter().position(|c| c.language == "en"),
        candidates.iter().position(|c| c.language == "zh"),
    )
}

/// 导出的字幕在缓存里留几天（导入时已经读进数据库，留着只为同一个视频再选时不用重新导出）
const EXPORT_KEEP: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 3600);

/// 清掉几天前导出的字幕
fn clean_old_exports(cache: &Path) {
    let Ok(entries) = std::fs::read_dir(cache.join("subtitles")) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > EXPORT_KEEP);
        if old {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// 缓存里放导出字幕的目录：按视频路径、大小与修改时间区分（同一个文件再选不重复导出）
fn export_dir(cache: &Path, video: &Path) -> PathBuf {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    video.hash(&mut hasher);
    if let Ok(meta) = std::fs::metadata(video) {
        meta.len().hash(&mut hasher);
        meta.modified().ok().hash(&mut hasher);
    }
    cache
        .join("subtitles")
        .join(format!("{:016x}", hasher.finish()))
}

/// 给一个视频找字幕
pub async fn discover(
    tools: &MediaTools,
    video: &Path,
    cache: &Path,
    logger: &Logger,
) -> AppResult<SubtitleDiscovery> {
    let mut candidates = Vec::new();
    if let Some(dir) = video.parent() {
        let names: Vec<String> = std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        for (path, language) in sidecar_files(video, &names) {
            let label = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            candidates.extend(candidate(&path, "file", label, language));
        }
    }

    let tracks = tools.subtitle_tracks(video).await.unwrap_or_else(|e| {
        logger.warn("VIDEO", "读取视频里的字幕轨道失败", Some(&e.to_string()));
        Vec::new()
    });
    let image_tracks = tracks.iter().filter(|t| !t.is_text()).count() as i64;
    let text_tracks: Vec<&SubtitleTrack> = tracks.iter().filter(|t| t.is_text()).collect();
    clean_old_exports(cache);
    if !text_tracks.is_empty() {
        let dir = export_dir(cache, video);
        std::fs::create_dir_all(&dir)
            .map_err(|e| crate::error::AppError::InternalError(format!("准备字幕缓存失败：{e}")))?;
        let outputs: Vec<(i64, PathBuf)> = text_tracks
            .iter()
            .map(|t| (t.index, dir.join(format!("track-{}.srt", t.index))))
            .collect();
        let missing: Vec<(i64, PathBuf)> = outputs
            .iter()
            .filter(|(_, p)| !p.is_file())
            .cloned()
            .collect();
        if let Err(e) = tools.extract_subtitles(video, &missing).await {
            logger.warn("VIDEO", "导出视频里的字幕失败", Some(&e.to_string()));
        }
        for (track, (_, path)) in text_tracks.iter().zip(&outputs) {
            if path.is_file() {
                let language = language_of_track(track);
                candidates.extend(candidate(
                    path,
                    "embedded",
                    track_label(track, language),
                    language,
                ));
            }
        }
    }
    candidates.truncate(MAX_CANDIDATES);
    let (primary, secondary) = suggest(&candidates);
    Ok(SubtitleDiscovery {
        candidates,
        primary,
        secondary,
        image_tracks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn sidecar_subtitles_match_the_video_name_and_language_suffix() {
        let video = Path::new("/v/Friends S01E01.mp4");
        let found = sidecar_files(
            video,
            &names(&[
                "Friends S01E01.mp4",
                "friends s01e01.SRT",
                "Friends S01E01.en.srt",
                "Friends S01E01.chs.srt",
                "Friends S01E01.zh-CN.vtt",
                "Friends S01E01.forced.srt",
                "Friends S01E02.srt",
                "Friends S01E01 extra.srt",
                "Friends S01E01.txt",
            ]),
        );
        let got: Vec<(String, &str)> = found
            .iter()
            .map(|(p, l)| (p.file_name().unwrap().to_string_lossy().into_owned(), *l))
            .collect();
        assert_eq!(
            got,
            [
                ("Friends S01E01.chs.srt".to_string(), "zh"),
                ("Friends S01E01.en.srt".to_string(), "en"),
                ("Friends S01E01.forced.srt".to_string(), ""),
                ("Friends S01E01.zh-CN.vtt".to_string(), "zh"),
                ("friends s01e01.SRT".to_string(), ""),
            ]
        );
    }

    #[test]
    fn track_language_from_tag_then_title() {
        let track = |language: &str, title: &str| SubtitleTrack {
            index: 2,
            codec: "subrip".into(),
            language: language.into(),
            title: title.into(),
        };
        assert_eq!(language_of_track(&track("eng", "")), "en");
        assert_eq!(language_of_track(&track("chi", "")), "zh");
        assert_eq!(language_of_track(&track("und", "English SDH")), "en");
        assert_eq!(language_of_track(&track("", "简体中文")), "zh");
        assert_eq!(language_of_track(&track("fre", "")), "");
        assert_eq!(track_label(&track("eng", ""), "en"), "视频自带 · 英文");
        assert_eq!(
            track_label(&track("eng", "English SDH"), "en"),
            "视频自带 · English SDH"
        );
    }

    #[test]
    fn content_decides_language_and_suggestion() {
        let dir = std::env::temp_dir().join(format!("pindu-subs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let en = dir.join("a.srt");
        std::fs::write(&en, "1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:03,000 --> 00:00:04,000\nHow are you?\n").unwrap();
        let zh = dir.join("b.srt");
        std::fs::write(&zh, "1\n00:00:01,000 --> 00:00:02,000\n你好。\n").unwrap();
        let bilingual = dir.join("c.srt");
        std::fs::write(
            &bilingual,
            "1\n00:00:01,000 --> 00:00:02,000\n你好。\nHello.\n",
        )
        .unwrap();
        let empty = dir.join("d.srt");
        std::fs::write(&empty, "not a subtitle").unwrap();

        let a = candidate(&en, "file", "a.srt".into(), "zh").unwrap();
        assert_eq!(
            (a.language.as_str(), a.preview.as_str()),
            ("en", "Hello there. / How are you?")
        );
        let b = candidate(&zh, "file", "b.srt".into(), "").unwrap();
        assert_eq!(b.language, "zh");
        // 文件名标着中文的双语字幕：内容里有英文，做主字幕
        let c = candidate(&bilingual, "file", "c.srt".into(), "zh").unwrap();
        assert_eq!(c.language, "en");
        assert!(candidate(&empty, "file", "d.srt".into(), "").is_none());

        assert_eq!(suggest(&[b.clone(), a.clone()]), (Some(1), Some(0)));
        assert_eq!(suggest(&[b]), (None, Some(0)));
        std::fs::remove_dir_all(&dir).ok();
    }
}

/// 用真实的 ffmpeg 与样例视频走一遍（`PINDU_FFMPEG_DIR` = 放 ffmpeg / ffprobe 的目录，`PINDU_TEST_SUBS` = 样例目录：
/// sidecar/ 有同名字幕，embedded/ 有自带字幕的 mkv 与 mp4，none/ 没有字幕）：
/// `cargo test real_subtitle_discovery -- --ignored --nocapture`
#[cfg(test)]
mod real {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn real_subtitle_discovery() {
        let tools = crate::media::locate_in(Path::new(&std::env::var("PINDU_FFMPEG_DIR").unwrap()))
            .await
            .expect("ffmpeg");
        let samples = PathBuf::from(std::env::var("PINDU_TEST_SUBS").unwrap());
        let cache = std::env::temp_dir().join(format!("pindu-subcache-{}", std::process::id()));
        let logger = crate::test_support::test_logger();
        let mut summary = Vec::new();
        for video in [
            "sidecar/Trip Day.mp4",
            "embedded/trip-embedded.mkv",
            "embedded/trip-movtext.mp4",
            "none/no-subs.mp4",
        ] {
            let found = discover(&tools, &samples.join(video), &cache, &logger)
                .await
                .unwrap();
            let pick = |i: Option<usize>| i.map(|i| found.candidates[i].label.clone());
            println!(
                "{video}: {:?} → 字幕 {:?} / 第二字幕 {:?}",
                found
                    .candidates
                    .iter()
                    .map(|c| (&c.label, &c.language, &c.preview))
                    .collect::<Vec<_>>(),
                pick(found.primary),
                pick(found.secondary)
            );
            summary.push((
                pick(found.primary).is_some(),
                pick(found.secondary).is_some(),
            ));
        }
        assert_eq!(
            summary,
            [(true, true), (true, true), (true, false), (false, false)]
        );
        std::fs::remove_dir_all(&cache).ok();
    }
}
