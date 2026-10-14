//! 打分：发音模型给出每一帧每个音的对数概率后，算每个音读得准不准。
//!
//! - 词界（▁）与附加符号（送气、长音、鼻化等）不分对错，先并进 blank；
//! - GOP：标准读法的整体概率，对比把这个音换成别的音（或删掉）后最高的概率——差得越多，越像读准了；
//!   听起来接近、母语者也常这样读的（弱读、松紧元音、词尾清化）不拿来比；
//! - 特征（GOP、删掉的差距、这个音最清楚的一帧、是哪个音）交给训练好的小模型（梯度提升树，speechocean762
//!   训练），给出 0–2 分，与人工的音素评分口径一致。
//!
//! 与原型（`.claude/work/pronunciation-spike/spike/`）逐项一致，固定样例见 tests。

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

pub const NEG: f64 = -1e30;

/// 发音模型的字表：下标 → 字符
pub fn tokens() -> &'static [String] {
    static TOKENS: OnceLock<Vec<String>> = OnceLock::new();
    TOKENS.get_or_init(|| {
        include_str!("data/tokens.txt")
            .lines()
            .map(|l| {
                let mut p = l.split_whitespace();
                match (p.next(), p.next()) {
                    (Some(t), Some(_)) => t.to_string(),
                    _ => " ".to_string(),
                }
            })
            .collect()
    })
}

fn token_ids() -> &'static HashMap<char, usize> {
    static IDS: OnceLock<HashMap<char, usize>> = OnceLock::new();
    IDS.get_or_init(|| {
        tokens()
            .iter()
            .enumerate()
            .filter_map(|(i, t)| {
                let mut c = t.chars();
                match (c.next(), c.next()) {
                    (Some(ch), None) => Some((ch, i)),
                    _ => None,
                }
            })
            .collect()
    })
}

/// 一个音（IPA 字符串）→ 字表下标（字表里没有的字符跳过）
pub fn seq(phone: &str) -> Vec<usize> {
    let ids = token_ids();
    phone.chars().filter_map(|c| ids.get(&c).copied()).collect()
}

/// 不分对错、并进 blank 的字符
fn folded() -> &'static [usize] {
    static FOLD: OnceLock<Vec<usize>> = OnceLock::new();
    FOLD.get_or_init(|| {
        tokens()
            .iter()
            .enumerate()
            .filter(|(_, t)| {
                let mut c = t.chars();
                let single = match (c.next(), c.next()) {
                    (Some(ch), None) => Some(ch as u32),
                    _ => None,
                };
                matches!(t.as_str(), "▁" | "<sos/eos>" | "<unk>")
                    || single.is_some_and(|u| {
                        (0x2b0..=0x2ff).contains(&u) || (0x300..=0x36f).contains(&u)
                    })
            })
            .map(|(i, _)| i)
            .collect()
    })
}

/// 帧 × 字表的对数概率（f64），附加符号并进 blank
pub struct LogProbs {
    pub frames: usize,
    pub vocab: usize,
    data: Vec<f64>,
}

impl LogProbs {
    pub fn new(frames: usize, vocab: usize, raw: &[f32]) -> Self {
        let mut data: Vec<f64> = raw[..frames * vocab].iter().map(|v| *v as f64).collect();
        let fold = folded();
        for t in 0..frames {
            let row = &mut data[t * vocab..(t + 1) * vocab];
            let mut blank = row[0];
            for &i in fold {
                blank = logaddexp(blank, row[i]);
                row[i] = NEG;
            }
            row[0] = blank;
        }
        Self {
            frames,
            vocab,
            data,
        }
    }

    #[inline]
    pub fn at(&self, t: usize, k: usize) -> f64 {
        self.data[t * self.vocab + k]
    }

    /// 最可能的读法（贪心解码，听到了什么）
    pub fn greedy(&self) -> String {
        let toks = tokens();
        self.greedy_ids()
            .iter()
            .map(|&k| toks[k].as_str())
            .collect()
    }

