//! 视频切分规划：AI 交回的字幕编号范围 → 编辑器里的片段（毫秒）；当前规划 → 字幕编号范围（按意见修改时给 AI 看）。
//! 后台任务 `start_video_plan` 在这里运行：调用 agent、校正、写进 videos.plan。

use crate::agent::tasks::{self, VideoPlanSpec};
use crate::agent::AgentPaths;
use crate::error::{AppError, AppResult};
use crate::jobs::JobCtx;
use crate::logger::Logger;
use crate::repositories::video_repository::VideoRepository;
use crate::services::subtitle::Cue;
use crate::types::ai_model::AIModelConfig;
use crate::types::video::{VideoPlan, VideoSegment};
use futures::stream::{self, StreamExt};
use serde::Deserialize;
use serde_json::Value;
use sqlx::SqlitePool;
use std::ops::Range;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// 片段在第一条字幕前、最后一条字幕后留的余量
const PAD_MS: i64 = 300;
const MAX_KEY_WORDS: usize = 8;
/// 每段最多几个标签
const MAX_TAGS: usize = 3;
const LEVELS: [&str; 5] = ["a1", "a2", "b1", "b2", "c1"];
/// 分块规划时每块大约多长
const CHUNK_MS: i64 = 15 * 60 * 1000;
/// 同时规划几块
const CHUNK_CONCURRENCY: usize = 3;

#[derive(Debug, Deserialize)]
struct Submitted {
    segments: Vec<SubmittedSegment>,
}

#[derive(Debug, Deserialize)]
struct SubmittedSegment {
    first: usize,
    last: usize,
    title: String,
    scene: String,
    level: String,
    focus: String,
    #[serde(default)]
    key_words: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
}

/// AI 的提交 → 片段：编号换成时间（前后留余量、不出界），重点词只留字幕里出现过的。
/// `within` 是这次规划的字幕下标范围（分块时只是一块）：超出的编号收进范围内，重叠或无效的段丢掉。
/// 还没有 id、相邻段的余量也没处理，合并后由 `finish_segments` 收尾。
pub fn segments_from_submission(
    details: &Value,
    cues: &[Cue],
    duration_ms: i64,
    within: Range<usize>,
) -> Result<Vec<VideoSegment>, String> {
    let submitted: Submitted =
        serde_json::from_value(details.clone()).map_err(|e| format!("规划格式不对：{e}"))?;
    let (lo, hi) = (within.start + 1, within.end.min(cues.len()));
    let mut ranges: Vec<(usize, usize, &SubmittedSegment)> = submitted
        .segments
        .iter()
        .filter(|s| s.first >= 1 && s.first <= s.last && s.last <= cues.len())
        .map(|s| (s.first.max(lo), s.last.min(hi), s))
        .filter(|(first, last, _)| first <= last)
        .collect();
    ranges.sort_by_key(|(first, _, _)| *first);
    // 去掉与前一段重叠的
    let mut kept: Vec<(usize, usize, &SubmittedSegment)> = Vec::new();
    for r in ranges {
        if kept.last().is_none_or(|prev| r.0 > prev.1) {
            kept.push(r);
        }
    }
    // 片段的开头 / 结尾不落在半句话上：对齐到整句（断句见 services::sentences）
    let aligned = align_to_sentences(
        &kept.iter().map(|&(f, l, _)| (f, l)).collect::<Vec<_>>(),
        cues,
        lo,
        hi,
    );
    let kept: Vec<(usize, usize, &SubmittedSegment)> = kept
        .iter()
        .zip(aligned)
        .filter_map(|(&(_, _, s), r)| r.map(|(f, l)| (f, l, s)))
        .collect();
    Ok(kept
        .iter()
        .map(|&(first, last, s)| {
            let covered = &cues[first - 1..last];
            let text = covered
                .iter()
                .map(|c| c.en.to_lowercase())
                .collect::<Vec<_>>()
                .join(" ");
            let mut key_words: Vec<String> = Vec::new();
            for word in &s.key_words {
                let word = word.trim();
                if !word.is_empty()
                    && text.contains(&word.to_lowercase())
                    && !key_words.iter().any(|k| k.eq_ignore_ascii_case(word))
                {
                    key_words.push(word.to_string());
                }
            }
            key_words.truncate(MAX_KEY_WORDS);
            let mut tags: Vec<String> = Vec::new();
            for tag in s
                .tags
                .iter()
                .filter_map(|t| crate::services::tag::clean_name(t))
            {
                if !tags.iter().any(|k| k.eq_ignore_ascii_case(&tag)) {
                    tags.push(tag);
                }
            }
            tags.truncate(MAX_TAGS);
            let level = s.level.trim().to_lowercase();
            VideoSegment {
                id: String::new(),
                start_ms: (covered[0].start_ms - PAD_MS).max(0),
                end_ms: (covered[covered.len() - 1].end_ms + PAD_MS).min(duration_ms.max(1)),
                title: s.title.trim().chars().take(60).collect(),
                scene: s.scene.trim().chars().take(20).collect(),
                level: if LEVELS.contains(&level.as_str()) {
                    level
                } else {
                    String::new()
                },
                focus: s.focus.trim().chars().take(300).collect(),
                key_words,
                tags,
            }
        })
        .collect())
}

