//! 导入材料（DECISIONS D30）：预处理预览、逐篇导入（AI 只翻译 / 起标题 / 估水平 / 挑重点词）、取消、
//! 生词加进词汇本（拼读分析补全音标与例句）。
//!
//! 原文一字不改：保存的英文来自导入请求，模型只回传译文（`passage_rules::translation_from_submission`）。

use crate::agent::{tasks, AgentPaths};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::passage_repository::{NewPassage, PassageRepository};
use crate::services::agent_settings::{AgentSettingsService, AgentTaskKind};
use crate::services::passage_import;
use crate::services::passage_rules::{self, GeneratedPassage};
use crate::services::prompt_profile::PromptProfileService;
use crate::types::common::Id;
use crate::types::passage::{
    AddPassageWordsRequest, ImportPassageRequest, ImportPreview, Passage, PassageNewWord,
    PassageSentence, PassageSource, PassageTargetWord, PrepareImportRequest,
};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;

const MAX_SENTENCE_CHARS: usize = 1_000;
const MAX_TITLE_CHARS: usize = 120;
const MAX_LABEL_CHARS: usize = 200;
const MAX_BOOKS: usize = 20;
const MIN_WORDS: usize = 5;

fn cancelled_error() -> AppError {
    AppError::ValidationError("已取消导入".to_string())
}

pub struct PassageImportService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
    repository: PassageRepository,
}

