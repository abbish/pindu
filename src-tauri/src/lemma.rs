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
}
