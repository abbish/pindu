//! 单词 ↔ 素材：某个词出现在哪些短文 / 视频切片里（重点词，或正文里出现过）。
//! 用词索引 passage_words 缩小到命中的那几篇，再读这几篇逐句定位（数据再多也只读命中的，不会越用越慢）。

use crate::error::AppResult;
use crate::repositories::passage_repository::{PassageRepository, PassageText};
use crate::repositories::passage_word_repository::PassageWordRepository;
use crate::repositories::video_repository::{ClipRow, VideoRepository};
use crate::services::video::UrlOf;
use crate::services::word_forms;
use crate::types::material::{ClipBrief, WordMaterial, WordMaterialCount};
use crate::types::Id;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

/// 一篇短文里这个词的位置：是否重点词、第一处出现的句子下标
fn locate(
    forms: &HashSet<String>,
    word_id: Option<Id>,
    text: &PassageText,
) -> Option<(bool, Option<usize>)> {
    let key = text.target_words.iter().any(|t| {
        (word_id.is_some() && t.word_id == word_id)
            || forms.contains(&word_forms::normalize(&t.word))
    });
    let sentence = text
        .sentences
        .iter()
        .position(|s| word_forms::occurs(forms, &s.en));
    (key || sentence.is_some()).then_some((key, sentence))
}

/// 这个词出现过的短文：重点词在前，其余保持输入顺序（最新在前）
pub fn find(
    word: &str,
    word_id: Option<Id>,
    texts: &[PassageText],
) -> Vec<(usize, bool, Option<usize>)> {
    let forms = word_forms::forms(word);
    if forms.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<(usize, bool, Option<usize>)> = texts
        .iter()
        .enumerate()
        .filter_map(|(i, t)| locate(&forms, word_id, t).map(|(key, s)| (i, key, s)))
        .collect();
    hits.sort_by_key(|(_, key, _)| !*key);
    hits
}

/// 每个词出现过的短文数与切片数
pub fn count(words: &[(Id, String)], texts: &[PassageText]) -> Vec<WordMaterialCount> {
    words
        .iter()
        .map(|(id, word)| {
            let forms = word_forms::forms(word);
            let mut c = WordMaterialCount {
                word_id: *id,
                ..Default::default()
            };
            for t in texts {
                if locate(&forms, Some(*id), t).is_some() {
                    if t.origin == "video" {
                        c.clips += 1;
                    } else {
                        c.passages += 1;
                    }
                }
            }
            c
        })
        .collect()
}

pub struct WordMaterialsService {
    pool: Arc<SqlitePool>,
}

/// 一个词最多列出多少篇（重点词在前）
const MAX_MATERIALS: usize = 200;

impl WordMaterialsService {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    /// 可能含有这个词的短文：单词按词形查索引；短语先找含有全部组成词的短文，再逐句核对
    async fn candidates(&self, word: &str) -> AppResult<Vec<Id>> {
        let normalized = word_forms::normalize(word);
        if normalized.is_empty() {
            return Ok(Vec::new());
        }
        let forms: Vec<String> = word_forms::forms(&normalized).into_iter().collect();
        let mut ids: Vec<Id> = PassageWordRepository::hits(&self.pool, &forms)
            .await?
            .into_iter()
            .map(|h| h.passage_id)
            .collect();
        if normalized.contains(' ') {
            let tokens: Vec<String> = word_forms::tokens(&normalized).collect();
            ids.extend(PassageWordRepository::having_all(&self.pool, &tokens).await?);
            ids.sort_unstable();
            ids.dedup();
        }
        Ok(ids)
    }

    /// 一个词出现在哪些短文 / 切片里（重点词在前，其余最新在前）
    pub async fn materials(
        &self,
        word: &str,
        word_id: Option<Id>,
        data_dir: &Path,
        url: &(dyn Fn(&Path) -> Option<String> + Sync),
    ) -> AppResult<Vec<WordMaterial>> {
        PassageWordRepository::index_missing(&self.pool).await?;
        let ids = self.candidates(word).await?;
        let texts = PassageRepository::new(self.pool.clone())
            .texts_by_ids(&ids)
            .await?;
        let clips: HashMap<Id, (ClipRow, String)> =
            VideoRepository::clips_of_passages(&self.pool, &ids)
                .await?
                .into_iter()
                .map(|(c, title)| (c.passage_id, (c, title)))
                .collect();
        let mut hits = find(word, word_id, &texts);
        hits.truncate(MAX_MATERIALS);
        Ok(hits
            .into_iter()
            .map(|(i, key, sentence)| {
                let t = &texts[i];
                let s = sentence.and_then(|k| t.sentences.get(k));
                WordMaterial {
                    passage_id: t.id,
                    title: t.title.clone(),
                    origin: t.origin.clone(),
                    level: t.level.clone(),
                    key,
                    en: s.map(|s| s.en.clone()).unwrap_or_default(),
                    zh: s.map(|s| s.zh.clone()).unwrap_or_default(),
                    start_ms: s.and_then(|s| s.start_ms),
                    clip: clips
                        .get(&t.id)
                        .map(|(c, title)| clip_brief(c, title, data_dir, url)),
                }
            })
            .collect())
    }