    /// 贪心解码的字表下标（去掉 blank 与连续重复）
    pub fn greedy_ids(&self) -> Vec<usize> {
        let mut out = Vec::new();
        let mut prev = usize::MAX;
        for t in 0..self.frames {
            let (best, _) = (0..self.vocab).fold((0, NEG), |acc, k| {
                let v = self.at(t, k);
                if v > acc.1 {
                    (k, v)
                } else {
                    acc
                }
            });
            if best != prev && best != 0 {
                out.push(best);
            }
            prev = best;
        }
        out
    }
}

#[inline]
fn logaddexp(a: f64, b: f64) -> f64 {
    if a == NEG {
        return b;
    }
    if b == NEG {
        return a;
    }
    let m = a.max(b);
    m + ((a - m).exp() + (b - m).exp()).ln()
}

/// CTC 前向：log P(labels | X)
pub fn ctc_logp(lp: &LogProbs, labels: &[usize]) -> f64 {
    if lp.frames == 0 {
        return NEG;
    }
    let mut ext = Vec::with_capacity(labels.len() * 2 + 1);
    ext.push(0);
    for &l in labels {
        ext.push(l);
        ext.push(0);
    }
    let s = ext.len();
    let skip: Vec<bool> = (0..s)
        .map(|i| i >= 2 && ext[i] != 0 && ext[i] != ext[i - 2])
        .collect();
    let mut a = vec![NEG; s];
    a[0] = lp.at(0, ext[0]);
    if s > 1 {
        a[1] = lp.at(0, ext[1]);
    }
    let mut b = vec![NEG; s];
    for t in 1..lp.frames {
        for i in 0..s {
            let mut v = a[i];
            if i >= 1 {
                v = logaddexp(v, a[i - 1]);
            }
            if skip[i] {
                v = logaddexp(v, a[i - 2]);
            }
            b[i] = if v == NEG { NEG } else { v + lp.at(t, ext[i]) };
        }
        std::mem::swap(&mut a, &mut b);
    }
    if s > 1 {
        logaddexp(a[s - 1], a[s - 2])
    } else {
        a[s - 1]
    }
}

/// 听到的字符算不算读出了标准读法里的这个字符（相同，或听起来接近、母语者也常这样读）
fn same_sound(expected: usize, heard: usize) -> bool {
    if expected == heard {
        return true;
    }
    let toks = tokens();
    lenient(&toks[expected], &toks[heard])
}

/// 把听到的（贪心解码）和标准读法逐字符对齐（编辑距离），返回标准读法每个字符有没有被读出来。
/// GOP 只比「标准读法」和「换掉一个音」谁更像，录音里根本没在读（静音、噪声、读了别的）时两边都不像、差距接近 0，
/// 打分树会给出中高分；对齐能看出这句到底读出来多少。
pub fn heard_mask(heard: &[usize], expected: &[usize]) -> Vec<bool> {
    let (n, m) = (expected.len(), heard.len());
    let mut d = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=n {
        for j in 1..=m {
            let sub = d[i - 1][j - 1] + usize::from(!same_sound(expected[i - 1], heard[j - 1]));
            d[i][j] = sub.min(d[i - 1][j] + 1).min(d[i][j - 1] + 1);
        }
    }
    let mut mask = vec![false; n];
    let (mut i, mut j) = (n, m);
    while i > 0 && j > 0 {
        let matched = same_sound(expected[i - 1], heard[j - 1]);
        if d[i][j] == d[i - 1][j - 1] + usize::from(!matched) {
            mask[i - 1] = matched;
            i -= 1;
            j -= 1;
        } else if d[i][j] == d[i - 1][j] + 1 {
            i -= 1;
        } else {
            j -= 1;
        }
    }
    mask
}

