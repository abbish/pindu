//! 单词本业务逻辑服务
//!
//! 封装单词本相关的业务逻辑
//!
//! # 注意
//! 此模块当前独立实现,未来将集成到 handlers

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::wordbook_repository::{WordBookFilters, WordBookRepository};
use crate::types::{
    common::{Id, WordSaveResult},
    wordbook::*,
};
use sqlx::SqlitePool;
use std::sync::Arc;

/// 单词本服务
///
/// 负责单词本的业务逻辑处理
/// 单词本名称：必填，最多 100 字（与前端表单同一规则）
fn validate_title(title: &str) -> AppResult<()> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::ValidationError("单词本名称不能为空".to_string()));
    }
    if title.chars().count() > 100 {
        return Err(AppError::ValidationError(
            "单词本名称不能超过 100 个字".to_string(),
        ));
    }
    Ok(())
}

/// 单词本描述：最多 500 字
fn validate_description(description: &str) -> AppResult<()> {
    if description.chars().count() > 500 {
        return Err(AppError::ValidationError(
            "单词本描述不能超过 500 个字".to_string(),
        ));
    }
    Ok(())
}

pub struct WordBookService {
    repository: WordBookRepository,
    logger: Arc<Logger>,
}

impl WordBookService {
    /// 创建新的服务实例
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: WordBookRepository::new(pool, logger.clone()),
            logger,
        }
    }

    /// 获取单词本列表
    pub async fn get_word_books(
        &self,
        include_deleted: bool,
        status: Option<String>,
    ) -> AppResult<Vec<WordBook>> {
        // 状态：normal / draft / deleted；不指定时 include_deleted 决定是否带上已删除的
        let filters = WordBookFilters {
            status,
            include_deleted,
        };

        // 调用 repository 查询；词性分布一次查询带出
        let mut books = self.repository.find_all(filters).await?;
        let mut distributions = self.repository.word_type_distributions(None).await?;
        for book in &mut books {
            book.word_types = Some(distributions.remove(&book.id).unwrap_or_default());
        }
        Ok(books)
    }

    /// 获取单词本(仅基本信息)
    pub async fn get_word_book(&self, id: Id) -> AppResult<WordBook> {
        // 获取基本信息
        let word_book = self
            .repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound("单词本不存在，可能已被删除".to_string()))?;

        Ok(word_book)
    }

    /// 创建单词本
    pub async fn create_word_book(&self, request: CreateWordBookRequest) -> AppResult<Id> {
        validate_title(&request.title)?;
        validate_description(&request.description)?;

        // 调用 repository 创建
        self.repository.create(request).await
    }

    /// 更新单词本
    pub async fn update_word_book(&self, id: Id, request: UpdateWordBookRequest) -> AppResult<()> {
        // 验证单词本是否存在
        let _existing = self
            .repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound("单词本不存在，可能已被删除".to_string()))?;

        if let Some(title) = &request.title {
            validate_title(title)?;
        }
        if let Some(description) = &request.description {
            validate_description(description)?;
        }

        // 单词本只有“正常”一种可编辑状态（2026-10 取消草稿，存量由迁移 049 改为正常）；删除走删除命令
        if let Some(status) = &request.status {
            if status != "normal" {
                return Err(AppError::ValidationError(
                    "单词本状态只能是 normal（草稿状态已取消，删除请用删除操作）".to_string(),
                ));
            }
        }

        // 调用 repository 更新
        self.repository.update(id, request).await
    }

    /// 删除单词本（软删除，可在“已删除”里恢复）；被未结束的计划使用时不能删除
    pub async fn delete_word_book(&self, id: Id) -> AppResult<()> {
        // 验证单词本是否存在
        let _existing = self
            .repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound("单词本不存在，可能已被删除".to_string()))?;
        self.ensure_not_in_unfinished_plans(id, "删除").await?;

        // 调用 repository 删除
        self.repository.delete(id).await
    }

    /// 恢复已删除的单词本
    pub async fn restore_word_book(&self, id: Id) -> AppResult<()> {
        if self.repository.restore(id).await? {
            Ok(())
        } else {
            Err(AppError::NotFound(format!("没有找到已删除的单词本 {}", id)))
        }
    }

    /// 单词本被草稿 / 待开始 / 进行中 / 已暂停的计划使用时，不允许删除或转草稿
    async fn ensure_not_in_unfinished_plans(&self, id: Id, action: &str) -> AppResult<()> {
        let plans = self.repository.unfinished_plan_names(id).await?;
        if plans.is_empty() {
            return Ok(());
        }
        let names = plans
            .iter()
            .map(|n| format!("「{}」", n))
            .collect::<Vec<_>>()
            .join("");
        Err(AppError::ValidationError(format!(
            "这个单词本正在被学习计划{}使用，不能{}。请先完成、终止或删除这些计划。",
            names, action
        )))
    }

    /// 获取单词本统计信息
    pub async fn get_word_book_statistics(&self, id: Id) -> AppResult<WordBookStatistics> {
        // 验证单词本是否存在
        let _existing = self
            .repository
            .find_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound("单词本不存在，可能已被删除".to_string()))?;

        // 调用 repository 获取统计
        self.repository.get_statistics(id).await
    }

    /// 获取单词本词性分布
    pub async fn get_word_type_distribution(&self, id: Id) -> AppResult<WordTypeDistribution> {
        let stats = self.get_word_book_statistics(id).await?;
        Ok(stats.word_types)
    }

    /// 更新所有单词本的统计信息
    pub async fn update_all_counts(&self) -> AppResult<()> {
        self.repository.update_all_counts().await
    }

    /// 更新单词本的统计信息
    pub async fn update_statistics(&self, id: Id) -> AppResult<()> {
        self.repository.update_statistics(id).await
    }

    /// 从分析结果创建单词本（批量操作）
    pub async fn create_word_book_from_analysis(
        &self,
        request: CreateWordBookFromAnalysisRequest,
    ) -> AppResult<WordSaveResult> {
        use crate::repositories::word_repository::WordRepository;
        use crate::types::wordbook::{AnalyzedWord, Word};

        // 验证输入
        if request.title.trim().is_empty() {
            return Err(AppError::ValidationError("单词本标题不能为空".to_string()));
        }

        if request.words.is_empty() {
            return Err(AppError::ValidationError(
                "单词本必须包含至少一个单词".to_string(),
            ));
        }

        // 1. 内部去重
        let mut unique_words = Vec::new();
        let mut seen_words = std::collections::HashSet::new();

        let normalized: Vec<AnalyzedWord> = request
            .words
            .iter()
            .cloned()
            .map(|mut w| {
                w.word = crate::types::wordbook::normalize_vocab(&w.word);
                w
            })
            .collect();
        for word in &normalized {
            let word_lower = word.word.to_lowercase();
            if !seen_words.contains(&word_lower) {
                seen_words.insert(word_lower);
                unique_words.push(word.clone());
            }
        }

        // 2. 数据库查重和分类
        let book_id_for_check = request.book_id.unwrap_or(0);
        let mut words_to_add = Vec::new();
        let mut words_to_update = Vec::new();

        if book_id_for_check > 0 {
            // 检查数据库重复
            let word_repo =
                WordRepository::new(self.repository.get_pool(), self.repository.get_logger());

            let word_list: Vec<String> =
                unique_words.iter().map(|w| w.word.to_lowercase()).collect();
            let existing_map = word_repo
                .find_existing_words_by_book(book_id_for_check, &word_list)
                .await?;

            for word in &unique_words {
                let word_lower = word.word.to_lowercase();
                if let Some(&existing_id) = existing_map.get(&word_lower) {
                    words_to_update.push((existing_id, word.clone()));
                } else {
                    words_to_add.push(word.clone());
                }
            }
        } else {
            words_to_add = unique_words;
        }

        if words_to_add.is_empty() && words_to_update.is_empty() {
            return Err(AppError::ValidationError(
                "去重后没有单词需要处理".to_string(),
            ));
        }

        // 3. 开始事务，确保原子性
        let pool = self.repository.get_pool();
        let mut tx = crate::services::srs::begin_write(&pool).await?;

        // 4. 确定目标单词本ID（已有单词本须存在；否则在事务中新建并关联主题标签）
        let book_id = if let Some(existing_book_id) = request.book_id {
            if !self
                .repository
                .exists_active_conn(&mut tx, existing_book_id)
                .await?
            {
                return Err(AppError::NotFound("单词本不存在，可能已被删除".to_string()));
            }
            existing_book_id
        } else {
            // 单词本已取消草稿状态：请求里的 status 只为兼容旧前端保留，一律按正常创建
            let creation_status = "normal";
            let icon = request.icon.unwrap_or_else(|| "bookmark".to_string());
            let icon_color = request.icon_color.unwrap_or_else(|| "primary".to_string());
            let new_book_id = self
                .repository
                .insert_conn(
                    &mut tx,
                    &request.title,
                    &request.description,
                    &icon,
                    &icon_color,
                    creation_status,
                )
                .await?;
            if let Some(tag_ids) = &request.tag_ids {
                self.repository
                    .add_tags_conn(&mut tx, new_book_id, tag_ids)
                    .await?;
            }
            new_book_id
        };

        // 5. 批量添加和更新单词（在事务中）
        let word_repo =
            WordRepository::new(self.repository.get_pool(), self.repository.get_logger());
        let to_word = |aw: AnalyzedWord| {
            let examples = complete_examples(aw.examples.clone().unwrap_or_default());
            let kind = crate::types::wordbook::vocab_kind(&aw.word).to_string();
            Word {
                id: 0,
                phonics_segments: phonics_segments_from_syllables(
                    aw.syllables.as_deref(),
                    &aw.word,
                ),
                word: aw.word,
                meaning: aw.meaning,
                description: None,
                ipa: aw.ipa,
                syllables: aw.syllables,
                image_path: None,
                audio_path: None,
                part_of_speech: aw.part_of_speech,
                category_id: None,
                word_book_id: Some(book_id),
                pos_abbreviation: aw.pos_abbreviation,
                pos_english: aw.pos_english,
                pos_chinese: aw.pos_chinese,
                phonics_rule: aw.phonics_rule,
                analysis_explanation: aw.analysis_explanation,
                kind,
                phrase_type: aw.phrase_type,
                separable: aw.separable,
                // 只保存句子与翻译都有的例句（更新已有单词时，新结果没有例句则保留原例句）
                examples,
                created_at: String::new(),
                updated_at: String::new(),
            }
        };

        let words: Vec<Word> = words_to_add.into_iter().map(to_word).collect();
        let added_count = word_repo.create_batch(&mut tx, &words).await?.len();

        let updates: Vec<(Id, Word)> = words_to_update
            .into_iter()
            .map(|(id, aw)| (id, to_word(aw)))
            .collect();
        word_repo.update_batch(&mut tx, &updates).await?;
        let updated_count = updates.len();

        // 6. 提交事务
        tx.commit().await?;

        // 7. 更新单词本统计（在事务外，避免长时间锁定）；单词已经保存，统计失败只记日志，下次刷新会补上
        if let Err(e) = self.update_statistics(book_id).await {
            self.logger.warn(
                "WORDBOOK_SERVICE",
                &format!("更新单词本 {} 统计失败", book_id),
                Some(&e.to_string()),
            );
        }

        Ok(WordSaveResult {
            book_id,
            added_count: added_count as i32,
            updated_count: updated_count as i32,
            skipped_count: 0,
        })
    }
}