    /// 单词本里每个词出现过的短文数与切片数：单词一次索引查询；短语（少数）逐个核对
    pub async fn counts(&self, words: &[(Id, String)]) -> AppResult<Vec<WordMaterialCount>> {
        PassageWordRepository::index_missing(&self.pool).await?;
        type Words<'a> = Vec<&'a (Id, String)>;
        let (phrases, singles): (Words, Words) = words
            .iter()
            .partition(|(_, w)| word_forms::normalize(w).contains(' '));
        let pairs: Vec<(Id, String)> = singles
            .iter()
            .flat_map(|(id, w)| word_forms::forms(w).into_iter().map(move |f| (*id, f)))
            .collect();
        let mut out: Vec<WordMaterialCount> = PassageWordRepository::counts(&self.pool, &pairs)
            .await?
            .into_iter()
            .map(|(word_id, clips, passages)| WordMaterialCount {
                word_id,
                passages,
                clips,
            })
            .collect();
        for (id, phrase) in phrases {
            let ids = self.candidates(phrase).await?;
            let texts = PassageRepository::new(self.pool.clone())
                .texts_by_ids(&ids)
                .await?;
            let c = count(&[(*id, phrase.clone())], &texts).remove(0);
            if c.clips + c.passages > 0 {
                out.push(c);
            }
        }
        Ok(out)
    }
}

