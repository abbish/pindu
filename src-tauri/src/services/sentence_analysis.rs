//! 句子分析：短文 / 视频台词里的一句话 → 句式、成分、语法点、交际功能、词组、发音要点（agent 任务）。
//! 按句子文字缓存（sentence_analyses，065），各短文共用；「重新分析」时覆盖。
//! 模型的提交在这里按原句校正：片段必须出自原句，词组原形要合法，数量有上限。

use crate::agent::{tasks, AgentPaths};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::repositories::passage_repository::PassageRepository;
use crate::repositories::sentence_analysis_repository::SentenceAnalysisRepository;
use crate::services::agent_settings::{AgentSettingsService, AgentTaskKind};
use crate::services::passage_rules;
use crate::services::prompt_profile::PromptProfileService;
use crate::types::passage::{
    AlternativeExpression, AnalyzeSentenceRequest, GrammarPoint, Passage, PronunciationTip,
    SentenceAnalysis, SentenceChunk, SentencePhrase,
};
use serde_json::Value;
use sqlx::SqlitePool;
use std::sync::Arc;

const MAX_GRAMMAR: usize = 3;
const MAX_PHRASES: usize = 4;
const MAX_PRONUNCIATION: usize = 4;
const MAX_ALTERNATIVES: usize = 3;