/// 拿来比较的其他读法：英语里的全部音
fn alternatives() -> &'static [String] {
    static ALTS: OnceLock<Vec<String>> = OnceLock::new();
    ALTS.get_or_init(|| {
        let mut set: Vec<String> = [
            "AA", "AE", "AH", "AO", "AW", "AY", "B", "CH", "D", "DH", "EH", "ER", "EY", "F", "G",
            "HH", "IH", "IY", "JH", "K", "L", "M", "N", "NG", "OW", "OY", "P", "R", "S", "SH", "T",
            "TH", "UH", "UW", "V", "W", "Y", "Z", "ZH",
        ]
        .iter()
        .filter_map(|p| super::dict::ipa(&format!("{p}1")))
        .chain(std::iter::once("ə".to_string()))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
        set.sort();
        set
    })
}

/// 听起来接近、母语者也常这样读的：不当作「更像的别的读法」
fn lenient(phone: &str, alt: &str) -> bool {
    const GROUPS: [&[&str]; 11] = [
        &["ə", "ʌ", "ɑ", "ɪ"],
        &["ɪ", "i"],
        &["ɪ", "ɛ"],
        &["ʊ", "u"],
        &["ɔ", "ɑ", "oʊ"],
        &["ɛ", "æ"],
        &["b", "p"],
        &["d", "t"],
        &["g", "k"],
        &["z", "s"],
        &["ð", "d"],
    ];
    GROUPS
        .iter()
        .any(|g| g.contains(&phone) && g.contains(&alt) && phone != alt)
}

/// 学习者常见的读偏（th→s、v→w、r/l、前后鼻音、æ/ɛ、长短 i…）：标准读法 → 读偏成
const CONFUSIONS: [(&str, &str); 26] = [
    ("θ", "s"),
    ("θ", "f"),
    ("θ", "t"),
    ("ð", "d"),
    ("ð", "z"),
    ("v", "w"),
    ("v", "f"),
    ("w", "v"),
    ("ɹ", "l"),
    ("ɹ", "w"),
    ("l", "n"),
    ("l", "ɹ"),
    ("n", "ŋ"),
    ("n", "l"),
    ("ŋ", "n"),
    ("æ", "ɛ"),
    ("æ", "ʌ"),
    ("i", "ɪ"),
    ("ɪ", "i"),
    ("ʃ", "s"),
    ("s", "ʃ"),
    ("z", "s"),
    ("dʒ", "tʃ"),
    ("eɪ", "ɛ"),
    ("oʊ", "ɔ"),
    ("aɪ", "æ"),
];
/// 最像的读法是常见读偏、且明显比标准读法更像（GOP 低于这个值）：可以提醒一句（不改分数——
/// speechocean762 上人工对这类音大多仍判「可以接受」，只当提示，见 evidence.md）
const CONFUSION_GOP: f64 = -4.0;

/// 明显读成了常见的读偏
pub fn likely_confused(phone: &str, f: &PhoneFeatures) -> bool {
    f.gop < CONFUSION_GOP
        && f.closest
            .as_deref()
            .is_some_and(|c| CONFUSIONS.iter().any(|&(a, b)| a == phone && b == c))
}

/// 一个音的打分特征，以及最像的别的读法（"" 表示像是没读出来）
pub struct PhoneFeatures {
    pub gop: f64,
    pub gop_delete: f64,
    pub peak: f64,
    pub closest: Option<String>,
}

/// 整句每个音的特征：phones 是按顺序的 IPA 音
pub fn features(lp: &LogProbs, phones: &[String]) -> Vec<PhoneFeatures> {
    let full: Vec<Vec<usize>> = phones.iter().map(|p| seq(p)).collect();
    let flat: Vec<usize> = full.iter().flatten().copied().collect();
    let base = ctc_logp(lp, &flat);
    phones
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let mut best = NEG;
            let mut closest = None;
            let mut delete = NEG;
            let before: Vec<usize> = full[..i].iter().flatten().copied().collect();
            let after: Vec<usize> = full[i + 1..].iter().flatten().copied().collect();
            for alt in alternatives()
                .iter()
                .map(String::as_str)
                .chain(std::iter::once(""))
            {
                if alt == p || lenient(p, alt) {
                    continue;
                }
                let cand: Vec<usize> = before
                    .iter()
                    .copied()
                    .chain(seq(alt))
                    .chain(after.iter().copied())
                    .collect();
                if cand.is_empty() {
                    continue;
                }
                let v = ctc_logp(lp, &cand);
                if v > best {
                    best = v;
                    closest = Some(alt.to_string());
                }
                if alt.is_empty() {
                    delete = v;
                }
            }
            let peak = full[i]
                .iter()
                .map(|&k| (0..lp.frames).map(|t| lp.at(t, k)).fold(NEG, f64::max))
                .fold(NEG, f64::max);
            PhoneFeatures {
                gop: base - best,
                gop_delete: base - delete,
                peak,
                closest,
            }
        })
        .collect()
}

