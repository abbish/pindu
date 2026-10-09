//! 带时间轴的字幕解析（视频库）：srt / vtt → 字幕条 `Cue { startMs, endMs, en, zh }`。
//!
//! - 一条字幕里同时有英文行和中文行（双语字幕）时分别放进 en / zh；
//! - 另给一个字幕文件时按时间重叠对齐：英文文件为主，中文按重叠最多的那条补进 zh（两个文件谁是英文自动判断）；
//! - 去掉样式标签、[音效]、说话人前缀的短横，没有英文的字幕条（纯音效、纯中文）丢掉。
//!
//! 文本清理复用短文导入的 `strip_tags` / `strip_brackets`（services/passage_import.rs）。

use crate::error::{AppError, AppResult};
use crate::services::passage_import::{is_cjk, strip_brackets, strip_tags};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    pub start_ms: i64,
    pub end_ms: i64,
    pub en: String,
    #[serde(default)]
    pub zh: String,
    /// 和上一条是同一句话（字幕断行把一句拆开了）；None = 还没让 AI 整理过（按标点与停顿推断）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub join: Option<bool>,
}

/// 文件里的一条字幕（还没分英文 / 中文）
#[derive(Debug, Clone, PartialEq)]
struct RawCue {
    start_ms: i64,
    end_ms: i64,
    lines: Vec<String>,
}

/// 解析字幕文件内容；`secondary` 是另一个语言的字幕文件（可选）
pub fn build_cues(primary: &str, secondary: Option<&str>) -> AppResult<Vec<Cue>> {
    let mut main = parse(primary);
    let mut other = secondary.map(parse).unwrap_or_default();
    // 英文多的那个文件为主
    if english_share(&other) > english_share(&main) {
        std::mem::swap(&mut main, &mut other);
    }
    let mut cues: Vec<Cue> = main
        .iter()
        .filter_map(|raw| {
            let (en, zh) = split_languages(&raw.lines);
            (!en.is_empty()).then_some(Cue {
                start_ms: raw.start_ms,
                end_ms: raw.end_ms,
                en,
                zh,
                join: None,
            })
        })
        .collect();
    if cues.is_empty() {
        return Err(AppError::ValidationError(
            "字幕里没有找到英文，请确认是 srt / vtt 格式的英文或中英字幕".to_string(),
        ));
    }
    for cue in cues.iter_mut().filter(|c| c.zh.is_empty()) {
        if let Some(best) = best_overlap(cue, &other) {
            cue.zh = split_languages(&best.lines).1;
        }
    }
    Ok(cues)
}

/// 英文字幕条的占比（判断哪个文件是英文）
fn english_share(cues: &[RawCue]) -> f64 {
    if cues.is_empty() {
        return 0.0;
    }
    let english = cues
        .iter()
        .filter(|c| !split_languages(&c.lines).0.is_empty())
        .count();
    english as f64 / cues.len() as f64
}

fn best_overlap<'a>(cue: &Cue, others: &'a [RawCue]) -> Option<&'a RawCue> {
    others
        .iter()
        .map(|o| (o, o.end_ms.min(cue.end_ms) - o.start_ms.max(cue.start_ms)))
        .filter(|(_, overlap)| *overlap > 0)
        .max_by_key(|(_, overlap)| *overlap)
        .map(|(o, _)| o)
}

/// 按行分英文 / 中文：含汉字的行算中文，含拉丁字母的其余行算英文
fn split_languages(lines: &[String]) -> (String, String) {
    let mut en = Vec::new();
    let mut zh = Vec::new();
    for line in lines {
        if line.chars().any(is_cjk) {
            zh.push(line.as_str());
        } else if line.chars().any(|c| c.is_ascii_alphabetic()) {
            en.push(line.as_str());
        }
    }
    (en.join(" "), zh.join(""))
}

/// srt 与 vtt 共用：按空行分块，块里有 `-->` 的行是时间轴，之后的行是文字
fn parse(text: &str) -> Vec<RawCue> {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let mut cues = Vec::new();
    for block in text.split("\n\n") {
        let mut lines = block
            .lines()
            .map(str::trim)
            .skip_while(|l| !l.contains("-->"));
        let Some(timing) = lines.next() else {
            continue;
        };
        let Some((start, end)) = parse_timing(timing) else {
            continue;
        };
        let lines: Vec<String> = lines
            .map(|l| {
                strip_brackets(&strip_tags(l))
                    .trim()
                    .trim_start_matches(['-', '–'])
                    .trim()
                    .to_string()
            })
            .filter(|l| !l.is_empty())
            .collect();
        if !lines.is_empty() && end > start {
            cues.push(RawCue {
                start_ms: start,
                end_ms: end,
                lines,
            });
        }
    }
    cues.sort_by_key(|c| c.start_ms);
    cues
}