/// 给「切分要求建议」看的字幕：不多于 `max` 条时全给；否则均匀取 `windows` 段连续的字幕（每段看得出上下文）
pub fn sample_cues(cues: &[Cue], max: usize, windows: usize) -> Vec<&Cue> {
    if cues.len() <= max || windows == 0 {
        return cues.iter().collect();
    }
    let per = (max / windows).max(1);
    let stride = cues.len() / windows;
    (0..windows)
        .flat_map(|w| {
            let start = (w * stride).min(cues.len().saturating_sub(per));
            cues[start..(start + per).min(cues.len())].iter()
        })
        .collect()
}

/// 每句最多延长几条字幕去补齐（防止断句异常时片段被拉得很长）
const MAX_ALIGN_CUES: usize = 3;

/// 把片段（字幕编号范围，从 1 开始，有序不重叠）的开头与结尾对齐到整句：开头在半句话上往前补到句首，结尾在半句话上往后补到句尾
/// （各最多 `MAX_ALIGN_CUES` 条，不超出 lo..=hi）。相邻两段在同一句中间分开时，这句归前一段；后一段因此空了就去掉（None）。
pub fn align_to_sentences(
    ranges: &[(usize, usize)],
    cues: &[Cue],
    lo: usize,
    hi: usize,
) -> Vec<Option<(usize, usize)>> {
    // 每条字幕所在句子的 [首, 尾]（从 1 开始）
    let mut sentence_of = vec![(0usize, 0usize); cues.len() + 1];
    for g in crate::services::sentences::group_cues(cues) {
        for i in g.clone() {
            sentence_of[i + 1] = (g.start + 1, g.end);
        }
    }
    let mut prev_last = lo.saturating_sub(1);
    ranges
        .iter()
        .map(|&(first, last)| {
            let (sentence_first, _) = sentence_of[first];
            let f = if first - sentence_first <= MAX_ALIGN_CUES {
                sentence_first
            } else {
                first
            }
            .max(lo)
            .max(prev_last + 1);
            let (_, sentence_last) = sentence_of[last];
            let l = if sentence_last - last <= MAX_ALIGN_CUES {
                sentence_last
            } else {
                last
            }
            .min(hi);
            if f > l {
                return None;
            }
            prev_last = l;
            Some((f, l))
        })
        .collect()
}

/// 合并后的片段收尾：按时间排序、编 id，余量让相邻两段重叠时取中点
pub fn finish_segments(mut segments: Vec<VideoSegment>) -> Vec<VideoSegment> {
    segments.sort_by_key(|s| s.start_ms);
    for (i, s) in segments.iter_mut().enumerate() {
        s.id = format!("ai{}", i + 1);
    }
    for i in 1..segments.len() {
        if segments[i].start_ms < segments[i - 1].end_ms {
            let mid = (segments[i].start_ms + segments[i - 1].end_ms) / 2;
            segments[i - 1].end_ms = mid;
            segments[i].start_ms = mid;
        }
    }
    segments
}

