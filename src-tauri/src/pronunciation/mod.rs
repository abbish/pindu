//! 本机发音评估（看 · 说 · 盖 · 写 · 查 的「说」）：学习者读一个词或一句话，告诉他哪个音不准。
//!
//! 全部在本机：发音模型（ZIPA small，`model`）听出每一帧像哪个音 → 按词典（CMUdict，`dict`）的标准读法逐音打分
//! （CTC 对齐 + GOP + 训练好的小模型，`score`）。录音不上传、不收费。
//! 方案与实测（speechocean762：音素 PCC 0.56、句子 0.64）见 `.claude/work/pronunciation-spike/evidence.md`。

pub mod align;
pub mod dict;
pub mod fbank;
pub mod model;
pub mod score;

use crate::error::{AppError, AppResult};
use score::LogProbs;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 分数换算：模型给 0–2，界面用 0–100
const SCALE: f64 = 50.0;
/// 低于这个分数时说明「听起来像什么」
const EXPLAIN_BELOW: u32 = 60;
/// 算作有声音的音量（20ms 一段的 RMS，约 -46 dBFS）：没接麦克风的底噪在这以下，离麦克风远、很小声说话也在这以上（跟读录音不开自动增益，音量比说话输入小）
const VOICE_RMS: f32 = 0.005;
/// 有声音的部分不到这么长就当没读（一个短词也有 200ms 以上）
const MIN_VOICE_MS: usize = 150;
/// 听到的音不到标准读法的这个比例（且不到 2 个）就当没在读：静音、底噪时模型只会冒出一两个音
const MIN_HEARD_RATIO: f64 = 0.15;
/// 一个词读出来的音不到一半时按比例降分：读出来的比例 c → 分数 × (0.3 + 1.4c)，一个音都没读出来时只剩三成
const WORD_HEARD_FULL: f64 = 0.5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneAssessment {
    /// 标准读法里的这个音（IPA）
    pub ipa: String,
    pub score: u32,
    /// 不准时最像的读法（IPA；空字符串表示像是没读出来）
    pub heard_as: Option<String>,
    /// 明显读成了常见的读偏（如 th 读成 s）：分数照人工口径不变，界面可以提醒一句
    pub likely_confused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordAssessment {
    pub word: String,
    /// 词典里有这个词（没有的不评分）
    pub known: bool,
    pub score: Option<u32>,
    pub phones: Vec<PhoneAssessment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assessment {
    /// 能评分的词的平均分；一个都不能评时为空
    pub score: Option<u32>,
    pub words: Vec<WordAssessment>,
    /// 听到的音（IPA，调试与「听到了什么」用）
    pub heard: String,
    /// 有没有听到说话（几乎全是静音时为 false）
    pub voiced: bool,
}

/// 把要读的文字拆成词
pub fn words_of(text: &str) -> Vec<String> {
    text.split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '’'))
        .filter(|w| w.chars().any(char::is_alphabetic))
        .map(str::to_string)
        .collect()
}

/// 评估一段录音（16kHz 单声道 [-1, 1]）读的是不是 `text`
pub fn assess(model_path: &Path, text: &str, samples: &[f32]) -> AppResult<Assessment> {
    let words = words_of(text);
    if words.is_empty() {
        return Err(AppError::ValidationError("没有要读的英文".to_string()));
    }
    if voiced_ms(samples) < MIN_VOICE_MS {
        return Ok(unvoiced(&words));
    }
    let (frames, vocab, raw) = model::log_probs(model_path, samples)?;
    let lp = LogProbs::new(frames, vocab, &raw);
    Ok(assess_log_probs(&lp, &words))
}

/// 录音里有声音的时长（毫秒，20ms 一段按音量算）
fn voiced_ms(samples: &[f32]) -> usize {
    const WINDOW: usize = fbank::SAMPLE_RATE / 50;
    samples
        .chunks(WINDOW)
        .filter(|w| (w.iter().map(|v| v * v).sum::<f32>() / w.len() as f32).sqrt() >= VOICE_RMS)
        .count()
        * 20
}

/// 没听到在读：不评分
fn unvoiced(words: &[String]) -> Assessment {
    Assessment {
        score: None,
        words: words
            .iter()
            .map(|w| WordAssessment {
                word: w.clone(),
                known: dict::lookup(w).is_some(),
                score: None,
                phones: Vec::new(),
            })
            .collect(),
        heard: String::new(),
        voiced: false,
    }
}

