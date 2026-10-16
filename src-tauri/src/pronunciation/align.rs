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
pub fn spoken_words(text: &str) -> Vec<String> {
    text.split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '’'))
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .map(str::to_string)
        .collect()
}

/// 每句台词说出来的帧范围 [起, 止)；一句里一个词都没有（纯标点）时为 None。
/// `windows` 是每句字幕的帧范围（参考，见 WINDOW_MARGIN_FRAMES），没有时不限制（测试与探针用；正式路径见 `align_audio`）
#[cfg(test)]
pub fn align_sentences(
    lp: &LogProbs,
    sentences: &[String],
    windows: Option<&[(f64, f64)]>,
) -> Vec<Option<(usize, usize)>> {
    align_words(lp, sentences, windows)
        .into_iter()
        .map(|words| {
            words.iter().flatten().fold(None, |acc, w| {
                Some(acc.map_or((w.start, w.end), |(x, y): (usize, usize)| {
                    (x.min(w.start), y.max(w.end))
                }))
            })
        })
        .collect()
}

/// 一个词对上的帧范围 [起, 止) 与对得有多像（`fit`：这些帧上对上的音与那一帧最像的音的对数概率差的平均，
/// 0 最像，越负越不像——真说了这个词时接近 0，没说、被硬塞进静音或别的话里时很低）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WordHit {
    pub start: usize,
    pub end: usize,
    pub fit: f64,
}

/// 每句台词里每个词（`spoken_words` 的顺序）说出来的帧范围与像不像（见 WordHit）；被跳过、没对上的词为 None
pub fn align_words(
    lp: &LogProbs,
    sentences: &[String],
    windows: Option<&[(f64, f64)]>,
) -> Vec<Vec<Option<WordHit>>> {
    // 标签序列与每个标签属于哪一句的哪个词
    let mut labels: Vec<Label> = Vec::new();
    let mut owner: Vec<usize> = Vec::new();
    let mut word_of: Vec<usize> = Vec::new();
    let mut out: Vec<Vec<Option<WordHit>>> = Vec::with_capacity(sentences.len());
    for (i, text) in sentences.iter().enumerate() {
        let words = spoken_words(text);
        out.push(vec![None; words.len()]);
        for (j, word) in words.into_iter().enumerate() {
            match dict::lookup(&word) {
                Some(prons) => {
                    for ph in &prons[0] {
                        for k in seq(ph) {
                            labels.push(Label::Token(k));
                            owner.push(i);
                            word_of.push(j);
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
                        word_of.push(j);
                    }
                }
            }
        }
    }
    if labels.is_empty() || lp.frames == 0 {
        return out;
    }
    // 每帧「任意读音」的分数：最像的非空白字符
    let any: Vec<f64> = (0..lp.frames)
        .map(|t| (1..lp.vocab).map(|k| lp.at(t, k)).fold(NEG, f64::max))
        .collect();
    // 每帧最像的音（含空白）：算 fit 的基准
    let best: Vec<f64> = (0..lp.frames).map(|t| any[t].max(lp.at(t, 0))).collect();
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
            let fit = match labels[s / 2] {
                Label::Token(k) => lp.at(t, k),
                Label::Any => any[t],
            } - best[t];
            let slot = &mut out[owner[s / 2]][word_of[s / 2]];
            *slot = Some(match *slot {
                // 先累加差值，回溯完再除以帧数
                Some(w) => WordHit {
                    start: t,
                    end: w.end,
                    fit: w.fit + fit,
                },
                None => WordHit {
                    start: t,
                    end: t + 1,
                    fit,
                },
            });
        }
        if t > 0 {
            s -= back[t * states + s] as usize;
        }
    }
    for w in out.iter_mut().flatten().flatten() {
        w.fit /= (w.end - w.start).max(1) as f64;
    }
    out
}

/// 一句台词在一段声音里说出来的位置（毫秒，相对这段声音开头）与每个词的位置
#[derive(Debug, Clone, PartialEq)]
pub struct AlignedSentence {
    pub start_ms: i64,
    pub end_ms: i64,
    /// `spoken_words` 里对上了的词
    pub words: Vec<AlignedWord>,
}

/// 一个词说出来的位置（毫秒）与像不像（见 WordHit::fit）
#[derive(Debug, Clone, PartialEq)]
pub struct AlignedWord {
    pub word: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub fit: f64,
}

/// 不超过这么长的声音整段对齐；更长的按句子分段（对齐的计算量与内存随长度平方增长）
const WHOLE_MS: i64 = 3 * 60 * 1000;
/// 分段时每段核心句子的跨度上限
const CHUNK_MS: i64 = 60 * 1000;
/// 每段声音在上下文句子之外再多取这么多
const CHUNK_PAD_MS: i64 = 2000;