/// 长视频分块规划：一次把两小时的字幕交给 AI 会超时，后半部分也容易切得粗。
/// 总长不超过 1.5 块时整片一块；否则每块大约 CHUNK_MS，在 [2/3, 4/3] 块长的窗口里挑字幕间停顿最长的地方断开，
/// 不在 `keep`（当前规划的段，字幕编号从 1 开始）中间断开。返回字幕下标范围。
pub fn chunk_cues(cues: &[Cue], keep: &[tasks::CueRange]) -> Vec<Range<usize>> {
    let splits_kept = |i: usize| keep.iter().any(|(first, last, _)| *first <= i && i < *last);
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < cues.len() {
        let base = cues[start].start_ms;
        if cues[cues.len() - 1].end_ms - base <= CHUNK_MS * 3 / 2 {
            chunks.push(start..cues.len());
            break;
        }
        // 在第 i 条之前断开（i 从 start + 1 起）
        let candidates = (start + 1..cues.len()).filter(|&i| !splits_kept(i));
        let in_window = candidates.clone().filter(|&i| {
            let t = cues[i].start_ms - base;
            (CHUNK_MS * 2 / 3..=CHUNK_MS * 4 / 3).contains(&t)
        });
        let gap = |i: &usize| cues[*i].start_ms - cues[*i - 1].end_ms;
        let cut = in_window.max_by_key(gap).or_else(|| {
            candidates
                .clone()
                .find(|&i| cues[i].start_ms - base >= CHUNK_MS)
        });
        match cut {
            Some(i) => {
                chunks.push(start..i);
                start = i;
            }
            None => {
                chunks.push(start..cues.len());
                break;
            }
        }
    }
    chunks
}

/// 当前规划 → 每段覆盖的字幕编号范围（从 1 开始）与标题；不含字幕的片段略过
pub fn cue_ranges(plan: &VideoPlan, cues: &[Cue]) -> Vec<tasks::CueRange> {
    plan.segments
        .iter()
        .filter_map(|s| {
            let inside: Vec<usize> = cues
                .iter()
                .enumerate()
                .filter(|(_, c)| {
                    let overlap = c.end_ms.min(s.end_ms) - c.start_ms.max(s.start_ms);
                    overlap > 0 && overlap * 2 >= c.end_ms - c.start_ms
                })
                .map(|(i, _)| i + 1)
                .collect();
            Some((*inside.first()?, *inside.last()?, s.title.clone()))
        })
        .collect()
}

/// 切分规划的后台任务
pub struct VideoPlanJob {
    pub pool: Arc<SqlitePool>,
    pub logger: Arc<Logger>,
    pub paths: AgentPaths,
    pub model: AIModelConfig,
    pub profile: crate::prompts::PromptProfile,
    pub video_id: i64,
    pub requirements: String,
    pub min_seconds: i64,
    pub max_seconds: i64,
    /// 按意见修改时的意见
    pub feedback: Option<String>,
    /// 已有的标签名（让 AI 优先复用）
    pub tags: Vec<String>,
}

