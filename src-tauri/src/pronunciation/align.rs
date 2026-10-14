//! 台词与声音对齐（场景片段的单句播放用）：把每句台词的读音按顺序对到发音模型听出的每一帧上（CTC 强制对齐，Viterbi），
//! 得到每句话真正说出来的起止。字幕的时间常常不准（整句早一秒、晚一秒都有），单句播放按字幕切会切在说话中间。
//!
//! 词典里没有的词（数字、人名）当作「任意读音」：一个状态，每帧取最像的非空白字符。

use super::dict;
use super::score::{seq, LogProbs, NEG};

/// 跳过一个音的代价（对数概率）：比硬对上一个完全不像的帧（约 -12）便宜，比正常对上贵得多
const SKIP_PENALTY: f64 = 8.0;

/// 一个标签：字表下标，或「任意读音」
#[derive(Clone, Copy, PartialEq)]
enum Label {
    Token(usize),
    Any,
}

/// 字幕时间只是参考：每句在它字幕范围前后这么多帧以内不加代价（字幕早晚一两秒常见）
pub const WINDOW_MARGIN_FRAMES: f64 = 75.0;
/// 超出参考范围每帧的代价：相同的音不会被借到别的句子里（Well 的 l、no 的 n 对到后面 eleven 里）
const OUTSIDE_PER_FRAME: f64 = 0.5;

/// 一句台词里会读出来的词：字母词与数字（「11」「1969」也要读，按任意读音对齐）
fn spoken_words(text: &str) -> Vec<String> {
    text.split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '’'))
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .map(str::to_string)
        .collect()
}