/// 把台词对到一段声音上（16kHz 单声道）。`windows` 是每句大概在哪里（毫秒，相对声音开头，见 WINDOW_MARGIN_FRAMES），
/// 声音超过 3 分钟且每句都有参考范围时按句子分段：每段约一分钟，前后各多带一句作上下文（它们的结果不用，
/// 免得段首段尾邻句的声音被硬塞进这一段的第一句、最后一句）
pub fn align_audio(
    model_path: &std::path::Path,
    samples: &[f32],
    texts: &[String],
    windows: &[Option<(i64, i64)>],
) -> crate::error::AppResult<Vec<Option<AlignedSentence>>> {
    align_audio_within(model_path, samples, texts, windows, WHOLE_MS)
}

/// 同 `align_audio`，超过 `whole_ms` 才分段（实验对照用）
fn align_audio_within(
    model_path: &std::path::Path,
    samples: &[f32],
    texts: &[String],
    windows: &[Option<(i64, i64)>],
    whole_ms: i64,
) -> crate::error::AppResult<Vec<Option<AlignedSentence>>> {
    let total_ms = (samples.len() / 16) as i64;
    let all_windows: Option<Vec<(i64, i64)>> = windows.iter().copied().collect();
    let Some(ws) = all_windows.filter(|_| total_ms > whole_ms) else {
        return align_range(model_path, samples, 0, total_ms, texts, windows);
    };
    let mut out: Vec<Option<AlignedSentence>> = vec![None; texts.len()];
    let mut first = 0;
    while first < texts.len() {
        let mut last = first;
        while last + 1 < texts.len() && ws[last + 1].1 - ws[first].0 <= CHUNK_MS {
            last += 1;
        }
        let from = first.saturating_sub(1);
        let to = (last + 1).min(texts.len() - 1);
        let start = (ws[from].0 - CHUNK_PAD_MS).max(0);
        let end = (ws[to].1 + CHUNK_PAD_MS).min(total_ms);
        let part = align_range(
            model_path,
            samples,
            start,
            end,
            &texts[from..=to],
            &windows[from..=to],
        )?;
        for (k, aligned) in part.into_iter().enumerate() {
            let i = from + k;
            if (first..=last).contains(&i) {
                out[i] = aligned;
            }
        }
        first = last + 1;
    }
    Ok(out)
}