impl VideoPlanJob {
    pub async fn run(self, ctx: JobCtx) -> AppResult<Value> {
        let row = VideoRepository::get(&self.pool, self.video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?;
        let cues = row.cues();
        if cues.is_empty() {
            return Err(AppError::ValidationError(
                "这个视频没有字幕，AI 没法规划".to_string(),
            ));
        }
        let current = row.plan().unwrap_or_default();
        let feedback = self
            .feedback
            .as_deref()
            .map(str::trim)
            .filter(|f| !f.is_empty());
        let ranges = if feedback.is_some() {
            cue_ranges(&current, &cues)
        } else {
            Vec::new()
        };
        let chunks = chunk_cues(&cues, &ranges);
        let total = chunks.len();
        let finished = AtomicU64::new(0);
        if total == 1 {
            ctx.stage(format!("AI 正在通读 {} 条字幕并规划场景", cues.len()));
        } else {
            ctx.stage(format!("AI 正在分 {total} 部分规划"));
            ctx.progress(0, total as u64);
        }
        let outcomes: Vec<(usize, AppResult<Vec<VideoSegment>>)> =
            stream::iter(chunks.iter().cloned().enumerate())
                .map(|(k, range)| {
                    let (job, ctx, cues, ranges, finished) =
                        (&self, &ctx, &cues, &ranges, &finished);
                    async move {
                        let result = job
                            .plan_chunk(
                                ctx,
                                cues,
                                row.duration_ms,
                                ranges,
                                range,
                                (k + 1, total),
                                feedback,
                            )
                            .await;
                        let n = finished.fetch_add(1, Ordering::SeqCst) + 1;
                        if total > 1 {
                            ctx.progress(n, total as u64);
                            ctx.stage(format!("AI 正在规划：已完成 {n}/{total} 部分"));
                        }
                        (k, result)
                    }
                })
                .buffer_unordered(CHUNK_CONCURRENCY)
                .collect()
                .await;
        if ctx.is_cancelled() {
            return Err(AppError::ValidationError("已取消".to_string()));
        }

        let mut segments = Vec::new();
        let mut failed: Vec<(usize, AppError)> = Vec::new();
        for (k, outcome) in outcomes {
            match outcome {
                Ok(planned) => segments.extend(planned),
                Err(e) => failed.push((k, e)),
            }
        }
        if failed.len() == total {
            return Err(failed.remove(0).1);
        }
        // 没规划成的部分保留原来的片段，并告诉用户是哪一段时间
        failed.sort_by_key(|(k, _)| *k);
        let mut failed_parts = Vec::new();
        for (k, e) in &failed {
            let from = cues[chunks[*k].start].start_ms;
            let to = chunks
                .get(k + 1)
                .map_or(i64::MAX, |next| cues[next.start].start_ms);
            segments.extend(
                current
                    .segments
                    .iter()
                    .filter(|s| (from..to).contains(&((s.start_ms + s.end_ms) / 2)))
                    .cloned(),
            );
            self.logger.error(
                "VIDEO",
                &format!("video-plan 第 {}/{total} 部分失败", k + 1),
                Some(&e.to_string()),
            );
            failed_parts.push(format!(
                "{}–{}",
                clock(from),
                clock(cues[chunks[*k].end - 1].end_ms)
            ));
        }
        let segments = finish_segments(segments);
        if segments.is_empty() {
            return Err(AppError::ExternalServiceError(
                "AI 没有找到适合学习的片段，可以换个要求再试".to_string(),
            ));
        }
        let count = segments.len();
        let plan = VideoPlan {
            requirements: self.requirements.clone(),
            segments,
            // 建议留着，下次打开「AI 规划」还能用
            suggestions: current.suggestions.clone(),
        };
        VideoRepository::save_plan(&self.pool, self.video_id, &plan).await?;
        Ok(serde_json::json!({
            "videoId": self.video_id,
            "segments": count,
            "failedParts": failed_parts,
        }))
    }

    /// 规划一块；超时或交回的规划不能用时再试一次
    #[allow(clippy::too_many_arguments)]
    async fn plan_chunk(
        &self,
        ctx: &JobCtx,
        cues: &[Cue],
        duration_ms: i64,
        ranges: &[tasks::CueRange],
        range: Range<usize>,
        part: (usize, usize),
        feedback: Option<&str>,
    ) -> AppResult<Vec<VideoSegment>> {
        // 只给 AI 看这一块里的当前规划
        let local: Vec<tasks::CueRange> = ranges
            .iter()
            .filter(|(first, _, _)| range.contains(&(first - 1)))
            .cloned()
            .collect();
        let spec = VideoPlanSpec {
            duration_ms,
            cues: &cues[range.clone()],
            offset: range.start,
            total: cues.len(),
            part: (part.1 > 1).then_some(part),
            requirements: &self.requirements,
            min_seconds: self.min_seconds,
            max_seconds: self.max_seconds,
            tags: &self.tags,
            revise: feedback
                .filter(|_| !local.is_empty())
                .map(|f| (local.as_slice(), f)),
        };
        let mut last_error: Option<AppError> = None;
        for attempt in 0..2 {
            if ctx.is_cancelled() {
                break;
            }
            if let Some(e) = &last_error {
                self.logger.warn(
                    "VIDEO",
                    &format!(
                        "视频 {} 第 {}/{} 部分规划失败，重试第 {attempt} 次",
                        self.video_id, part.0, part.1
                    ),
                    Some(&e.to_string()),
                );
            }
            let attempt = async {
                let details = tasks::plan_video(
                    &self.paths,
                    &self.model,
                    &self.profile,
                    &spec,
                    &self.logger,
                    || ctx.is_cancelled(),
                )
                .await?;
                segments_from_submission(&details, cues, duration_ms, range.clone())
                    .map_err(|e| AppError::ExternalServiceError(format!("{e}，请再试一次")))
            };
            match attempt.await {
                Ok(segments) => return Ok(segments),
                Err(e) => last_error = Some(e),
            }
        }
        Err(last_error.unwrap_or_else(|| AppError::ValidationError("已取消".to_string())))
    }
}

fn clock(ms: i64) -> String {
    let s = ms.max(0) / 1000;
    if s >= 3600 {
        format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60)
    } else {
        format!("{:02}:{:02}", s / 60, s % 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cues() -> Vec<Cue> {
        (0..6)
            .map(|i| Cue {
                start_ms: 1000 + i * 3000,
                end_ms: 3000 + i * 3000,
                en: format!("Can I see the menu {i}?"),
                zh: String::new(),
                join: None,
            })
            .collect()
    }

    fn seg(first: usize, last: usize) -> Value {
        json!({"first": first, "last": last, "title": " Ordering ", "scene": "点餐", "level": "A2", "focus": "点餐", "key_words": ["menu", "pizza", "Menu"]})
    }

    #[test]
    fn ranges_become_padded_times_without_overlap() {
        let details = json!({"cue_count": 6, "segments": [seg(4, 6), seg(1, 3)]});
        let segments =
            finish_segments(segments_from_submission(&details, &cues(), 20_000, 0..6).unwrap());
        assert_eq!(segments.len(), 2);
        assert_eq!(
            (segments[0].id.as_str(), segments[1].id.as_str()),
            ("ai1", "ai2")
        );
        // 第 1–3 条：1000–9000，留 300ms；第 4–6 条：10000–18000
        assert_eq!((segments[0].start_ms, segments[0].end_ms), (700, 9300));
        assert_eq!((segments[1].start_ms, segments[1].end_ms), (9700, 18_300));
        assert_eq!(segments[0].title, "Ordering");
        assert_eq!(segments[0].level, "a2");
        // 重点词只留字幕里出现过的，去重
        assert_eq!(segments[0].key_words, vec!["menu"]);
    }

    #[test]
    fn invalid_or_overlapping_ranges_are_dropped() {
        let details =
            json!({"cue_count": 6, "segments": [seg(1, 3), seg(3, 5), seg(0, 2), seg(5, 9)]});
        let segments = segments_from_submission(&details, &cues(), 20_000, 0..6).unwrap();
        assert_eq!(segments.len(), 1);
        // 某一部分没有合适的内容可以为空；格式不对是错误
        assert!(
            segments_from_submission(&json!({"segments": []}), &cues(), 20_000, 0..6)
                .unwrap()
                .is_empty()
        );
        assert!(segments_from_submission(&json!({"oops": 1}), &cues(), 20_000, 0..6).is_err());
    }

    #[test]
    fn numbers_outside_the_chunk_are_clamped_into_it() {
        // 这块是第 3–4 条（下标 2..4）：1–3 收成 3–3，4–6 收成 4–4
        let details = json!({"segments": [seg(1, 3), seg(4, 6), seg(5, 6)]});
        let segments = segments_from_submission(&details, &cues(), 20_000, 2..4).unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start_ms, 7000 - PAD_MS);
        assert_eq!(segments[1].end_ms, 12_000 + PAD_MS);
    }

    /// 每 `every_ms` 一条 2 秒的字幕，`pauses` 里的下标前面多停 `pause_ms`
    fn long_cues(count: usize, every_ms: i64, pauses: &[(usize, i64)]) -> Vec<Cue> {
        let mut t = 0;
        (0..count)
            .map(|i| {
                t += pauses
                    .iter()
                    .find(|(p, _)| *p == i)
                    .map_or(0, |(_, ms)| *ms);
                let c = Cue {
                    start_ms: t,
                    end_ms: t + 2000,
                    en: "line".into(),
                    zh: String::new(),
                    join: None,
                };
                t += every_ms;
                c
            })
            .collect()
    }

    #[test]
    fn short_videos_are_planned_in_one_go() {
        // 20 分钟：不超过 1.5 块
        let cues = long_cues(400, 3000, &[]);
        assert_eq!(chunk_cues(&cues, &[]), vec![0..400]);
        assert!(chunk_cues(&[], &[]).is_empty());
    }

    #[test]
    fn long_videos_split_at_the_longest_pause_near_each_chunk() {
        // 125 分钟，每 5 秒一条；第 200 条（约 16.7 分钟）前停 20 秒，第 150 条前停 8 秒
        let cues = long_cues(1500, 5000, &[(150, 8000), (200, 20_000)]);
        let chunks = chunk_cues(&cues, &[]);
        assert_eq!(chunks[0], 0..200);
        // 连续、覆盖全部字幕
        assert_eq!(chunks.last().unwrap().end, 1500);
        for w in chunks.windows(2) {
            assert_eq!(w[0].end, w[1].start);
        }
        // 每块大约 10–20 分钟，最后一块不超过 1.5 块长
        for c in &chunks {
            let len = cues[c.end - 1].end_ms - cues[c.start].start_ms;
            assert!(len <= CHUNK_MS * 3 / 2 + 5000, "{c:?} {len}");
        }
        assert!(chunks.len() >= 6 && chunks.len() <= 9, "{}", chunks.len());
    }

    #[test]
    fn chunks_never_split_a_current_segment() {
        let cues = long_cues(1500, 5000, &[(200, 20_000)]);
        // 当前规划有一段是第 190–260 条：边界不能落在中间
        let keep = vec![(190, 260, "x".to_string())];
        let chunks = chunk_cues(&cues, &keep);
        for c in &chunks[1..] {
            assert!(!(190..260).contains(&c.start), "{c:?}");
        }
    }

    #[test]
    fn segments_snap_to_whole_sentences() {
        let c = |start: i64, en: &str| Cue {
            start_ms: start,
            end_ms: start + 1000,
            en: en.into(),
            zh: String::new(),
            join: None,
        };
        let cues = vec![
            c(0, "The whole program was designed"),       // 1
            c(1000, "to get two Americans there."),       // 2
            c(2000, "The enormity of this event"),        // 3
            c(3000, "is something only history judges."), // 4
            c(4000, "Apollo 11 was given the mission."),  // 5
        ];
        // 第 1 段在半句上结束、第 2 段从半句开始：这句归第 1 段，第 2 段从下一句开始
        assert_eq!(
            align_to_sentences(&[(1, 3), (4, 5)], &cues, 1, 5),
            vec![Some((1, 4)), Some((5, 5))]
        );
        // 一段从半句开始：往前补到句首
        assert_eq!(
            align_to_sentences(&[(2, 2)], &cues, 1, 5),
            vec![Some((1, 2))]
        );
        // 后一段被前一段补齐后空了：去掉
        assert_eq!(
            align_to_sentences(&[(1, 3), (4, 4)], &cues, 1, 5),
            vec![Some((1, 4)), None]
        );
        // 不超出这次规划的范围
        assert_eq!(
            align_to_sentences(&[(2, 3)], &cues, 2, 3),
            vec![Some((2, 3))]
        );
    }

    #[test]
    fn suggestion_sample_spreads_over_the_whole_video() {
        let cues: Vec<Cue> = (0..1000)
            .map(|i| Cue {
                start_ms: i * 1000,
                end_ms: i * 1000 + 900,
                en: "x".into(),
                zh: String::new(),
                join: None,
            })
            .collect();
        let few = &cues[..100];
        assert_eq!(sample_cues(few, 250, 10).len(), 100);
        let sample = sample_cues(&cues, 250, 10);
        assert_eq!(sample.len(), 250);
        // 第一段从头开始，最后一段在后部，按时间顺序
        assert_eq!(sample[0].start_ms, 0);
        assert!(sample[249].start_ms >= 900_000);
        assert!(sample.windows(2).all(|w| w[0].start_ms < w[1].start_ms));
    }

    #[test]
    fn clock_has_hours_for_long_videos() {
        assert_eq!(clock(65_000), "01:05");
        assert_eq!(clock(7_510_304), "2:05:10");
    }

    #[test]
    fn padding_never_overlaps_neighbours_or_leaves_the_video() {
        let tight: Vec<Cue> = vec![
            Cue {
                start_ms: 0,
                end_ms: 2000,
                en: "a.".into(),
                zh: String::new(),
                join: None,
            },
            Cue {
                start_ms: 2100,
                end_ms: 4000,
                en: "b.".into(),
                zh: String::new(),
                join: None,
            },
        ];
        let details = json!({"segments": [seg(1, 1), seg(2, 2)]});
        let segments =
            finish_segments(segments_from_submission(&details, &tight, 4100, 0..2).unwrap());
        assert_eq!(segments[0].start_ms, 0);
        assert_eq!(segments[0].end_ms, segments[1].start_ms);
        assert_eq!(segments[1].end_ms, 4100);
    }

    #[test]
    fn current_plan_maps_back_to_cue_numbers() {
        let plan = VideoPlan {
            suggestions: Vec::new(),
            requirements: String::new(),
            segments: vec![
                VideoSegment {
                    id: "a".into(),
                    start_ms: 700,
                    end_ms: 9300,
                    title: "One".into(),
                    ..Default::default()
                },
                VideoSegment {
                    id: "b".into(),
                    start_ms: 50_000,
                    end_ms: 60_000,
                    ..Default::default()
                },
            ],
        };
        assert_eq!(cue_ranges(&plan, &cues()), vec![(1, 3, "One".to_string())]);
    }
}

/// 真实模型：用一份真实数据库里配置的「短文」模型规划示例字幕。
/// `PINDU_TEST_DB=<vocabulary.db 副本> PINDU_SAMPLE_SRT=<字幕> REDLARK_AGENT_BIN=<sidecar> cargo test real_video_plan -- --ignored --nocapture`
/// 长视频：把 `PINDU_SAMPLE_SRT` 换成 `PINDU_TEST_VIDEO_ID=<库里的视频 id>`
#[cfg(test)]
mod real_tests {
    use super::*;
    use crate::jobs::{JobSpec, Jobs, Lane};

