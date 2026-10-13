//! 发音评估结果的保存与统计：学习计划里的跟读每次一行，统计常错的音（计划详情「发音」）。
//! 不进单词练习的正确率与记忆等级；素材上的自由跟读不保存。

use crate::error::{AppError, AppResult};
use crate::pronunciation::{Assessment, WordAssessment};
use crate::repositories::pronunciation_repository::{NewAttempt, PronunciationRepository};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;

/// 一个音低于这个分数算「读得不准」（与界面标准档指出的口径一致）
const WEAK_BELOW: u32 = 60;
/// 一个音至少读过几次才进排行
const MIN_TIMES: usize = 3;
/// 每个音最多列几个读错过的词
const MAX_WORDS: usize = 6;

/// 评估发生在哪里：带上时保存（只在学习计划里）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PronunciationContext {
    pub plan_id: i64,
    pub session_id: Option<String>,
    pub word_id: Option<i64>,
    pub passage_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundStat {
    /// 这个音（IPA）
    pub ipa: String,
    /// 读过几次
    pub times: usize,
    /// 其中读得不准的次数
    pub weak: usize,
    /// 最常听成的音（空字符串 = 常没读出来）
    pub heard_as: Option<String>,
    /// 读错过的词（新的在前，不重复）
    pub words: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PronunciationOverview {
    /// 跟读了几次
    pub attempts: usize,
    /// 平均分
    pub average: Option<u32>,
    /// 常错的音，不准的比例高的在前
    pub sounds: Vec<SoundStat>,
}

fn is_weak(score: u32, likely_confused: bool) -> bool {
    score < WEAK_BELOW || likely_confused
}

pub struct PronunciationService;

impl PronunciationService {
    /// 保存一次评估（没有能评分的词时不存）
    pub async fn record(
        pool: &SqlitePool,
        text: &str,
        assessment: &Assessment,
        context: &PronunciationContext,
    ) -> AppResult<()> {
        let Some(score) = assessment.score else {
            return Ok(());
        };
        let words: Vec<&WordAssessment> = assessment.words.iter().filter(|w| w.known).collect();
        let detail =
            serde_json::to_string(&words).map_err(|e| AppError::InternalError(e.to_string()))?;
        let source = if assessment.words.len() > 1 {
            "sentence"
        } else {
            "word"
        };
        PronunciationRepository::insert(
            pool,
            &NewAttempt {
                plan_id: context.plan_id,
                session_id: context.session_id.as_deref(),
                source,
                word_id: context.word_id,
                passage_id: context.passage_id,
                text: text.trim(),
                score: score as i64,
                detail: &detail,
            },
        )
        .await?;
        Ok(())
    }

    pub async fn overview(pool: &SqlitePool, plan_id: i64) -> AppResult<PronunciationOverview> {
        let rows = PronunciationRepository::list_by_plan(pool, plan_id).await?;
        Ok(summarize(rows.iter().map(|r| {
            (
                r.score,
                serde_json::from_str::<Vec<WordAssessment>>(&r.detail).unwrap_or_default(),
            )
        })))
    }
}

#[derive(Default)]
struct Tally {
    times: usize,
    weak: usize,
    heard: HashMap<String, usize>,
    words: Vec<String>,
}

/// 汇总（输入新的在前）
fn summarize(attempts: impl Iterator<Item = (i64, Vec<WordAssessment>)>) -> PronunciationOverview {
    let mut count = 0usize;
    let mut total = 0i64;
    let mut tallies: HashMap<String, Tally> = HashMap::new();
    for (score, words) in attempts {
        count += 1;
        total += score;
        for word in &words {
            for phone in &word.phones {
                let t = tallies.entry(phone.ipa.clone()).or_default();
                t.times += 1;
                if !is_weak(phone.score, phone.likely_confused) {
                    continue;
                }
                t.weak += 1;
                if let Some(h) = &phone.heard_as {
                    *t.heard.entry(h.clone()).or_default() += 1;
                }
                let w = word.word.to_lowercase();
                if t.words.len() < MAX_WORDS && !t.words.contains(&w) {
                    t.words.push(w);
                }
            }
        }
    }
    let mut sounds: Vec<SoundStat> = tallies
        .into_iter()
        .filter(|(_, t)| t.times >= MIN_TIMES && t.weak > 0)
        .map(|(ipa, t)| SoundStat {
            ipa,
            times: t.times,
            weak: t.weak,
            heard_as: t
                .heard
                .into_iter()
                .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
                .map(|(h, _)| h),
            words: t.words,
        })
        .collect();
    sounds.sort_by(|a, b| {
        (b.weak * a.times)
            .cmp(&(a.weak * b.times))
            .then(b.weak.cmp(&a.weak))
            .then_with(|| a.ipa.cmp(&b.ipa))
    });
    PronunciationOverview {
        attempts: count,
        average: (count > 0).then(|| (total as f64 / count as f64).round() as u32),
        sounds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pronunciation::PhoneAssessment;
    use crate::test_support::memory_pool;

    fn phone(ipa: &str, score: u32, heard: Option<&str>) -> PhoneAssessment {
        PhoneAssessment {
            ipa: ipa.into(),
            score,
            heard_as: heard.map(Into::into),
            likely_confused: false,
        }
    }

    fn word(w: &str, phones: Vec<PhoneAssessment>) -> WordAssessment {
        WordAssessment {
            word: w.into(),
            known: true,
            score: Some(80),
            phones,
        }
    }

    #[test]
    fn ranks_sounds_by_weak_ratio_and_lists_words() {
        let think = word(
            "think",
            vec![phone("θ", 20, Some("s")), phone("ɪ", 90, None)],
        );
        let three = word(
            "Three",
            vec![phone("θ", 30, Some("s")), phone("i", 90, None)],
        );
        let thin = word(
            "thin",
            vec![phone("θ", 95, None), phone("ɪ", 50, Some("i"))],
        );
        let o = summarize(
            vec![
                (60, vec![think.clone()]),
                (70, vec![three]),
                (90, vec![thin]),
                (60, vec![think]),
            ]
            .into_iter(),
        );
        assert_eq!(o.attempts, 4);
        assert_eq!(o.average, Some(70));
        // θ 4 次错 3 次排第一；ɪ 3 次错 1 次；i 只读过 1 次不进
        assert_eq!(o.sounds.len(), 2);
        assert_eq!(o.sounds[0].ipa, "θ");
        assert_eq!((o.sounds[0].times, o.sounds[0].weak), (4, 3));
        assert_eq!(o.sounds[0].heard_as.as_deref(), Some("s"));
        assert_eq!(o.sounds[0].words, vec!["think", "three"]);
        assert_eq!(o.sounds[1].ipa, "ɪ");
    }

    #[tokio::test]
    async fn records_in_plan_and_skips_unscored() {
        let pool = memory_pool().await;
        let plan_id = crate::test_support::seed_schedule(&pool, 1).await.plan_id;
        let assessment = Assessment {
            score: Some(55),
            words: vec![word("think", vec![phone("θ", 20, Some("s"))])],
            heard: String::new(),
            voiced: true,
        };
        let context = PronunciationContext {
            plan_id,
            session_id: None,
            word_id: None,
            passage_id: None,
        };
        PronunciationService::record(&pool, "think", &assessment, &context)
            .await
            .unwrap();
        let unscored = Assessment {
            score: None,
            ..assessment
        };
        PronunciationService::record(&pool, "think", &unscored, &context)
            .await
            .unwrap();
        let rows = PronunciationRepository::list_by_plan(&pool, plan_id)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].score, 55);
        crate::time::assert_instants_canonical(&pool).await;
    }
}
