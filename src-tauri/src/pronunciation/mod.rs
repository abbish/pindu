//! 本机发音评估（看 · 说 · 盖 · 写 · 查 的「说」）：学习者读一个词或一句话，告诉他哪个音不准。
//!
//! 全部在本机：发音模型（ZIPA small，`model`）听出每一帧像哪个音 → 按词典（CMUdict，`dict`）的标准读法逐音打分
//! （CTC 对齐 + GOP + 训练好的小模型，`score`）。录音不上传、不收费。
//! 方案与实测（speechocean762：音素 PCC 0.56、句子 0.64）见 `.claude/work/pronunciation-spike/evidence.md`。

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
    let (frames, vocab, raw) = model::log_probs(model_path, samples)?;
    let lp = LogProbs::new(frames, vocab, &raw);
    Ok(assess_log_probs(&lp, &words))
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
    for w in &mut out {
        if !w.phones.is_empty() {
            let sum: u32 = w.phones.iter().map(|p| p.score).sum();
            w.score = Some((sum as f64 / w.phones.len() as f64).round() as u32);
        }
    }
    let scored: Vec<u32> = out.iter().filter_map(|w| w.score).collect();
    Assessment {
        score: (!scored.is_empty())
            .then(|| (scored.iter().sum::<u32>() as f64 / scored.len() as f64).round() as u32),
        words: out,
        voiced: heard.chars().filter(|c| c.is_alphabetic()).count() > 0,
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