/// 分析结果中的例句：去空白，丢弃缺句子或缺翻译的条目，忽略重复与近似重复的句子
fn complete_examples(examples: Vec<WordExample>) -> Vec<WordExample> {
    let mut seen = std::collections::HashSet::new();
    examples
        .into_iter()
        .map(|e| WordExample {
            sentence: e.sentence.trim().to_string(),
            translation: e.translation.trim().to_string(),
        })
        .filter(|e| !e.sentence.is_empty() && !e.translation.is_empty())
        .filter(|e| seen.insert(e.sentence.to_lowercase()))
        .fold(Vec::<WordExample>::new(), |mut kept, e| {
            // 拼读分析给出的例句同样丢弃近似重复
            if !kept
                .iter()
                .any(|k| crate::agent::tasks::is_near_duplicate(&k.sentence, &e.sentence))
            {
                kept.push(e);
            }
            kept
        })
}

/// 练习页「拼读」块（phonics_segments，JSON 数组字符串）由音节生成：`el-e-phant` → `["el","e","phant"]`。
/// 音节拼不回单词时不生成（避免错误提示）。
pub fn phonics_segments_from_syllables(syllables: Option<&str>, word: &str) -> Option<String> {
    let parts: Vec<&str> = syllables?
        .split(['-', '·'])
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    let joined: String = parts.concat().to_lowercase();
    let letters: String = word
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_lowercase();
    if parts.is_empty() || joined != letters {
        return None;
    }
    serde_json::to_string(&parts).ok()
}

