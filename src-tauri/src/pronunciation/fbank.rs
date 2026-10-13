//! Kaldi 兼容的 80 维 log-mel fbank。两套参数：
//! - `ZIPA`（发音评估）：与训练时一致，lhotse `FbankConfig(num_filters=80, dither=0, snip_edges=False)`，
//!   即 kaldi-native-fbank 的默认值加 high_freq -400；
//! - `SENSE_VOICE`（语音输入）：与 sherpa-onnx 一致，hamming 窗、high_freq 0、snip_edges、采样放大到 16 位整数的范围。
//!
//! 输入是 16kHz 单声道、[-1, 1] 的采样。

use std::f64::consts::PI;
use std::sync::OnceLock;

pub const SAMPLE_RATE: usize = 16_000;
pub const NUM_BINS: usize = 80;
const FRAME_LENGTH: usize = 400; // 25ms
const FRAME_SHIFT: usize = 160; // 10ms
const PADDED: usize = 512;
const PREEMPH: f64 = 0.97;
const LOW_FREQ: f64 = 20.0;

#[derive(Clone, Copy)]
enum Window {
    /// hann 的 0.85 次方
    Povey,
    Hamming,
}

/// 一套 fbank 参数（查表在第一次用时算好）
pub struct Fbank {
    window: Window,
    /// 负数表示相对奈奎斯特频率，0 表示奈奎斯特频率
    high_freq: f64,
    /// true：帧从 0 开始、只取完整的帧；false：帧居中、越界按镜像取
    snip_edges: bool,
    /// 采样先乘上这个数（sherpa 的 SenseVoice 用 16 位整数的范围）
    scale: f64,
    tables: OnceLock<Tables>,
}

pub static ZIPA: Fbank = Fbank {
    window: Window::Povey,
    high_freq: -400.0,
    snip_edges: false,
    scale: 1.0,
    tables: OnceLock::new(),
};

pub static SENSE_VOICE: Fbank = Fbank {
    window: Window::Hamming,
    high_freq: 0.0,
    snip_edges: true,
    scale: 32768.0,
    tables: OnceLock::new(),
};

struct Tables {
    window: Vec<f64>,
    /// 每个 mel 滤波器：（起始的 FFT 频点，权重）
    banks: Vec<(usize, Vec<f64>)>,
}

impl Fbank {
    fn tables(&self) -> &Tables {
        self.tables.get_or_init(|| {
            let window = (0..FRAME_LENGTH)
                .map(|i| {
                    let a = 2.0 * PI * i as f64 / (FRAME_LENGTH - 1) as f64;
                    match self.window {
                        Window::Povey => (0.5 - 0.5 * a.cos()).powf(0.85),
                        Window::Hamming => 0.54 - 0.46 * a.cos(),
                    }
                })
                .collect();
            let mel = |f: f64| 1127.0 * (1.0 + f / 700.0).ln();
            let nyquist = SAMPLE_RATE as f64 / 2.0;
            let high = if self.high_freq <= 0.0 {
                nyquist + self.high_freq
            } else {
                self.high_freq
            };
            let (mel_low, mel_high) = (mel(LOW_FREQ), mel(high));
            let delta = (mel_high - mel_low) / (NUM_BINS + 1) as f64;
            let fft_bins = PADDED / 2;
            let bin_width = SAMPLE_RATE as f64 / PADDED as f64;
            let banks = (0..NUM_BINS)
                .map(|b| {
                    let left = mel_low + b as f64 * delta;
                    let center = left + delta;
                    let right = center + delta;
                    let mut first = None;
                    let mut weights = Vec::new();
                    for i in 0..fft_bins {
                        let m = mel(bin_width * i as f64);
                        if m > left && m < right {
                            let w = if m <= center {
                                (m - left) / (center - left)
                            } else {
                                (right - m) / (right - center)
                            };
                            first.get_or_insert(i);
                            weights.push(w);
                        }
                    }
                    (first.unwrap_or(0), weights)
                })
                .collect();
            Tables { window, banks }
        })
    }

    /// 帧数：snip_edges 时只算完整的帧，否则按帧移四舍五入
    pub fn num_frames(&self, samples: usize) -> usize {
        if self.snip_edges {
            if samples < FRAME_LENGTH {
                0
            } else {
                1 + (samples - FRAME_LENGTH) / FRAME_SHIFT
            }
        } else {
            (samples + FRAME_SHIFT / 2) / FRAME_SHIFT
        }
    }

