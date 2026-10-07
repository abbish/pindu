//! 学习计划日程的确定性计算（docs/agent-harness/DECISIONS.md D13）。
//!
//! 模型只给出学习顺序与每词难度 / 优先级；日期、每日新词分配、元数据全部在这里计算，
//! 保证：每个词恰好新学一次、日期在计划周期内、同一天不会重复出现同一个词。
//! 复习不在这里预先排：由 `services::srs` 按每个词的记忆等级与实际练习结果每天动态安排（D20）。

use crate::error::{AppError, AppResult};
use crate::types::study::{DailyStudyPlan, DailyStudyWord, StudyPlanAIResult, StudyPlanMetadata};
use chrono::{Duration, NaiveDate};
use std::collections::{BTreeMap, HashSet};

/// 计划中的一个单词
#[derive(Debug, Clone, PartialEq)]
pub struct PlanWord {
    pub word_id: i64,
    pub word: String,
    pub wordbook_id: i64,
    pub meaning: Option<String>,
}

/// 模型对单词的判断
#[derive(Debug, Clone, PartialEq)]
pub struct WordAssessment {
    pub word_id: i64,
    /// 1（最容易）– 5
    pub difficulty: i32,
    /// high / medium / low
    pub priority: String,
}

#[derive(Debug, Clone)]
pub struct PlanParams {
    /// 每天新学的词数
    pub daily_new_words: i32,
    /// YYYY-MM-DD
    pub start_date: String,
}

/// 每天新词数的允许范围
pub const DAILY_NEW_WORDS_RANGE: std::ops::RangeInclusive<i32> = 1..=50;

/// 巩固期天数：最后一天学的词按 1 → 3 → 7 天的间隔复习三次（都答对）后升到掌握等级，
/// 需要 1 + 3 + 7 = 11 天（与 `srs::INTERVALS` 一致）
pub const CONSOLIDATION_DAYS: usize = 11;

/// 学新词的天数
pub fn learning_days(daily_new_words: i32, total_words: usize) -> usize {
    total_words.div_ceil(daily_new_words.max(1) as usize).max(1)
}

/// 兼容旧列 intensity_level：按每天新词数给出档位
pub fn intensity_label(daily_new_words: i32) -> (&'static str, &'static str) {
    match daily_new_words {
        ..=5 => ("easy", "轻松"),
        6..=12 => ("normal", "标准"),
        _ => ("intensive", "强化"),
    }
}

/// 难度估计（模型漏掉某词时兜底）：按长度
pub fn estimated_difficulty(word: &str) -> i32 {
    match word.chars().count() {
        0..=3 => 1,
        4..=5 => 2,
        6..=7 => 3,
        8..=9 => 4,
        _ => 5,
    }
}

/// 把模型给出的顺序规整为“每个词恰好一次”：忽略未知 / 重复 id，漏掉的词按原顺序追加（难度按长度估计）
pub fn normalize_order(
    words: &[PlanWord],
    assessed: &[WordAssessment],
) -> Vec<(PlanWord, WordAssessment)> {
    let by_id: BTreeMap<i64, &PlanWord> = words.iter().map(|w| (w.word_id, w)).collect();
    let mut seen = HashSet::new();
    let mut ordered = Vec::with_capacity(words.len());
    for a in assessed {
        if let Some(word) = by_id.get(&a.word_id) {
            if seen.insert(a.word_id) {
                let priority = match a.priority.as_str() {
                    "high" | "medium" | "low" => a.priority.clone(),
                    _ => "medium".to_string(),
                };
                ordered.push((
                    (*word).clone(),
                    WordAssessment {
                        word_id: a.word_id,
                        difficulty: a.difficulty.clamp(1, 5),
                        priority,
                    },
                ));
            }
        }
    }
    for word in words {
        if seen.insert(word.word_id) {
            ordered.push((
                word.clone(),
                WordAssessment {
                    word_id: word.word_id,
                    difficulty: estimated_difficulty(&word.word),
                    priority: "medium".to_string(),
                },
            ));
        }
    }
    ordered
}

