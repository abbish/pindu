//! 字幕条 → 学习用的句子。字幕按屏幕宽度断行，一句话常被拆成几条；练习（朗读、听句拼句、跟读、翻译）以完整的句子为单位更合适。
//! 断句以 AI 为准：导入时 AI 整理字幕（翻译的同时判断哪几条是同一句，不依赖标点），结果记在 `Cue::join`；
//! 还没整理过的字幕（join 为 None）按标点与停顿推断：合并到句末标点为止，停顿太长、换人说话（以「-」开头）时不合并。
//! 一句停在 that / to / the 这类词上（后面一定还有话）且没有停顿时，不管哪种都接着下一条。
//! 太长的句子在这里断开，只断在安全的地方（逗号、分号后，but / because / which 这类词前（and / or 要有停顿），停顿处），
//! 绝不断在虚词后面；找不到安全的地方宁可留长句，超过硬上限才断在停顿最长处。
//! 语音识别按逐词时间组句（services::subtitle_recognition）用的是同一套规则（`Span` 是一个词）。

use crate::services::subtitle::Cue;
use std::ops::Range;

/// 一句超过这么多英文词就找安全的地方断开
pub const MAX_WORDS: usize = 35;
/// 一句超过这么久（毫秒）就找安全的地方断开
pub const MAX_MS: i64 = 15_000;
/// 硬上限：超过时没有安全的地方也要断（停顿最长处）
pub const HARD_MAX_WORDS: usize = 50;
pub const HARD_MAX_MS: i64 = 25_000;
/// 两条字幕之间停顿超过这么久就不合并（毫秒；没整理过的字幕、逐词组句用）
pub const MAX_GAP_MS: i64 = 1_500;
/// 停在虚词上、停顿不超过这么久时一定接着说（毫秒）
const DANGLING_GAP_MS: i64 = 800;
/// 没有标点、也不在从句开头时，停顿至少这么久才算可以断开的地方（毫秒）
const PAUSE_MS: i64 = 400;

/// 后面一定还有话的词：冠词、介词、连词与引导从句的词、主格代词、物主代词
const DANGLING: &[&str] = &[
    "a", "an", "the", "of", "to", "in", "on", "at", "for", "with", "from", "by", "into", "onto",
    "about", "as", "than", "via", "between", "through", "during", "without", "within", "and", "or",
    "but", "nor", "that", "which", "who", "whom", "whose", "where", "when", "while", "if",
    "because", "although", "though", "since", "unless", "whether", "i", "we", "they", "he", "she",
    "my", "your", "his", "her", "our", "their", "its", "very",
];
/// 在这些词前断开不会把一句话卡断：并列连词、从属连词、关系词
const CLAUSE_START: &[&str] = &[
    "but", "so", "because", "although", "though", "while", "whereas", "which", "who", "when",
    "where", "if", "however", "unless", "until", "since",
];
/// and / or 也常连接两个名词（passengers and airlines），前面有逗号或停顿时才算新的分句
const COORDINATORS: &[&str] = &["and", "or"];
/// 以句点结尾但不是句末的缩写
const ABBREVIATIONS: &[&str] = &[
    "mr.", "mrs.", "ms.", "dr.", "st.", "jr.", "sr.", "prof.", "vs.", "e.g.", "i.e.",
];

/// 这一条在句末结束（. ? ! 之后可以跟引号或括号）；省略号多表示话没说完，Mr. 这类缩写也不算
pub fn ends_sentence(text: &str) -> bool {
    let t = text
        .trim_end()
        // 有的字幕把对话的短横写在行尾（「folks.-」）
        .trim_end_matches(['"', '\'', '”', '’', ')', ']', '»', '-', '–']);
    let last = t
        .rsplit(char::is_whitespace)
        .next()
        .unwrap_or("")
        .to_lowercase();
    t.ends_with(['.', '?', '!', '。', '？', '！'])
        && !t.ends_with("..")
        && !ABBREVIATIONS.contains(&last.as_str())
}

/// 停在后面一定还有话的词上（没有标点）
pub fn dangling(text: &str) -> bool {
    let t = text.trim_end();
    if t.ends_with(|c: char| !c.is_alphanumeric() && c != '\'') {
        return false;
    }
    let last = t.rsplit(char::is_whitespace).next().unwrap_or("");
    // 句末的大写 A 是字母（launch pad A），不是冠词
    last != "A" && DANGLING.contains(&last.to_lowercase().as_str())
}

