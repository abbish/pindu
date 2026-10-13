//! 标准发音：CMU 发音词典（ARPAbet，BSD-2）换成发音模型的 IPA 字符。
//! 换算规则与训练打分模型时一致（`.claude/work/pronunciation-spike/spike/gop.py` 的 `ipa`）。

use std::collections::HashMap;
use std::sync::OnceLock;

/// 一个词的一种读法：每个音是一串 IPA 字符（双元音、塞擦音是两个字符）
pub type Pron = Vec<String>;

fn entries() -> &'static HashMap<String, Vec<Pron>> {
    static DICT: OnceLock<HashMap<String, Vec<Pron>>> = OnceLock::new();
    DICT.get_or_init(|| {
        let mut map: HashMap<String, Vec<Pron>> = HashMap::new();
        for line in include_str!("data/cmudict.dict").lines() {
            // `word(2) P H ...  # 注释`：(2) 是同一个词的另一种读法
            let line = line.split('#').next().unwrap_or("").trim();
            let mut parts = line.split_whitespace();
            let Some(head) = parts.next() else { continue };
            let word = head.split('(').next().unwrap_or(head).to_lowercase();
            let pron: Option<Pron> = parts.map(ipa).collect();
            if let Some(pron) = pron.filter(|p| !p.is_empty()) {
                map.entry(word).or_default().push(pron);
            }
        }
        map
    })
}

/// 一个 ARPAbet 音（带重音数字）→ IPA 字符串
pub fn ipa(phone: &str) -> Option<String> {
    let base: String = phone.chars().filter(|c| c.is_ascii_alphabetic()).collect();
    let stress: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    let s = match base.as_str() {
        "AH" if stress == "0" || stress.is_empty() => "ə",
        "ER" if stress == "0" => "ɹ",
        "ER" => "ɜɹ",
        "AA" => "ɑ",
        "AE" => "æ",
        "AH" => "ʌ",
        "AO" => "ɔ",
        "AW" => "aʊ",
        "AY" => "aɪ",
        "B" => "b",
        "CH" => "tʃ",
        "D" => "d",
        "DH" => "ð",
        "EH" => "ɛ",
        "EY" => "eɪ",
        "F" => "f",
        // 模型的字表里是 ASCII 的 g，不是 IPA 的 ɡ
        "G" => "g",
        "HH" => "h",
        "IH" => "ɪ",
        "IY" => "i",
        "JH" => "dʒ",
        "K" => "k",
        "L" => "l",
        "M" => "m",
        "N" => "n",
        "NG" => "ŋ",
        "OW" => "oʊ",
        "OY" => "ɔɪ",
        "P" => "p",
        "R" => "ɹ",
        "S" => "s",
        "SH" => "ʃ",
        "T" => "t",
        "TH" => "θ",
        "UH" => "ʊ",
        "UW" => "u",
        "V" => "v",
        "W" => "w",
        "Y" => "j",
        "Z" => "z",
        "ZH" => "ʒ",
        _ => return None,
    };
    Some(s.to_string())
}

/// 一个词的全部读法（小写、去掉首尾标点）；词典里没有返回 None
pub fn lookup(word: &str) -> Option<&'static [Pron]> {
    let key = word
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '\'')
        .to_lowercase()
        .replace('’', "'");
    entries().get(&key).map(Vec::as_slice)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_up_words_with_all_variants() {
        let three = lookup("Three").unwrap();
        assert_eq!(three[0], ["θ", "ɹ", "i"]);
        // read 有 /ɹid/ 与 /ɹɛd/ 两种读法
        assert!(lookup("read").unwrap().len() >= 2);
        assert_eq!(
            lookup("elephant,").unwrap()[0].first().map(String::as_str),
            Some("ɛ")
        );
        assert!(lookup("zzzqx").is_none());
    }

    #[test]
    fn arpabet_maps_to_model_symbols() {
        assert_eq!(ipa("AH0").as_deref(), Some("ə"));
        assert_eq!(ipa("AH1").as_deref(), Some("ʌ"));
        assert_eq!(ipa("ER0").as_deref(), Some("ɹ"));
        assert_eq!(ipa("ER1").as_deref(), Some("ɜɹ"));
        assert_eq!(ipa("G").as_deref(), Some("g"));
        assert_eq!(ipa("XX"), None);
    }
}