/// 已经有对数概率时打分（测试与整句复用）
pub fn assess_log_probs(lp: &LogProbs, words: &[String]) -> Assessment {
    let heard = lp.greedy();
    let prons: Vec<Option<&'static [dict::Pron]>> = words.iter().map(|w| dict::lookup(w)).collect();
    // 一个词有几种读法（read /ɹid/ /ɹɛd/）：逐个词选整句概率最高的那种
    let mut chosen: Vec<usize> = vec![0; words.len()];
    for i in 0..words.len() {
        let Some(variants) = prons[i].filter(|v| v.len() > 1) else {
            continue;
        };
        let mut best = (score::NEG, 0);
        for k in 0..variants.len() {
            chosen[i] = k;
            let v = score::ctc_logp(lp, &flatten(&prons, &chosen));
            if v > best.0 {
                best = (v, k);
            }
        }
        chosen[i] = best.1;
    }
    let mut phones: Vec<String> = Vec::new();
    let mut owner: Vec<usize> = Vec::new();
    for (i, p) in prons.iter().enumerate() {
        if let Some(variants) = p {
            for ph in &variants[chosen[i]] {
                phones.push(ph.clone());
                owner.push(i);
            }
        }
    }
    // 听到的音和标准读法对齐：这句到底读出来多少（见 score::heard_mask）
    let tokens: Vec<Vec<usize>> = phones.iter().map(|p| score::seq(p)).collect();
    let expected: Vec<usize> = tokens.iter().flatten().copied().collect();
    let heard_ids = lp.greedy_ids();
    if expected.is_empty()
        || (heard_ids.len() as f64) < (expected.len() as f64 * MIN_HEARD_RATIO).max(2.0)
    {
        return unvoiced(words);
    }
    let mask = score::heard_mask(&heard_ids, &expected);
    let mut at = 0;
    let phone_heard: Vec<bool> = tokens
        .iter()
        .map(|t| {
            let got = mask[at..at + t.len()].iter().filter(|&&m| m).count();
            at += t.len();
            got * 2 >= t.len() && got > 0
        })
        .collect();
    let feats = score::features(lp, &phones);
    let mut out: Vec<WordAssessment> = words
        .iter()
        .zip(&prons)
        .map(|(w, p)| WordAssessment {
            word: w.clone(),
            known: p.is_some(),
            score: None,
            phones: Vec::new(),
        })
        .collect();
    for ((ph, f), &i) in phones.iter().zip(&feats).zip(&owner) {
        let s = (score::phone_score(ph, f) * SCALE).round() as u32;
        let confused = score::likely_confused(ph, f);
        out[i].phones.push(PhoneAssessment {
            ipa: ph.clone(),
            score: s,
            heard_as: (s < EXPLAIN_BELOW || confused)
                .then(|| f.closest.clone())
                .flatten(),
            likely_confused: confused,
        });
    }
    let mut heard_in_word = vec![(0usize, 0usize); words.len()];
    for (&h, &i) in phone_heard.iter().zip(&owner) {
        heard_in_word[i].0 += usize::from(h);
        heard_in_word[i].1 += 1;
    }
    for (w, &(got, all)) in out.iter_mut().zip(&heard_in_word) {
        if !w.phones.is_empty() {
            let sum: u32 = w.phones.iter().map(|p| p.score).sum();
            let mean = sum as f64 / w.phones.len() as f64;
            let c = got as f64 / all as f64;
            let factor = if c >= WORD_HEARD_FULL {
                1.0
            } else {
                0.3 + 1.4 * c
            };
            w.score = Some((mean * factor).round() as u32);
        }
    }
    let scored: Vec<u32> = out.iter().filter_map(|w| w.score).collect();
    Assessment {
        score: (!scored.is_empty())
            .then(|| (scored.iter().sum::<u32>() as f64 / scored.len() as f64).round() as u32),
        words: out,
        voiced: true,
        heard,
    }
}

