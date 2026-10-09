//! 字幕条 → 学习用的句子。字幕按屏幕宽度断行，一句话常被拆成几条；练习（朗读、听句拼句、跟读、翻译）以完整的句子为单位更合适。
//! 断句以 AI 为准：导入时 AI 整理字幕（翻译的同时判断哪几条是同一句，不依赖标点），结果记在 `Cue::join`；
//! 还没整理过的字幕（join 为 None）按标点与停顿推断：合并到句末标点为止，停顿太长、换人说话（以「-」开头）时不合并。
//! 无论哪种，一句太长都在这里断开（AI 的判断用宽一些的硬上限），避免出现难以跟读和拼写的超长句。

use crate::services::subtitle::Cue;
use std::ops::Range;

/// 合并后一句最多多少个英文词
pub const MAX_WORDS: usize = 28;
/// 合并后一句最长多久（毫秒）
pub const MAX_MS: i64 = 12_000;
/// 两条字幕之间停顿超过这么久就不合并（毫秒）
pub const MAX_GAP_MS: i64 = 1_500;
/// AI 判断为同一句时的硬上限（AI 已经按意群断过，这里只防异常的超长句）
pub const HARD_MAX_WORDS: usize = 40;
pub const HARD_MAX_MS: i64 = 15_000;

/// 这一条在句末结束（. ? ! 之后可以跟引号或括号）；省略号多表示话没说完，不算
pub fn ends_sentence(text: &str) -> bool {
    let t = text
        .trim_end()
        .trim_end_matches(['"', '\'', '”', '’', ')', ']', '»']);
    t.ends_with(['.', '?', '!', '。', '？', '！']) && !t.ends_with("..")
}

/// 以「-」开头：字幕里表示换了一个人说话
fn new_speaker(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with('-') || t.starts_with('–') || t.starts_with('—')
}

fn words(text: &str) -> usize {
    text.split_whitespace().count()
}

/// 把字幕条分成句子：返回每句覆盖的字幕下标范围（连续、不重叠、覆盖全部）
pub fn group_cues(cues: &[Cue]) -> Vec<Range<usize>> {
    let mut groups: Vec<Range<usize>> = Vec::new();
    let mut start = 0;
    for i in 0..cues.len() {
        let last = i + 1 == cues.len();
        let cut = last || {
            let (cur, next) = (&cues[i], &cues[i + 1]);
            let group_words: usize = cues[start..=i].iter().map(|c| words(&c.en)).sum();
            let span = next.end_ms - cues[start].start_ms;
            match next.join {
                // AI 整理过：按它的判断，只防超长
                Some(join) => {
                    !join || group_words + words(&next.en) > HARD_MAX_WORDS || span > HARD_MAX_MS
                }
                None => {
                    ends_sentence(&cur.en)
                        || next.start_ms - cur.end_ms > MAX_GAP_MS
                        || new_speaker(&next.en)
                        || group_words + words(&next.en) > MAX_WORDS
                        || span > MAX_MS
                }
            }
        };
        if cut {
            groups.push(start..i + 1);
            start = i + 1;
        }
    }
    groups
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
        // 太长（时长）
        let long: Vec<Cue> = (0..8)
            .map(|i| cue(i * 2000, i * 2000 + 2000, "and then we went on"))
            .collect();
        let groups = group_cues(&long);
        assert!(groups.len() > 1);
        assert!(groups
            .iter()
            .all(|g| long[g.end - 1].end_ms - long[g.start].start_ms <= MAX_MS));
        assert_eq!(groups.iter().map(|g| g.len()).sum::<usize>(), 8);
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
        let mut long: Vec<Cue> = (0..10)
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
}
