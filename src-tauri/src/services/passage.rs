//! 短文库（DECISIONS D23）：短文是独立素材，阅读理解题按「题组」单独生成。
//! 写短文：来源（词汇本 / 学习计划，可组合）→ 用户指定必用词 + AI 从来源里按场景挑词 → AI 写短文。
//! 出题：选题型、题量、难度 → AI 出一套题。练习：按题组做阅读或听力 → 客观题判分 + 开放题 AI 评分。
//! 统计与单词练习独立，不读写记忆等级。

use crate::agent::{tasks, AgentPaths};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::passage_repository::{
    AttemptOutcome, CandidateRow, NewPassage, NewQuestionSet, PassageRepository, StoredAnswers,
};
use crate::repositories::plan_passage_repository::PlanPassageRepository;
use crate::repositories::study_plan_repository::StudyPlanRepository;
use crate::services::agent_settings::{AgentSettingsService, AgentTaskKind};
use crate::services::passage_rules::{self, OPEN_MAX_SCORE};
use crate::services::plan_passages;
use crate::services::prompt_profile::PromptProfileService;
use crate::types::common::Id;
use crate::types::passage::{
    GeneratePassageRequest, GenerateQuestionSetRequest, Passage, PassageAttempt, PassageSentence,
    PassageSource, PassageStatistics, PassageSummary, PassageTargetWord, PassageWordCandidate,
    PassageWordSources, QuestionResult, QuestionSet, SubmitPassageAttemptRequest,
};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// 候选词列表最多返回多少个
const MAX_CANDIDATES: usize = 500;
/// 开放题回答的最大长度（字符）
const OPEN_ANSWER_MAX: usize = 1000;
/// 自定主题的最大长度（字符）
/// 自定场景 / 调整意见最多几个字（start_passage_planning 提交前也按它校验）
pub const TOPIC_MAX: usize = 200;
/// 按描述生成时写作要求的最大字数
const INSTRUCTION_MAX: usize = 500;
/// 按描述生成时 AI 为整份规划选目标词的上限
const FREE_PLAN_WORDS: usize = 32;
/// 场景里最多合并几本词汇本的描述
const MAX_SCENE_BOOKS: usize = 3;
/// 题组名称最大长度
const SET_NAME_MAX: usize = 30;

pub fn validate_mode(mode: &str) -> AppResult<()> {
    if matches!(mode, "reading" | "listening") {
        Ok(())
    } else {
        Err(AppError::ValidationError(format!(
            "练习模式应为 reading 或 listening，收到 {}",
            mode
        )))
    }
}

/// 计划的取词策略（空 = 全部学过的）；有非法值时报错
fn plan_scopes(sources: &PassageWordSources) -> AppResult<Vec<String>> {
    if let Some(bad) = sources
        .plan_scopes
        .iter()
        .find(|s| !passage_rules::PLAN_SCOPES.contains(&s.as_str()))
    {
        return Err(AppError::ValidationError(format!(
            "未知的取词策略：{}",
            bad
        )));
    }
    Ok(if sources.plan_scopes.is_empty() {
        vec!["learned".to_string()]
    } else {
        sources.plan_scopes.clone()
    })
}

/// 计划候选词的学习情况标签
fn tags_of(row: &CandidateRow, today: chrono::NaiveDate) -> Vec<String> {
    match row.srs_box {
        Some(srs_box) => passage_rules::word_tags(
            srs_box,
            row.wrong,
            row.first_learned
                .as_deref()
                .and_then(crate::time::local_date_of),
            row.srs_due.as_deref().and_then(crate::time::parse_date),
            today,
        ),
        None => Vec::new(),
    }
}