    #[tokio::test]
    #[ignore]
    async fn real_video_plan() {
        let env = |k: &str| std::env::var(k).unwrap();
        let pool = Arc::new(
            sqlx::sqlite::SqlitePoolOptions::new()
                .connect(&format!("sqlite://{}?mode=ro", env("PINDU_TEST_DB")))
                .await
                .unwrap(),
        );
        let logger = crate::test_support::test_logger();
        let model = crate::services::agent_settings::AgentSettingsService::new(
            pool.clone(),
            logger.clone(),
        )
        .model_for(
            crate::services::agent_settings::AgentTaskKind::Passage,
            None,
        )
        .await
        .unwrap();
        // PINDU_TEST_VIDEO_ID：用库里那个视频的字幕与时长（长视频分块）；否则用示例字幕
        let (cues, duration_ms, requirements) = match std::env::var("PINDU_TEST_VIDEO_ID") {
            Ok(vid) => {
                let row = VideoRepository::get(&pool, vid.parse().unwrap())
                    .await
                    .unwrap()
                    .unwrap();
                (row.cues(), row.duration_ms, String::new())
            }
            Err(_) => (
                crate::services::subtitle::build_cues(
                    &std::fs::read_to_string(env("PINDU_SAMPLE_SRT")).unwrap(),
                    None,
                )
                .unwrap(),
                180_000,
                "按场景切：餐厅、问路、买衣服".to_string(),
            ),
        };
        // 写进内存库，任务按 video_id 读取
        let mem = crate::test_support::memory_pool().await;
        let id = VideoRepository::insert(&mem, "sample", "s.mkv", None, &cues, 0)
            .await
            .unwrap();
        sqlx::query("UPDATE videos SET duration_ms = ?, status = 'ready' WHERE id = ?")
            .bind(duration_ms)
            .bind(id)
            .execute(mem.as_ref())
            .await
            .unwrap();
        let data = std::env::temp_dir().join(format!("pindu-real-plan-{}", std::process::id()));
        let job = VideoPlanJob {
            pool: mem.clone(),
            logger,
            paths: AgentPaths::resolve(&data).unwrap(),
            model,
            profile: crate::prompts::PromptProfile::default(),
            video_id: id,
            requirements,
            min_seconds: 30,
            max_seconds: 120,
            feedback: None,
            tags: Vec::new(),
        };
        let jobs = Jobs::new(|_| {});
        let spec = JobSpec {
            kind: "t",
            title: "t".into(),
            lane: Lane::Agent,
            detached: true,
            link: None,
        };
        let job_id = jobs.spawn(spec, move |ctx| job.run(ctx));
        let done = loop {
            let j = jobs.get(&job_id).unwrap();
            if !j.status.is_active() {
                break j;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        };
        assert!(done.error.is_none(), "{:?}", done.error);
        eprintln!("result: {}", done.result.unwrap());
        let plan = VideoRepository::get(&mem, id)
            .await
            .unwrap()
            .unwrap()
            .plan()
            .unwrap();
        for s in &plan.segments {
            eprintln!(
                "{:>6}–{:>6} {} | {} | {} | {} | {:?}",
                s.start_ms, s.end_ms, s.title, s.scene, s.level, s.focus, s.key_words
            );
        }
        assert!(plan.segments.len() >= 2);
        let _ = std::fs::remove_dir_all(&data);
    }
}
