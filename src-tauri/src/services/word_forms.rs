//! 英文词形：从原形生成常见屈折形式（复数 / 第三人称、过去式 / 过去分词、-ing），并把句子切成小写词。
//! 词汇本里存的是原形，素材里出现的是各种形式；用「原形 → 形式集合」去匹配，比把文本里的词还原成原形更可靠。

use std::collections::HashSet;

fn is_vowel(c: char) -> bool {
    matches!(c, 'a' | 'e' | 'i' | 'o' | 'u')
}

/// 规范化：小写、去首尾空白与撇号
pub fn normalize(word: &str) -> String {
    word.trim()
        .trim_matches(|c: char| c == '\'' || c == '’')
        .to_lowercase()
}

/// 原形的常见形式（含原形本身）；短语（含空格）只返回自身
pub fn forms(word: &str) -> HashSet<String> {
    let w = normalize(word);
    let mut out = HashSet::new();
    if w.is_empty() {
        return out;
    }
    out.insert(w.clone());
    if w.contains(' ') || !w.chars().all(|c| c.is_ascii_alphabetic() || c == '-') {
        return out;
    }
    let chars: Vec<char> = w.chars().collect();
    let n = chars.len();
    let last = chars[n - 1];
    let prev = if n >= 2 { Some(chars[n - 2]) } else { None };
    let stem_no_last: String = chars[..n - 1].iter().collect();

    // 复数 / 第三人称
    if last == 'y' && prev.is_some_and(|p| !is_vowel(p)) {
        out.insert(format!("{stem_no_last}ies"));
    } else if w.ends_with('s')
        || w.ends_with('x')
        || w.ends_with('z')
        || w.ends_with("ch")
        || w.ends_with("sh")
        || (last == 'o' && prev.is_some_and(|p| !is_vowel(p)))
    {
        out.insert(format!("{w}es"));
    }
    out.insert(format!("{w}s"));

    // 过去式 / -ing
    if last == 'e' {
        out.insert(format!("{w}d"));
        if !w.ends_with("ee") && !w.ends_with("ye") && !w.ends_with("oe") {
            out.insert(format!("{stem_no_last}ing"));
        }
        out.insert(format!("{w}ing"));
    } else if last == 'y' && prev.is_some_and(|p| !is_vowel(p)) {
        out.insert(format!("{stem_no_last}ied"));
        out.insert(format!("{w}ing"));
    } else {
        out.insert(format!("{w}ed"));
        out.insert(format!("{w}ing"));
        // 辅音 + 元音 + 辅音结尾的短词双写（stop → stopped / stopping）
        let cvc = n >= 3
            && !is_vowel(last)
            && !matches!(last, 'w' | 'x' | 'y')
            && prev.is_some_and(is_vowel)
            && !is_vowel(chars[n - 3]);
        if cvc && n <= 5 {
            out.insert(format!("{w}{last}ed"));
            out.insert(format!("{w}{last}ing"));
        }
    }
    if w.ends_with("ie") {
        out.insert(format!("{}ying", &w[..w.len() - 2]));
    }
    out
}

/// 句子 → 小写词（字母、连字符与词内撇号）
pub fn tokens(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !(c.is_alphabetic() || c == '\'' || c == '’' || c == '-'))
        .map(normalize)
        .filter(|t| !t.is_empty())
}

/// 文本里是否出现这个词的某个形式；词组按 passage_rules::text_uses 匹配（每个词可变形、可拆开、占位词）
pub fn occurs(forms: &HashSet<String>, text: &str) -> bool {
    if forms.iter().any(|f| f.contains(' ')) {
        return forms
            .iter()
            .any(|f| crate::services::passage_rules::text_uses(text, f));
    }
    tokens(text)
        .any(|t| forms.contains(&t) || t.strip_suffix("'s").is_some_and(|b| forms.contains(b)))
}

/// 一篇短文的词索引（passage_words 的行）：正文里每个词形第一次出现的句子；目标词（原形或短语）标 key，
/// 正文里没出现的目标词句子为 -1。词形都是 `normalize` 后的小写。
pub fn index_entries(
    sentences: &[crate::types::passage::PassageSentence],
    targets: &[crate::types::passage::PassageTargetWord],
) -> Vec<(String, i64, bool)> {
    let mut entries: Vec<(String, i64, bool)> = Vec::new();
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (i, s) in sentences.iter().enumerate() {
        for t in tokens(&s.en) {
            let t = t.strip_suffix("'s").map(str::to_string).unwrap_or(t);
            if !seen.contains_key(&t) {
                seen.insert(t.clone(), entries.len());
                entries.push((t, i as i64, false));
            }
        }
    }
    for target in targets {
        let word = normalize(&target.word);
        if word.is_empty() {
            continue;
        }
        if let Some(&k) = seen.get(&word) {
            entries[k].2 = true;
            continue;
        }
        let f = forms(&word);
        let sentence = sentences
            .iter()
            .position(|s| occurs(&f, &s.en))
            .map_or(-1, |i| i as i64);
        seen.insert(word.clone(), entries.len());
        entries.push((word, sentence, true));
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has(word: &str, form: &str) -> bool {
        forms(word).contains(form)
    }

    #[test]
    fn common_inflections() {
        assert!(has("book", "books") && has("book", "booked") && has("book", "booking"));
        assert!(has("study", "studies") && has("study", "studied") && has("study", "studying"));
        assert!(has("play", "plays") && has("play", "played"));
        assert!(has("make", "making") && has("make", "makes"));
        assert!(has("watch", "watches") && has("go", "goes"));
        assert!(has("stop", "stopped") && has("stop", "stopping"));
        assert!(has("lie", "lying"));
        assert!(has("Apple", "apple"));
        assert_eq!(forms("ice cream").len(), 1);
    }

    #[test]
    fn index_has_each_form_once_and_marks_targets() {
        use crate::types::passage::{PassageSentence, PassageTargetWord};
        let sentence = |en: &str| PassageSentence {
            en: en.into(),
            ..Default::default()
        };
        let target = |w: &str| PassageTargetWord {
            word_id: None,
            word: w.into(),
            required: false,
            meaning: None,
        };
        let e = index_entries(
            &[
                sentence("I ordered tea."),
                sentence("Tom's tea, ordered again."),
            ],
            &[target("order"), target("tea"), target("ice cream")],
        );
        let get = |w: &str| e.iter().find(|x| x.0 == w).cloned();
        assert_eq!(get("ordered"), Some(("ordered".into(), 0, false)));
        assert_eq!(get("tea"), Some(("tea".into(), 0, true)));
        assert_eq!(get("tom"), Some(("tom".into(), 1, false)));
        assert_eq!(get("order"), Some(("order".into(), 0, true)));
        assert_eq!(get("ice cream"), Some(("ice cream".into(), -1, true)));
        assert_eq!(e.iter().filter(|x| x.0 == "tea").count(), 1);
    }

    #[test]
    fn occurrence_in_sentences() {
        let f = forms("order");
        assert!(occurs(&f, "Are you ready to order?"));
        assert!(occurs(&f, "She ordered a coffee."));
        assert!(!occurs(&f, "Put them in alphabetical orders-of-magnitude"));
        assert!(occurs(&forms("ice cream"), "I love Ice Cream."));
        assert!(occurs(&forms("tom"), "That's Tom's car."));
        assert!(!occurs(&forms("car"), "Careful!"));
    }
}
