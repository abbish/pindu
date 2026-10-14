//! 单词卡：短文目标词里没有收进词汇本的词，也有完整的学习资料（音标、词性、释义、音节与拼读、例句），
//! 学短文时不必先建词汇本。按小写单词存一份（word_cards，063），由批量拼读分析生成（与词汇本加词同一个 AI 任务）；
//! 读原文时选中的词可以加成目标词，随后补生成它的单词卡。

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::passage_repository::PassageRepository;
use crate::repositories::word_card_repository::WordCardRepository;
use crate::services::passage_rules;
use crate::types::material::WordCard;
use crate::types::passage::{Passage, PassageTargetWord, TargetWordPick};
use crate::types::word_analysis::PhonicsWord;
use crate::types::Id;
use sqlx::SqlitePool;
use std::sync::Arc;

pub struct WordCardService {
    pool: Arc<SqlitePool>,
    #[allow(dead_code)]
    logger: Arc<Logger>,
}

/// 拼读分析结果 → 单词卡
pub fn card_from_phonics(p: &PhonicsWord) -> WordCard {
    WordCard {
        word: p.word.trim().to_string(),
        meaning: p.chinese_translation.trim().to_string(),
        pos_abbreviation: p.pos_abbreviation.trim().to_string(),
        pos_chinese: p.pos_chinese.trim().to_string(),
        ipa: p.ipa.trim().to_string(),
        syllables: p.syllables.trim().to_string(),
        phonics_rule: p.phonics_rule.trim().to_string(),
        analysis_explanation: p.analysis_explanation.trim().to_string(),
        examples: p.examples.clone(),
        kind: crate::types::wordbook::vocab_kind(&p.word).to_string(),
        phrase_type: p.phrase_type.clone(),
        separable: p.separable,
    }
}

/// 专有名词（正文里每次出现都大写，且至少一次不在句首）按正文的写法保留大写
fn proper_noun_form(passage: &Passage, word: &str) -> Option<String> {
    let mut found: Option<String> = None;
    let mut mid_sentence = false;
    for s in &passage.sentences {
        for (i, token) in
            s.en.split(|c: char| !c.is_ascii_alphabetic())
                .filter(|t| !t.is_empty())
                .enumerate()
        {
            if !token.eq_ignore_ascii_case(word) {
                continue;
            }
            if !token.chars().next().is_some_and(|c| c.is_uppercase()) {
                return None;
            }
            mid_sentence |= i > 0;
            found = Some(token.to_string());
        }
    }
    found.filter(|_| mid_sentence)
}

/// 同一个目标词：同一个词（含变形，双向：birds 与 bird）或同一个词组（gave up 与 give up）
fn same_target(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
        || (passage_rules::is_phrase(a) == passage_rules::is_phrase(b)
            && (passage_rules::text_uses(a, b) || passage_rules::text_uses(b, a)))
}

/// 选中的文字是不是可以加成目标词的英文单词或词组（2–6 个词）
pub fn valid_selection(word: &str) -> bool {
    passage_rules::valid_vocab(word)
}

