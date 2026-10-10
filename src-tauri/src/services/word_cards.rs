//! 单词卡：短文目标词里没有收进单词本的词，也有完整的学习资料（音标、词性、释义、音节与拼读、例句），
//! 学短文时不必先建单词本。按小写单词存一份（word_cards，063），由批量拼读分析生成（与单词本加词同一个 AI 任务）；
//! 读原文时选中的词可以加成目标词，随后补生成它的单词卡。

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::passage_repository::PassageRepository;
use crate::repositories::word_card_repository::WordCardRepository;
use crate::services::passage_rules;
use crate::types::material::WordCard;
use crate::types::passage::{Passage, PassageTargetWord};
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

    /// 短文里不在单词本的目标词
    fn unrecorded(passage: &Passage) -> Vec<String> {
        passage
            .target_words
            .iter()
            .filter(|t| t.word_id.is_none())
            .map(|t| t.word.clone())
            .collect()
    }

    /// 短文里不在单词本的目标词已有的单词卡
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
    /// 单词本里有的关联 wordId。返回更新后的短文
    pub async fn add_target_word(&self, passage_id: Id, word: &str) -> AppResult<Passage> {
        let normalized = crate::types::wordbook::normalize_vocab(
            word.trim_matches(|c: char| !c.is_ascii_alphabetic()),
        );
        let word = normalized.as_str();
        if !valid_selection(word) {
            return Err(AppError::ValidationError("请选中一个英文单词或词组".into()));
        }
        let mut passage = self.passage(passage_id).await?;
        let text = passage
            .sentences
            .iter()
            .map(|s| s.en.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        if !passage_rules::text_uses_any_form(&text, word) {
            return Err(AppError::ValidationError(format!(
                "「{word}」不在这篇短文里"
            )));
        }
        if passage.target_words.iter().any(|t| {
            t.word.eq_ignore_ascii_case(word)
                    // 单词之间按变形判重（birds 与 bird）；词组只与相同的词组判重
                    || (!passage_rules::is_phrase(word)
                        && !passage_rules::is_phrase(&t.word)
                        && passage_rules::text_uses(word, &t.word))
        }) {
            return Err(AppError::ValidationError(format!("「{word}」已经是目标词")));
        }
        let stored = proper_noun_form(&passage, word).unwrap_or_else(|| word.to_lowercase());
        let repository = PassageRepository::new(self.pool.clone());
        let known = repository
            .word_ids_by_text(std::slice::from_ref(&stored))
            .await?;
        passage.target_words.push(PassageTargetWord {
            word_id: known.get(&stored.to_lowercase()).copied(),
            word: stored,
            required: true,
            meaning: None,
        });
        repository
            .update_target_words(passage_id, &passage.target_words)
            .await?;
        self.passage(passage_id).await
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

/// 讲解 / 答疑用的单词资料：`card_word` 有值时取单词卡（不在单词本的目标词），否则按 id 取单词本里的词
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
            kind: "word".to_string(),
            phrase_type: None,
            separable: false,
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
    use crate::types::passage::PassageSentence;

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
        assert!(service.add_target_word(id, "two words").await.is_err());
        assert!(service.add_target_word(id, "volcano").await.is_err());
        let passage = service.add_target_word(id, " fossils, ").await.unwrap();
        let added = passage.target_words.last().unwrap();
        assert_eq!(added.word, "fossils");
        assert!(added.required && added.word_id.is_none());
        assert!(service.add_target_word(id, "Fossils").await.is_err());
        // 专有名词保留大写
        let passage = service.add_target_word(id, "tyrannosaurus").await.unwrap();
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
        let passage = service.add_target_word(id, "study  fossil").await.unwrap();
        assert_eq!(passage.target_words.last().unwrap().word, "study fossil");
        assert!(service.add_target_word(id, "study fossil").await.is_err());
    }
}