fn text(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn list(v: &Value, key: &str) -> Vec<Value> {
    v.get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// 片段在原句里的位置（整词、忽略大小写与多余空白）：从 `from` 起找，返回结束位置
fn find_in(sentence: &str, part: &str, from: usize) -> Option<usize> {
    let hay = sentence.to_ascii_lowercase();
    let needle = part
        .replace(['\u{2019}', '\u{2018}'], "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    let needle = needle.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'');
    if needle.is_empty() {
        return None;
    }
    let is_word = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric());
    let mut at = from;
    while let Some(i) = hay.get(at..)?.find(needle) {
        let start = at + i;
        let end = start + needle.len();
        if !is_word(hay[..start].chars().next_back()) && !is_word(hay[end..].chars().next()) {
            return Some(end);
        }
        at = start + 1;
        while !hay.is_char_boundary(at) {
            at += 1;
        }
    }
    None
}

fn in_sentence(sentence: &str, part: &str) -> bool {
    find_in(sentence, part, 0).is_some()
}

/// `submit_sentence_analysis` 的参数 → 校正后的分析；句式或交际功能缺失时报错
pub fn analysis_from_submission(
    details: &Value,
    sentence: &str,
) -> Result<SentenceAnalysis, String> {
    // 原句里的弯撇号按直撇号比对（模型抄写时常把 don’t 写成 don't）；位置只用于判断出处与先后
    let normalized = sentence.replace(['\u{2019}', '\u{2018}'], "'");
    let sentence = normalized.as_str();
    let pattern = text(details, "pattern");
    let function = text(details, "function");
    if pattern.is_empty() || function.is_empty() {
        return Err("AI 的分析不完整，请再试一次".to_string());
    }

    // 成分：按顺序出自原句；找不到的丢掉，剩下不到一半时整段不要
    let raw_chunks = list(details, "chunks");
    let mut chunks = Vec::new();
    let mut at = 0;
    for c in &raw_chunks {
        let (t, role) = (text(c, "text"), text(c, "role"));
        if t.is_empty() || role.is_empty() {
            continue;
        }
        if let Some(end) = find_in(sentence, &t, at) {
            at = end;
            chunks.push(SentenceChunk { text: t, role });
        }
    }
    if chunks.len() * 2 < raw_chunks.len() || chunks.len() < 2 {
        chunks.clear();
    }

    let grammar = list(details, "grammar")
        .iter()
        .filter_map(|g| {
            let (title, explanation) = (text(g, "title"), text(g, "explanation"));
            let t = text(g, "text");
            (!title.is_empty() && !explanation.is_empty()).then(|| GrammarPoint {
                title,
                text: if in_sentence(sentence, &t) {
                    t
                } else {
                    String::new()
                },
                explanation,
            })
        })
        .take(MAX_GRAMMAR)
        .collect();

    // 词组：原形是合法的多词词组，且原句里用到了它（可变形；拆开用的按 AI 给的原句写法核对，D47）
    let mut phrases: Vec<SentencePhrase> = Vec::new();
    for p in list(details, "phrases") {
        let base = crate::types::wordbook::normalize_vocab(&text(&p, "base")).to_lowercase();
        let (t, meaning) = (text(&p, "text"), text(&p, "meaning"));
        if meaning.is_empty()
            || !passage_rules::is_phrase(&base)
            || !passage_rules::valid_vocab(&base)
            || !passage_rules::text_uses_forms(
                sentence,
                &base,
                &passage_rules::annotated_forms(
                    &[serde_json::json!({ "phrase": base, "text": t })],
                    sentence,
                    &base,
                ),
            )
            || phrases.iter().any(|x| x.base == base)
        {
            continue;
        }
        phrases.push(SentencePhrase {
            text: if in_sentence(sentence, &t) {
                t
            } else {
                base.clone()
            },
            base,
            meaning,
        });
        if phrases.len() >= MAX_PHRASES {
            break;
        }
    }

    let pronunciation = list(details, "pronunciation")
        .iter()
        .filter_map(|p| {
            let (t, tip) = (text(p, "text"), text(p, "tip"));
            (!tip.is_empty() && in_sentence(sentence, &t))
                .then_some(PronunciationTip { text: t, tip })
        })
        .take(MAX_PRONUNCIATION)
        .collect();

    let same = |a: &str| a.trim().eq_ignore_ascii_case(sentence.trim());
    let alternatives = list(details, "alternatives")
        .iter()
        .filter_map(|a| {
            let (en, zh) = (text(a, "en"), text(a, "zh"));
            (!en.is_empty() && !zh.is_empty() && !same(&en))
                .then_some(AlternativeExpression { en, zh })
        })
        .take(MAX_ALTERNATIVES)
        .collect();

    Ok(SentenceAnalysis {
        pattern,
        pattern_note: text(details, "pattern_note"),
        chunks,
        grammar,
        function,
        function_note: text(details, "function_note"),
        alternatives,
        phrases,
        pronunciation,
    })
}

/// 给 AI 老师看的分析摘要（纯文本）
pub fn summary(a: &SentenceAnalysis) -> String {
    let mut lines = vec![format!("句式：{}", a.pattern)];
    if !a.pattern_note.is_empty() {
        lines.push(format!("句式说明：{}", a.pattern_note));
    }
    if !a.chunks.is_empty() {
        let parts: Vec<String> = a
            .chunks
            .iter()
            .map(|c| format!("{}（{}）", c.text, c.role))
            .collect();
        lines.push(format!("成分：{}", parts.join(" / ")));
    }
    for g in &a.grammar {
        lines.push(format!(
            "语法：{}{}——{}",
            g.title,
            if g.text.is_empty() {
                String::new()
            } else {
                format!("「{}」", g.text)
            },
            g.explanation
        ));
    }
    lines.push(format!(
        "交际功能：{}{}",
        a.function,
        if a.function_note.is_empty() {
            String::new()
        } else {
            format!("。{}", a.function_note)
        }
    ));
    for p in &a.phrases {
        lines.push(format!("词组：{}（{}）", p.base, p.meaning));
    }
    for p in &a.pronunciation {
        lines.push(format!("发音：「{}」{}", p.text, p.tip));
    }
    lines.join("\n")
}

/// 一句话和它在短文里的上下文
pub struct SentenceInPassage {
    pub passage: Passage,
    pub index: usize,
}

impl SentenceInPassage {
    pub fn en(&self) -> &str {
        &self.passage.sentences[self.index].en
    }
    pub fn zh(&self) -> &str {
        &self.passage.sentences[self.index].zh
    }
    /// 前一句 / 后一句（没有为空）
    pub fn neighbors(&self) -> (&str, &str) {
        let s = &self.passage.sentences;
        let before = self
            .index
            .checked_sub(1)
            .map(|i| s[i].en.as_str())
            .unwrap_or("");
        let after = s.get(self.index + 1).map(|x| x.en.as_str()).unwrap_or("");
        (before, after)
    }
}

pub struct SentenceAnalysisService {
    pool: Arc<SqlitePool>,
    logger: Arc<Logger>,
}

impl SentenceAnalysisService {
    pub fn new(pool: Arc<SqlitePool>, logger: Arc<Logger>) -> Self {
        Self { pool, logger }
    }

    /// 短文里的第 `index` 句
    pub async fn sentence(&self, passage_id: i64, index: i64) -> AppResult<SentenceInPassage> {
        let passage = PassageRepository::new(self.pool.clone())
            .find(passage_id)
            .await?
            .ok_or_else(|| AppError::NotFound("短文不存在，可能已被删除".to_string()))?;
        let index = usize::try_from(index)
            .ok()
            .filter(|&i| i < passage.sentences.len())
            .ok_or_else(|| AppError::ValidationError("没有这一句".to_string()))?;
        Ok(SentenceInPassage { passage, index })
    }

    /// 已有的分析（没有为 None）
    pub async fn cached(&self, sentence: &str) -> AppResult<Option<SentenceAnalysis>> {
        SentenceAnalysisRepository::new(self.pool.clone())
            .find(sentence)
            .await
    }

    /// 分析一句：已有分析且不要求重新分析时直接返回，否则调用 AI 并保存
    pub async fn analyze(
        &self,
        request: &AnalyzeSentenceRequest,
        paths: &AgentPaths,
    ) -> AppResult<SentenceAnalysis> {
        let s = self
            .sentence(request.passage_id, request.sentence_index)
            .await?;
        if !request.refresh {
            if let Some(found) = self.cached(s.en()).await? {
                return Ok(found);
            }
        }
        let model = AgentSettingsService::new(self.pool.clone(), self.logger.clone())
            .model_for(AgentTaskKind::Explain, None)
            .await?;
        let profile = PromptProfileService::load(&self.pool).await?;
        let (before, after) = s.neighbors();
        let targets: Vec<String> = s
            .passage
            .target_words
            .iter()
            .map(|t| t.word.clone())
            .filter(|w| passage_rules::text_uses(s.en(), w))
            .collect();
        let details = tasks::analyze_sentence(
            paths,
            &model,
            &profile,
            &tasks::SentenceContext {
                sentence: s.en(),
                zh: s.zh(),
                title: &s.passage.title,
                before,
                after,
                targets: &targets,
            },
            &self.logger,
        )
        .await?;
        let analysis =
            analysis_from_submission(&details, s.en()).map_err(AppError::ExternalServiceError)?;
        SentenceAnalysisRepository::new(self.pool.clone())
            .upsert(s.en(), &analysis)
            .await?;
        Ok(analysis)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SENTENCE: &str = "She gave up her job because she wanted to travel.";

    #[test]
    fn submission_is_checked_against_the_sentence() {
        let details = json!({
            "pattern": "主语 + 谓语 + 宾语 + because + 原因从句",
            "pattern_note": "说明做某事的原因",
            "chunks": [
                {"text": "She", "role": "主语"},
                {"text": "gave up", "role": "谓语"},
                {"text": "her job", "role": "宾语"},
                {"text": "because she wanted to travel", "role": "原因状语从句"}
            ],
            "grammar": [
                {"title": "一般过去时", "text": "gave up", "explanation": "过去发生的事"},
                {"title": "不定式", "text": "not here", "explanation": "want to do"},
                {"title": "", "text": "", "explanation": "缺标题"}
            ],
            "function": "说明原因",
            "phrases": [
                {"text": "gave up", "base": "Give Up", "meaning": "放弃"},
                {"text": "gave up", "base": "give up", "meaning": "重复"},
                {"text": "her", "base": "her", "meaning": "单词不列"},
                {"text": "look after", "base": "look after", "meaning": "原句没有"}
            ],
            "pronunciation": [
                {"text": "gave up", "tip": "连读 /ɡeɪvʌp/"},
                {"text": "nowhere", "tip": "不在原句"}
            ],
            "alternatives": [{"en": SENTENCE, "zh": "和原句一样"}, {"en": "She quit her job to travel.", "zh": "她辞职去旅行。"}]
        });
        let a = analysis_from_submission(&details, SENTENCE).unwrap();
        assert_eq!(a.chunks.len(), 4);
        assert_eq!(a.grammar.len(), 2);
        assert_eq!(a.grammar[1].text, "", "不在原句的片段清空");
        assert_eq!(a.phrases.len(), 1);
        assert_eq!(a.phrases[0].base, "give up");
        assert_eq!(a.pronunciation.len(), 1);
        assert_eq!(a.alternatives.len(), 1);
        assert!(summary(&a).contains("give up"));

        // 成分顺序错乱、大半找不到：整段不要
        let scrambled = json!({"pattern": "x", "function": "y", "chunks": [
            {"text": "travel", "role": "宾语"}, {"text": "She", "role": "主语"}, {"text": "nope", "role": "?"}
        ]});
        assert!(analysis_from_submission(&scrambled, SENTENCE)
            .unwrap()
            .chunks
            .is_empty());
        assert!(analysis_from_submission(&json!({"pattern": "x"}), SENTENCE).is_err());

        // 原句是弯撇号、模型抄成直撇号：仍算出自原句
        let curly = json!({"pattern": "x", "function": "y",
            "pronunciation": [{"text": "don't", "tip": "t 不爆破"}]});
        let a = analysis_from_submission(&curly, "I don\u{2019}t know.").unwrap();
        assert_eq!(a.pronunciation.len(), 1);
    }

    #[tokio::test]
    async fn analysis_is_cached_by_sentence_text() {
        let pool = crate::test_support::memory_pool().await;
        let repo = SentenceAnalysisRepository::new(pool.clone());
        let a = SentenceAnalysis {
            pattern: "p".into(),
            function: "f".into(),
            ..Default::default()
        };
        repo.upsert("Hello  World.", &a).await.unwrap();
        assert_eq!(repo.find("hello world.").await.unwrap(), Some(a));
        assert_eq!(repo.find("other").await.unwrap(), None);
        crate::time::assert_instants_canonical(&pool).await;
    }
}