/// 切片的播放信息（地址经本机媒体服务）
pub fn clip_brief(c: &ClipRow, video_title: &str, data_dir: &Path, url: UrlOf) -> ClipBrief {
    let path = |file: &str| {
        url(&crate::services::video_processing::clip_path(
            data_dir, c.video_id, file,
        ))
    };
    ClipBrief {
        video_id: c.video_id,
        video_title: video_title.to_string(),
        clip_url: path(&c.file),
        poster_url: c.poster_file.as_deref().and_then(path),
        duration_ms: c.end_ms - c.start_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::passage::{PassageSentence, PassageTargetWord};

    fn text(id: Id, origin: &str, sentences: &[&str], targets: &[&str]) -> PassageText {
        PassageText {
            id,
            title: format!("p{id}"),
            origin: origin.into(),
            level: "a2".into(),
            sentences: sentences
                .iter()
                .map(|en| PassageSentence {
                    en: en.to_string(),
                    ..Default::default()
                })
                .collect(),
            target_words: targets
                .iter()
                .map(|w| PassageTargetWord {
                    word_id: None,
                    word: w.to_string(),
                    required: false,
                    meaning: None,
                })
                .collect(),
        }
    }

    #[test]
    fn finds_key_words_first_then_occurrences() {
        let texts = vec![
            text(1, "generated", &["I ordered tea."], &[]),
            text(2, "video", &["Hi.", "Ready to order?"], &["order"]),
            text(3, "imported", &["Nothing here."], &[]),
        ];
        let hits = find("order", None, &texts);
        assert_eq!(hits, vec![(1, true, Some(1)), (0, false, Some(0))]);
        let counts = count(&[(7, "order".into())], &texts);
        assert_eq!((counts[0].passages, counts[0].clips), (1, 1));
    }

    #[test]
    fn matches_target_word_by_id() {
        let mut t = text(1, "video", &["Something else."], &["menu"]);
        t.target_words[0].word_id = Some(42);
        assert_eq!(find("Menu", Some(42), &[t.clone()]), vec![(0, true, None)]);
        assert_eq!(find("x", Some(42), &[t]), vec![(0, true, None)]);
    }

    async fn insert(pool: &SqlitePool, title: &str, sentences: &[&str], targets: &[&str]) -> Id {
        use crate::repositories::passage_repository::NewPassage;
        use crate::services::passage_rules::GeneratedPassage;
        let mut tx = pool.begin().await.unwrap();
        let id = PassageRepository::insert_passage_conn(
            &mut tx,
            &NewPassage {
                origin: "generated",
                source_label: None,
                scene: None,
                level: "a2",
                sources: &[],
                model_name: None,
                prompt_fingerprint: None,
            },
            &GeneratedPassage {
                title: title.into(),
                sentences: text(0, "", sentences, &[]).sentences,
                target_words: text(0, "", &[], targets).target_words,
                word_count: 1,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        id
    }

    #[tokio::test]
    async fn new_passages_are_indexed_and_queried_through_the_index() {
        let pool = crate::test_support::memory_pool().await;
        let a = insert(
            &pool,
            "A",
            &["She ordered ice cream.", "Thanks."],
            &["order"],
        )
        .await;
        let b = insert(&pool, "B", &["I love ice", "and cream."], &[]).await;
        let service = WordMaterialsService::new(pool.clone());
        let none = |_: &Path| None;

        let order = service
            .materials("order", None, Path::new("/"), &none)
            .await
            .unwrap();
        assert_eq!(order.len(), 1);
        assert!(
            order[0].key && order[0].passage_id == a && order[0].en == "She ordered ice cream."
        );

        // 短语：b 里两个词都有但不相连，核对后排除
        let phrase = service
            .materials("ice cream", None, Path::new("/"), &none)
            .await
            .unwrap();
        assert_eq!(
            phrase.iter().map(|m| m.passage_id).collect::<Vec<_>>(),
            vec![a]
        );

        let counts = service
            .counts(&[
                (1, "order".into()),
                (2, "ice cream".into()),
                (3, "cream".into()),
                (4, "zebra".into()),
            ])
            .await
            .unwrap();
        let get = |id: Id| {
            counts
                .iter()
                .find(|c| c.word_id == id)
                .map(|c| (c.passages, c.clips))
        };
        assert_eq!(get(1), Some((1, 0)));
        assert_eq!(get(2), Some((1, 0)));
        assert_eq!(get(3), Some((2, 0)));
        assert_eq!(get(4), None);

        // 改目标词：索引同步
        PassageRepository::new(pool.clone())
            .update_target_words(b, &text(0, "", &[], &["love"]).target_words)
            .await
            .unwrap();
        let love = service
            .materials("love", None, Path::new("/"), &none)
            .await
            .unwrap();
        assert!(love[0].key && love[0].passage_id == b);
    }

    /// 长期使用的数据量：5000 篇短文、每篇 20 句；单词本 500 个词。
    /// `cargo test --release word_materials::tests::scale -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn scale() {
        let pool = crate::test_support::memory_pool().await;
        // 纯字母的词（分词只认字母）：aab、aac …
        let letters = |mut n: usize| {
            let mut w = String::new();
            for _ in 0..4 {
                w.push((b'a' + (n % 26) as u8) as char);
                n /= 26;
            }
            w
        };
        let vocab: Vec<String> = (0..3000).map(letters).collect();
        let started = std::time::Instant::now();
        for p in 0..5000usize {
            let sentences: Vec<String> = (0..20)
                .map(|k| {
                    (0..12)
                        .map(|j| vocab[(p * 31 + k * 7 + j * 13) % vocab.len()].clone())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect();
            let refs: Vec<&str> = sentences.iter().map(String::as_str).collect();
            insert(
                &pool,
                &format!("p{p}"),
                &refs,
                &[vocab[p % vocab.len()].as_str()],
            )
            .await;
        }
        println!("写入 5000 篇（含索引）：{:?}", started.elapsed());
        let service = WordMaterialsService::new(pool.clone());
        let none = |_: &Path| None;
        let t = std::time::Instant::now();
        let hits = service
            .materials(&vocab[42], None, Path::new("/"), &none)
            .await
            .unwrap();
        println!("一个词的素材（{} 篇）：{:?}", hits.len(), t.elapsed());
        let words: Vec<(Id, String)> = (0..500).map(|i| (i as Id, vocab[i * 5].clone())).collect();
        let t = std::time::Instant::now();
        let counts = service.counts(&words).await.unwrap();
        println!(
            "单词本 500 个词的计数（{} 个有）：{:?}",
            counts.len(),
            t.elapsed()
        );
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM passage_words")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        println!("索引行数：{rows}");
    }
}
