//! 词形还原（lemmatization）：WordNet 的 morphy 算法 + WordNet 3.0 词典（`shared/lemma/wordnet.json`，
//! `scripts/lemma/build.mjs` 生成）。与前端 / sidecar 共用的 `shared/lemma/morphy.ts` 是同一算法、同一份数据，
//! 两端用 `shared/lemma/cases.json` 核对结果（D47）。
//!
//! 先查不规则变形表（went → go），再按各词性的去词尾规则还原，结果必须是词典里有的词；这个词本身已是该词性的
//! 基本词时不再去词尾（bed 不还原成 be）。词典里没有的词（人名、生僻词）只按同样的去词尾规则比较。

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

const POS: [&str; 4] = ["n", "v", "a", "r"];

/// WordNet morph.c 的去词尾规则（词尾 → 替换）
fn detach(pos: &str) -> &'static [(&'static str, &'static str)] {
    match pos {
        "n" => &[
            ("s", ""),
            ("ses", "s"),
            ("xes", "x"),
            ("zes", "z"),
            ("ches", "ch"),
            ("shes", "sh"),
            ("men", "man"),
            ("ies", "y"),
        ],
        "v" => &[
            ("s", ""),
            ("ies", "y"),
            ("es", "e"),
            ("es", ""),
            ("ed", "e"),
            ("ed", ""),
            ("ing", "e"),
            ("ing", ""),
        ],
        "a" => &[("er", ""), ("est", ""), ("er", "e"), ("est", "e")],
        _ => &[],
    }
}

struct Tables {
    index: HashMap<&'static str, HashSet<String>>,
    exceptions: HashMap<&'static str, HashMap<String, Vec<String>>>,
}

fn tables() -> &'static Tables {
    static TABLES: OnceLock<Tables> = OnceLock::new();
    TABLES.get_or_init(|| {
        let raw: serde_json::Value =
            serde_json::from_str(include_str!("../../shared/lemma/wordnet.json"))
                .expect("shared/lemma/wordnet.json 格式错误");
        let mut index = HashMap::new();
        let mut exceptions = HashMap::new();
        for p in POS {
            let words = raw["index"][p].as_str().unwrap_or_default();
            index.insert(p, words.split(' ').map(str::to_string).collect());
            let exc = raw["exceptions"][p].as_str().unwrap_or_default();
            exceptions.insert(
                p,
                exc.lines()
                    .filter_map(|line| {
                        let mut parts = line.split(' ');
                        let form = parts.next()?.to_string();
                        Some((form, parts.map(str::to_string).collect()))
                    })
                    .collect(),
            );
        }
        Tables { index, exceptions }
    })
}

fn normalize(word: &str) -> String {
    word.trim()
        .replace(['\u{2019}', '\u{2018}'], "'")
        .to_lowercase()
}

/// 一个词可能的原形（各词性合并，含它自己，小写）
pub fn lemmas(word: &str) -> Vec<String> {
    let w = normalize(word);
    if w.is_empty() {
        return Vec::new();
    }
    let t = tables();
    let mut out = vec![w.clone()];
    let mut push = |l: String| {
        if !out.contains(&l) {
            out.push(l);
        }
    };
    for p in POS {
        for l in t.exceptions[p].get(&w).into_iter().flatten() {
            push(l.clone());
        }
        if t.index[p].contains(&w) {
            continue;
        }
        for (suffix, repl) in detach(p) {
            if w.len() > suffix.len() && w.ends_with(suffix) {
                let base = format!("{}{}", &w[..w.len() - suffix.len()], repl);
                if t.index[p].contains(&base) {
                    push(base);
                }
            }
        }
    }
    out
}

/// 这个词在词典里吗（任一词性）
pub fn known(word: &str) -> bool {
    let w = normalize(word);
    POS.iter().any(|p| tables().index[p].contains(&w))
}

/// `token` 是不是 `base` 的某种形式（went 与 go、children 与 child）；base 不在词典里时按去词尾规则比较
pub fn is_form_of(token: &str, base: &str) -> bool {
    let (t, b) = (normalize(token), normalize(base));
    if t.is_empty() || b.is_empty() {
        return false;
    }
    if t == b || lemmas(&t).contains(&b) {
        return true;
    }
    if known(&b) {
        return false;
    }
    POS.iter().any(|p| {
        detach(p).iter().any(|(suffix, repl)| {
            t.len() > suffix.len()
                && t.ends_with(suffix)
                && format!("{}{}", &t[..t.len() - suffix.len()], repl) == b
        })
    })
}

// ==================== 词组位置（D47 B2，与 shared/lemma/phrase.ts 同一实现） ====================

/// 词组条目里代表「某人 / 某物」的记号（词典的书写约定），在文中对应 1–3 个词
pub const NOTATION: [&str; 4] = ["sb", "sth", "one's", "oneself"];