impl WordCardService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    async fn passage(&self, passage_id: Id) -> AppResult<Passage> {
        PassageRepository::new(self.pool.clone())
            .find(passage_id)
            .await?
            .ok_or_else(|| AppError::NotFound("短文不存在，可能已被删除".to_string()))
    }

    /// 短文里不在词汇本的目标词
    fn unrecorded(passage: &Passage) -> Vec<String> {
        passage
            .target_words
            .iter()
            .filter(|t| t.word_id.is_none())
            .map(|t| t.word.clone())
            .collect()
    }

    /// 短文里不在词汇本的目标词已有的单词卡
    pub async fn passage_cards(&self, passage_id: Id) -> AppResult<Vec<WordCard>> {
        let passage = self.passage(passage_id).await?;
        let words = Self::unrecorded(&passage);
        let mut cards = WordCardRepository::new(self.pool.clone())
            .find_many(&words)
            .await?;
        Ok(words
            .iter()
            .filter_map(|w| cards.remove(&w.to_lowercase()))
            .collect())
    }

    /// 还没有单词卡的未收录目标词，以及它们在这篇短文里的释义（有就沿用）
    pub async fn missing(&self, passage_id: Id) -> AppResult<(Passage, Vec<PassageTargetWord>)> {
        let passage = self.passage(passage_id).await?;
        let words = Self::unrecorded(&passage);
        let cards = WordCardRepository::new(self.pool.clone())
            .find_many(&words)
            .await?;
        let missing = passage
            .target_words
            .iter()
            .filter(|t| t.word_id.is_none() && !cards.contains_key(&t.word.to_lowercase()))
            .cloned()
            .collect();
        Ok((passage, missing))
    }

    /// 读原文时把一个词加成目标词（指定单词）：必须是英文单词、正文里出现过（含变形）、还不是目标词；
    /// 词汇本里有的关联 wordId。`form`：词组在原文里的写法（句子分析里给出的，如 picked it up）；
    /// 不传时选中的文字本身就是写法。返回更新后的短文
    pub async fn add_target_word(
        &self,
        passage_id: Id,
        word: &str,
        form: Option<&str>,
    ) -> AppResult<Passage> {
        let mut passage = self.passage(passage_id).await?;
        let forms: Vec<String> = form.map(|f| vec![f.to_string()]).unwrap_or_default();
        let target = self.resolve_target(&passage, word, &forms).await?;
        if passage
            .target_words
            .iter()
            .any(|t| same_target(&t.word, &target.word))
        {
            return Err(AppError::ValidationError(format!(
                "「{}」已经在词汇里",
                word.trim()
            )));
        }
        passage.target_words.push(target);
        PassageRepository::new(self.pool.clone())
            .update_target_words(passage_id, &passage.target_words)
            .await?;
        self.passage(passage_id).await
    }

    /// 移除一个目标词（按单词，不区分大小写）；返回更新后的短文
    pub async fn remove_target_word(&self, passage_id: Id, word: &str) -> AppResult<Passage> {
        let mut passage = self.passage(passage_id).await?;
        let before = passage.target_words.len();
        passage
            .target_words
            .retain(|t| !t.word.eq_ignore_ascii_case(word.trim()));
        if passage.target_words.len() == before {
            return Err(AppError::NotFound(format!(
                "「{}」已经不在词汇里",
                word.trim()
            )));
        }
        PassageRepository::new(self.pool.clone())
            .update_target_words(passage_id, &passage.target_words)
            .await?;
        self.passage(passage_id).await
    }

    /// 整体换成这组目标词（重新挑选后确认的）：原来就有的词保留原来的标记（指定单词 / 写法 / wordId），
    /// 新词按读原文加词的同一套规则核对；重复的只留一个。返回更新后的短文
    pub async fn replace_target_words(
        &self,
        passage_id: Id,
        picks: &[TargetWordPick],
    ) -> AppResult<Passage> {
        let passage = self.passage(passage_id).await?;
        let mut out: Vec<PassageTargetWord> = Vec::new();
        for pick in picks {
            let target = match passage
                .target_words
                .iter()
                .find(|t| t.word.eq_ignore_ascii_case(pick.word.trim()))
            {
                Some(existing) => existing.clone(),
                None => {
                    let mut t = self
                        .resolve_target(&passage, &pick.word, &pick.forms)
                        .await?;
                    t.required = false;
                    t.meaning = pick
                        .meaning
                        .as_deref()
                        .map(str::trim)
                        .filter(|m| !m.is_empty())
                        .map(str::to_string);
                    t
                }
            };
            if !out.iter().any(|t| same_target(&t.word, &target.word)) {
                out.push(target);
            }
        }
        PassageRepository::new(self.pool.clone())
            .update_target_words(passage_id, &out)
            .await?;
        self.passage(passage_id).await
    }

    /// 一个词作为这篇短文的目标词：英文单词或词组、正文里出现过（含变形）；变形按原形存（词汇本或单词卡里有原形时），
    /// 词汇本里有的关联 wordId。`forms`：词组在原文里的写法（核对后才用）
    async fn resolve_target(
        &self,
        passage: &Passage,
        word: &str,
        forms: &[String],
    ) -> AppResult<PassageTargetWord> {
        let normalized = crate::types::wordbook::normalize_vocab(
            word.trim_matches(|c: char| !c.is_ascii_alphabetic()),
        );
        let word = normalized.as_str();
        if !valid_selection(word) {
            return Err(AppError::ValidationError("请选中一个英文单词或词组".into()));
        }
        let text = passage
            .sentences
            .iter()
            .map(|s| s.en.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        // 词组的写法：给了就核对（和词组对得上、原样在文中），没给就是选中的文字本身
        let forms: Vec<String> = if passage_rules::is_phrase(word) {
            if forms.is_empty() {
                vec![word.to_string()]
            } else {
                let uses: Vec<serde_json::Value> = forms
                    .iter()
                    .map(|f| serde_json::json!({ "phrase": word, "text": f }))
                    .collect();
                passage_rules::annotated_forms(&uses, &text, word)
            }
        } else {
            Vec::new()
        };
        if !passage_rules::text_uses_forms(&text, word, &forms) {
            return Err(AppError::ValidationError(format!(
                "「{word}」不在这篇短文里"
            )));
        }
        // 选中的是变形（fossils、studied、gave up 里的 gave）时，词汇本或单词卡里有原形就按原形加入
        let repository = PassageRepository::new(self.pool.clone());
        let mut stored = proper_noun_form(passage, word).unwrap_or_else(|| word.to_lowercase());
        let mut known = repository
            .word_ids_by_text(std::slice::from_ref(&stored))
            .await?;
        if !known.contains_key(&stored.to_lowercase()) && !passage_rules::is_phrase(&stored) {
            let bases = passage_rules::base_candidates(&stored);
            if !bases.is_empty() {
                let found = repository.word_ids_by_text(&bases).await?;
                let carded = WordCardRepository::new(self.pool.clone())
                    .find_many(&bases)
                    .await?;
                if let Some(base) = bases
                    .iter()
                    .find(|b| found.contains_key(*b) || carded.contains_key(*b))
                {
                    stored = base.clone();
                    known = found;
                }
            }
        }
        Ok(PassageTargetWord {
            word_id: known.get(&stored.to_lowercase()).copied(),
            word: stored,
            required: true,
            meaning: None,
            forms,
        })
    }

    /// AI 没能分析的词：存一张只有单词与释义（有的话）的卡片，标记为已处理
    pub async fn save_basic(
        &self,
        words: &[String],
        meanings: &std::collections::HashMap<String, String>,
    ) -> AppResult<usize> {
        let repository = WordCardRepository::new(self.pool.clone());
        for w in words {
            repository
                .upsert(&WordCard {
                    word: w.trim().to_string(),
                    meaning: meanings.get(&w.to_lowercase()).cloned().unwrap_or_default(),
                    kind: crate::types::wordbook::vocab_kind(w).to_string(),
                    ..Default::default()
                })
                .await?;
        }
        Ok(words.len())
    }

    /// 几篇短文里还没有单词卡的未收录目标词（去重），以及它们在短文里的释义（有就沿用）；已删除的短文跳过
    pub async fn missing_for(
        &self,
        passage_ids: &[Id],
    ) -> AppResult<(Vec<String>, std::collections::HashMap<String, String>)> {
        let repository = PassageRepository::new(self.pool.clone());
        let mut words: Vec<String> = Vec::new();
        let mut meanings = std::collections::HashMap::new();
        let mut seen = std::collections::HashSet::new();
        for id in passage_ids {
            let Some(passage) = repository.find(*id).await? else {
                continue;
            };
            for t in passage.target_words.iter().filter(|t| t.word_id.is_none()) {
                let key = t.word.trim().to_lowercase();
                if key.is_empty() || !seen.insert(key.clone()) {
                    continue;
                }
                if let Some(m) = t
                    .meaning
                    .as_ref()
                    .map(|m| m.trim())
                    .filter(|m| !m.is_empty())
                {
                    meanings.insert(key, m.to_string());
                }
                words.push(t.word.clone());
            }
        }
        let cards = WordCardRepository::new(self.pool.clone())
            .find_many(&words)
            .await?;
        words.retain(|w| !cards.contains_key(&w.trim().to_lowercase()));
        Ok((words, meanings))
    }

    /// 分批做拼读分析并存成单词卡（打开短文时补生成、视频切分时一并生成共用）。
    /// AI 没给出分析的词存一张只有释义的卡片（不然每次打开都会再提交一次）；取消时停在当前批之后。
    /// 返回存下的张数；一张都没存成且没取消时返回最后一次的错误
    pub async fn generate(
        &self,
        analyzer: &crate::services::phonics_analysis::PhonicsBatchAnalyzer,
        words: &[String],
        meanings: &std::collections::HashMap<String, String>,
        batch_size: usize,
        ctx: &crate::jobs::JobCtx,
        progress: impl Fn(u64, u64),
    ) -> AppResult<usize> {
        let batches: Vec<&[String]> = words.chunks(batch_size.max(1)).collect();
        let total = words.len() as u64;
        let mut done = 0u64;
        let mut saved = 0usize;
        let mut last_error = None;
        progress(0, total);
        for (i, batch) in batches.iter().enumerate() {
            if ctx.is_cancelled() {
                break;
            }
            match analyzer.analyze_batch(batch, i, batches.len()).await {
                Ok(outcome) => {
                    saved += self.save(&outcome.analyzed).await?;
                    saved += self.save_basic(&outcome.missing, meanings).await?;
                }
                Err(e) => last_error = Some(e),
            }
            done += batch.len() as u64;
            progress(done, total);
        }
        if saved == 0 && !words.is_empty() && !ctx.is_cancelled() {
            return Err(last_error.unwrap_or_else(|| {
                AppError::ExternalServiceError("没有生成单词卡，请再试一次".into())
            }));
        }
        Ok(saved)
    }

    /// 保存分析好的单词卡
    pub async fn save(&self, analyzed: &[PhonicsWord]) -> AppResult<usize> {
        let repository = WordCardRepository::new(self.pool.clone());
        for p in analyzed {
            repository.upsert(&card_from_phonics(p)).await?;
        }
        Ok(analyzed.len())
    }
}