/// 生成日程：新词按顺序均分到前 L 天（L = ⌈词数 / 每天新词数⌉，每天数量相差不超过 1）；
/// 周期 = L + 巩固期。复习由 `services::srs` 每天按实际练习结果动态安排，这里不预排。
pub fn build_schedule(
    params: &PlanParams,
    ordered: &[(PlanWord, WordAssessment)],
) -> AppResult<StudyPlanAIResult> {
    let start = NaiveDate::parse_from_str(params.start_date.trim(), "%Y-%m-%d").map_err(|_| {
        AppError::ValidationError(format!("开始日期格式不正确：{}", params.start_date))
    })?;
    if !DAILY_NEW_WORDS_RANGE.contains(&params.daily_new_words) {
        return Err(AppError::ValidationError(
            "每天新词数需在 1–50 之间".to_string(),
        ));
    }
    if ordered.is_empty() {
        return Err(AppError::ValidationError("计划中没有单词".to_string()));
    }
    let total = ordered.len();
    let days = learning_days(params.daily_new_words, total);
    let period = days + CONSOLIDATION_DAYS;

    let (base, extra) = (total / days, total % days);
    let mut cursor = 0;
    let mut daily_plans = Vec::with_capacity(days);
    for day in 1..=days {
        let count = base + usize::from(day <= extra);
        let words = ordered[cursor..cursor + count]
            .iter()
            .map(|(word, a)| DailyStudyWord {
                word_id: word.word_id.to_string(),
                word: word.word.clone(),
                wordbook_id: word.wordbook_id.to_string(),
                is_review: false,
                review_count: None,
                priority: a.priority.clone(),
                difficulty_level: a.difficulty,
            })
            .collect();
        cursor += count;
        daily_plans.push(DailyStudyPlan {
            day: day as i32,
            date: (start + Duration::days(day as i64 - 1))
                .format("%Y-%m-%d")
                .to_string(),
            words,
        });
    }

    let (intensity, label) = intensity_label(params.daily_new_words);
    Ok(StudyPlanAIResult {
        plan_metadata: StudyPlanMetadata {
            total_words: total as i32,
            study_period_days: period as i32,
            intensity_level: intensity.to_string(),
            review_frequency: 0,
            plan_type: format!(
                "每天 {} 个新词 · {} 天学完 · 自适应复习（{}）",
                params.daily_new_words, days, label
            ),
            start_date: start.format("%Y-%m-%d").to_string(),
            end_date: (start + Duration::days(period as i64 - 1))
                .format("%Y-%m-%d")
                .to_string(),
            daily_new_words: Some(params.daily_new_words),
        },
        daily_plans,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn words(n: usize) -> Vec<PlanWord> {
        (0..n)
            .map(|i| PlanWord {
                word_id: i as i64 + 100,
                word: format!("w{}", i),
                wordbook_id: 1,
                meaning: None,
            })
            .collect()
    }

    fn params(daily: i32) -> PlanParams {
        PlanParams {
            daily_new_words: daily,
            start_date: "2026-10-07".to_string(),
        }
    }

    fn schedule(n: usize, p: &PlanParams) -> StudyPlanAIResult {
        build_schedule(p, &normalize_order(&words(n), &[])).unwrap()
    }

    #[test]
    fn learning_days_follow_daily_new_words() {
        assert_eq!(learning_days(10, 34), 4);
        assert_eq!(learning_days(5, 5), 1);
        assert_eq!(learning_days(30, 1), 1);
    }

    #[test]
    fn every_word_is_learned_exactly_once_and_days_are_balanced() {
        for (daily, n) in [(10, 34), (3, 7), (5, 5), (30, 120), (1, 4)] {
            let result = schedule(n, &params(daily));
            let mut learned: HashMap<String, usize> = HashMap::new();
            let sizes: Vec<usize> = result.daily_plans.iter().map(|d| d.words.len()).collect();
            assert!(sizes.iter().all(|s| *s <= daily as usize), "{sizes:?}");
            assert!(sizes.iter().max().unwrap() - sizes.iter().min().unwrap() <= 1);
            for day in &result.daily_plans {
                for w in &day.words {
                    assert!(!w.is_review, "复习不预排");
                    *learned.entry(w.word_id.clone()).or_default() += 1;
                }
            }
            assert_eq!(learned.len(), n);
            assert!(learned.values().all(|c| *c == 1));
            assert_eq!(result.plan_metadata.total_words, n as i32);
        }
    }

    #[test]
    fn period_includes_consolidation_and_dates_are_computed() {
        // 34 词、每天 10 个：4 天学完 + 11 天巩固 = 15 天
        let result = schedule(34, &params(10));
        let meta = &result.plan_metadata;
        assert_eq!(result.daily_plans.len(), 4);
        assert_eq!(meta.study_period_days, 15);
        assert_eq!(
            (meta.start_date.as_str(), meta.end_date.as_str()),
            ("2026-10-07", "2026-10-21")
        );
        assert_eq!(meta.intensity_level, "normal");
        assert_eq!(meta.review_frequency, 0);
        assert_eq!(
            (
                result.daily_plans[3].day,
                result.daily_plans[3].date.as_str()
            ),
            (4, "2026-10-10")
        );
        assert!(build_schedule(
            &PlanParams {
                start_date: "10/07/2026".into(),
                ..params(5)
            },
            &normalize_order(&words(3), &[])
        )
        .is_err());
        assert!(build_schedule(&params(0), &normalize_order(&words(3), &[])).is_err());
        assert!(build_schedule(&params(51), &normalize_order(&words(3), &[])).is_err());
    }

    #[test]
    fn model_order_is_respected_and_gaps_are_filled() {
        let list = words(4);
        let assessed = vec![
            WordAssessment {
                word_id: 103,
                difficulty: 1,
                priority: "high".into(),
            },
            WordAssessment {
                word_id: 999,
                difficulty: 2,
                priority: "low".into(),
            }, // 未知
            WordAssessment {
                word_id: 101,
                difficulty: 9,
                priority: "urgent".into(),
            }, // 越界值规整
            WordAssessment {
                word_id: 103,
                difficulty: 5,
                priority: "low".into(),
            }, // 重复
        ];
        let ordered = normalize_order(&list, &assessed);
        let ids: Vec<i64> = ordered.iter().map(|(w, _)| w.word_id).collect();
        assert_eq!(ids, vec![103, 101, 100, 102]);
        assert_eq!(
            (ordered[0].1.difficulty, ordered[0].1.priority.as_str()),
            (1, "high")
        );
        assert_eq!(
            (ordered[1].1.difficulty, ordered[1].1.priority.as_str()),
            (5, "medium")
        );
        assert_eq!(ordered[2].1.priority, "medium");
    }
}