fn passage_text(sentences: &[PassageSentence]) -> String {
    sentences
        .iter()
        .map(|s| s.en.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

pub struct PassageService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
    repository: PassageRepository,
}

impl PassageService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self {
            repository: PassageRepository::new(pool.clone()),
            pool,
            logger,
        }
    }

    async fn model(&self) -> AppResult<crate::types::AIModelConfig> {
        AgentSettingsService::new(self.pool.clone(), self.logger.clone())
            .model_for(AgentTaskKind::Passage, None)
            .await
    }

    pub async fn get(&self, id: Id) -> AppResult<Passage> {
        self.repository
            .find(id)
            .await?
            .ok_or_else(|| AppError::NotFound("短文不存在，可能已被删除".to_string()))
    }

    pub async fn list(
        &self,
        book_id: Option<Id>,
        plan_id: Option<Id>,
        origin: Option<&str>,
    ) -> AppResult<Vec<PassageSummary>> {
        if let Some(origin) = origin {
            if !["generated", "imported"].contains(&origin) {
                return Err(AppError::ValidationError("短文来源筛选不正确".to_string()));
            }
        }
        self.repository.list(book_id, plan_id, origin).await
    }

    /// 删除短文：被没结束的计划用着时不能删；只被已结束的计划用到时，计划里的这项任务与作答一并删除
    pub async fn delete(&self, id: Id) -> AppResult<()> {
        let plans = PlanPassageRepository::new(self.pool.clone())
            .unfinished_plans_using_passage(id)
            .await?;
        if !plans.is_empty() {
            return Err(AppError::ValidationError(format!(
                "这篇短文在计划「{}」里，计划还没结束；先从计划里去掉这篇短文再删除",
                plans.join("」「")
            )));
        }
        if self.repository.delete(id).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("短文不存在，可能已被删除".to_string()))
        }
    }

    /// 目标词的完整资料（音标、音节、拼读、释义、例句），供朗读时点词查看；手动输入的词与已删除的词不返回
    pub async fn target_word_details(
        &self,
        passage_id: Id,
    ) -> AppResult<Vec<crate::types::wordbook::Word>> {
        let passage = self.get(passage_id).await?;
        let words = crate::repositories::word_repository::WordRepository::new(
            self.pool.clone(),
            self.logger.clone(),
        );
        let mut out = Vec::new();
        for id in passage.target_words.iter().filter_map(|w| w.word_id) {
            if let Some(word) = words.find_by_id(id).await? {
                out.push(word);
            }
        }
        Ok(out)
    }

    pub async fn statistics(&self, plan_id: Option<Id>) -> AppResult<PassageStatistics> {
        self.repository.statistics(plan_id).await
    }

    // ==================== 选词 ====================

    /// 来源的快照（名称）；来源不存在时报错
    async fn source_snapshots(
        &self,
        sources: &PassageWordSources,
    ) -> AppResult<Vec<PassageSource>> {
        let mut out = Vec::new();
        for &book_id in &sources.book_ids {
            let name = self
                .repository
                .book_title(book_id)
                .await?
                .ok_or_else(|| AppError::NotFound("词汇本不存在，可能已被删除".to_string()))?;
            out.push(PassageSource {
                kind: "book".into(),
                ref_id: book_id,
                name,
                detail: None,
                exists: true,
            });
        }
        if !sources.plan_ids.is_empty() {
            let scopes = plan_scopes(sources)?;
            for &plan_id in &sources.plan_ids {
                let name = self.repository.plan_name(plan_id).await?.ok_or_else(|| {
                    AppError::NotFound("学习计划不存在，可能已被删除".to_string())
                })?;
                out.push(PassageSource {
                    kind: "plan".into(),
                    ref_id: plan_id,
                    name,
                    detail: Some(scopes.join(",")),
                    exists: true,
                });
            }
        }
        Ok(out)
    }

    /// 候选行：计划在前（同一个词两边都有时保留计划里的学习标签），词汇本在后
    async fn candidate_rows(&self, sources: &PassageWordSources) -> AppResult<Vec<CandidateRow>> {
        let mut rows = Vec::new();
        if !sources.plan_ids.is_empty() {
            let scopes = plan_scopes(sources)?;
            let today = crate::time::local_today();
            for &plan_id in &sources.plan_ids {
                rows.extend(
                    self.repository
                        .plan_candidates(plan_id)
                        .await?
                        .into_iter()
                        .filter(|r| passage_rules::in_plan_scopes(&scopes, &tags_of(r, today))),
                );
            }
        }
        for &book_id in &sources.book_ids {
            rows.extend(self.repository.book_candidates(book_id).await?);
        }
        Ok(rows)
    }

    /// 所选计划里每种取词策略能取到的词数（同一个词跨计划只算一次）
    pub async fn plan_scope_counts(
        &self,
        plan_ids: &[Id],
    ) -> AppResult<Vec<crate::types::passage::PlanScopeCount>> {
        let today = crate::time::local_today();
        let mut seen = HashSet::new();
        let mut counts: HashMap<String, i64> = HashMap::new();
        for &plan_id in plan_ids {
            for row in self.repository.plan_candidates(plan_id).await? {
                if !seen.insert(row.word.to_lowercase()) {
                    continue;
                }
                *counts.entry("learned".into()).or_insert(0) += 1;
                for tag in tags_of(&row, today) {
                    *counts.entry(tag).or_insert(0) += 1;
                }
            }
        }
        Ok(passage_rules::PLAN_SCOPES
            .iter()
            .map(|s| crate::types::passage::PlanScopeCount {
                scope: s.to_string(),
                count: counts.get(*s).copied().unwrap_or(0),
            })
            .collect())
    }

    /// 候选词：按来源合并去重（同一个词只出现一次），标出难词与用过的次数；不做推荐
    pub async fn candidates(
        &self,
        sources: &PassageWordSources,
    ) -> AppResult<Vec<PassageWordCandidate>> {
        let rows = self.candidate_rows(sources).await?;
        let usage = self.repository.word_usage().await?;
        let today = crate::time::local_today();
        let mut seen_ids = HashSet::new();
        let mut seen_words = HashSet::new();
        Ok(rows
            .into_iter()
            .filter(|r| seen_ids.insert(r.word_id) && seen_words.insert(r.word.to_lowercase()))
            .take(MAX_CANDIDATES)
            .map(|r| PassageWordCandidate {
                usage: usage.get(&r.word_id).copied().unwrap_or(0),
                tags: tags_of(&r, today),
                statuses: passage_rules::learning_statuses(r.level, r.wrong),
                word_id: r.word_id,
                word: r.word,
                meaning: r.meaning,
                source: r.source,
            })
            .collect())
    }

    /// 必用词（勾选的 + 手动输入的）、AI 可挑选的候选池，以及必用词所在的词汇本
    async fn resolve_words(
        &self,
        request: &GeneratePassageRequest,
    ) -> AppResult<(Vec<PassageTargetWord>, Vec<PassageTargetWord>, Vec<Id>)> {
        let mut required: Vec<PassageTargetWord> = Vec::new();
        let mut books: Vec<Id> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let found: HashMap<Id, (String, Option<Id>)> = self
            .repository
            .words_by_ids(&request.required_word_ids)
            .await?
            .into_iter()
            .map(|(id, word, book)| (id, (word, book)))
            .collect();
        for id in &request.required_word_ids {
            if let Some((word, book)) = found.get(id) {
                if seen.insert(word.to_lowercase()) {
                    required.push(PassageTargetWord {
                        word_id: Some(*id),
                        word: word.clone(),
                        required: true,
                        meaning: None,
                        forms: Vec::new(),
                    });
                    books.extend(*book);
                }
            }
        }
        for extra in &request.extra_words {
            let word = extra.trim();
            if word.is_empty() {
                continue;
            }
            if !passage_rules::valid_vocab(word) {
                return Err(AppError::ValidationError(format!(
                    "「{}」不是英文单词或词组",
                    word
                )));
            }
            if seen.insert(word.to_lowercase()) {
                required.push(PassageTargetWord {
                    word_id: None,
                    word: word.to_string(),
                    required: true,
                    meaning: request
                        .extra_meanings
                        .get(&word.to_lowercase())
                        .map(|m| m.trim().to_string())
                        .filter(|m| !m.is_empty()),
                    forms: Vec::new(),
                });
            }
        }
        let pool: Vec<PassageTargetWord> = if request.ai_pick > 0 {
            self.candidates(&request.word_sources())
                .await?
                .into_iter()
                .filter(|c| {
                    !seen.contains(&c.word.to_lowercase())
                        && passage_rules::in_pick_statuses(&request.pick_statuses, &c.statuses)
                })
                .take(passage_rules::MAX_POOL)
                .map(|c| PassageTargetWord {
                    word_id: Some(c.word_id),
                    word: c.word,
                    required: false,
                    meaning: None,
                    forms: Vec::new(),
                })
                .collect()
        } else {
            Vec::new()
        };
        Ok((required, pool, books))
    }

    /// 场景：自定主题优先；否则合并所选词汇本（及必用词所在词汇本）的场景。
    /// 返回（给模型的场景文本, 给界面看的场景说明）
    async fn scene(&self, topic: &str, book_ids: &[Id]) -> AppResult<(String, String)> {
        if !topic.is_empty() {
            return Ok((crate::prompts::topic_scene(topic), topic.to_string()));
        }
        let books = crate::repositories::wordbook_repository::WordBookRepository::new(
            self.pool.clone(),
            self.logger.clone(),
        );
        let (mut scenes, mut labels) = (Vec::new(), Vec::new());
        for &id in book_ids.iter().take(MAX_SCENE_BOOKS) {
            let scene =
                PromptProfileService::book_scene(&self.pool, &self.logger, Some(id)).await?;
            if scene.is_empty() {
                continue;
            }
            scenes.push(scene);
            if let Some(book) = books.find_by_id(id).await? {
                let description = book.description.trim();
                labels.push(if description.is_empty() {
                    book.title
                } else {
                    format!("{}：{}", book.title, description)
                });
            }
        }
        Ok((scenes.join("\n\n"), labels.join("\n")))
    }

    /// 新建短文时的场景建议：按所选词汇本（含指定单词所在的词汇本）的场景，给 4–6 个能用上这些词的场景
    pub async fn suggest_scenes(
        &self,
        request: &crate::types::passage::PassageSceneSuggestRequest,
        paths: &AgentPaths,
    ) -> AppResult<Vec<String>> {
        let found = self.repository.words_by_ids(&request.word_ids).await?;
        let mut books: Vec<Id> = request.book_ids.clone();
        // 学习计划：用计划里单词所在的词汇本
        let plans = StudyPlanRepository::new(self.pool.clone(), self.logger.clone());
        for &plan in &request.plan_ids {
            for b in plans.find_word_book_ids(plan).await? {
                if !books.contains(&b) {
                    books.push(b);
                }
            }
        }
        for (_, _, book) in &found {
            if let Some(b) = book {
                if !books.contains(b) {
                    books.push(*b);
                }
            }
        }
        let (scene, _) = self.scene("", &books).await?;
        let mut words: Vec<String> = found.into_iter().map(|(_, w, _)| w).collect();
        for w in &request.words {
            let w = w.trim();
            if !w.is_empty() && !words.iter().any(|x| x.eq_ignore_ascii_case(w)) {
                words.push(w.to_string());
            }
        }
        if scene.is_empty() && words.is_empty() {
            return Ok(Vec::new());
        }
        let model = self.model().await?;
        let profile = PromptProfileService::load(&self.pool).await?;
        tasks::suggest_passage_scenes(
            paths,
            &model,
            &profile,
            &tasks::passage_scene_suggest_message(&scene, &words, &request.exclude),
            &self.logger,
        )
        .await
    }

    // ==================== 写短文 ====================

    /// 校验请求里的通用字段（篇幅、场景、AI 挑词数与挑词条件）
    pub(crate) fn validate_request(request: &GeneratePassageRequest) -> AppResult<()> {
        let length = request.length.as_deref().unwrap_or("standard");
        if !matches!(length, "short" | "standard" | "long") {
            return Err(AppError::ValidationError(format!(
                "篇幅应为 short / standard / long，收到 {}",
                length
            )));
        }
        if request
            .topic
            .as_deref()
            .unwrap_or("")
            .trim()
            .chars()
            .count()
            > TOPIC_MAX
        {
            return Err(AppError::ValidationError(format!(
                "场景描述最多 {} 个字",
                TOPIC_MAX
            )));
        }
        if request
            .instruction
            .as_deref()
            .unwrap_or("")
            .trim()
            .chars()
            .count()
            > INSTRUCTION_MAX
        {
            return Err(AppError::ValidationError(format!(
                "写作要求最多 {} 个字",
                INSTRUCTION_MAX
            )));
        }
        if !(0..=passage_rules::MAX_AI_PICK).contains(&request.ai_pick) {
            return Err(AppError::ValidationError(format!(
                "AI 挑选的词数应在 0–{} 之间",
                passage_rules::MAX_AI_PICK
            )));
        }
        if let Some(bad) = request
            .pick_statuses
            .iter()
            .find(|s| !passage_rules::PICK_STATUSES.contains(&s.as_str()))
        {
            return Err(AppError::ValidationError(format!(
                "未知的学习情况：{}",
                bad
            )));
        }
        if let Some(d) = request.pick_difficulty.as_deref() {
            if !passage_rules::PICK_DIFFICULTIES.contains(&d) {
                return Err(AppError::ValidationError(format!("未知的单词难度：{}", d)));
            }
        }
        if let Some(f) = request.pick_frequency.as_deref() {
            if !passage_rules::PICK_FREQUENCIES.contains(&f) {
                return Err(AppError::ValidationError(format!("未知的常用程度：{}", f)));
            }
        }
        Ok(())
    }

    /// 给模型的挑词偏好（不让 AI 挑词时为空）
    fn pick_preferences(request: &GeneratePassageRequest, ai_pick: usize) -> String {
        if ai_pick == 0 {
            return String::new();
        }
        passage_rules::pick_preferences(
            request.pick_difficulty.as_deref(),
            request.pick_frequency.as_deref(),
        )
    }

    /// 选好的词：必用词、AI 可挑的候选池（及实际可挑数）、场景用到的词汇本
    async fn chosen_words(
        &self,
        request: &GeneratePassageRequest,
    ) -> AppResult<(
        Vec<PassageTargetWord>,
        Vec<PassageTargetWord>,
        usize,
        Vec<Id>,
    )> {
        let (required, pool, word_books) = self.resolve_words(request).await?;
        if request.ai_pick > 0 && pool.is_empty() {
            return Err(AppError::ValidationError(
                "所选来源里没有符合条件、可供 AI 挑选的词：换一换学习情况，或不让 AI 挑词".into(),
            ));
        }
        let ai_pick = (request.ai_pick as usize).min(pool.len());
        let total = required.len() + ai_pick;
        // 按描述生成可以不指定单词
        if total < passage_rules::MIN_TARGET_WORDS && !request.has_instruction() {
            return Err(AppError::ValidationError(format!(
                "至少要有 {} 个词：勾选必用词、输入单词，或让 AI 从来源里挑词（当前 {} 个）",
                passage_rules::MIN_TARGET_WORDS,
                total
            )));
        }
        let mut scene_books: Vec<Id> = request.book_ids.clone();
        for id in word_books {
            if !scene_books.contains(&id) {
                scene_books.push(id);
            }
        }
        Ok((required, pool, ai_pick, scene_books))
    }

    /// 内容规划里一篇的词：有 id 的必须是真实存在的词，手动词必须是英文单词；返回词与它们所在的词汇本。
    /// `allow_empty`：按描述生成时这一篇可以不指定单词
    async fn plan_item_words(
        &self,
        item: &crate::types::passage::PassagePlanItem,
        allow_empty: bool,
    ) -> AppResult<(Vec<PassageTargetWord>, Vec<Id>)> {
        let ids: Vec<Id> = item.words.iter().filter_map(|w| w.word_id).collect();
        let found: HashMap<Id, (String, Option<Id>)> = self
            .repository
            .words_by_ids(&ids)
            .await?
            .into_iter()
            .map(|(id, word, book)| (id, (word, book)))
            .collect();
        let mut words = Vec::new();
        let mut books = Vec::new();
        let mut seen = HashSet::new();
        for w in &item.words {
            let word = match w.word_id {
                Some(id) => match found.get(&id) {
                    Some((word, book)) => {
                        books.extend(*book);
                        word.clone()
                    }
                    None => continue,
                },
                None if passage_rules::valid_vocab(&w.word) => {
                    crate::types::wordbook::normalize_vocab(&w.word)
                }
                None => continue,
            };
            if seen.insert(word.to_lowercase()) {
                words.push(PassageTargetWord {
                    word_id: w.word_id,
                    word,
                    required: w.required,
                    meaning: w.meaning.clone().filter(|m| !m.trim().is_empty()),
                    forms: Vec::new(),
                });
            }
        }
        if words.is_empty() && !allow_empty {
            return Err(AppError::ValidationError("这一篇没有可用的词".into()));
        }
        Ok((words, books))
    }

    /// 内容规划：AI 提议写几篇、每篇的构思与用词（不保存，交给用户确认后逐篇生成）
    pub async fn plan(
        &self,
        request: &GeneratePassageRequest,
        feedback: &str,
        paths: &AgentPaths,
        cancelled: impl Fn() -> bool,
    ) -> AppResult<crate::types::passage::PassagePlan> {
        Self::validate_request(request)?;
        if feedback.chars().count() > TOPIC_MAX {
            return Err(AppError::ValidationError(format!(
                "调整意见最多 {} 个字",
                TOPIC_MAX
            )));
        }
        self.source_snapshots(&request.word_sources()).await?;
        let (required, pool, ai_pick, scene_books) = self.chosen_words(request).await?;
        let topic = request.topic.as_deref().unwrap_or("").trim();
        // 按描述生成且没有给定单词：AI 按要求自己为各篇选目标词
        let free = request.has_instruction() && required.is_empty() && pool.is_empty();
        let scene = match request.instruction.as_deref().map(str::trim) {
            Some(text) if !text.is_empty() => crate::prompts::writing_brief(text),
            _ => self.scene(topic, &scene_books).await?.0,
        };
        let profile = PromptProfileService::load(&self.pool).await?;
        let level = profile.effective_level().to_string();
        let model = self.model().await?;
        let pick_prefs = Self::pick_preferences(request, ai_pick);
        let mut plan = tasks::plan_passages(
            paths,
            &model,
            &profile,
            &tasks::PlanSpec {
                scene: &scene,
                required: &required,
                pool: &pool,
                ai_pick,
                pick_prefs: &pick_prefs,
                length: request.length.as_deref().unwrap_or("standard"),
                ranges: [
                    passage_rules::length_range(&level, "short"),
                    passage_rules::length_range(&level, "standard"),
                    passage_rules::length_range(&level, "long"),
                ],
                feedback: feedback.trim(),
                free_words: if free { FREE_PLAN_WORDS } else { 0 },
            },
            &self.logger,
            cancelled,
        )
        .await?;
        // AI 选的词、手动输入的词：已在词汇本里的关联上 wordId（不算未收录词）
        self.link_existing_words(&mut plan).await?;
        Ok(plan)
    }

    /// 规划里没有 wordId 的目标词：已在词汇本里的关联上 wordId（不算未收录词）
    async fn link_existing_words(
        &self,
        plan: &mut crate::types::passage::PassagePlan,
    ) -> AppResult<()> {
        let texts: Vec<String> = plan
            .items
            .iter()
            .flat_map(|i| i.words.iter().map(|w| w.word.clone()))
            .collect();
        let known = self.repository.word_ids_by_text(&texts).await?;
        for word in plan.items.iter_mut().flat_map(|i| i.words.iter_mut()) {
            if word.word_id.is_none() {
                word.word_id = known.get(&word.word.to_lowercase()).copied();
            }
        }
        Ok(())
    }

    /// 生成一篇短文（独立素材，记录来源）。带 `plan_item` 时按规划里这一篇的构思、用词与篇幅来写
    pub async fn generate(
        &self,
        request: &GeneratePassageRequest,
        paths: &AgentPaths,
    ) -> AppResult<Passage> {
        Self::validate_request(request)?;
        let sources = self.source_snapshots(&request.word_sources()).await?;
        let topic = request.topic.as_deref().unwrap_or("").trim();
        let (required, pool, ai_pick, scene_books, length, outline, title) =
            match &request.plan_item {
                Some(item) => {
                    let (words, books) = self
                        .plan_item_words(item, request.has_instruction())
                        .await?;
                    let mut scene_books = request.book_ids.clone();
                    for id in books {
                        if !scene_books.contains(&id) {
                            scene_books.push(id);
                        }
                    }
                    let length = match item.length.as_str() {
                        l @ ("short" | "long") => l.to_string(),
                        _ => "standard".to_string(),
                    };
                    (
                        words,
                        Vec::new(),
                        0,
                        scene_books,
                        length,
                        item.idea.trim().to_string(),
                        item.title.trim().to_string(),
                    )
                }
                None => {
                    let (required, pool, ai_pick, scene_books) = self.chosen_words(request).await?;
                    let length = request.length.clone().unwrap_or_else(|| "standard".into());
                    (
                        required,
                        pool,
                        ai_pick,
                        scene_books,
                        length,
                        String::new(),
                        String::new(),
                    )
                }
            };
        let (scene, scene_label) = match request.instruction.as_deref().map(str::trim) {
            Some(text) if !text.is_empty() => {
                (crate::prompts::writing_brief(text), text.to_string())
            }
            _ => self.scene(topic, &scene_books).await?,
        };

        let profile = PromptProfileService::load(&self.pool).await?;
        let level = profile.effective_level().to_string();
        let (min_words, max_words) = passage_rules::length_range(&level, &length);
        let model = self.model().await?;
        let pick_prefs = Self::pick_preferences(request, ai_pick);
        let known_tags = crate::services::tag::TagService::new(self.pool.clone())
            .known_names()
            .await?;
        let mut generated = tasks::generate_passage(
            paths,
            &model,
            &profile,
            &tasks::PassageSpec {
                scene: &scene,
                outline: &outline,
                title: &title,
                required: &required,
                pool: &pool,
                ai_pick,
                pick_prefs: &pick_prefs,
                min_words,
                max_words,
                tags: &known_tags,
            },
            &self.logger,
        )
        .await?;
        // 内容规划里的标题是用户确认（可能改过）的，以它为准
        if !title.is_empty() {
            generated.title = title.clone();
        }
        let fingerprint = crate::prompts::fingerprint(&crate::prompts::system_prompt(
            crate::prompts::PromptTask::Passage,
            &profile,
            &[],
        ));
        let mut tx = self.pool.begin().await?;
        let id = PassageRepository::insert_passage_conn(
            &mut tx,
            &NewPassage {
                origin: "generated",
                source_label: None,
                scene: (!scene_label.is_empty()).then_some(scene_label.as_str()),
                level: &level,
                sources: &sources,
                model_name: Some(model.display_name.as_str()),
                prompt_fingerprint: Some(&fingerprint),
            },
            &generated,
        )
        .await?;
        crate::services::tag::TagService::new(self.pool.clone())
            .add_names_conn(
                &mut tx,
                crate::types::material::MaterialKind::Passage,
                id,
                &generated.tags,
            )
            .await?;
        tx.commit().await?;
        self.get(id).await
    }

    // ==================== 题组 ====================

    pub async fn get_set(&self, id: Id) -> AppResult<QuestionSet> {
        self.repository
            .find_set(id)
            .await?
            .ok_or_else(|| AppError::NotFound("题组不存在，可能已被删除".to_string()))
    }

    /// 删除题组：没结束的计划里还没完成的任务用着时不能删
    pub async fn delete_set(&self, id: Id) -> AppResult<()> {
        let plans = PlanPassageRepository::new(self.pool.clone())
            .unfinished_plans_using_set(id)
            .await?;
        if !plans.is_empty() {
            return Err(AppError::ValidationError(format!(
                "计划「{}」安排了这套题还没练；先在计划里换一套题或去掉这篇短文再删除",
                plans.join("」「")
            )));
        }
        if self.repository.delete_set(id).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("题组不存在，可能已被删除".to_string()))
        }
    }

    /// 为短文生成一套阅读理解题
    pub async fn generate_question_set(
        &self,
        request: &GenerateQuestionSetRequest,
        paths: &AgentPaths,
    ) -> AppResult<QuestionSet> {
        passage_rules::validate_spec(&request.spec).map_err(AppError::ValidationError)?;
        let name = request.name.as_deref().unwrap_or("").trim().to_string();
        if name.chars().count() > SET_NAME_MAX {
            return Err(AppError::ValidationError(format!(
                "题组名称最多 {} 个字",
                SET_NAME_MAX
            )));
        }
        let passage = self.get(request.passage_id).await?;
        let name = if name.is_empty() {
            format!("第 {} 套", self.repository.set_count(passage.id).await? + 1)
        } else {
            name
        };
        let profile = PromptProfileService::load(&self.pool).await?;
        let model = self.model().await?;
        let generated = tasks::generate_questions(
            paths,
            &model,
            &profile,
            &tasks::QuestionsSpec {
                title: &passage.title,
                sentences: &passage.sentences,
                targets: &passage.target_words,
                spec: &request.spec,
            },
            &self.logger,
        )
        .await?;
        let fingerprint = crate::prompts::fingerprint(&crate::prompts::system_prompt(
            crate::prompts::PromptTask::PassageQuestions,
            &profile,
            &[],
        ));
        let mut tx = self.pool.begin().await?;
        let id = PassageRepository::insert_set_conn(
            &mut tx,
            &NewQuestionSet {
                passage_id: passage.id,
                name: &name,
                spec: &request.spec,
                model_name: Some(model.display_name.as_str()),
                prompt_fingerprint: Some(&fingerprint),
            },
            &generated,
        )
        .await?;
        tx.commit().await?;
        self.get_set(id).await
    }

    // ==================== 作答 ====================

    /// 开始作答：同一套题、同一模式（同一计划）有未提交的作答就接着用。
    /// `plan_id` 不为空时是计划里的短文任务：计划要能练习、题组与方式和计划安排的一致；
    /// 待开始的计划第一次练习时自动开始。
    pub async fn start_attempt(
        &self,
        set_id: Id,
        mode: &str,
        plan_id: Option<Id>,
    ) -> AppResult<PassageAttempt> {
        validate_mode(mode)?;
        let set = self.get_set(set_id).await?;
        if let Some(plan_id) = plan_id {
            let plans = StudyPlanRepository::new(self.pool.clone(), self.logger.clone());
            let mut tx = crate::services::srs::begin_write(&self.pool).await?;
            plan_passages::check_plan_attempt_conn(
                &plans,
                &mut tx,
                plan_id,
                set.passage_id,
                set_id,
                mode,
            )
            .await?;
            plan_passages::auto_start_conn(&plans, &mut tx, plan_id, crate::time::local_today())
                .await?;
            tx.commit().await?;
        }
        if let Some(open) = self
            .repository
            .find_open_attempt(set_id, mode, plan_id)
            .await?
        {
            return Ok(open);
        }
        let id = self
            .repository
            .create_attempt(set_id, set.passage_id, mode, plan_id)
            .await?;
        self.attempt(id).await
    }

    pub async fn attempt(&self, id: Id) -> AppResult<PassageAttempt> {
        self.repository
            .find_attempt(id)
            .await?
            .ok_or_else(|| AppError::NotFound("练习记录不存在，可能已被删除".to_string()))
    }

    /// 提交：选词填空与客观题由代码判分，开放题交给 AI 评分（评分失败不影响客观题成绩，可重试）
    pub async fn submit_attempt(
        &self,
        request: &SubmitPassageAttemptRequest,
        paths: &AgentPaths,
    ) -> AppResult<PassageAttempt> {
        let attempt = self.attempt(request.attempt_id).await?;
        if attempt.status != "in_progress" {
            return Err(AppError::ValidationError(
                "这次练习已经提交过了".to_string(),
            ));
        }
        if request
            .answers
            .iter()
            .any(|a| a.value.chars().count() > OPEN_ANSWER_MAX)
        {
            return Err(AppError::ValidationError(format!(
                "回答最多 {} 个字",
                OPEN_ANSWER_MAX
            )));
        }
        let set = self.get_set(attempt.set_id).await?;
        let given: HashMap<Id, &str> = request
            .answers
            .iter()
            .map(|a| (a.question_id, a.value.as_str()))
            .collect();
        let value_of = |id: Id| given.get(&id).copied().unwrap_or("").to_string();
        // 必须全部作答才能判分（听力里选词填空是「听句填空」：只显示所在句子并挖空，同样要答）
        let unanswered = set
            .questions
            .iter()
            .filter(|q| value_of(q.id).trim().is_empty())
            .count();
        if unanswered > 0 {
            return Err(AppError::ValidationError(format!(
                "还有 {} 题没有作答，全部答完才能提交",
                unanswered
            )));
        }

        let cloze_results = passage_rules::grade_cloze_questions(&set.questions, &value_of);
        let others: Vec<_> = set.questions.iter().filter(|q| q.kind != "cloze").collect();
        let mut question_results: Vec<QuestionResult> = others
            .iter()
            .map(|q| {
                let value = value_of(q.id).trim().to_string();
                QuestionResult {
                    question_id: q.id,
                    correct: passage_rules::grade_objective(q, &value),
                    given: value,
                    score: None,
                    feedback: None,
                    suggestion: None,
                }
            })
            .collect();
        let objective_total = cloze_results.len() as i64
            + question_results
                .iter()
                .filter(|r| r.correct.is_some())
                .count() as i64;
        let objective_correct = cloze_results.iter().filter(|r| r.correct).count() as i64
            + question_results
                .iter()
                .filter(|r| r.correct == Some(true))
                .count() as i64;

        let grading_error = self
            .grade_open(&set, &mut question_results, paths)
            .await
            .err();
        let (open_score, open_total) = open_totals(&set, &question_results);
        let answers = StoredAnswers {
            cloze_results,
            question_results,
            grading_error,
        };
        let mut tx = crate::services::srs::begin_write(&self.pool).await?;
        let updated = PassageRepository::complete_attempt_conn(
            &mut tx,
            attempt.id,
            &AttemptOutcome {
                answers: &answers,
                objective_correct,
                objective_total,
                open_score,
                open_total,
                active_time: request.active_time,
            },
        )
        .await?;
        if !updated {
            return Err(AppError::ValidationError(
                "这次练习已经提交过了".to_string(),
            ));
        }
        // 计划里的短文任务：完成对应任务，计划可能随之自动完成
        if let Some(plan_id) = attempt.plan_id {
            let plans = StudyPlanRepository::new(self.pool.clone(), self.logger.clone());
            plan_passages::on_attempt_completed_conn(
                &plans,
                &mut tx,
                plan_id,
                attempt.passage_id,
                attempt.set_id,
                &attempt.mode,
                attempt.id,
            )
            .await?;
        }
        tx.commit().await?;
        self.attempt(attempt.id).await
    }

    /// 开放题评分失败后重试
    pub async fn regrade(&self, attempt_id: Id, paths: &AgentPaths) -> AppResult<PassageAttempt> {
        let attempt = self.attempt(attempt_id).await?;
        if attempt.status != "completed" {
            return Err(AppError::ValidationError("请先提交这次练习".to_string()));
        }
        let set = self.get_set(attempt.set_id).await?;
        let mut question_results = attempt.question_results;
        let grading_error = self
            .grade_open(&set, &mut question_results, paths)
            .await
            .err();
        let (open_score, _) = open_totals(&set, &question_results);
        self.repository
            .update_open_grades(
                attempt_id,
                &StoredAnswers {
                    cloze_results: attempt.cloze_results,
                    question_results,
                    grading_error,
                },
                open_score,
            )
            .await?;
        self.attempt(attempt_id).await
    }

    /// 给还没有分数的开放题评分；空白回答直接 0 分，不调用模型。失败时返回给用户看的原因
    async fn grade_open(
        &self,
        set: &QuestionSet,
        results: &mut [QuestionResult],
        paths: &AgentPaths,
    ) -> Result<(), String> {
        let questions: HashMap<Id, &crate::types::passage::PassageQuestion> =
            set.questions.iter().map(|q| (q.id, q)).collect();
        let mut pending: Vec<usize> = Vec::new();
        for (i, r) in results.iter_mut().enumerate() {
            let Some(q) = questions.get(&r.question_id) else {
                continue;
            };
            if q.kind != "open" || r.score.is_some() {
                continue;
            }
            if r.given.is_empty() {
                r.score = Some(0);
                r.feedback = Some("没有作答。试着用英文写一两句话回答这个问题吧。".into());
            } else {
                pending.push(i);
            }
        }
        if pending.is_empty() {
            return Ok(());
        }
        let run = async {
            let sentences = self
                .repository
                .sentences(set.passage_id)
                .await?
                .unwrap_or_default();
            let profile = PromptProfileService::load(&self.pool).await?;
            let model = self.model().await?;
            let answers: Vec<tasks::OpenAnswer> = pending
                .iter()
                .map(|&i| {
                    let q = questions[&results[i].question_id];
                    tasks::OpenAnswer {
                        question: &q.stem,
                        reference_answer: q.reference_answer.as_deref().unwrap_or(""),
                        rubric: &q.rubric,
                        answer: &results[i].given,
                    }
                })
                .collect();
            tasks::grade_open_answers(
                paths,
                &model,
                &profile,
                &passage_text(&sentences),
                &answers,
                &self.logger,
            )
            .await
        };
        let grades = run.await.map_err(|e| {
            self.logger
                .error("PASSAGE", "开放题评分失败", Some(&e.to_string()));
            format!("开放题评分失败：{}", e)
        })?;
        let mut missing = 0;
        for (&i, grade) in pending.iter().zip(grades) {
            match grade {
                Some((score, feedback, suggestion)) => {
                    results[i].score = Some(score);
                    results[i].feedback = Some(feedback);
                    results[i].suggestion = suggestion;
                }
                None => missing += 1,
            }
        }
        if missing > 0 {
            return Err(format!("有 {} 道开放题没有评出分数", missing));
        }
        Ok(())
    }
}