/// `00:01:02,345 --> 00:01:04.000 align:start` → 毫秒
fn parse_timing(line: &str) -> Option<(i64, i64)> {
    let (start, rest) = line.split_once("-->")?;
    let end = rest.split_whitespace().next()?;
    Some((parse_time(start.trim())?, parse_time(end)?))
}

/// `HH:MM:SS,mmm`、`HH:MM:SS.mmm`、`MM:SS.mmm`
fn parse_time(value: &str) -> Option<i64> {
    let value = value.replace(',', ".");
    let (clock, millis) = value.split_once('.').unwrap_or((&value, "0"));
    let parts: Vec<i64> = clock
        .split(':')
        .map(|p| p.parse().ok())
        .collect::<Option<_>>()?;
    let seconds = match parts.as_slice() {
        [h, m, s] => h * 3600 + m * 60 + s,
        [m, s] => m * 60 + s,
        _ => return None,
    };
    let millis: String = millis.chars().take(3).collect();
    let millis = format!("{millis:0<3}").parse::<i64>().ok()?;
    Some(seconds * 1000 + millis)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRT: &str = "1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello, table for two?</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\n[Music]\r\n\r\n3\r\n00:00:06,200 --> 00:00:08,000\r\n- Right this way.\r\n- Thank you.\r\n";

    #[test]
    fn srt_cues_keep_times_and_drop_sound_effects() {
        let cues = build_cues(SRT, None).unwrap();
        assert_eq!(cues.len(), 2);
        assert_eq!((cues[0].start_ms, cues[0].end_ms), (1000, 3500));
        assert_eq!(cues[0].en, "Hello, table for two?");
        assert_eq!(cues[1].en, "Right this way. Thank you.");
        assert_eq!(cues[1].zh, "");
    }

    #[test]
    fn vtt_with_header_settings_and_short_times() {
        let vtt = "WEBVTT\n\nNOTE made by hand\n\n00:01.5 --> 00:03.250 align:start\n<c.yellow>Good morning</c>\n\nintro\n01:00:00.000 --> 01:00:02.000\nSee you.\n";
        let cues = build_cues(vtt, None).unwrap();
        assert_eq!(cues.len(), 2);
        assert_eq!((cues[0].start_ms, cues[0].end_ms), (1500, 3250));
        assert_eq!(cues[0].en, "Good morning");
        assert_eq!(cues[1].start_ms, 3_600_000);
    }

    #[test]
    fn bilingual_cue_splits_english_and_chinese() {
        let srt = "1\n00:00:01,000 --> 00:00:02,000\nCan I get the menu?\n能给我菜单吗？\n";
        let cues = build_cues(srt, None).unwrap();
        assert_eq!(cues[0].en, "Can I get the menu?");
        assert_eq!(cues[0].zh, "能给我菜单吗？");
    }

    #[test]
    fn second_file_is_aligned_by_overlap_whichever_is_english() {
        let zh = "1\n00:00:00,900 --> 00:00:03,400\n两位用餐吗？\n\n2\n00:00:06,100 --> 00:00:08,100\n这边请。\n";
        for (a, b) in [(SRT, zh), (zh, SRT)] {
            let cues = build_cues(a, Some(b)).unwrap();
            assert_eq!(cues.len(), 2);
            assert_eq!(cues[0].zh, "两位用餐吗？");
            assert_eq!(cues[1].zh, "这边请。");
        }
    }

    #[test]
    fn subtitles_without_english_are_rejected() {
        let zh = "1\n00:00:01,000 --> 00:00:02,000\n你好\n";
        assert!(matches!(
            build_cues(zh, None),
            Err(AppError::ValidationError(_))
        ));
        assert!(build_cues("not a subtitle", None).is_err());
    }

    #[test]
    fn time_formats() {
        assert_eq!(parse_time("00:01:02,345"), Some(62_345));
        assert_eq!(parse_time("01:02.3"), Some(62_300));
        assert_eq!(parse_time("1:02:03"), Some(3_723_000));
        assert_eq!(parse_time("x"), None);
    }
}