impl PassageImportService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: PassageRepository::new(pool.clone()),
            pool,
            logger,
        }
    }

    /// 预处理：读文件 / 文本 → 清理、分句、拆篇（不写库、不用 AI）
    pub fn prepare(&self, request: &PrepareImportRequest) -> AppResult<ImportPreview> {
        passage_import::prepare_request(request)
    }

    /// 导入一篇：校验 → 翻译（`cancelled` 为真时中止）→ 目标词（词汇本匹配 + AI 重点词）→ 保存。
    /// 由后台任务 `start_passage_import` 逐篇调用
    pub async fn import(
        &self,
        request: &ImportPassageRequest,
        paths: &AgentPaths,
        cancelled: &(dyn Fn() -> bool + Sync),
    ) -> AppResult<Passage> {
        self.import_inner(cancelled, request, paths).await
    }

    async fn import_inner(
        &self,
        cancelled: &(dyn Fn() -> bool + Sync),
        request: &ImportPassageRequest,
        paths: &AgentPaths,
    ) -> AppResult<Passage> {
        let sentences: Vec<String> = request
            .sentences
            .iter()
            .map(|s| s.en.split_whitespace().collect::<Vec<_>>().join(" "))
            .collect();
        if sentences.is_empty() || sentences.len() > passage_import::MAX_SENTENCES_PER_ITEM {
            return Err(AppError::ValidationError(format!(
                "每篇需要 1–{} 句，请在预览里拆开或合并",
                passage_import::MAX_SENTENCES_PER_ITEM
            )));
        }
        if sentences.iter().any(|s| s.is_empty()) {
            return Err(AppError::ValidationError(
                "有空的句子，请回到预览检查".to_string(),
            ));
        }
        if sentences
            .iter()
            .any(|s| s.chars().count() > MAX_SENTENCE_CHARS)
        {
            return Err(AppError::ValidationError(format!(
                "有一句超过 {} 个字符，请在预览里拆开",
                MAX_SENTENCE_CHARS
            )));
        }
        let word_count: usize = sentences
            .iter()
            .map(|s| passage_rules::words_of(s).count())
            .sum();
        if word_count < MIN_WORDS {
            return Err(AppError::ValidationError(format!(
                "内容太短了，至少需要 {} 个英文单词",
                MIN_WORDS
            )));
        }
        let title = request
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty());
        if title.is_some_and(|t| t.chars().count() > MAX_TITLE_CHARS) {
            return Err(AppError::ValidationError(format!(
                "标题最多 {} 个字",
                MAX_TITLE_CHARS
            )));
        }
        let label: String = request
            .source_label
            .trim()
            .chars()
            .take(MAX_LABEL_CHARS)
            .collect();
        let label = if label.is_empty() {
            "粘贴的文本".to_string()
        } else {
            label
        };
        if request.book_ids.len() > MAX_BOOKS {
            return Err(AppError::ValidationError(format!(
                "最多选 {} 个词汇本",
                MAX_BOOKS
            )));
        }

        // 词汇本匹配（确定性）：原文里出现的词（含屈折形式）
        let full_text = sentences.join(" ");
        let mut targets: Vec<PassageTargetWord> = Vec::new();
        let mut sources: Vec<PassageSource> = Vec::new();
        for &book_id in &request.book_ids {
            let Some(book_title) = self.repository.book_title(book_id).await? else {
                return Err(AppError::NotFound("词汇本不存在，可能已被删除".to_string()));
            };
            let mut matched = 0;
            for c in self.repository.book_candidates(book_id).await? {
                if passage_rules::text_uses(&full_text, &c.word)
                    && !targets.iter().any(|t| t.word.eq_ignore_ascii_case(&c.word))
                {
                    targets.push(PassageTargetWord {
                        word_id: Some(c.word_id),
                        word: c.word,
                        required: true,
                        meaning: Some(c.meaning).filter(|m| !m.trim().is_empty()),
                    });
                    matched += 1;
                }
            }
            sources.push(PassageSource {
                kind: "book".into(),
                ref_id: book_id,
                name: book_title,
                detail: Some(format!("原文里有 {} 个词", matched)),
                exists: true,
            });
        }

        if cancelled() {
            return Err(cancelled_error());
        }
        let profile = PromptProfileService::load(&self.pool).await?;
        let model = AgentSettingsService::new(self.pool.clone(), self.logger.clone())
            .model_for(AgentTaskKind::Passage, None)
            .await?;
        let known_tags = crate::services::tag::TagService::new(self.pool.clone())
            .known_names()
            .await?;
        let translation = tasks::translate_passage(
            paths,
            &model,
            &profile,
            &tasks::TranslateSpec {
                title,
                sentences: &sentences,
                key_words: request.ai_key_words,
                tags: &known_tags,
            },
            &self.logger,
            cancelled,
        )
        .await
        .map_err(|e| if cancelled() { cancelled_error() } else { e })?;
        if cancelled() {
            return Err(cancelled_error());
        }

        // AI 重点词：已在词汇本里的词带上 wordId（不算生词）
        let key_texts: Vec<String> = translation
            .key_words
            .iter()
            .map(|(w, _)| w.clone())
            .collect();
        let known = self.repository.word_ids_by_text(&key_texts).await?;
        for (word, meaning) in &translation.key_words {
            if targets.iter().any(|t| t.word.eq_ignore_ascii_case(word)) {
                continue;
            }
            targets.push(PassageTargetWord {
                word_id: known.get(&word.to_lowercase()).copied(),
                word: word.clone(),
                required: false,
                meaning: Some(meaning.clone()).filter(|m| !m.trim().is_empty()),
            });
        }

        let saved_sentences: Vec<PassageSentence> = request
            .sentences
            .iter()
            .zip(&sentences)
            .zip(translation.zh)
            .enumerate()
            .map(|(i, ((s, en), zh))| PassageSentence {
                en: en.clone(),
                zh,
                paragraph: s.paragraph || i == 0,
                start_ms: None,
                end_ms: None,
            })
            .collect();
        let title = title
            .map(String::from)
            .or_else(|| Some(translation.title.trim().to_string()).filter(|t| !t.is_empty()))
            .unwrap_or_else(|| label.clone());
        let fingerprint = crate::prompts::fingerprint(&crate::prompts::system_prompt(
            crate::prompts::PromptTask::PassageTranslate,
            &profile,
            &[],
        ));
        let mut tx = self.pool.begin().await?;
        let id = PassageRepository::insert_passage_conn(
            &mut tx,
            &NewPassage {
                origin: "imported",
                source_label: Some(&label),
                scene: None,
                level: &translation.level,
                sources: &sources,
                model_name: Some(model.display_name.as_str()),
                prompt_fingerprint: Some(&fingerprint),
            },
            &GeneratedPassage {
                title,
                sentences: saved_sentences,
                target_words: targets,
                word_count,
                tags: Vec::new(),
            },
        )
        .await?;
        crate::services::tag::TagService::new(self.pool.clone())
            .add_names_conn(
                &mut tx,
                crate::types::material::MaterialKind::Passage,
                id,
                &translation.tags,
            )
            .await?;
        tx.commit().await?;
        self.repository
            .find(id)
            .await?
            .ok_or_else(|| AppError::NotFound("短文不存在，可能已被删除".to_string()))
    }

    /// 短文里还不在词汇本的词（AI 挑的重点词里没有 wordId 的）
    pub async fn new_words(&self, passage_id: Id) -> AppResult<Vec<PassageNewWord>> {
        let passage = self.passage(passage_id).await?;
        Ok(passage
            .target_words
            .into_iter()
            .filter(|t| t.word_id.is_none())
            .map(|t| PassageNewWord {
                word: t.word,
                meaning: t.meaning,
            })
            .collect())
    }

    async fn passage(&self, passage_id: Id) -> AppResult<Passage> {
        self.repository
            .find(passage_id)
            .await?
            .ok_or_else(|| AppError::NotFound("短文不存在，可能已被删除".to_string()))
    }

    /// 生词加进词汇本：本里已有的直接关联；其余先做拼读分析（音标、音节、例句）再保存，
    /// 分析没覆盖到的词只存单词与释义。保存后短文的目标词补上 wordId。返回这些词在本里的 id。
    pub async fn add_words_to_book(
        &self,
        request: &AddPassageWordsRequest,
        paths: &AgentPaths,
    ) -> AppResult<Vec<Id>> {
        let passage = self.passage(request.passage_id).await?;
        let Some(book_title) = self.repository.book_title(request.book_id).await? else {
            return Err(AppError::NotFound("词汇本不存在，可能已被删除".to_string()));
        };
        let mut wanted: Vec<&PassageTargetWord> = Vec::new();
        for w in &request.words {
            let target = passage
                .target_words
                .iter()
                .find(|t| t.word.eq_ignore_ascii_case(w.trim()))
                .ok_or_else(|| {
                    AppError::ValidationError(format!("「{}」不是这篇短文里的词", w.trim()))
                })?;
            if !wanted
                .iter()
                .any(|t| t.word.eq_ignore_ascii_case(&target.word))
            {
                wanted.push(target);
            }
        }
        if wanted.is_empty() {
            return Err(AppError::ValidationError("请至少选一个词".to_string()));
        }
        let words_repo = crate::repositories::word_repository::WordRepository::new(
            self.pool.clone(),
            self.logger.clone(),
        );
        let texts: Vec<String> = wanted.iter().map(|t| t.word.clone()).collect();
        let existing = words_repo
            .find_existing_words_by_book(request.book_id, &texts)
            .await?;
        let to_create: Vec<&PassageTargetWord> = wanted
            .iter()
            .copied()
            .filter(|t| !existing.contains_key(&t.word.to_lowercase()))
            .collect();

        if !to_create.is_empty() {
            let analyzed = self.analyze(&to_create, request.book_id, paths).await?;
            let words = to_create
                .iter()
                .map(|t| {
                    let meaning = t.meaning.clone().unwrap_or_default();
                    match analyzed.get(&t.word.to_lowercase()) {
                        Some(p) => crate::types::wordbook::AnalyzedWord {
                            word: t.word.clone(),
                            meaning: if meaning.trim().is_empty() {
                                p.chinese_translation.clone()
                            } else {
                                meaning
                            },
                            part_of_speech: Some(p.pos_abbreviation.clone()),
                            ipa: Some(p.ipa.clone()),
                            syllables: Some(p.syllables.clone()),
                            pos_abbreviation: Some(p.pos_abbreviation.clone()),
                            pos_english: Some(p.pos_english.clone()),
                            pos_chinese: Some(p.pos_chinese.clone()),
                            phonics_rule: Some(p.phonics_rule.clone()),
                            analysis_explanation: Some(p.analysis_explanation.clone()),
                            examples: Some(p.examples.clone()),
                            word_frequency: Some(p.frequency),
                            phrase_type: Some(p.phrase_type.clone()).filter(|t| !t.is_empty()),
                            separable: p.separable,
                        },
                        None => crate::types::wordbook::AnalyzedWord {
                            word: t.word.clone(),
                            meaning,
                            part_of_speech: None,
                            ipa: None,
                            syllables: None,
                            pos_abbreviation: None,
                            pos_english: None,
                            pos_chinese: None,
                            phonics_rule: None,
                            analysis_explanation: None,
                            examples: None,
                            word_frequency: None,
                            phrase_type: None,
                            separable: false,
                        },
                    }
                })
                .collect();
            crate::services::wordbook::WordBookService::new(self.pool.clone(), self.logger.clone())
                .create_word_book_from_analysis(
                    crate::types::wordbook::CreateWordBookFromAnalysisRequest {
                        title: book_title,
                        description: String::new(),
                        icon: None,
                        icon_color: None,
                        words,
                        status: None,
                        book_id: Some(request.book_id),
                        tag_ids: None,
                    },
                )
                .await?;
        }

        let ids = words_repo
            .find_existing_words_by_book(request.book_id, &texts)
            .await?;
        let mut targets = passage.target_words.clone();
        for t in targets.iter_mut() {
            if let Some(id) = ids.get(&t.word.to_lowercase()) {
                t.word_id = Some(*id);
            }
        }
        self.repository
            .update_target_words(request.passage_id, &targets)
            .await?;
        Ok(texts
            .iter()
            .filter_map(|w| ids.get(&w.to_lowercase()).copied())
            .collect())
    }

    /// 拼读分析（音标、音节、拼读规则、例句），释义沿用短文里的意思；返回 小写单词 → 结果
    async fn analyze(
        &self,
        words: &[&PassageTargetWord],
        book_id: Id,
        paths: &AgentPaths,
    ) -> AppResult<HashMap<String, crate::types::word_analysis::PhonicsWord>> {
        let model = AgentSettingsService::new(self.pool.clone(), self.logger.clone())
            .model_for(AgentTaskKind::Phonics, None)
            .await?;
        let profile = PromptProfileService::load(&self.pool).await?;
        let scene =
            PromptProfileService::book_scene(&self.pool, &self.logger, Some(book_id)).await?;
        let context = tasks::PhonicsContext {
            scene,
            meanings: words
                .iter()
                .filter_map(|t| {
                    t.meaning
                        .as_ref()
                        .filter(|m| !m.trim().is_empty())
                        .map(|m| (t.word.to_lowercase(), m.clone()))
                })
                .collect(),
        };
        let texts: Vec<String> = words.iter().map(|t| t.word.clone()).collect();
        let outcome =
            tasks::analyze_phonics_batch(paths, &model, &profile, &context, &texts, &self.logger)
                .await?;
        Ok(outcome
            .analyzed
            .into_iter()
            .map(|p| (p.word.to_lowercase(), p))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::passage::tests::seed_passage;
    use crate::test_support::{memory_pool, test_logger};
    use crate::types::passage::ImportSentence;

    fn paths() -> AgentPaths {
        AgentPaths {
            program: "/nonexistent/redlark-agent".into(),
            root: std::env::temp_dir().join("redlark-import-test"),
        }
    }

    fn request(sentences: &[&str]) -> ImportPassageRequest {
        ImportPassageRequest {
            title: None,
            sentences: sentences
                .iter()
                .map(|s| ImportSentence {
                    en: s.to_string(),
                    paragraph: false,
                })
                .collect(),
            source_label: "lesson.txt".into(),
            book_ids: vec![],
            ai_key_words: true,
        }
    }

    #[tokio::test]
    async fn import_validates_input_and_honours_cancel_before_calling_the_model() {
        let pool = memory_pool().await;
        let service = PassageImportService::new(pool.clone(), test_logger());
        assert!(service
            .import(&request(&[]), &paths(), &|| false)
            .await
            .is_err());
        assert!(service
            .import(&request(&["Hi there."]), &paths(), &|| false)
            .await
            .is_err());
        assert!(service
            .import(&request(&["Tom has a red kite.", "  "]), &paths(), &|| {
                false
            })
            .await
            .is_err());
        let mut missing_book = request(&["Tom has a red kite today."]);
        missing_book.book_ids = vec![404];
        assert!(service
            .import(&missing_book, &paths(), &|| false)
            .await
            .is_err());

        // 已取消：在调用模型之前就返回“已取消”
        let err = service
            .import(&request(&["Tom has a red kite today."]), &paths(), &|| true)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("已取消"), "{err}");
    }

    #[tokio::test]
    async fn new_words_link_to_existing_book_words_without_analysis() {
        let pool = memory_pool().await;
        let (passage_id, _) = seed_passage(&pool).await;
        let service = PassageImportService::new(pool.clone(), test_logger());
        // 种子短文目标词：passport / customs 有 wordId，fly 没有
        let new_words = service.new_words(passage_id).await.unwrap();
        assert_eq!(
            new_words
                .iter()
                .map(|w| w.word.as_str())
                .collect::<Vec<_>>(),
            ["fly"]
        );

        // 词汇本 971 里已经有 fly：直接关联，不需要拼读分析（sidecar 不存在也能完成）
        sqlx::query(
            "INSERT INTO words (id, word, meaning, word_book_id, created_at, updated_at)
             VALUES (9799, 'fly', '飞', 971, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();
        let ids = service
            .add_words_to_book(
                &AddPassageWordsRequest {
                    passage_id,
                    book_id: 971,
                    words: vec!["Fly".into()],
                },
                &paths(),
            )
            .await
            .unwrap();
        assert_eq!(ids, vec![9799]);
        assert!(service.new_words(passage_id).await.unwrap().is_empty());
        // 不是短文里的词：拒绝
        assert!(service
            .add_words_to_book(
                &AddPassageWordsRequest {
                    passage_id,
                    book_id: 971,
                    words: vec!["banana".into()],
                },
                &paths(),
            )
            .await
            .is_err());
    }
}