fn flatten(prons: &[Option<&'static [dict::Pron]>], chosen: &[usize]) -> Vec<usize> {
    prons
        .iter()
        .zip(chosen)
        .filter_map(|(p, &k)| p.map(|v| &v[k]))
        .flatten()
        .flat_map(|ph| score::seq(ph))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_text_into_words() {
        assert_eq!(words_of("Don't stop, KATE!"), ["Don't", "stop", "KATE"]);
        assert!(words_of("123 …").is_empty());
    }

    #[test]
    fn silence_is_not_scored_and_never_reaches_the_model() {
        // 模型文件不存在：没声音时根本不该去跑模型
        let a = assess(
            Path::new("/nonexistent/model.onnx"),
            "careful",
            &vec![0.0; 16000],
        )
        .unwrap();
        assert!(!a.voiced && a.score.is_none());
        let hiss: Vec<f32> = (0..16000)
            .map(|i| if i % 2 == 0 { 0.002 } else { -0.002 })
            .collect();
        assert!(
            !assess(Path::new("/nonexistent/model.onnx"), "careful", &hiss)
                .unwrap()
                .voiced
        );
        assert_eq!(voiced_ms(&vec![0.1; 16000]), 1000);
    }

    /// 读 16 位 wav（固定样例）
    fn wav(name: &str) -> Vec<f32> {
        let bytes = std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/pronunciation")
                .join(name),
        )
        .unwrap();
        bytes[44..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
            .collect()
    }

    /// 读任意 wav（找 data 块；macOS `say` 生成的文件头不止 44 字节）
    fn wav_any(path: &Path) -> Vec<f32> {
        let bytes = std::fs::read(path).unwrap();
        let at = bytes.windows(4).position(|w| w == b"data").unwrap() + 8;
        bytes[at..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
            .collect()
    }

    /// 评分探针：`PINDU_PRONUNCIATION_MODEL=<model> PINDU_PRONUNCIATION_PROBE=<目录>`，目录里 cases.txt 每行「文件|要读的文字」
    #[test]
    #[ignore]
    fn probe_cases() {
        let model = std::env::var("PINDU_PRONUNCIATION_MODEL").expect("PINDU_PRONUNCIATION_MODEL");
        let dir = std::path::PathBuf::from(
            std::env::var("PINDU_PRONUNCIATION_PROBE").expect("PINDU_PRONUNCIATION_PROBE"),
        );
        for line in std::fs::read_to_string(dir.join("cases.txt"))
            .unwrap()
            .lines()
        {
            let Some((file, text)) = line.split_once('|') else {
                continue;
            };
            let samples = wav_any(&dir.join(file));
            let a = assess(Path::new(&model), text, &samples).unwrap();
            let words: Vec<String> = a
                .words
                .iter()
                .map(|w| format!("{}={:?}", w.word, w.score))
                .collect();
            println!(
                "{file:<16} score={:?} voiced={} heard=「{}」 {}",
                a.score,
                a.voiced,
                a.heard,
                words.join(" ")
            );
        }
    }

    /// 与原型逐项对照：需要模型文件（`PINDU_PRONUNCIATION_MODEL=<model.int8.onnx>`）
    #[test]
    #[ignore]
    fn matches_prototype_on_speechocean_samples() {
        let model = std::env::var("PINDU_PRONUNCIATION_MODEL").expect("PINDU_PRONUNCIATION_MODEL");
        let fixtures: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../tests/fixtures/pronunciation/utterances.json"
        ))
        .unwrap();
        for fx in fixtures {
            let samples = wav(fx["file"].as_str().unwrap());
            let (frames, vocab, raw) = model::log_probs(Path::new(&model), &samples).unwrap();
            let lp = LogProbs::new(frames, vocab, &raw);
            let phones: Vec<String> = fx["words"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|w| {
                    w["phones"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|p| p.as_str().unwrap().to_string())
                })
                .collect();
            let feats = score::features(&lp, &phones);
            let expected: Vec<f64> = serde_json::from_value(fx["scores"].clone()).unwrap();
            // 特征（GOP 等）与原型只差浮点与特征提取的细微误差；打分树在阈值附近会放大这点差别，所以按整句平均比
            let features: Vec<Vec<f64>> = serde_json::from_value(fx["features"].clone()).unwrap();
            let mut diffs = Vec::new();
            for (((ph, f), e), x) in phones.iter().zip(&feats).zip(&expected).zip(&features) {
                for (got, want) in [f.gop, f.gop_delete, f.peak].iter().zip(x) {
                    let (g, w) = (got.clamp(-30.0, 30.0), want.clamp(-30.0, 30.0));
                    assert!(
                        (g - w).abs() < 0.5 + 0.05 * w.abs(),
                        "{}：{ph} 特征 {g:.3} vs {w:.3}",
                        fx["text"]
                    );
                }
                diffs.push((score::phone_score(ph, f) - e).abs());
            }
            let mean = diffs.iter().sum::<f64>() / diffs.len() as f64;
            assert!(mean < 0.06, "{}：平均分差 {mean:.3}", fx["text"]);
            // 整句接口：这些词都在词典里
            let a = assess_log_probs(&lp, &words_of(fx["text"].as_str().unwrap()));
            assert!(a.words.iter().all(|w| w.known), "{:?}", a.words);
            println!("{} → {:?} heard {}", fx["text"], a.score, a.heard);
        }
    }
}