    /// 计算 fbank：返回 `num_frames × 80`（按行展开）
    pub fn compute(&self, samples: &[f32]) -> Vec<f32> {
        let n = samples.len();
        let frames = self.num_frames(n);
        let t = self.tables();
        let mut out = Vec::with_capacity(frames * NUM_BINS);
        let mut frame = vec![0f64; FRAME_LENGTH];
        let mut re = vec![0f64; PADDED];
        let mut im = vec![0f64; PADDED];
        for f in 0..frames {
            // snip_edges：帧从 f × 帧移开始；否则帧的中心落在 f × 帧移 + 帧移 / 2，越界的采样按镜像取
            let start = if self.snip_edges {
                (f * FRAME_SHIFT) as isize
            } else {
                (f * FRAME_SHIFT + FRAME_SHIFT / 2) as isize - (FRAME_LENGTH / 2) as isize
            };
            for (j, v) in frame.iter_mut().enumerate() {
                let mut s = start + j as isize;
                while s < 0 || s >= n as isize {
                    s = if s < 0 {
                        -s - 1
                    } else {
                        2 * n as isize - 1 - s
                    };
                }
                *v = samples[s as usize] as f64 * self.scale;
            }
            let mean = frame.iter().sum::<f64>() / FRAME_LENGTH as f64;
            frame.iter_mut().for_each(|v| *v -= mean);
            for j in (1..FRAME_LENGTH).rev() {
                frame[j] -= PREEMPH * frame[j - 1];
            }
            frame[0] -= PREEMPH * frame[0];
            re.iter_mut().for_each(|v| *v = 0.0);
            im.iter_mut().for_each(|v| *v = 0.0);
            for j in 0..FRAME_LENGTH {
                re[j] = frame[j] * t.window[j];
            }
            fft(&mut re, &mut im);
            for (first, weights) in &t.banks {
                let energy: f64 = weights
                    .iter()
                    .enumerate()
                    .map(|(k, w)| {
                        let i = first + k;
                        w * (re[i] * re[i] + im[i] * im[i])
                    })
                    .sum();
                out.push(energy.max(f32::EPSILON as f64).ln() as f32);
            }
        }
        out
    }
}

/// 发音评估的 fbank（`ZIPA`）
pub fn fbank(samples: &[f32]) -> Vec<f32> {
    ZIPA.compute(samples)
}

/// 原地基 2 复数 FFT（长度是 2 的幂）
fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let angle = -2.0 * PI / len as f64;
        let (wr, wi) = (angle.cos(), angle.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0, 0.0);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let (xr, xi) = (re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr);
                re[b] = re[a] - xr;
                im[b] = im[a] - xi;
                re[a] += xr;
                im[a] += xi;
                let next = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = next;
            }
        }
        len <<= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 语音输入的参数（hamming、snip_edges、放大到 16 位整数范围）与 kaldi-native-fbank 逐值对照
    #[test]
    fn sense_voice_matches_kaldi_native_fbank() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/pronunciation/fbank-sense-voice.json"
        ))
        .unwrap();
        let fb = SENSE_VOICE.compute(&sweep());
        let frames = fixture["frames"].as_u64().unwrap() as usize;
        assert_eq!(fb.len(), frames * NUM_BINS);
        for (name, row) in [("first", 0), ("middle", frames / 2), ("last", frames - 1)] {
            let expected: Vec<f64> = serde_json::from_value(fixture[name].clone()).unwrap();
            for (b, e) in expected.iter().enumerate() {
                let got = fb[row * NUM_BINS + b] as f64;
                assert!((got - e).abs() < 2e-3, "{name} 第 {b} 维：{got} vs {e}");
            }
        }
    }

    fn sweep() -> Vec<f32> {
        (0..8000)
            .map(|n| {
                let t = n as f64 / 16000.0;
                (0.3 * (2.0 * PI * (200.0 + 1800.0 * t) * t).sin()) as f32
            })
            .collect()
    }

    /// 与 kaldi-native-fbank（发音模型训练用的特征）逐值对照：同一段确定的扫频信号
    #[test]
    fn matches_kaldi_native_fbank() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/pronunciation/fbank.json"
        ))
        .unwrap();
        let samples: Vec<f32> = (0..8000)
            .map(|n| {
                let t = n as f64 / 16000.0;
                (0.3 * (2.0 * PI * (200.0 + 1800.0 * t) * t).sin()) as f32
            })
            .collect();
        let fb = fbank(&samples);
        let frames = fixture["frames"].as_u64().unwrap() as usize;
        assert_eq!(fb.len(), frames * NUM_BINS);
        for (name, row) in [("first", 0), ("middle", frames / 2), ("last", frames - 1)] {
            let expected: Vec<f64> = serde_json::from_value(fixture[name].clone()).unwrap();
            for (b, e) in expected.iter().enumerate() {
                let got = fb[row * NUM_BINS + b] as f64;
                assert!((got - e).abs() < 2e-3, "{name} 第 {b} 维：{got} vs {e}");
            }
        }
    }
}