/// 讲解 / 答疑用的单词资料：`card_word` 有值时取单词卡（不在词汇本的目标词），否则按 id 取词汇本里的词
pub async fn learning_word(
    pool: &Arc<SqlitePool>,
    logger: &Arc<Logger>,
    word_id: Id,
    card_word: Option<&str>,
) -> AppResult<crate::types::wordbook::Word> {
    if let Some(text) = card_word.map(str::trim).filter(|t| !t.is_empty()) {
        let card = WordCardRepository::new(pool.clone())
            .find_many(&[text.to_string()])
            .await?
            .remove(&text.to_lowercase())
            .ok_or_else(|| AppError::NotFound("这个词还没有单词卡".to_string()))?;
        let now = crate::time::now_utc();
        let opt = |s: &str| Some(s.to_string()).filter(|s| !s.is_empty());
        return Ok(crate::types::wordbook::Word {
            id: 0,
            word: card.word.clone(),
            meaning: card.meaning.clone(),
            description: None,
            ipa: opt(&card.ipa),
            syllables: opt(&card.syllables),
            phonics_segments: None,
            image_path: None,
            audio_path: None,
            part_of_speech: opt(&card.pos_abbreviation),
            category_id: None,
            word_book_id: None,
            pos_abbreviation: opt(&card.pos_abbreviation),
            pos_english: None,
            pos_chinese: opt(&card.pos_chinese),
            phonics_rule: opt(&card.phonics_rule),
            analysis_explanation: opt(&card.analysis_explanation),
            kind: crate::types::wordbook::vocab_kind(&card.word).to_string(),
            phrase_type: opt(&card.phrase_type),
            separable: card.separable,
            examples: card.examples,
            created_at: now.clone(),
            updated_at: now,
        });
    }
    crate::repositories::word_repository::WordRepository::new(pool.clone(), logger.clone())
        .find_by_id(word_id)
        .await?
        .ok_or_else(|| AppError::NotFound("单词不存在，可能已被删除".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_pool, test_logger};
    use crate::types::passage::{PassageSentence, TargetWordPick};
    use crate::types::Id;
    use sqlx::SqlitePool;

    fn phonics(word: &str) -> PhonicsWord {
        PhonicsWord {
            word: word.into(),
            frequency: 1,
            chinese_translation: "化石".into(),
            pos_abbreviation: "n.".into(),
            pos_english: "noun".into(),
            pos_chinese: "名词".into(),
            ipa: "/ˈfɒsl/".into(),
            syllables: "fos-sil".into(),
            phonics_rule: "".into(),
            analysis_explanation: "".into(),
            examples: vec![],
            phrase_type: String::new(),
            separable: false,
        }
    }

    /// 一篇只有正文的短文（AI 写的），返回 id
    async fn seed(pool: &Arc<SqlitePool>, en: &str) -> Id {
        let mut tx = pool.begin().await.unwrap();
        let id = PassageRepository::insert_passage_conn(
            &mut tx,
            &crate::repositories::passage_repository::NewPassage {
                origin: "generated",
                source_label: None,
                scene: None,
                level: "a2",
                sources: &[],
                model_name: None,
                prompt_fingerprint: None,
            },
            &passage_rules::GeneratedPassage {
                title: "Water".into(),
                sentences: vec![PassageSentence {
                    en: en.into(),
                    zh: "译文".into(),
                    paragraph: true,
                    start_ms: None,
                    end_ms: None,
                }],
                target_words: vec![],
                word_count: 12,
                tags: vec![],
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        id
    }

    fn pick(word: &str, forms: &[&str], meaning: &str) -> TargetWordPick {
        TargetWordPick {
            word: word.into(),
            forms: forms.iter().map(|f| f.to_string()).collect(),
            meaning: Some(meaning.into()),
        }
    }

    /// 重新挑选后整体替换：原有的保留标记，新词按原文核对、带上释义，重复的只留一个；不在原文的整体拒绝
    #[tokio::test]
    async fn replace_keeps_existing_marks_and_checks_new_words() {
        let pool = memory_pool().await;
        let id = seed(
            &pool,
            "The new policy failed, so the team gave it up and made a plan.",
        )
        .await;
        let service = WordCardService::new(pool.clone(), test_logger());
        service.add_target_word(id, "plan", None).await.unwrap();
        let passage = service
            .replace_target_words(
                id,
                &[
                    pick("plan", &[], "计划"),
                    pick("policy", &[], "政策"),
                    pick("give up", &["gave it up"], "放弃"),
                    pick("Policy", &[], "重复"),
                ],
            )
            .await
            .unwrap();
        let words: Vec<(&str, bool, Option<&str>)> = passage
            .target_words
            .iter()
            .map(|t| (t.word.as_str(), t.required, t.meaning.as_deref()))
            .collect();
        assert_eq!(
            words,
            [
                ("plan", true, None),
                ("policy", false, Some("政策")),
                ("give up", false, Some("放弃"))
            ]
        );
        assert_eq!(
            passage.target_words[2].forms,
            vec!["gave it up".to_string()]
        );
        // 原文里没有的词：整次替换失败，原来的目标词不变
        assert!(service
            .replace_target_words(id, &[pick("airport", &[], "机场")])
            .await
            .is_err());
        assert_eq!(service.passage(id).await.unwrap().target_words.len(), 3);
        // 移除一个；已经不是目标词的再移除报错
        let passage = service.remove_target_word(id, "Policy").await.unwrap();
        assert_eq!(
            passage
                .target_words
                .iter()
                .map(|t| t.word.as_str())
                .collect::<Vec<_>>(),
            ["plan", "give up"]
        );
        assert!(service.remove_target_word(id, "policy").await.is_err());
    }

    /// 几篇短文一起找缺卡片的词：去重（不分大小写）、带上释义、已有卡片的与已删除的短文跳过
    #[tokio::test]
    async fn missing_for_dedupes_across_passages_and_skips_existing_cards() {
        let pool = memory_pool().await;
        let service = WordCardService::new(pool.clone(), test_logger());
        let a = seed(&pool, "The salmon swim upstream past the old dam.").await;
        let b = seed(&pool, "Salmon return to the river every fall.").await;
        service
            .replace_target_words(a, &[pick("salmon", &[], "鲑鱼"), pick("dam", &[], "水坝")])
            .await
            .unwrap();
        service
            .replace_target_words(
                b,
                &[pick("Salmon", &[], "三文鱼"), pick("river", &[], "河")],
            )
            .await
            .unwrap();
        service.save(&[phonics("river")]).await.unwrap();
        let (words, meanings) = service.missing_for(&[a, b, 9999]).await.unwrap();
        assert_eq!(words, ["salmon", "dam"]);
        assert_eq!(meanings.get("salmon").map(String::as_str), Some("鲑鱼"));
        assert_eq!(meanings.get("dam").map(String::as_str), Some("水坝"));
    }

    #[tokio::test]
    async fn selection_becomes_target_word_and_cards_are_found() {
        let pool = memory_pool().await;
        let mut tx = pool.begin().await.unwrap();
        let id = PassageRepository::insert_passage_conn(
            &mut tx,
            &crate::repositories::passage_repository::NewPassage {
                origin: "generated",
                source_label: None,
                scene: None,
                level: "a2",
                sources: &[],
                model_name: None,
                prompt_fingerprint: None,
            },
            &passage_rules::GeneratedPassage {
                title: "Fossils".into(),
                sentences: vec![PassageSentence {
                    en: "Scientists study fossils of Tyrannosaurus.".into(),
                    zh: "科学家研究霸王龙的化石。".into(),
                    paragraph: true,
                    start_ms: None,
                    end_ms: None,
                }],
                target_words: vec![],
                word_count: 5,
                tags: vec![],
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let service = WordCardService::new(pool.clone(), test_logger());
        assert!(service
            .add_target_word(id, "two words", None)
            .await
            .is_err());
        assert!(service.add_target_word(id, "volcano", None).await.is_err());
        let passage = service
            .add_target_word(id, " fossils, ", None)
            .await
            .unwrap();
        let added = passage.target_words.last().unwrap();
        assert_eq!(added.word, "fossils");
        assert!(added.required && added.word_id.is_none());
        assert!(service.add_target_word(id, "Fossils", None).await.is_err());
        // 专有名词保留大写
        let passage = service
            .add_target_word(id, "tyrannosaurus", None)
            .await
            .unwrap();
        assert_eq!(passage.target_words.last().unwrap().word, "Tyrannosaurus");

        let (_, missing) = service.missing(id).await.unwrap();
        assert_eq!(missing.len(), 2);
        service.save(&[phonics("Fossils")]).await.unwrap();
        let cards = service.passage_cards(id).await.unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].ipa, "/ˈfɒsl/");
        let (_, missing) = service.missing(id).await.unwrap();
        assert_eq!(
            missing.iter().map(|t| t.word.as_str()).collect::<Vec<_>>(),
            vec!["Tyrannosaurus"]
        );
        // 词组：正文里出现（可变形）就能加，与单词不互相判重
        let passage = service
            .add_target_word(id, "study  fossil", None)
            .await
            .unwrap();
        assert_eq!(passage.target_words.last().unwrap().word, "study fossil");
        assert!(service
            .add_target_word(id, "study fossil", None)
            .await
            .is_err());
    }
}