/// 开放题总分：全部评出分数才计入（否则为 None，等待重试）
fn open_totals(set: &QuestionSet, results: &[QuestionResult]) -> (Option<i64>, Option<i64>) {
    let open_ids: HashSet<Id> = set
        .questions
        .iter()
        .filter(|q| q.kind == "open")
        .map(|q| q.id)
        .collect();
    if open_ids.is_empty() {
        return (None, None);
    }
    let score = results
        .iter()
        .filter(|r| open_ids.contains(&r.question_id))
        .map(|r| r.score)
        .sum::<Option<i64>>();
    (score, Some(open_ids.len() as i64 * OPEN_MAX_SCORE))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::services::passage_rules::{GeneratedPassage, GeneratedQuestionSet, NewQuestion};
    use crate::test_support::{memory_pool, test_logger};
    use crate::types::passage::{PassageAnswer, QuestionSetSpec};

    async fn seed_words(pool: &Arc<SqlitePool>) {
        sqlx::raw_sql(
            "INSERT INTO word_books (id, title, description, created_at, updated_at, last_used)
             VALUES (970, '出国旅行', '机场与海关', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
                    (971, '酒店', '入住与退房', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
             INSERT INTO words (id, word, meaning, word_book_id, created_at, updated_at) VALUES
               (9701, 'passport', '护照', 970, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
               (9702, 'customs', '海关', 970, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
               (9703, 'gate', '登机口', 970, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
               (9704, 'ticket', '票', 970, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
               (9711, 'room', '房间', 971, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
               (9712, 'key', '钥匙', 971, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');",
        )
        .execute(pool.as_ref())
        .await
        .unwrap();
    }

    fn sentences() -> Vec<PassageSentence> {
        [
            (
                "Tom has his passport and a ticket.",
                "汤姆带着护照和一张票。",
            ),
            (
                "He goes to customs, then to the gate.",
                "他去海关，然后去登机口。",
            ),
            ("He is happy to fly today.", "他今天坐飞机很开心。"),
        ]
        .iter()
        .map(|(en, zh)| PassageSentence {
            en: en.to_string(),
            zh: zh.to_string(),
            paragraph: false,
            start_ms: None,
            end_ms: None,
        })
        .collect()
    }

    /// 一篇短文 + 一套题（选词填空 2、选择 1、判断 1、开放 1）
    /// 再加一篇没有题组的短文（计划测试用）
    pub(crate) async fn seed_plain_passage(pool: &Arc<SqlitePool>, title: &str) -> Id {
        let mut tx = pool.begin().await.unwrap();
        let id = PassageRepository::insert_passage_conn(
            &mut tx,
            &NewPassage {
                origin: "generated",
                source_label: None,
                scene: None,
                level: "a1",
                sources: &[],
                model_name: None,
                prompt_fingerprint: None,
            },
            &GeneratedPassage {
                title: title.into(),
                sentences: sentences(),
                target_words: vec![],
                word_count: 21,
                tags: Vec::new(),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        id
    }

    /// 短文（目标词 passport / customs / fly）+ 一套 5 题的题组（2 空 + 选择 + 判断 + 开放）
    pub(crate) async fn seed_passage(pool: &Arc<SqlitePool>) -> (Id, Id) {
        seed_words(pool).await;
        let word = |id: Option<Id>, w: &str, required: bool| PassageTargetWord {
            word_id: id,
            word: w.into(),
            required,
            meaning: None,
            forms: Vec::new(),
        };
        let generated = GeneratedPassage {
            title: "At the Airport".into(),
            sentences: sentences(),
            target_words: vec![
                word(Some(9701), "passport", true),
                word(Some(9702), "customs", false),
                word(None, "fly", true),
            ],
            word_count: 21,
            tags: Vec::new(),
        };
        let sources = vec![PassageSource {
            kind: "book".into(),
            ref_id: 970,
            name: "出国旅行".into(),
            detail: None,
            exists: true,
        }];
        let mut tx = pool.begin().await.unwrap();
        let passage_id = PassageRepository::insert_passage_conn(
            &mut tx,
            &NewPassage {
                origin: "generated",
                source_label: None,
                scene: Some("机场"),
                level: "a1",
                sources: &sources,
                model_name: Some("K3"),
                prompt_fingerprint: None,
            },
            &generated,
        )
        .await
        .unwrap();
        let q = |kind: &str, stem: &str, answer: Option<&str>, sentence: Option<i64>| NewQuestion {
            kind: kind.into(),
            stem: stem.into(),
            options: if kind == "choice" {
                vec!["a dog".into(), "a ticket".into(), "a cake".into()]
            } else {
                vec![]
            },
            answer: answer.map(String::from),
            explanation: None,
            reference_answer: (kind == "open").then(|| "I want to fly to Paris.".into()),
            rubric: if kind == "open" {
                vec!["说出地点".into()]
            } else {
                vec![]
            },
            sentence_index: sentence,
        };
        let spec = QuestionSetSpec {
            cloze: 2,
            choice: 1,
            true_false: 1,
            open: 1,
            difficulty: "standard".into(),
        };
        let set_id = PassageRepository::insert_set_conn(
            &mut tx,
            &NewQuestionSet {
                passage_id,
                name: "第 1 套",
                spec: &spec,
                model_name: Some("K3"),
                prompt_fingerprint: None,
            },
            &GeneratedQuestionSet {
                questions: vec![
                    q("cloze", "passport", Some("passport"), Some(0)),
                    q("cloze", "customs", Some("customs"), Some(1)),
                    q("choice", "What does Tom have?", Some("1"), None),
                    q(
                        "true_false",
                        "Tom goes to the gate first.",
                        Some("false"),
                        None,
                    ),
                    q("open", "Where do you want to fly?", None, None),
                ],
                cloze_distractors: vec!["visa".into()],
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        (passage_id, set_id)
    }

    #[tokio::test]
    async fn passage_with_sets_round_trips_and_survives_source_deletion() {
        let pool = memory_pool().await;
        let (id, set_id) = seed_passage(&pool).await;
        let service = PassageService::new(pool.clone(), test_logger());
        let p = service.get(id).await.unwrap();
        assert_eq!(p.sentences.len(), 3);
        // 手动输入的 fly 没有资料，只返回词汇本里的两个词
        let details = service.target_word_details(id).await.unwrap();
        assert_eq!(
            details.iter().map(|w| w.word.as_str()).collect::<Vec<_>>(),
            vec!["passport", "customs"]
        );
        assert_eq!(p.question_sets.len(), 1);
        assert_eq!(p.question_sets[0].spec.cloze, 2);
        assert!(p.target_words[0].required && !p.target_words[1].required);
        let set = service.get_set(set_id).await.unwrap();
        assert_eq!(set.questions.len(), 5);
        assert_eq!(set.questions[0].sentence_index, Some(0));
        let mut bank = set.cloze_bank.clone();
        bank.sort();
        assert_eq!(bank, vec!["customs", "passport", "visa"]);
        let list = service.list(Some(970), None, None).await.unwrap();
        assert_eq!((list.len(), list[0].question_sets), (1, 1));
        assert!(service
            .list(Some(971), None, None)
            .await
            .unwrap()
            .is_empty());

        // 删除来源词汇本：短文还在，来源标为已删除
        sqlx::query("DELETE FROM word_books WHERE id = 970")
            .execute(pool.as_ref())
            .await
            .unwrap();
        let p = service.get(id).await.unwrap();
        assert!(!p.sources[0].exists);
        // 删除题组只删题目，短文还在；删除短文连同题组
        service.delete_set(set_id).await.unwrap();
        assert!(service.get(id).await.unwrap().question_sets.is_empty());
        service.delete(id).await.unwrap();
        assert!(service.get(id).await.is_err());
    }

    #[tokio::test]
    async fn candidates_merge_books_and_plans_without_suggestions() {
        let pool = memory_pool().await;
        seed_passage(&pool).await;
        let service = PassageService::new(pool.clone(), test_logger());
        let list = service
            .candidates(&PassageWordSources {
                book_ids: vec![970, 971],
                plan_ids: vec![],
                plan_scopes: vec![],
            })
            .await
            .unwrap();
        assert_eq!(list.len(), 6);
        let usage: HashMap<&str, i64> = list.iter().map(|c| (c.word.as_str(), c.usage)).collect();
        assert_eq!(
            (usage["passport"], usage["customs"], usage["gate"]),
            (1, 1, 0)
        );

        assert!(list.iter().all(|c| c.tags.is_empty()));
    }

    /// 计划的取词策略：按真实的练习记录（经练习会话关联到计划）与记忆等级打标签，多选取并集
    #[tokio::test]
    async fn plan_strategies_follow_practice_records_and_memory_levels() {
        use crate::test_support::{seed_schedule, seed_session, seed_step};
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 4).await;
        let today = crate::time::format_date(crate::time::local_today());
        // word1：等级 1、答错过；word2：等级 4、很久以前学的；word3：等级 3、今天到期；word4：还没学
        for (i, (srs_box, due)) in [
            (1, "2999-01-01"),
            (4, "2999-01-01"),
            (3, today.as_str()),
            (0, "2999-01-01"),
        ]
        .iter()
        .enumerate()
        {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id, srs_box, srs_due) VALUES (?, ?, ?, ?)")
                .bind(fx.plan_id)
                .bind(fx.word_ids[i])
                .bind(srs_box)
                .bind(due)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }
        seed_session(&pool, &fx, "s1", true).await;
        let now = crate::time::now_utc();
        seed_step(
            &pool,
            "s1",
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            1,
            false,
            &now,
        )
        .await;
        seed_step(
            &pool,
            "s1",
            fx.word_ids[1],
            fx.schedule_word_ids[1],
            1,
            true,
            "2026-01-01T00:00:00.000Z",
        )
        .await;
        seed_step(
            &pool,
            "s1",
            fx.word_ids[2],
            fx.schedule_word_ids[2],
            1,
            true,
            &now,
        )
        .await;

        let service = PassageService::new(pool.clone(), test_logger());
        let pick = |scopes: &[&str]| PassageWordSources {
            book_ids: vec![],
            plan_ids: vec![fx.plan_id],
            plan_scopes: scopes.iter().map(|s| s.to_string()).collect(),
        };
        let words =
            |list: Vec<PassageWordCandidate>| list.into_iter().map(|c| c.word).collect::<Vec<_>>();
        let all = service.candidates(&pick(&["learned"])).await.unwrap();
        // 错得多、等级低的在前；未学的词不出现
        assert_eq!(words(all.clone()), vec!["word1", "word3", "word2"]);
        assert_eq!(all[0].tags, vec!["wrong", "weak", "recent"]);
        assert_eq!(all[1].tags, vec!["recent", "upcoming"]);
        assert_eq!(all[2].tags, vec!["mastered"]);
        assert_eq!(
            words(service.candidates(&pick(&["wrong"])).await.unwrap()),
            vec!["word1"]
        );
        assert_eq!(
            words(
                service
                    .candidates(&pick(&["upcoming", "mastered"]))
                    .await
                    .unwrap()
            ),
            vec!["word3", "word2"]
        );
        assert_eq!(
            words(service.candidates(&pick(&["recent"])).await.unwrap()),
            vec!["word1", "word3"]
        );
        assert_eq!(
            words(service.candidates(&pick(&[])).await.unwrap()).len(),
            3
        );
        assert!(service.candidates(&pick(&["weird"])).await.is_err());
        let counts: Vec<(String, i64)> = service
            .plan_scope_counts(&[fx.plan_id])
            .await
            .unwrap()
            .into_iter()
            .map(|c| (c.scope, c.count))
            .collect();
        assert_eq!(
            counts,
            [
                ("wrong", 1),
                ("weak", 1),
                ("recent", 2),
                ("upcoming", 1),
                ("mastered", 1),
                ("learned", 3)
            ]
            .map(|(s, n)| (s.to_string(), n))
            .to_vec()
        );
        // 来源快照记下所选策略
        let snapshot = service
            .source_snapshots(&pick(&["wrong", "weak"]))
            .await
            .unwrap();
        assert_eq!(snapshot[0].detail.as_deref(), Some("wrong,weak"));
    }

    /// 词汇本来源的学习情况按所有计划里的记忆等级与答错记录判断；AI 挑词的候选池按学习情况筛选
    #[tokio::test]
    async fn book_words_carry_learning_statuses_and_filter_the_pool() {
        use crate::test_support::{seed_schedule, seed_session, seed_step};
        let pool = memory_pool().await;
        let fx = seed_schedule(&pool, 4).await;
        // word1：等级 1、答错过；word2：等级 4；word3：等级 2；word4：没进计划
        for (i, srs_box) in [1, 4, 2].iter().enumerate() {
            sqlx::query("INSERT INTO study_plan_words (plan_id, word_id, srs_box, srs_due) VALUES (?, ?, ?, '2999-01-01')")
                .bind(fx.plan_id)
                .bind(fx.word_ids[i])
                .bind(srs_box)
                .execute(pool.as_ref())
                .await
                .unwrap();
        }
        seed_session(&pool, &fx, "s1", true).await;
        let now = crate::time::now_utc();
        seed_step(
            &pool,
            "s1",
            fx.word_ids[0],
            fx.schedule_word_ids[0],
            1,
            false,
            &now,
        )
        .await;
        let book_id: Id = sqlx::query_scalar("SELECT word_book_id FROM words WHERE id = ?")
            .bind(fx.word_ids[0])
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        let service = PassageService::new(pool.clone(), test_logger());
        let sources = PassageWordSources {
            book_ids: vec![book_id],
            plan_ids: vec![],
            plan_scopes: vec![],
        };
        let statuses: HashMap<Id, Vec<String>> = service
            .candidates(&sources)
            .await
            .unwrap()
            .into_iter()
            .map(|c| (c.word_id, c.statuses))
            .collect();
        assert_eq!(statuses[&fx.word_ids[0]], vec!["learning", "wrong"]);
        assert_eq!(statuses[&fx.word_ids[1]], vec!["mastered"]);
        assert_eq!(statuses[&fx.word_ids[2]], vec!["learning"]);
        assert_eq!(statuses[&fx.word_ids[3]], vec!["new"]);

        let request = |filter: &[&str]| GeneratePassageRequest {
            book_ids: vec![book_id],
            plan_ids: vec![],
            plan_scopes: vec![],
            required_word_ids: vec![fx.word_ids[0]],
            extra_words: vec![],
            extra_meanings: Default::default(),
            ai_pick: 5,
            pick_statuses: filter.iter().map(|s| s.to_string()).collect(),
            pick_difficulty: Some("easy".into()),
            pick_frequency: None,
            topic: None,
            instruction: None,
            length: None,
            plan_item: None,
        };
        let pool_ids = |words: Vec<PassageTargetWord>| {
            let mut ids: Vec<Id> = words.into_iter().filter_map(|w| w.word_id).collect();
            ids.sort();
            ids
        };
        // 必用词不进候选池；只要没学过的和常错的（word1 是必用词）
        let (_, picked, _) = service
            .resolve_words(&request(&["new", "wrong"]))
            .await
            .unwrap();
        assert_eq!(pool_ids(picked), vec![fx.word_ids[3]]);
        let (_, picked, _) = service.resolve_words(&request(&[])).await.unwrap();
        assert_eq!(pool_ids(picked).len(), 3);
        // 筛完没有可挑的词时报错；未知条件被拒绝
        let mut empty = request(&["mastered"]);
        empty.required_word_ids = vec![fx.word_ids[1]];
        assert!(service.chosen_words(&empty).await.is_err());
        // 按描述生成：没有单词也可以；写作要求有长度上限
        let mut brief = request(&[]);
        brief.book_ids.clear();
        brief.ai_pick = 0;
        brief.required_word_ids.clear();
        assert!(service.chosen_words(&brief).await.is_err());
        brief.instruction = Some("写一篇关于第一次去海边露营的小故事".into());
        assert!(service.chosen_words(&brief).await.is_ok());
        brief.instruction = Some("长".repeat(INSTRUCTION_MAX + 1));
        assert!(PassageService::validate_request(&brief).is_err());
        let mut bad = request(&["often"]);
        assert!(PassageService::validate_request(&bad).is_err());
        bad.pick_statuses.clear();
        bad.pick_frequency = Some("rare".into());
        assert!(PassageService::validate_request(&bad).is_err());
    }

    #[tokio::test]
    async fn required_words_and_pool_exclude_each_other() {
        let pool = memory_pool().await;
        seed_words(&pool).await;
        let service = PassageService::new(pool.clone(), test_logger());
        let request = |ids: Vec<Id>, extra: Vec<&str>, ai_pick: i64| GeneratePassageRequest {
            book_ids: vec![970],
            plan_ids: vec![],
            plan_scopes: vec![],
            required_word_ids: ids,
            extra_words: extra.into_iter().map(String::from).collect(),
            extra_meanings: Default::default(),
            ai_pick,
            pick_statuses: vec![],
            pick_difficulty: None,
            pick_frequency: None,
            topic: None,
            instruction: None,
            length: None,
            plan_item: None,
        };
        let (required, pool_words, books) = service
            .resolve_words(&request(
                vec![9701, 9711, 9701],
                vec!["visa", "Passport"],
                3,
            ))
            .await
            .unwrap();
        assert_eq!(
            required.iter().map(|w| w.word.as_str()).collect::<Vec<_>>(),
            vec!["passport", "room", "visa"]
        );
        assert!(required.iter().all(|w| w.required));
        assert_eq!(required[2].word_id, None);
        assert_eq!(books, vec![970, 971]);
        assert_eq!(
            pool_words
                .iter()
                .map(|w| w.word.as_str())
                .collect::<Vec<_>>(),
            vec!["ticket", "gate", "customs"]
        );
        // 不让 AI 挑词时没有候选池
        let (_, empty, _) = service
            .resolve_words(&request(vec![9701], vec![], 0))
            .await
            .unwrap();
        assert!(empty.is_empty());
        assert!(service
            .resolve_words(&request(vec![], vec!["两个 词"], 0))
            .await
            .is_err());
        assert!(service
            .source_snapshots(&PassageWordSources {
                book_ids: vec![404],
                plan_ids: vec![],
                plan_scopes: vec![],
            })
            .await
            .is_err());
    }

    /// 按规划写的一篇：只接受真实存在的词与合法的手动词，保留必用 / AI 挑选标记
    #[tokio::test]
    async fn plan_item_words_are_checked_against_the_database() {
        let pool = memory_pool().await;
        seed_words(&pool).await;
        let service = PassageService::new(pool.clone(), test_logger());
        let w = |id: Option<Id>, word: &str, required: bool| PassageTargetWord {
            word_id: id,
            word: word.into(),
            required,
            meaning: None,
            forms: Vec::new(),
        };
        let item = crate::types::passage::PassagePlanItem {
            title: "At the Airport".into(),
            idea: "主角与目标：去机场".into(),
            words: vec![
                w(Some(9701), "PASSPORT（模型写错）", true),
                w(Some(404), "ghost", true),
                w(None, "visa", true),
                w(None, "两个 词", true),
                w(Some(9711), "room", false),
            ],
            length: "short".into(),
        };
        let (words, books) = service.plan_item_words(&item, false).await.unwrap();
        // 有 id 的词以数据库为准；不存在的 id 与非法手动词丢弃
        assert_eq!(
            words
                .iter()
                .map(|w| (w.word.as_str(), w.required))
                .collect::<Vec<_>>(),
            vec![("passport", true), ("visa", true), ("room", false)]
        );
        assert_eq!(books, vec![970, 971]);
        let empty = crate::types::passage::PassagePlanItem {
            words: vec![w(Some(404), "ghost", true)],
            ..item
        };
        assert!(service.plan_item_words(&empty, false).await.is_err());
        // 按描述生成：这一篇可以没有单词
        let (none, _) = service.plan_item_words(&empty, true).await.unwrap();
        assert!(none.is_empty());
    }

    #[tokio::test]
    async fn submit_requires_every_answer_then_grades() {
        let pool = memory_pool().await;
        let (passage_id, set_id) = seed_passage(&pool).await;
        let service = PassageService::new(pool.clone(), test_logger());
        let attempt = service
            .start_attempt(set_id, "reading", None)
            .await
            .unwrap();
        assert_eq!(attempt.passage_id, passage_id);
        // 再次开始续用同一条未提交的作答
        assert_eq!(
            service
                .start_attempt(set_id, "reading", None)
                .await
                .unwrap()
                .id,
            attempt.id
        );
        assert!(service
            .start_attempt(set_id, "speaking", None)
            .await
            .is_err());

        let set = service.get_set(set_id).await.unwrap();
        let id_of = |kind: &str| {
            set.questions
                .iter()
                .filter(|q| q.kind == kind)
                .map(|q| q.id)
                .collect::<Vec<_>>()
        };
        // 开放题为空白时不调用模型：给一个不存在的 sidecar 路径，确保不会启动它
        let paths = AgentPaths {
            program: "/nonexistent/redlark-agent".into(),
            root: std::env::temp_dir().join("redlark-passage-test"),
        };
        let answer = |question_id: Id, value: &str| PassageAnswer {
            question_id,
            value: value.into(),
        };
        let cloze = id_of("cloze");
        let mut request = SubmitPassageAttemptRequest {
            attempt_id: attempt.id,
            active_time: 90_000,
            answers: vec![
                answer(cloze[0], "Passport"),
                answer(cloze[1], "visa"),
                answer(id_of("choice")[0], "1"),
                answer(id_of("true_false")[0], "true"),
                answer(id_of("open")[0], "  "),
            ],
        };
        // 有题没作答（开放题空白、少一个填空）：拒绝提交，作答仍可继续
        let err = service.submit_attempt(&request, &paths).await.unwrap_err();
        assert!(err.to_string().contains("还有 1 题没有作答"), "{err}");
        request.answers.remove(1);
        request.answers[3] = answer(id_of("open")[0], "Because she was late.");
        let err = service.submit_attempt(&request, &paths).await.unwrap_err();
        assert!(err.to_string().contains("还有 1 题没有作答"), "{err}");
        assert_eq!(
            service.attempt(attempt.id).await.unwrap().status,
            "in_progress"
        );

        request.answers.push(answer(cloze[1], "visa"));
        let done = service.submit_attempt(&request, &paths).await.unwrap();
        assert_eq!(done.status, "completed");
        // 填空 1/2 + 选择对 + 判断错 = 2/4
        assert_eq!((done.objective_correct, done.objective_total), (2, 4));
        // 开放题评分失败（没有 sidecar）不影响提交：没有分数，可重新评分
        assert_eq!((done.open_score, done.open_total), (None, Some(4)));
        assert!(done.grading_error.is_some());
        assert_eq!(done.cloze_results.len(), 2);
        assert_eq!(done.question_results.len(), 3);
        assert!(service.submit_attempt(&request, &paths).await.is_err());

        // 听力模式：选词填空是听句填空，同样作答、判分
        let listening = service
            .start_attempt(set_id, "listening", None)
            .await
            .unwrap();
        let heard = service
            .submit_attempt(
                &SubmitPassageAttemptRequest {
                    attempt_id: listening.id,
                    active_time: 1_000,
                    answers: vec![
                        answer(cloze[0], "Passport"),
                        answer(cloze[1], "visa"),
                        answer(id_of("choice")[0], "1"),
                        answer(id_of("true_false")[0], "false"),
                        answer(id_of("open")[0], "She went home."),
                    ],
                },
                &paths,
            )
            .await
            .unwrap();
        assert_eq!((heard.objective_correct, heard.objective_total), (3, 4));
        assert_eq!(heard.cloze_results.len(), 2);

        let stats = service.statistics(None).await.unwrap();
        assert_eq!(
            (stats.total_passages, stats.total_sets, stats.passages),
            (1, 1, 1)
        );
        assert_eq!((stats.reading.attempts, stats.listening.attempts), (1, 1));
        assert!((stats.reading.objective_accuracy.unwrap() - 50.0).abs() < 1e-9);
        let p = service.get(passage_id).await.unwrap();
        assert_eq!(p.question_sets[0].completed_attempts, 2);
        crate::time::assert_instants_canonical(&pool).await;
    }
}