/// 以 and / but / because / which 这类词开头
fn first_word(text: &str) -> String {
    text.split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

/// 以 but / because / which 这类词开头；and / or 要在停顿之后
fn starts_clause(text: &str, gap_ms: i64) -> bool {
    let first = first_word(text);
    CLAUSE_START.contains(&first.as_str())
        || (gap_ms >= PAUSE_MS / 2 && COORDINATORS.contains(&first.as_str()))
}

/// 以「-」开头：字幕里表示换了一个人说话
pub fn new_speaker(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with('-') || t.starts_with('–') || t.starts_with('—')
}

fn words(text: &str) -> usize {
    text.split_whitespace().count()
}

/// 断句的最小单位：一条字幕或一个词
#[derive(Debug, Clone, Copy)]
pub struct Span<'a> {
    pub text: &'a str,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// 第 i 个和下一个之间断开好不好：None 不能断（停在虚词上）；越大越好
fn cut_quality(spans: &[Span], i: usize) -> Option<i64> {
    let (cur, next) = (&spans[i], &spans[i + 1]);
    if dangling(cur.text) {
        return None;
    }
    let gap = (next.start_ms - cur.end_ms).clamp(0, 2_000);
    let t = cur.text.trim_end();
    let tier = if ends_sentence(t) {
        6
    } else if t.ends_with([',', ';', ':', '-', '–', '—'])
        || starts_clause(next.text, gap)
        || new_speaker(next.text)
    {
        4
    } else if gap >= PAUSE_MS {
        2
    } else {
        // 没标点、没停顿：多半在半句话里
        return None;
    };
    Some(tier * 1_000 + gap / 2)
}

fn too_long(spans: &[Span], range: &Range<usize>, max_words: usize, max_ms: i64) -> bool {
    let w: usize = spans[range.clone()].iter().map(|s| words(s.text)).sum();
    w > max_words || spans[range.end - 1].end_ms - spans[range.start].start_ms > max_ms
}

/// 一句太长时递归断开：超过 `(max_words, max_ms)` 在安全的地方断（两边尽量匀），超过硬上限且没有安全的地方时断在停顿最长处
fn split_long(
    spans: &[Span],
    range: Range<usize>,
    (max_words, max_ms): (usize, i64),
    out: &mut Vec<Range<usize>>,
) {
    if range.len() < 2 || !too_long(spans, &range, max_words, max_ms) {
        out.push(range);
        return;
    }
    let total: usize = spans[range.clone()].iter().map(|s| words(s.text)).sum();
    let mut left = 0usize;
    let mut best: Option<(i64, usize)> = None;
    for i in range.start..range.end - 1 {
        left += words(spans[i].text);
        let Some(quality) = cut_quality(spans, i) else {
            continue;
        };
        // 两边越不匀扣得越多，但不会压过更好的断点类型
        let balance = (left as i64 * 2 - total as i64).abs() * 900 / total.max(1) as i64;
        let score = quality - balance;
        if best.is_none_or(|(b, _)| score > b) {
            best = Some((score, i));
        }
    }
    let cut = match best {
        Some((_, i)) => i,
        None if too_long(spans, &range, HARD_MAX_WORDS, HARD_MAX_MS) => {
            // 没有安全的地方又实在太长：尽量不停在虚词上，再挑停顿最长处（一样长取中间）
            let mid = (range.start + range.end) / 2;
            (range.start..range.end - 1)
                .max_by_key(|&i| {
                    (
                        !dangling(spans[i].text),
                        spans[i + 1].start_ms - spans[i].end_ms,
                        -(i as i64 - mid as i64).abs(),
                    )
                })
                .unwrap_or(mid)
        }
        None => {
            out.push(range);
            return;
        }
    };
    split_long(spans, range.start..cut + 1, (max_words, max_ms), out);
    split_long(spans, cut + 1..range.end, (max_words, max_ms), out);
}

/// 把一串字幕条 / 词分成句子：`join(i)` 是第 i 个是不是接着上一个说（AI 的判断，没有时 None 按标点与停顿推断）。
/// AI 判断连成一句的，只在超过硬上限时才拆（新闻、访谈里 35 词以上的整句很常见，拆开就是半句话）。
/// 返回每句覆盖的下标范围（连续、不重叠、覆盖全部）
pub fn group_spans(spans: &[Span], join: impl Fn(usize) -> Option<bool>) -> Vec<Range<usize>> {
    let mut sentences: Vec<Range<usize>> = Vec::new();
    let mut start = 0;
    let mut ai_joined = false;
    for i in 0..spans.len() {
        let cut = i + 1 == spans.len() || {
            let (cur, next) = (&spans[i], &spans[i + 1]);
            let gap = next.start_ms - cur.end_ms;
            let cut = match join(i + 1) {
                Some(join) => {
                    ai_joined |= join;
                    !join
                }
                None => ends_sentence(cur.text) || gap > MAX_GAP_MS || new_speaker(next.text),
            };
            // 停在虚词上又没有停顿：话没说完，接着下一条（换人说话除外）
            cut && !(dangling(cur.text) && gap <= DANGLING_GAP_MS && !new_speaker(next.text))
        };
        if cut {
            let limits = if ai_joined {
                (HARD_MAX_WORDS, HARD_MAX_MS)
            } else {
                (MAX_WORDS, MAX_MS)
            };
            split_long(spans, start..i + 1, limits, &mut sentences);
            start = i + 1;
            ai_joined = false;
        }
    }
    sentences
}

/// 把字幕条分成句子：返回每句覆盖的字幕下标范围（连续、不重叠、覆盖全部）
pub fn group_cues(cues: &[Cue]) -> Vec<Range<usize>> {
    let spans: Vec<Span> = cues
        .iter()
        .map(|c| Span {
            text: &c.en,
            start_ms: c.start_ms,
            end_ms: c.end_ms,
        })
        .collect();
    group_spans(&spans, |i| cues[i].join)
}

/// 一组字幕合成一句：英文用空格连接，中文直接连接（有一条没有中文时整句中文留空，切分时再补）
pub fn merge(cues: &[Cue]) -> (String, String) {
    let en = cues
        .iter()
        .map(|c| c.en.trim())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let zh = if cues.iter().all(|c| !c.zh.trim().is_empty()) {
        cues.iter().map(|c| c.zh.trim()).collect::<String>()
    } else {
        String::new()
    };
    (en, zh)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(start: i64, end: i64, en: &str) -> Cue {
        Cue {
            start_ms: start,
            end_ms: end,
            en: en.into(),
            zh: String::new(),
            join: None,
        }
    }

    #[test]
    fn sentence_end_detection() {
        assert!(ends_sentence("and back again to Earth safely."));
        assert!(ends_sentence("Is it?\""));
        assert!(ends_sentence("Stop!)"));
        assert!(!ends_sentence("The whole Apollo program was designed"));
        assert!(!ends_sentence("landing them there,"));
        // 省略号多是话没说完
        assert!(!ends_sentence("And then..."));
        // 对话短横写在行尾；被打断的话（what-）不是句末
        assert!(ends_sentence("there, folks.-"));
        assert!(!ends_sentence("What, what-"));
    }

    #[test]
    fn broken_lines_become_one_sentence() {
        let cues = vec![
            cue(0, 2000, "The whole Apollo program was designed"),
            cue(2000, 4000, "to get two Americans to the lunar surface"),
            cue(4000, 6000, "and back again to Earth safely."),
            cue(6500, 8000, "The enormity of this event"),
            cue(
                8000,
                10_000,
                "is something that only history will be able to judge.",
            ),
        ];
        assert_eq!(group_cues(&cues), vec![0..3, 3..5]);
        let (en, _) = merge(&cues[0..3]);
        assert_eq!(en, "The whole Apollo program was designed to get two Americans to the lunar surface and back again to Earth safely.");
    }

    #[test]
    fn long_pauses_new_speakers_and_limits_break_sentences() {
        // 停顿太长
        let gap = vec![cue(0, 1000, "So we waited"), cue(4000, 5000, "and waited.")];
        assert_eq!(group_cues(&gap), vec![0..1, 1..2]);
        // 换人说话
        let dialog = vec![cue(0, 1000, "- Are you ready"), cue(1000, 2000, "- Yes.")];
        assert_eq!(group_cues(&dialog), vec![0..1, 1..2]);
        // 太长：断在逗号后、but 前这类安全的地方（两边尽量匀），不断在半句话里
        let long = vec![
            cue(0, 3500, "When we got to the airport early this morning,"),
            cue(
                3500,
                7000,
                "the board said that every single flight was delayed",
            ),
            cue(
                7000,
                10_500,
                "but nobody at the information desk could tell us",
            ),
            cue(
                10_500,
                14_000,
                "how long we would have to wait in the terminal",
            ),
            cue(
                14_000,
                17_000,
                "before the next plane could take off again.",
            ),
        ];
        assert_eq!(group_cues(&long), vec![0..2, 2..5]);
        // 一句长但只有「名词 and 名词」处可断（前面没有停顿）：不算安全的地方，整句保留
        let nouns = vec![
            cue(
                0,
                4000,
                "The trade body Airlines UK has said both passengers",
            ),
            cue(
                4000,
                8000,
                "and airlines deserve better after flights across the UK",
            ),
            cue(
                8000,
                12_000,
                "were disrupted by a technical issue with air traffic control",
            ),
            cue(
                12_000,
                16_000,
                "for the second time in two weeks, the group said today.",
            ),
        ];
        assert_eq!(group_cues(&nouns), vec![0..4]);
    }

    #[test]
    fn never_breaks_after_a_dangling_word() {
        // AI 判成不是同一句，但上一条停在 that 上、没有停顿：接着说
        let mut cues = vec![
            cue(0, 2000, "I got a message that"),
            cue(2000, 4000, "it's cancelled."),
        ];
        cues[0].join = Some(false);
        cues[1].join = Some(false);
        assert_eq!(group_cues(&cues), vec![0..2]);
        // 停顿很长时照常断开
        let paused = vec![
            cue(0, 2000, "We went to the"),
            cue(5000, 6000, "Okay, stop."),
        ];
        assert_eq!(group_cues(&paused), vec![0..1, 1..2]);
        // 太长时不断在 and / for 后面，断在逗号后（Apollo 11 字幕里被硬切的两处；没有 AI 判断，按 35 词的上限）
        let apollo = vec![
            cue(0, 3500, "Let us take a moment to think of those three men"),
            cue(3500, 5000, "and the burdens and"),
            cue(
                5000,
                8500,
                "the hopes that they carry on behalf of all mankind,",
            ),
            cue(
                8500,
                12_000,
                "as the astronauts will board the first of two elevators for",
            ),
            cue(
                12_000,
                15_000,
                "the trip to the 320 foot level at the launch pad.",
            ),
        ];
        assert_eq!(group_cues(&apollo), vec![0..3, 3..5]);
    }

    #[test]
    fn dangling_and_abbreviations() {
        assert!(dangling("I got a message that"));
        assert!(dangling("the trip to the"));
        assert!(!dangling("he said that,"));
        assert!(!dangling("that's what it is"));
        assert!(!dangling("on its trip to launch pad A"));
        assert!(!ends_sentence("Thank you, Mr."));
        assert!(ends_sentence("He works in the U.S."));
    }

    #[test]
    fn no_safe_place_keeps_the_sentence_until_the_hard_limit() {
        // 每条都停在 on 上：找不到安全的地方，没超过硬上限就整句保留
        let soft: Vec<Cue> = (0..6)
            .map(|i| cue(i * 2000, i * 2000 + 2000, "and then we went on"))
            .collect();
        assert_eq!(group_cues(&soft), vec![0..6]);
        // 超过硬上限才断，断在停顿最长处
        let mut hard: Vec<Cue> = (0..12)
            .map(|i| cue(i * 2000, i * 2000 + 2000, "and then we went on"))
            .collect();
        hard[7].start_ms += 300;
        let groups = group_cues(&hard);
        assert_eq!(groups[0], 0..7);
        assert_eq!(groups.iter().map(|g| g.len()).sum::<usize>(), 12);
    }

    #[test]
    fn ai_joined_long_sentence_stays_whole_until_the_hard_limit() {
        // 新闻里的整句（41 词、15 秒）：AI 判断两条是同一句，不在「as you say,」后拆成两半
        let mut cues = vec![
            cue(
                47_030,
                52_210,
                "It's a pretty stark warning, but then perhaps even more arresting came the reply, as you say,",
            ),
            cue(
                52_270,
                62_000,
                "from this very high profile head of alignment at Anthropic, current head of alignment as well, who frankly and bluntly agreed with that proclamation.",
            ),
        ];
        cues[0].join = Some(false);
        cues[1].join = Some(true);
        assert_eq!(group_cues(&cues), vec![0..2]);
        // 没有 AI 判断时仍按 35 词的上限在安全的地方拆
        cues[0].join = None;
        cues[1].join = None;
        assert_eq!(group_cues(&cues), vec![0..1, 1..2]);
    }

    #[test]
    fn ai_judgement_wins_over_punctuation() {
        // 没有标点的字幕：AI 说第二条接着第一条，第三条是新的一句
        let mut cues = vec![
            cue(0, 2000, "the whole program was designed"),
            cue(2000, 4000, "to get two Americans there"),
            cue(4000, 6000, "the enormity of this event"),
        ];
        cues[0].join = Some(false);
        cues[1].join = Some(true);
        cues[2].join = Some(false);
        assert_eq!(group_cues(&cues), vec![0..2, 2..3]);
        // AI 把有句号的两条判成同一句（如缩写「Mr.」结尾），也按 AI 的
        let mut mr = vec![cue(0, 1000, "Thank you, Mr."), cue(1000, 2000, "Smith.")];
        mr[1].join = Some(true);
        assert_eq!(group_cues(&mr), vec![0..2]);
        // 但超过硬上限仍然断开
        let mut long: Vec<Cue> = (0..12)
            .map(|i| cue(i * 2000, i * 2000 + 2000, "and then we went on"))
            .collect();
        for c in long.iter_mut().skip(1) {
            c.join = Some(true);
        }
        assert!(group_cues(&long).len() > 1);
    }

    #[test]
    fn chinese_is_kept_only_when_every_part_has_it() {
        let mut a = cue(0, 1000, "Hello");
        a.zh = "你好，".into();
        let mut b = cue(1000, 2000, "world.");
        b.zh = "世界。".into();
        assert_eq!(merge(&[a.clone(), b]).1, "你好，世界。");
        assert_eq!(merge(&[a, cue(1000, 2000, "world.")]).1, "");
    }

    /// 真实字幕的断句统计（`PINDU_TEST_CUES` 指向字幕 JSON，即 videos.cues）
    #[test]
    #[ignore]
    fn real_cues_report() {
        let path = std::env::var("PINDU_TEST_CUES").unwrap();
        let cues: Vec<Cue> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let stats = eval::stats(&cues);
        println!("{}", serde_json::to_string_pretty(&stats).unwrap());
    }
}

/// 断句评测（只在测试里用）：一组字幕断成句子后的质量指标，调规则时比前后（`subtitle_recognition::real::real_segmentation_eval`）
#[cfg(test)]
pub mod eval {
    use super::*;

    #[derive(Debug, Clone, serde::Serialize)]
    pub struct Stats {
        pub cues: usize,
        pub sentences: usize,
        /// 句子停在虚词上（that / to / the…，最后一句不算）：一定断错了
        pub dangling_cuts: usize,
        /// 断开处没有任何标点（句末、逗号…）：多半在半句话里
        pub bare_cuts: usize,
        /// 以大写字母或数字开头的句子占比（识别有没有恢复大小写）
        pub capitalized: f64,
        /// 以句末标点结束的句子占比（识别有没有恢复标点）
        pub terminal: f64,
        pub median_words: usize,
        pub max_words: usize,
        /// 超过软上限（MAX_WORDS）的句子
        pub over_soft: usize,
        /// 断在没有标点处的例子（前后各一段）
        pub examples: Vec<String>,
    }

    pub fn stats(cues: &[Cue]) -> Stats {
        let groups = group_cues(cues);
        let texts: Vec<String> = groups.iter().map(|g| merge(&cues[g.clone()]).0).collect();
        let n = texts.len().max(1) as f64;
        let inner = &texts[..texts.len().saturating_sub(1)];
        let mut examples = Vec::new();
        let mut bare_cuts = 0;
        for (i, t) in inner.iter().enumerate() {
            let punctuated = t
                .trim_end()
                .ends_with(|c: char| ".?!,;:-–—\"'”’)]".contains(c));
            if !punctuated {
                bare_cuts += 1;
                if examples.len() < 8 {
                    let tail: String = t
                        .chars()
                        .rev()
                        .take(50)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect();
                    let head: String = texts[i + 1].chars().take(40).collect();
                    examples.push(format!("…{tail} ‖ {head}…"));
                }
            }
        }
        let mut lengths: Vec<usize> = texts.iter().map(|t| words(t)).collect();
        lengths.sort_unstable();
        Stats {
            cues: cues.len(),
            sentences: texts.len(),
            dangling_cuts: inner.iter().filter(|t| dangling(t)).count(),
            bare_cuts,
            capitalized: texts
                .iter()
                .filter(|t| {
                    t.trim_start()
                        .starts_with(|c: char| c.is_uppercase() || c.is_ascii_digit())
                })
                .count() as f64
                / n,
            terminal: texts.iter().filter(|t| ends_sentence(t)).count() as f64 / n,
            median_words: lengths.get(lengths.len() / 2).copied().unwrap_or(0),
            max_words: lengths.last().copied().unwrap_or(0),
            over_soft: lengths.iter().filter(|&&w| w > MAX_WORDS).count(),
            examples,
        }
    }
}
