//! 短文的词索引与词的出现位置：词汇本里存原形，素材里出现的是各种形式。
//! 词形由词形库判断（[`crate::lemma`]：WordNet 词典 + morphy，D47）——索引里每个词同时存它可能的原形
//! （went 也存 go、children 也存 child），按原形一次查到；词组按标注的写法或连着出现核对。

/// 规范化：小写、去首尾空白与撇号
pub fn normalize(word: &str) -> String {
    word.trim()
        .trim_matches(|c: char| c == '\'' || c == '’')
        .to_lowercase()
}

/// 句子 → 小写词（字母、连字符与词内撇号）
pub fn tokens(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !(c.is_alphabetic() || c == '\'' || c == '’' || c == '-'))
        .map(normalize)
        .filter(|t| !t.is_empty())
}

/// 去掉所有格 's（Tom's → tom）
fn bare(token: &str) -> &str {
    token
        .strip_suffix("'s")
        .or_else(|| token.strip_suffix("’s"))
        .unwrap_or(token)
}

/// 文本里是否用到这个词：单词按词形库认各种形式；词组按标注的写法（`forms`）或连着出现
pub fn occurs(word: &str, forms: &[String], text: &str) -> bool {
    let word = normalize(word);
    if word.contains(' ') {
        return crate::services::passage_rules::text_uses_forms(text, &word, forms);
    }
    tokens(text).any(|t| crate::lemma::is_form_of(bare(&t), &word))
}

/// 一篇短文的词索引（passage_words 的行）：正文里每个词与它可能的原形第一次出现的句子；
/// 目标词（原形或词组）标 key，正文里找不到的目标词句子为 -1。词都是 `normalize` 后的小写。
pub fn index_entries(
    sentences: &[crate::types::passage::PassageSentence],
    targets: &[crate::types::passage::PassageTargetWord],
) -> Vec<(String, i64, bool)> {
    let mut entries: Vec<(String, i64, bool)> = Vec::new();
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (i, s) in sentences.iter().enumerate() {
        for t in tokens(&s.en) {
            for w in crate::lemma::lemmas(bare(&t)) {
                if !seen.contains_key(&w) {
                    seen.insert(w.clone(), entries.len());
                    entries.push((w, i as i64, false));
                }
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
        let sentence = sentences
            .iter()
            .position(|s| occurs(&word, &target.forms, &s.en))
            .map_or(-1, |i| i as i64);
        seen.insert(word.clone(), entries.len());
        entries.push((word, sentence, true));
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_stores_base_forms_once_and_marks_targets() {
        use crate::types::passage::{PassageSentence, PassageTargetWord};
        let sentence = |en: &str| PassageSentence {
            en: en.into(),
            ..Default::default()
        };
        let target = |w: &str, forms: &[&str]| PassageTargetWord {
            word_id: None,
            word: w.into(),
            required: false,
            meaning: None,
            forms: forms.iter().map(|f| f.to_string()).collect(),
        };
        let e = index_entries(
            &[
                sentence("I ordered tea."),
                sentence("Tom's tea, ordered again. The children went home."),
                sentence("She picked it up."),
            ],
            &[
                target("order", &[]),
                target("tea", &[]),
                target("ice cream", &[]),
                target("pick up", &["picked it up"]),
            ],
        );
        let get = |w: &str| e.iter().find(|x| x.0 == w).cloned();
        assert_eq!(get("ordered"), Some(("ordered".into(), 0, false)));
        // 原形也在索引里：按原形一次查到
        assert_eq!(get("order"), Some(("order".into(), 0, true)));
        assert_eq!(get("go"), Some(("go".into(), 1, false)));
        assert_eq!(get("child"), Some(("child".into(), 1, false)));
        assert_eq!(get("tea"), Some(("tea".into(), 0, true)));
        assert_eq!(get("tom"), Some(("tom".into(), 1, false)));
        assert_eq!(get("ice cream"), Some(("ice cream".into(), -1, true)));
        assert_eq!(get("pick up"), Some(("pick up".into(), 2, true)));
        assert_eq!(e.iter().filter(|x| x.0 == "tea").count(), 1);
    }

    #[test]
    fn occurrence_in_sentences() {
        assert!(occurs("order", &[], "Are you ready to order?"));
        assert!(occurs("order", &[], "She ordered a coffee."));
        assert!(occurs("go", &[], "They went home."));
        assert!(!occurs(
            "order",
            &[],
            "Put them in alphabetical orders-of-magnitude"
        ));
        assert!(occurs("ice cream", &[], "I love Ice Cream."));
        assert!(occurs("tom", &[], "That's Tom's car."));
        assert!(!occurs("car", &[], "Careful!"));
        assert!(!occurs("pick up", &[], "She picked it up."));
        assert!(occurs(
            "pick up",
            &["picked it up".into()],
            "She picked it up."
        ));
    }
}