/// 树的一个节点：[特征下标, 阈值, 左, 右, 是叶子, 值, 缺失往左]
type Node = (usize, f64, usize, usize, bool, f64, bool);

#[derive(serde::Deserialize)]
struct ScorerFile {
    phones: Vec<String>,
    baseline: f64,
    trees: Vec<Vec<Node>>,
}

fn scorer() -> &'static ScorerFile {
    static SCORER: OnceLock<ScorerFile> = OnceLock::new();
    SCORER.get_or_init(|| {
        serde_json::from_str(include_str!("data/scorer.json")).expect("内置的发音打分模型损坏")
    })
}

/// 一个音的分数（0–2，与 speechocean762 人工评分口径一致）
pub fn phone_score(phone: &str, f: &PhoneFeatures) -> f64 {
    let s = scorer();
    let clip = |v: f64| v.clamp(-30.0, 30.0);
    let mut x = vec![clip(f.gop), clip(f.gop_delete), clip(f.peak)];
    x.extend(s.phones.iter().map(|q| if q == phone { 1.0 } else { 0.0 }));
    let mut v = s.baseline;
    for tree in &s.trees {
        let mut i = 0;
        while !tree[i].4 {
            let (feat, threshold, left, right, ..) = tree[i];
            i = if x[feat] <= threshold { left } else { right };
        }
        v += tree[i].5;
    }
    v.clamp(0.0, 2.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alternatives_and_folding_match_the_prototype() {
        assert_eq!(alternatives().len(), 40);
        assert!(alternatives().iter().any(|a| a == "ɜɹ"));
        let fold: Vec<&str> = folded().iter().map(|&i| tokens()[i].as_str()).collect();
        assert_eq!(fold.len(), 18);
        assert!(fold.contains(&"▁") && fold.contains(&"ː") && fold.contains(&"̴"));
        assert_eq!(seq("tʃ").len(), 2);
        assert_eq!(seq("g").len(), 1);
    }

    #[test]
    fn heard_mask_marks_what_was_actually_said() {
        let e = |s: &str| seq(s);
        // careful 读成 hɛɹfəl：k 听成 h，其余都读出来了
        let mask = heard_mask(&e("hɛɹfəl"), &e("kɛɹfəl"));
        assert_eq!(mask, [false, true, true, true, true, true]);
        // 什么都没听到 / 读了别的
        assert!(heard_mask(&[], &e("kɛɹfəl")).iter().all(|m| !m));
        assert_eq!(
            heard_mask(&e("enana"), &e("kɛɹfəl"))
                .iter()
                .filter(|&&m| m)
                .count(),
            0
        );
        // 听起来接近的（弱读）算读出来了
        assert_eq!(heard_mask(&e("ʌ"), &e("ə")), [true]);
    }

    #[test]
    fn ctc_forward_prefers_the_spoken_sequence() {
        // 三帧、字表 3：blank、a、b；每帧都很像 a
        let raw: Vec<f32> = (0..3).flat_map(|_| [-3.0f32, -0.1, -4.0]).collect();
        let lp = LogProbs {
            frames: 3,
            vocab: 3,
            data: raw.iter().map(|v| *v as f64).collect(),
        };
        assert!(ctc_logp(&lp, &[1]) > ctc_logp(&lp, &[2]));
        assert!(ctc_logp(&lp, &[1]) > ctc_logp(&lp, &[1, 2]));
    }
}