/// 展开成比较用的小写词（连字符词拆开），并记下每个来自原来的第几个词
fn expand(words: &[&str]) -> (Vec<String>, Vec<usize>) {
    let mut parts = Vec::new();
    let mut origin = Vec::new();
    for (i, w) in words.iter().enumerate() {
        for p in normalize(w).split('-').filter(|p| !p.is_empty()) {
            parts.push(p.to_string());
            origin.push(i);
        }
    }
    (parts, origin)
}

fn split(text: &str) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    expand(&words).0
}

/// 从 tokens[i] 起按词组各词连着匹配（每个词可变形；记号对应 1–3 个词），返回结束位置
fn match_from(tokens: &[String], i: usize, parts: &[String], k: usize) -> Option<usize> {
    if k == parts.len() {
        return Some(i);
    }
    let part = parts[k].as_str();
    if NOTATION.contains(&part) {
        return (1..=3)
            .filter(|n| i + n <= tokens.len())
            .find_map(|n| match_from(tokens, i + n, parts, k + 1));
    }
    if i < tokens.len() && is_form_of(&tokens[i], part) {
        return match_from(tokens, i + 1, parts, k + 1);
    }
    None
}

/// 标注的写法和词组对得上：写法的第一个词是词组第一个词的某种形式，词组的其余词按顺序出现在写法里
pub fn form_matches_phrase(form: &str, phrase: &str) -> bool {
    let f = split(form);
    let p: Vec<String> = split(phrase)
        .into_iter()
        .filter(|w| !NOTATION.contains(&w.as_str()))
        .collect();
    if f.is_empty() || p.is_empty() || !is_form_of(&f[0], &p[0]) {
        return false;
    }
    let mut i = 1;
    for part in &p[1..] {
        while i < f.len() && !is_form_of(&f[i], part) {
            i += 1;
        }
        if i >= f.len() {
            return false;
        }
        i += 1;
    }
    true
}

/// 词组在一串词里出现的位置（[开始, 结束)，按原来的词序号，不重叠）。
/// `forms`：标注的写法（原样在文中找，先于规则）；没有标注或没找到时按「连着出现、可变形」匹配
pub fn phrase_spans(words: &[&str], phrase: &str, forms: &[String]) -> Vec<(usize, usize)> {
    let (tokens, origin) = expand(words);
    let mut found: Vec<(usize, usize)> = Vec::new();
    let mut take = |start: usize, end: usize| {
        if !found.iter().any(|&(a, b)| start < b && a < end) {
            found.push((start, end));
        }
    };
    for form in forms {
        let f = split(form);
        if f.is_empty() || f.len() > tokens.len() {
            continue;
        }
        for i in 0..=tokens.len() - f.len() {
            if f.iter().enumerate().all(|(k, w)| tokens[i + k] == *w) {
                take(i, i + f.len());
            }
        }
    }
    let parts = split(phrase);
    if !parts.is_empty() {
        let mut i = 0;
        while i < tokens.len() {
            match match_from(&tokens, i, &parts, 0) {
                Some(end) if end > i => {
                    take(i, end);
                    i = end;
                }
                _ => i += 1,
            }
        }
    }
    found.sort();
    found
        .into_iter()
        .map(|(s, e)| (origin[s], origin[e - 1] + 1))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_cases_match_the_typescript_implementation() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../shared/lemma/cases.json")).unwrap();
        for pair in cases["forms"].as_array().unwrap() {
            let (t, b) = (pair[0].as_str().unwrap(), pair[1].as_str().unwrap());
            assert!(is_form_of(t, b), "{t} → {b}");
        }
        for pair in cases["not_forms"].as_array().unwrap() {
            let (t, b) = (pair[0].as_str().unwrap(), pair[1].as_str().unwrap());
            assert!(!is_form_of(t, b), "{t} ✗ {b}");
        }
    }

    #[test]
    fn shared_phrase_cases_match_the_typescript_implementation() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../shared/lemma/cases.json")).unwrap();
        let words = |text: &str| -> Vec<String> {
            text.split(|c: char| !c.is_ascii_alphabetic() && c != '\'' && c != '-')
                .filter(|w| !w.is_empty())
                .map(str::to_string)
                .collect()
        };
        for case in cases["phrases"].as_array().unwrap() {
            let text = case[0].as_str().unwrap();
            let phrase = case[1].as_str().unwrap();
            let forms: Vec<String> = case[2]
                .as_array()
                .unwrap()
                .iter()
                .map(|f| f.as_str().unwrap().to_string())
                .collect();
            let w = words(text);
            let refs: Vec<&str> = w.iter().map(String::as_str).collect();
            assert_eq!(
                !phrase_spans(&refs, phrase, &forms).is_empty(),
                case[3].as_bool().unwrap(),
                "{text} / {phrase} / {forms:?}"
            );
        }
        for case in cases["forms_check"].as_array().unwrap() {
            let (form, phrase) = (case[0].as_str().unwrap(), case[1].as_str().unwrap());
            assert_eq!(
                form_matches_phrase(form, phrase),
                case[2].as_bool().unwrap(),
                "{form} ~ {phrase}"
            );
        }
    }
}