/// 对齐声音里 [start_ms, end_ms) 这一段；结果换回相对整段声音开头的毫秒
fn align_range(
    model_path: &std::path::Path,
    samples: &[f32],
    start_ms: i64,
    end_ms: i64,
    texts: &[String],
    windows: &[Option<(i64, i64)>],
) -> crate::error::AppResult<Vec<Option<AlignedSentence>>> {
    let a = (start_ms.max(0) as usize * 16).min(samples.len());
    let b = (end_ms.max(0) as usize * 16).clamp(a, samples.len());
    let slice = &samples[a..b];
    if slice.len() < 16 * 100 {
        return Ok(vec![None; texts.len()]);
    }
    let (frames, vocab, raw) = super::model::log_probs(model_path, slice)?;
    let lp = LogProbs::new(frames, vocab, &raw);
    let ms = slice.len() as f64 / 16.0 / frames.max(1) as f64;
    let frame_windows: Vec<(f64, f64)> = windows
        .iter()
        .map(|w| match w {
            Some((x, y)) => ((x - start_ms) as f64 / ms, (y - start_ms) as f64 / ms),
            None => (f64::NEG_INFINITY, f64::INFINITY),
        })
        .collect();
    let at = |f: usize| start_ms + (f as f64 * ms).round() as i64;
    Ok(align_words(&lp, texts, Some(&frame_windows))
        .into_iter()
        .zip(texts)
        .map(|(spans, text)| {
            let words: Vec<AlignedWord> = spoken_words(text)
                .into_iter()
                .zip(spans)
                .filter_map(|(word, hit)| {
                    hit.map(|h| AlignedWord {
                        word,
                        start_ms: at(h.start),
                        end_ms: at(h.end),
                        fit: h.fit,
                    })
                })
                .collect();
            let start = words.iter().map(|w| w.start_ms).min()?;
            let end = words.iter().map(|w| w.end_ms).max()?;
            Some(AlignedSentence {
                start_ms: start,
                end_ms: end,
                words,
            })
        })
        .collect())
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
    fn each_word_gets_its_own_span() {
        let no = said("no");
        let go = said("go");
        let mut f = quiet(2);
        f.extend(&no);
        f.extend(quiet(3));
        f.extend(&go);
        let words = align_words(&frames(&f), &["No, go.".to_string()], None);
        let a = 2 + no.len();
        let spans: Vec<_> = words[0]
            .iter()
            .map(|w| w.map(|w| (w.start, w.end)))
            .collect();
        assert_eq!(spans, [Some((2, a)), Some((a + 3, a + 3 + go.len()))]);
        // 真说了：每帧对上的就是最像的音
        assert!(words[0].iter().all(|w| w.unwrap().fit.abs() < 1e-9));
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

/// 真实片段探针：分段对齐与整段对齐对照、整段跟读评估（把原声延后当作学习者的录音）。
/// `PINDU_PRONUNCIATION_MODEL` `PINDU_ALIGN_WAV` `PINDU_ALIGN_TEXT` `PINDU_ALIGN_WINDOWS`（毫秒）
#[cfg(test)]
#[test]
#[ignore]
fn probe_chunked_and_shadowing() {
    let model = std::path::PathBuf::from(std::env::var("PINDU_PRONUNCIATION_MODEL").unwrap());
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
    let windows: Vec<Option<(i64, i64)>> = serde_json::from_str::<Vec<(i64, i64)>>(
        &std::fs::read_to_string(std::env::var("PINDU_ALIGN_WINDOWS").unwrap()).unwrap(),
    )
    .unwrap()
    .into_iter()
    .map(Some)
    .collect();
    let t = std::time::Instant::now();
    let whole = align_audio_within(&model, &samples, &texts, &windows, i64::MAX).unwrap();
    println!("whole {:?}", t.elapsed());
    let t = std::time::Instant::now();
    let chunked = align_audio_within(&model, &samples, &texts, &windows, 0).unwrap();
    println!("chunked {:?}", t.elapsed());
    for (i, (w, c)) in whole.iter().zip(&chunked).enumerate() {
        let w = w.as_ref().map(|a| (a.start_ms, a.end_ms));
        let c = c.as_ref().map(|a| (a.start_ms, a.end_ms));
        println!("{i:2} whole {w:?} chunked {c:?}");
    }
    // 原声延后 600ms 当作学习者跟着说的录音；再做一份把第 3、7 句和第 10 句后半静音（没跟上）
    // 房间底噪（真实录音不会是纯零）
    let mut seed = 12345u32;
    let mut noise = move || {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        (seed as f32 / u32::MAX as f32 - 0.5) * 0.004
    };
    let mut delayed: Vec<f32> = (0..600 * 16).map(|_| noise()).collect();
    delayed.extend(&samples);
    let mut muted = delayed.clone();
    let mut mute = |buf: &mut Vec<f32>, a: i64, b: i64| {
        let end = ((b + 600) as usize * 16).min(buf.len());
        for v in &mut buf[((a + 600) as usize * 16)..end] {
            *v = noise();
        }
    };
    let w = |i: usize| whole[i].as_ref().map(|a| (a.start_ms, a.end_ms)).unwrap();
    mute(&mut muted, w(3).0, w(3).1);
    mute(&mut muted, w(7).0, w(7).1);
    mute(&mut muted, (w(10).0 + w(10).1) / 2, w(10).1);
    // 每个词的 fit：全说了 / 静音
    let fits = |buf: &[f32]| {
        align_audio(
            &model,
            buf,
            &texts,
            &windows
                .iter()
                .map(|w| w.map(|(a, b)| (a, b + 1000)))
                .collect::<Vec<_>>(),
        )
        .unwrap()
    };
    for (name, buf) in [("all said", &delayed), ("muted", &muted)] {
        let t = std::time::Instant::now();
        let r = fits(buf);
        println!("{name} {:?}", t.elapsed());
        for (i, s) in r.iter().enumerate() {
            let f: Vec<String> = s
                .as_ref()
                .map(|s| s.words.iter().map(|w| format!("{:.1}", w.fit)).collect())
                .unwrap_or_default();
            println!("{i:2} {}", f.join(" "));
        }
    }
    let shadow = super::assess_shadowing(&model, &muted, &texts, &windows).unwrap();
    for (i, s) in shadow.iter().enumerate() {
        let said = s.words.iter().filter(|w| w.said).count();
        let lag = s
            .start_ms
            .zip(whole[i].as_ref())
            .map(|(x, a)| x - a.start_ms);
        println!("{i:2} said {said}/{} lag {lag:?}", s.words.len());
    }
}