/// 每句台词说出来的帧范围 [起, 止)；一句里一个词都没有（纯标点）时为 None。
/// `windows` 是每句字幕的帧范围（参考，见 WINDOW_MARGIN_FRAMES），没有时不限制
pub fn align_sentences(
    lp: &LogProbs,
    sentences: &[String],
    windows: Option<&[(f64, f64)]>,
) -> Vec<Option<(usize, usize)>> {
    // 标签序列与每个标签属于哪一句
    let mut labels: Vec<Label> = Vec::new();
    let mut owner: Vec<usize> = Vec::new();
    for (i, text) in sentences.iter().enumerate() {
        for word in spoken_words(text) {
            match dict::lookup(&word) {
                Some(prons) => {
                    for ph in &prons[0] {
                        for k in seq(ph) {
                            labels.push(Label::Token(k));
                            owner.push(i);
                        }
                    }
                }
                None => {
                    // 不认识的词大概读几个音：数字一位约 3 个（eleven 6 个），字母词约每两个字母一个
                    let digits = word.chars().filter(char::is_ascii_digit).count();
                    let n = if digits > 0 {
                        digits * 3
                    } else {
                        word.chars().count().div_ceil(2)
                    };
                    for _ in 0..n.clamp(1, 8) {
                        labels.push(Label::Any);
                        owner.push(i);
                    }
                }
            }
        }
    }
    let mut out = vec![None; sentences.len()];
    if labels.is_empty() || lp.frames == 0 {
        return out;
    }
    // 每帧「任意读音」的分数：最像的非空白字符
    let any: Vec<f64> = (0..lp.frames)
        .map(|t| (1..lp.vocab).map(|k| lp.at(t, k)).fold(NEG, f64::max))
        .collect();
    let outside = |t: usize, i: usize| -> f64 {
        let Some(&(a, b)) = windows.and_then(|w| w.get(i)) else {
            return 0.0;
        };
        let t = t as f64;
        (a - WINDOW_MARGIN_FRAMES - t)
            .max(t - b - WINDOW_MARGIN_FRAMES)
            .max(0.0)
            * OUTSIDE_PER_FRAME
    };
    let emit = |t: usize, s: usize| -> f64 {
        if s.is_multiple_of(2) {
            return lp.at(t, 0);
        }
        let e = match labels[s / 2] {
            Label::Token(k) => lp.at(t, k),
            Label::Any => any[t],
        };
        e - outside(t, owner[s / 2])
    };
    // 扩展状态：空白、标签 1、空白、标签 2 …… 空白
    let states = labels.len() * 2 + 1;
    let can_skip = |s: usize| s >= 2 && s % 2 == 1 && labels[s / 2] != labels[s / 2 - 1];
    let mut score = vec![NEG; states];
    let mut next = vec![NEG; states];
    // 回溯：每帧每个状态往回退几步（0 停留、1 前一个、2 跳过空白、3 / 4 跳过一个没听出来的音）
    let mut back = vec![0u8; lp.frames * states];
    score[0] = emit(0, 0);
    if states > 1 {
        score[1] = emit(0, 1);
    }
    for t in 1..lp.frames {
        for s in 0..states {
            let mut best = (score[s], 0u8);
            if s >= 1 && score[s - 1] > best.0 {
                best = (score[s - 1], 1);
            }
            if can_skip(s) && score[s - 2] > best.0 {
                best = (score[s - 2], 2);
            }
            // 跳过前一个音（模型没听出来，如 no 只听到 u ʊ）：少一个音不至于把整句拖到后面去凑
            if s % 2 == 1 && s >= 3 {
                for (step, from) in [(3u8, s - 3), (4u8, s.saturating_sub(4))] {
                    if step == 4 && s < 4 {
                        continue;
                    }
                    let v = score[from] - SKIP_PENALTY;
                    if v > best.0 {
                        best = (v, step);
                    }
                }
            }
            next[s] = if best.0 == NEG {
                NEG
            } else {
                best.0 + emit(t, s)
            };
            back[t * states + s] = best.1;
        }
        std::mem::swap(&mut score, &mut next);
    }
    // 结束在最后一个空白或最后一个标签
    let mut s = if states > 1 && score[states - 2] > score[states - 1] {
        states - 2
    } else {
        states - 1
    };
    if score[s] == NEG {
        return out;
    }
    for t in (0..lp.frames).rev() {
        if s % 2 == 1 {
            let i = owner[s / 2];
            out[i] = Some(match out[i] {
                Some((_, end)) => (t, end),
                None => (t, t + 1),
            });
        }
        if t > 0 {
            s -= back[t * states + s] as usize;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一个词按词典读音逐帧说出来（每个字符一帧）
    fn said(word: &str) -> Vec<Option<usize>> {
        dict::lookup(word).unwrap()[0]
            .iter()
            .flat_map(|ph| seq(ph))
            .map(Some)
            .collect()
    }

    /// 造一段对数概率：每帧最像给定的字符（None = 空白）
    fn frames(seq_: &[Option<usize>]) -> LogProbs {
        let vocab = super::super::score::tokens().len();
        let mut raw = vec![-12.0f32; seq_.len() * vocab];
        for (t, c) in seq_.iter().enumerate() {
            raw[t * vocab + c.unwrap_or(0)] = -0.05;
        }
        LogProbs::new(seq_.len(), vocab, &raw)
    }

    fn quiet(n: usize) -> Vec<Option<usize>> {
        vec![None; n]
    }

    #[test]
    fn finds_where_each_sentence_is_said() {
        let no = said("no");
        let go = said("go");
        let mut f = quiet(3);
        f.extend(&no);
        f.extend(quiet(4));
        f.extend(&go);
        f.extend(quiet(1));
        let spans = align_sentences(&frames(&f), &["No.".to_string(), "Go!".to_string()], None);
        let a = 3 + no.len();
        let b = a + 4;
        assert_eq!(spans, [Some((3, a)), Some((b, b + go.len()))]);
    }

    #[test]
    fn unknown_words_still_take_their_place() {
        // 第一句的词不在词典里：按任意读音对上它说话的那几帧
        let no = said("no");
        let mut f = quiet(2);
        f.extend([Some(seq("z")[0]), Some(seq("b")[0])]);
        f.extend(quiet(2));
        f.extend(&no);
        f.extend(quiet(1));
        let spans = align_sentences(
            &frames(&f),
            &["Zorblaxq.".to_string(), "No.".to_string()],
            None,
        );
        assert_eq!(spans[1], Some((6, 6 + no.len())));
        let (a, b) = spans[0].unwrap();
        assert!(a >= 2 && b <= 6, "{a}..{b}");
    }
}

/// 真实片段探针：`PINDU_PRONUNCIATION_MODEL=<model> PINDU_ALIGN_WAV=<16k wav> PINDU_ALIGN_TEXT=<句子 JSON 数组>`
#[cfg(test)]
#[test]
#[ignore]
fn probe_real_clip() {
    let model = std::env::var("PINDU_PRONUNCIATION_MODEL").unwrap();
    let bytes = std::fs::read(std::env::var("PINDU_ALIGN_WAV").unwrap()).unwrap();
    let at = bytes.windows(4).position(|w| w == b"data").unwrap() + 8;
    let samples: Vec<f32> = bytes[at..]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect();
    let texts: Vec<String> = serde_json::from_str(
        &std::fs::read_to_string(std::env::var("PINDU_ALIGN_TEXT").unwrap()).unwrap(),
    )
    .unwrap();
    let (frames, vocab, raw) =
        super::model::log_probs(std::path::Path::new(&model), &samples).unwrap();
    let lp = LogProbs::new(frames, vocab, &raw);
    let ms = samples.len() as f64 / 16.0 / frames as f64;
    let windows: Option<Vec<(f64, f64)>> = std::env::var("PINDU_ALIGN_WINDOWS").ok().map(|p| {
        let w: Vec<(f64, f64)> =
            serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
        w.into_iter().map(|(a, b)| (a / ms, b / ms)).collect()
    });
    for (t, span) in texts
        .iter()
        .zip(align_sentences(&lp, &texts, windows.as_deref()))
    {
        let span = span.map(|(a, b)| (a as f64 * ms, b as f64 * ms));
        println!("{span:?} {t}");
    }
}