#[cfg(test)]
mod tests {
    #[test]
    fn phonics_segments_come_from_valid_syllables() {
        use super::phonics_segments_from_syllables as segs;
        assert_eq!(
            segs(Some("el-e-phant"), "elephant").as_deref(),
            Some(r#"["el","e","phant"]"#)
        );
        assert_eq!(
            segs(Some("Sun-day"), "Sunday").as_deref(),
            Some(r#"["Sun","day"]"#)
        );
        assert_eq!(segs(Some("cat"), "cat").as_deref(), Some(r#"["cat"]"#));
        assert_eq!(segs(Some("ba-kin"), "baking"), None);
        assert_eq!(segs(None, "cat"), None);
        assert_eq!(segs(Some(""), "cat"), None);
    }

    use super::*;
    use crate::test_support::{memory_pool, test_logger};

    fn analyzed(word: &str, meaning: &str) -> AnalyzedWord {
        AnalyzedWord {
            word: word.to_string(),
            meaning: meaning.to_string(),
            part_of_speech: Some("n.".to_string()),
            examples: None,
            ipa: Some("/x/".to_string()),
            syllables: Some(word.to_string()),
            pos_abbreviation: None,
            pos_english: None,
            pos_chinese: None,
            phonics_rule: None,
            analysis_explanation: None,
            word_frequency: None,
            phrase_type: None,
            separable: false,
        }
    }

    fn request(book_id: Option<Id>, words: Vec<AnalyzedWord>) -> CreateWordBookFromAnalysisRequest {
        CreateWordBookFromAnalysisRequest {
            title: "分析单词本".to_string(),
            description: String::new(),
            icon: None,
            icon_color: None,
            words,
            status: None,
            book_id,
            tag_ids: Some(vec![1, 2]),
        }
    }

    async fn words_of(pool: &SqlitePool, book_id: Id) -> Vec<(String, String)> {
        sqlx::query_as("SELECT word, meaning FROM words WHERE word_book_id = ? ORDER BY word")
            .bind(book_id)
            .fetch_all(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn analysis_creates_book_with_tags_and_case_insensitively_unique_words() {
        let pool = memory_pool().await;
        let service = WordBookService::new(pool.clone(), test_logger());

        let result = service
            .create_word_book_from_analysis(request(
                None,
                vec![
                    analyzed("Apple", "苹果"),
                    analyzed("apple", "重复"),
                    analyzed("cat", "猫"),
                ],
            ))
            .await
            .unwrap();

        assert_eq!((result.added_count, result.updated_count), (2, 0));
        assert_eq!(
            words_of(pool.as_ref(), result.book_id).await,
            vec![("Apple".into(), "苹果".into()), ("cat".into(), "猫".into())]
        );
        let tags: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM material_tags WHERE kind = 'word_book' AND ref_id = ?",
        )
        .bind(result.book_id)
        .fetch_one(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(tags, 2);
        let total: i64 = sqlx::query_scalar("SELECT total_words FROM word_books WHERE id = ?")
            .bind(result.book_id)
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(total, 2);
    }

    #[tokio::test]
    async fn analysis_into_existing_book_updates_known_words_and_adds_new_ones() {
        let pool = memory_pool().await;
        let service = WordBookService::new(pool.clone(), test_logger());
        let first = service
            .create_word_book_from_analysis(request(None, vec![analyzed("cat", "猫")]))
            .await
            .unwrap();

        let second = service
            .create_word_book_from_analysis(request(
                Some(first.book_id),
                vec![analyzed("CAT", "猫咪"), analyzed("dog", "狗")],
            ))
            .await
            .unwrap();

        assert_eq!((second.added_count, second.updated_count), (1, 1));
        assert_eq!(second.book_id, first.book_id);
        assert_eq!(
            words_of(pool.as_ref(), first.book_id).await,
            vec![("cat".into(), "猫咪".into()), ("dog".into(), "狗".into())]
        );
        crate::time::assert_instants_canonical(&pool).await;
    }

    fn ex(sentence: &str, translation: &str) -> WordExample {
        WordExample {
            sentence: sentence.to_string(),
            translation: translation.to_string(),
        }
    }

    fn with_examples(word: &str, examples: Vec<WordExample>) -> AnalyzedWord {
        AnalyzedWord {
            examples: Some(examples),
            ..analyzed(word, "释义")
        }
    }

    /// (单词, 例句) 按单词、顺序排列
    async fn examples_of(pool: &SqlitePool, book_id: Id) -> Vec<(String, String)> {
        sqlx::query_as(
            "SELECT w.word, e.sentence FROM word_examples e JOIN words w ON w.id = e.word_id
             WHERE w.word_book_id = ? ORDER BY w.word, e.sort_order",
        )
        .bind(book_id)
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn examples_are_saved_in_order_and_kept_when_reanalysis_has_none() {
        let pool = memory_pool().await;
        let service = WordBookService::new(pool.clone(), test_logger());
        let first = service
            .create_word_book_from_analysis(request(
                None,
                vec![
                    with_examples(
                        "cat",
                        vec![
                            ex(" The cat is sleeping. ", "猫在睡觉。"),
                            ex("the cat is sleeping.", "重复"),
                            ex("My cat likes fish.", "我的猫喜欢鱼。"),
                        ],
                    ),
                    // 缺翻译的例句不保存
                    with_examples("dog", vec![ex("The dog can run.", " ")]),
                ],
            ))
            .await
            .unwrap();
        let pair = |w: &str, s: &str| (w.to_string(), s.to_string());
        assert_eq!(
            examples_of(pool.as_ref(), first.book_id).await,
            vec![
                pair("cat", "The cat is sleeping."),
                pair("cat", "My cat likes fish."),
            ]
        );

        // 再次导入：cat 没有例句 → 保留原例句；dog 有了例句 → 写入
        service
            .create_word_book_from_analysis(request(
                Some(first.book_id),
                vec![
                    analyzed("cat", "猫"),
                    with_examples("dog", vec![ex("My dog likes bones.", "我的狗喜欢骨头。")]),
                ],
            ))
            .await
            .unwrap();
        assert_eq!(
            examples_of(pool.as_ref(), first.book_id).await,
            vec![
                pair("cat", "The cat is sleeping."),
                pair("cat", "My cat likes fish."),
                pair("dog", "My dog likes bones."),
            ]
        );

        // 删除单词时例句级联删除
        let cat_id: Id = sqlx::query_scalar("SELECT id FROM words WHERE word = 'cat'")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        sqlx::query("DELETE FROM words WHERE id = ?")
            .bind(cat_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM word_examples WHERE word_id = ?")
            .bind(cat_id)
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn analysis_into_missing_book_writes_nothing() {
        let pool = memory_pool().await;
        let service = WordBookService::new(pool.clone(), test_logger());
        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM words")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();

        let err = service
            .create_word_book_from_analysis(request(Some(9_999), vec![analyzed("cat", "猫")]))
            .await
            .unwrap_err();

        assert!(matches!(err, AppError::NotFound(_)));
        let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM words")
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(before, after);
    }

    #[tokio::test]
    async fn create_word_book_returns_the_inserted_id_and_links_tags() {
        let pool = memory_pool().await;
        let service = WordBookService::new(pool.clone(), test_logger());

        let id = service
            .create_word_book(CreateWordBookRequest {
                title: "新书".to_string(),
                description: String::new(),
                icon: "📚".to_string(),
                icon_color: "#000".to_string(),
                tag_ids: Some(vec![1]),
            })
            .await
            .unwrap();

        let title: String = sqlx::query_scalar("SELECT title FROM word_books WHERE id = ?")
            .bind(id)
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert_eq!(title, "新书");
        let tag: Id = sqlx::query_scalar(
            "SELECT tag_id FROM material_tags WHERE kind = 'word_book' AND ref_id = ?",
        )
        .bind(id)
        .fetch_one(pool.as_ref())
        .await
        .unwrap();
        assert_eq!(tag, 1);
        crate::time::assert_instants_canonical(&pool).await;
    }

    #[test]
    fn part_of_speech_classification_is_exact() {
        let mut d = WordTypeDistribution::default();
        for pos in ["n.", "Noun", "n./v.", "名词"] {
            d.add(Some(pos), 1);
        }
        for pos in ["v.", "vt.", "vi"] {
            d.add(Some(pos), 1);
        }
        for pos in ["adj.", "a."] {
            d.add(Some(pos), 1);
        }
        // 数词、副词、介词、空值不再被“以 n / v 开头”误判
        for pos in [Some("num."), Some("adv."), Some("prep."), None] {
            d.add(pos, 1);
        }
        assert_eq!(
            d,
            WordTypeDistribution {
                nouns: 4,
                verbs: 3,
                adjectives: 2,
                others: 4
            }
        );
    }

    /// 单词本列表一次带出词性分布（前端不再逐本请求统计）
    #[tokio::test]
    async fn word_book_list_includes_word_type_distribution() {
        let pool = memory_pool().await;
        let service = WordBookService::new(pool.clone(), test_logger());
        let book_id =
            sqlx::query("INSERT INTO word_books (title, description) VALUES ('本子', '')")
                .execute(pool.as_ref())
                .await
                .unwrap()
                .last_insert_rowid();
        for (word, pos) in [
            ("cat", "n."),
            ("run", "v."),
            ("red", "adj."),
            ("ten", "num."),
        ] {
            sqlx::query("INSERT INTO words (word, meaning, word_book_id, part_of_speech) VALUES (?, '含义', ?, ?)")
                .bind(word)
                .bind(book_id)
                .bind(pos)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }

        let books = service.get_word_books(false, None).await.unwrap();
        let book = books.iter().find(|b| b.id == book_id).unwrap();

        assert_eq!(
            book.word_types,
            Some(WordTypeDistribution {
                nouns: 1,
                verbs: 1,
                adjectives: 1,
                others: 1
            })
        );
        assert_eq!(
            service.get_word_type_distribution(book_id).await.unwrap(),
            book.word_types.clone().unwrap()
        );
    }

    /// 单词本生命周期：被未结束的计划使用时不能删除 / 转草稿；删除后在“已删除”里可恢复；计数实时计算
    #[tokio::test]
    async fn word_book_lifecycle_guards_delete_and_draft_and_supports_restore() {
        use crate::test_support::seed_schedule;
        let pool = memory_pool().await;
        let service = WordBookService::new(pool.clone(), test_logger());
        let fx = seed_schedule(&pool, 2).await; // Active 计划，单词属于新建的单词本
        let book_id: Id = sqlx::query_scalar("SELECT word_book_id FROM words WHERE id = ?")
            .bind(fx.word_ids[0])
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        for w in &fx.word_ids {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id) VALUES (?, ?)")
                .bind(fx.plan_id)
                .bind(w)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }

        let listed = service.get_word_books(false, None).await.unwrap();
        let book = listed.iter().find(|b| b.id == book_id).unwrap();
        assert_eq!(
            (book.total_words, book.linked_plans),
            (2, 1),
            "计数实时计算"
        );

        let err = service.delete_word_book(book_id).await.unwrap_err();
        assert!(
            err.to_string().contains("测试计划") && err.to_string().contains("不能删除"),
            "{err}"
        );
        let to_draft = UpdateWordBookRequest {
            title: None,
            description: None,
            icon: None,
            icon_color: None,
            status: Some("draft".into()),
            tag_ids: None,
        };
        // 草稿状态已取消：任何时候都不能转草稿
        assert!(matches!(
            service.update_word_book(book_id, to_draft).await,
            Err(AppError::ValidationError(_))
        ));
        let bogus = UpdateWordBookRequest {
            title: None,
            description: None,
            icon: None,
            icon_color: None,
            status: Some("deleted".into()),
            tag_ids: None,
        };
        assert!(matches!(
            service.update_word_book(book_id, bogus).await,
            Err(AppError::ValidationError(_))
        ));

        // 计划结束后可以删除；删除后只在“已删除”里出现，可以恢复
        sqlx::query("UPDATE study_plans SET unified_status = 'Completed' WHERE id = ?")
            .bind(fx.plan_id)
            .execute(pool.as_ref())
            .await
            .unwrap();
        service.delete_word_book(book_id).await.unwrap();
        assert!(!service
            .get_word_books(false, None)
            .await
            .unwrap()
            .iter()
            .any(|b| b.id == book_id));
        let deleted = service
            .get_word_books(false, Some("deleted".into()))
            .await
            .unwrap();
        let d = deleted.iter().find(|b| b.id == book_id).unwrap();
        assert!(d.deleted_at.is_some());
        service.restore_word_book(book_id).await.unwrap();
        assert!(service
            .get_word_books(false, None)
            .await
            .unwrap()
            .iter()
            .any(|b| b.id == book_id));
        assert!(service.restore_word_book(book_id).await.is_err());
        crate::time::assert_instants_canonical(&pool).await;
    }
}
