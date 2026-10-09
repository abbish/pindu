//! 视频处理（后台任务，media 队列）：按规划逐段 ① ffmpeg 精确切出短片与封面 ② 片段里的字幕变成短文句子（时间改为相对短片开头）
//! ③ 缺中文、标题或重点词时用导入材料的翻译任务补齐 ④ 短文与短片同一事务写入。
//!
//! 按段幂等：起止与规划完全相同的短片已经存在时跳过，所以中途停止或失败后再点「开始处理」会从没做完的那段继续。

use crate::agent::tasks::{self, TranslateSpec};
use crate::agent::AgentPaths;
use crate::error::{AppError, AppResult};
use crate::jobs::JobCtx;
use crate::logger::Logger;
use crate::media::MediaTools;
use crate::repositories::passage_repository::{NewPassage, PassageRepository};
use crate::repositories::video_repository::{VideoRepository, VideoRow};
use crate::services::passage_rules::{english_word_count, GeneratedPassage};
use crate::services::subtitle::Cue;
use crate::services::video::video_dir;
use crate::types::ai_model::AIModelConfig;
use crate::types::passage::{PassageSentence, PassageTargetWord};
use crate::types::video::VideoSegment;
use serde_json::Value;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const CLIPS_DIR: &str = "clips";
/// 短文支持的水平（c1 的片段按 b2 存）
const PASSAGE_LEVELS: [&str; 4] = ["a1", "a2", "b1", "b2"];

pub struct VideoProcessJob {
    pub pool: Arc<SqlitePool>,
    pub logger: Arc<Logger>,
    pub tools: MediaTools,
    pub paths: AgentPaths,
    pub model: AIModelConfig,
    pub profile: crate::prompts::PromptProfile,
    pub data_dir: PathBuf,
    pub video_id: i64,
}

/// 片段里的字幕 → 短文句子（时间相对片段开头，夹在片段内）
pub fn clip_sentences(cues: &[Cue], seg: &VideoSegment) -> Vec<PassageSentence> {
    cues.iter()
        .filter(|c| {
            let overlap = c.end_ms.min(seg.end_ms) - c.start_ms.max(seg.start_ms);
            overlap > 0 && overlap * 2 >= c.end_ms - c.start_ms
        })
        .enumerate()
        .map(|(i, c)| PassageSentence {
            en: c.en.clone(),
            zh: c.zh.clone(),
            paragraph: i == 0,
            start_ms: Some((c.start_ms - seg.start_ms).max(0)),
            end_ms: Some((c.end_ms.min(seg.end_ms) - seg.start_ms).max(0)),
        })
        .collect()
}

/// 规划里还没切出来的片段（起止与已有短片完全相同的算已完成）
pub fn pending_segments<'a>(
    segments: &'a [VideoSegment],
    done: &[(i64, i64)],
) -> Vec<(usize, &'a VideoSegment)> {
    segments
        .iter()
        .enumerate()
        .filter(|(_, s)| !done.contains(&(s.start_ms, s.end_ms)))
        .collect()
}

impl VideoProcessJob {
    pub async fn run(self, ctx: JobCtx) -> AppResult<Value> {
        let row = VideoRepository::get(&self.pool, self.video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("视频不存在，可能已被删除".to_string()))?;
        let before = row.status.clone();
        VideoRepository::set_status(&self.pool, self.video_id, "processing", None).await?;
        let result = self.process(&ctx, &row).await;
        // 结束后：所有片段都切好了算完成；否则回到可以继续编辑与处理的状态
        let all_done = self.all_done(&row).await.unwrap_or(false);
        let status = if all_done || before == "done" {
            "done"
        } else {
            "ready"
        };
        let error = match &result {
            Err(e) if !ctx.is_cancelled() => Some(e.to_string()),
            _ => None,
        };
        VideoRepository::set_status(&self.pool, self.video_id, status, error.as_deref()).await?;
        result
    }

    async fn all_done(&self, row: &VideoRow) -> AppResult<bool> {
        let done: Vec<(i64, i64)> = VideoRepository::clips(&self.pool, self.video_id)
            .await?
            .iter()
            .map(|c| (c.start_ms, c.end_ms))
            .collect();
        let segments = row.plan().unwrap_or_default().segments;
        Ok(!segments.is_empty() && pending_segments(&segments, &done).is_empty())
    }

    async fn process(&self, ctx: &JobCtx, row: &VideoRow) -> AppResult<Value> {
        let segments = row.plan().unwrap_or_default().segments;
        if segments.is_empty() {
            return Err(AppError::ValidationError(
                "还没有片段，先规划切分".to_string(),
            ));
        }
        let dir = video_dir(&self.data_dir, self.video_id);
        // 从原视频切（画质最好）；原视频已删除时用编辑用的文件
        let source = row
            .source_file
            .as_ref()
            .or(row.media_file.as_ref())
            .map(|f| dir.join(f))
            .filter(|p| p.is_file())
            .ok_or_else(|| AppError::ValidationError("找不到视频文件，请重新导入".to_string()))?;
        std::fs::create_dir_all(dir.join(CLIPS_DIR)).map_err(io_error)?;

        let existing = VideoRepository::clips(&self.pool, self.video_id).await?;
        let done: Vec<(i64, i64)> = existing.iter().map(|c| (c.start_ms, c.end_ms)).collect();
        let mut seq = existing.iter().map(|c| c.seq).max().unwrap_or(0);
        let pending = pending_segments(&segments, &done);
        let cues = row.cues();
        let total = pending.len() as u64;
        let mut created = Vec::new();
        let mut skipped = 0;
        for (n, (index, seg)) in pending.iter().enumerate() {
            if ctx.is_cancelled() {
                break;
            }
            let label = format!("第 {}/{} 段", n + 1, total);
            let sentences = clip_sentences(&cues, seg);
            if sentences.is_empty() {
                skipped += 1;
                continue;
            }
            ctx.stage(format!("{label} · 切分"));
            let name = format!("{}-{}", self.video_id, uuid::Uuid::new_v4().simple());
            let file = format!("{CLIPS_DIR}/{name}.mp4");
            let poster = format!("{CLIPS_DIR}/{name}.jpg");
            let step = n as u64 * 100;
            self.tools
                .cut(
                    &source,
                    seg.start_ms,
                    seg.end_ms,
                    &dir.join(&file),
                    |f| ctx.progress(step + (f * 70.0) as u64, total * 100),
                    || ctx.is_cancelled(),
                )
                .await?;
            let poster = match self
                .tools
                .poster(
                    &dir.join(&file),
                    (seg.end_ms - seg.start_ms) / 3,
                    &dir.join(&poster),
                )
                .await
            {
                Ok(()) => Some(poster),
                Err(e) => {
                    self.logger
                        .warn("VIDEO", "短片封面生成失败", Some(&e.to_string()));
                    None
                }
            };
            ctx.stage(format!("{label} · 翻译与整理"));
            ctx.progress(step + 75, total * 100);
            seq += 1;
            let passage_id = self
                .save(ctx, row, seg, sentences, seq, &file, poster.as_deref())
                .await
                .inspect_err(|_| {
                    let _ = std::fs::remove_file(dir.join(&file));
                })?;
            created.push(passage_id);
            self.logger.info(
                "VIDEO",
                &format!(
                    "视频 {} 第 {} 段已生成短文 {}",
                    self.video_id,
                    index + 1,
                    passage_id
                ),
            );
            ctx.progress(step + 100, total * 100);
        }
        Ok(serde_json::json!({
            "videoId": self.video_id,
            "created": created.len(),
            "skipped": skipped,
            "passageIds": created,
        }))
    }

    /// 补齐中文、标题、水平与重点词后，短文与短片同一事务写入
    #[allow(clippy::too_many_arguments)]
    async fn save(
        &self,
        ctx: &JobCtx,
        row: &VideoRow,
        seg: &VideoSegment,
        mut sentences: Vec<PassageSentence>,
        seq: i64,
        file: &str,
        poster: Option<&str>,
    ) -> AppResult<i64> {
        let needs_ai = sentences.iter().any(|s| s.zh.trim().is_empty())
            || seg.title.trim().is_empty()
            || seg.level.is_empty()
            || seg.key_words.is_empty();
        let mut title = seg.title.trim().to_string();
        let mut level = seg.level.clone();
        let mut key_words: Vec<(String, Option<String>)> =
            seg.key_words.iter().map(|w| (w.clone(), None)).collect();
        if needs_ai {
            let english: Vec<String> = sentences.iter().map(|s| s.en.clone()).collect();
            let translation = tasks::translate_passage(
                &self.paths,
                &self.model,
                &self.profile,
                &TranslateSpec {
                    title: Some(title.as_str()).filter(|t| !t.is_empty()),
                    sentences: &english,
                    key_words: key_words.is_empty(),
                },
                &self.logger,
                || ctx.is_cancelled(),
            )
            .await?;
            for (s, zh) in sentences.iter_mut().zip(translation.zh) {
                if s.zh.trim().is_empty() {
                    s.zh = zh;
                }
            }
            if title.is_empty() {
                title = translation.title.trim().to_string();
            }
            if level.is_empty() {
                level = translation.level.clone();
            }
            if key_words.is_empty() {
                key_words = translation
                    .key_words
                    .into_iter()
                    .map(|(w, m)| (w, Some(m)))
                    .collect();
            }
        }
        if title.is_empty() {
            title = format!("{} · {}", row.title, seq);
        }
        let level = if PASSAGE_LEVELS.contains(&level.as_str()) {
            level
        } else {
            "b2".to_string()
        };
        let repo = PassageRepository::new(self.pool.clone());
        let texts: Vec<String> = key_words.iter().map(|(w, _)| w.clone()).collect();
        let known = repo.word_ids_by_text(&texts).await?;
        let targets: Vec<PassageTargetWord> = key_words
            .into_iter()
            .map(|(word, meaning)| PassageTargetWord {
                word_id: known.get(&word.to_lowercase()).copied(),
                word,
                required: false,
                meaning: meaning.filter(|m| !m.trim().is_empty()),
            })
            .collect();
        let word_count = english_word_count(&sentences);
        // 原视频的标签（事务外先读）
        let video_tags: Vec<i64> =
            crate::repositories::tag_repository::TagRepository::new(self.pool.clone())
                .tags_of(crate::types::material::MaterialKind::Video, self.video_id)
                .await?
                .into_iter()
                .map(|t| t.id)
                .collect();
        let mut tx = self.pool.begin().await?;
        let passage_id = PassageRepository::insert_passage_conn(
            &mut tx,
            &NewPassage {
                origin: "imported",
                source_label: Some(&row.title),
                scene: Some(seg.scene.as_str()).filter(|s| !s.trim().is_empty()),
                level: &level,
                sources: &[],
                model_name: needs_ai.then_some(self.model.display_name.as_str()),
                prompt_fingerprint: None,
            },
            &GeneratedPassage {
                title,
                sentences,
                target_words: targets,
                word_count,
            },
        )
        .await?;
        VideoRepository::insert_clip_conn(
            &mut tx,
            self.video_id,
            passage_id,
            seq,
            seg.start_ms,
            seg.end_ms,
            file,
            poster,
        )
        .await?;
        // 切片短文的标签 = 原视频的标签 + 片段的标签（AI 规划给的或用户改的）
        let tags = crate::services::tag::TagService::new(self.pool.clone());
        let mut tag_ids = tags.ensure_names_conn(&mut tx, &seg.tags).await?;
        let repo = crate::repositories::tag_repository::TagRepository::new(self.pool.clone());
        tag_ids.extend(video_tags);
        repo.add_conn(
            &mut tx,
            crate::types::material::MaterialKind::Passage,
            passage_id,
            &tag_ids,
        )
        .await?;
        tx.commit().await?;
        Ok(passage_id)
    }
}

/// 短片文件的绝对路径
pub fn clip_path(data_dir: &Path, video_id: i64, file: &str) -> PathBuf {
    video_dir(data_dir, video_id).join(file)
}

fn io_error(e: std::io::Error) -> AppError {
    AppError::InternalError(format!("读写视频文件失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(start: i64, end: i64, en: &str, zh: &str) -> Cue {
        Cue {
            start_ms: start,
            end_ms: end,
            en: en.into(),
            zh: zh.into(),
        }
    }

    fn seg(start: i64, end: i64) -> VideoSegment {
        VideoSegment {
            id: "s".into(),
            start_ms: start,
            end_ms: end,
            ..Default::default()
        }
    }

    #[test]
    fn sentences_are_relative_to_the_clip() {
        let cues = vec![
            cue(500, 1500, "Before", ""),
            cue(2000, 4000, "Hello", "你好"),
            cue(4500, 7000, "Bye", ""),
        ];
        let s = clip_sentences(&cues, &seg(1800, 6000));
        // 第一条只有一小半在片段里，不算；最后一条超出的部分夹到片段结尾
        assert_eq!(s.len(), 2);
        assert_eq!(
            (s[0].en.as_str(), s[0].start_ms, s[0].end_ms),
            ("Hello", Some(200), Some(2200))
        );
        assert!(s[0].paragraph && !s[1].paragraph);
        assert_eq!((s[1].start_ms, s[1].end_ms), (Some(2700), Some(4200)));
        assert_eq!(s[0].zh, "你好");
    }

    #[test]
    fn finished_segments_are_skipped_on_resume() {
        let segments = vec![seg(0, 5000), seg(5000, 9000), seg(9000, 12_000)];
        let pending = pending_segments(&segments, &[(0, 5000), (9000, 12_000)]);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].0, 1);
        // 边界改过的片段要重新切
        assert_eq!(pending_segments(&segments, &[(0, 4900)]).len(), 3);
    }

    #[tokio::test]
    async fn clip_and_passage_are_saved_together_and_cascade() {
        let pool = crate::test_support::memory_pool().await;
        let video = VideoRepository::insert(&pool, "v", "v.mp4", None, &[], 0)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let passage = PassageRepository::insert_passage_conn(
            &mut tx,
            &NewPassage {
                origin: "imported",
                source_label: Some("v"),
                scene: None,
                level: "a2",
                sources: &[],
                model_name: None,
                prompt_fingerprint: None,
            },
            &GeneratedPassage {
                title: "T".into(),
                sentences: clip_sentences(&[cue(0, 1000, "Hi", "嗨")], &seg(0, 2000)),
                target_words: vec![],
                word_count: 1,
            },
        )
        .await
        .unwrap();
        VideoRepository::insert_clip_conn(&mut tx, video, passage, 1, 0, 2000, "clips/a.mp4", None)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        crate::time::assert_instants_canonical(&pool).await;
        let clip = VideoRepository::clip_of_passage(&pool, passage)
            .await
            .unwrap()
            .unwrap();
        assert_eq!((clip.video_id, clip.seq), (video, 1));
        // 有短片的短文来源显示为 video，按来源筛选能分开
        let repo = PassageRepository::new(pool.clone());
        assert_eq!(repo.find(passage).await.unwrap().unwrap().origin, "video");
        assert_eq!(repo.list(None, None, Some("video")).await.unwrap().len(), 1);
        assert!(repo
            .list(None, None, Some("imported"))
            .await
            .unwrap()
            .is_empty());
        // 句子的时间存进了 JSON
        let json: String = sqlx::query_scalar("SELECT sentences FROM passages WHERE id = ?")
            .bind(passage)
            .fetch_one(pool.as_ref())
            .await
            .unwrap();
        assert!(json.contains("\"startMs\":0") && json.contains("\"endMs\":1000"));
        // 删除短文时短片记录一起删除
        sqlx::query("DELETE FROM passages WHERE id = ?")
            .bind(passage)
            .execute(pool.as_ref())
            .await
            .unwrap();
        assert!(VideoRepository::clips(&pool, video)
            .await
            .unwrap()
            .is_empty());
    }
}

/// 真实 ffmpeg 端到端（不调 AI：片段信息齐全、字幕自带中文）：
/// `PINDU_FFMPEG_DIR=<目录> PINDU_SAMPLE_VIDEO=<视频> PINDU_SAMPLE_SRT=<双语字幕> REDLARK_AGENT_BIN=<sidecar> cargo test real_video_processing -- --ignored`
#[cfg(test)]
mod real_tests {
    use super::*;
    use crate::jobs::{JobSpec, Jobs, Lane};
    use crate::services::video::VideoImport;

    async fn run_job<F, Fut>(jobs: &Jobs, f: F) -> crate::jobs::Job
    where
        F: FnOnce(JobCtx) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = AppResult<Value>> + Send + 'static,
    {
        let spec = JobSpec {
            kind: "t",
            title: "t".into(),
            lane: Lane::Media,
            detached: true,
            link: None,
        };
        let id = jobs.spawn(spec, f);
        loop {
            let job = jobs.get(&id).unwrap();
            if !job.status.is_active() {
                return job;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    }

    #[tokio::test]
    #[ignore]
    async fn real_video_processing() {
        let env = |k: &str| std::env::var(k).unwrap();
        let tools = crate::media::locate_in(Path::new(&env("PINDU_FFMPEG_DIR")))
            .await
            .unwrap();
        let srt = std::fs::read_to_string(env("PINDU_SAMPLE_SRT")).unwrap();
        let cues = crate::services::subtitle::build_cues(&srt, None).unwrap();
        let pool = crate::test_support::memory_pool().await;
        let logger = crate::test_support::test_logger();
        let data = std::env::temp_dir().join(format!("pindu-real-process-{}", std::process::id()));
        let id = VideoRepository::insert(&pool, "sample", "sample.mkv", None, &cues, 0)
            .await
            .unwrap();
        let jobs = Jobs::new(|job| {
            eprintln!(
                "{:?} {:?} {}/{}",
                job.status, job.stage, job.current, job.total
            )
        });
        let import = VideoImport {
            pool: pool.clone(),
            logger: logger.clone(),
            tools: tools.clone(),
            data_dir: data.clone(),
            video_id: id,
            source: PathBuf::from(env("PINDU_SAMPLE_VIDEO")),
        };
        assert!(run_job(&jobs, move |ctx| import.run(ctx))
            .await
            .error
            .is_none());

        let segment = |start: i64, end: i64, title: &str| VideoSegment {
            id: title.into(),
            start_ms: start,
            end_ms: end,
            title: title.into(),
            scene: "测试".into(),
            level: "a2".into(),
            focus: "f".into(),
            key_words: vec!["menu".into()],
            tags: vec!["点餐".into()],
        };
        let plan = crate::types::video::VideoPlan {
            requirements: String::new(),
            segments: vec![
                segment(1700, 40_000, "Restaurant"),
                segment(45_000, 70_000, "Directions"),
            ],
        };
        VideoRepository::save_plan(&pool, id, &plan).await.unwrap();
        let make = || {
            VideoProcessJob {
            pool: pool.clone(),
            logger: logger.clone(),
            tools: tools.clone(),
            paths: AgentPaths::resolve(&data).unwrap(),
            // 不会调用 AI：给一个占位模型
            model: serde_json::from_value(serde_json::json!({
                "id": 1, "name": "m", "displayName": "M", "modelId": "m", "description": null,
                "maxTokens": 1000, "temperature": 1.0, "isActive": true, "isDefault": true,
                "createdAt": "", "updatedAt": "",
                "provider": {"id": 1, "name": "p", "displayName": "P", "baseUrl": "http://localhost",
                    "apiKey": "", "description": null, "isActive": true, "createdAt": "", "updatedAt": ""}
            }))
            .unwrap(),
            profile: crate::prompts::PromptProfile::default(),
            data_dir: data.clone(),
            video_id: id,
        }
        };
        let first = make();
        let job = run_job(&jobs, move |ctx| first.run(ctx)).await;
        assert!(job.error.is_none(), "{:?}", job.error);
        assert_eq!(job.result.as_ref().unwrap()["created"], 2);
        let clips = VideoRepository::clips(&pool, id).await.unwrap();
        assert_eq!(clips.len(), 2);
        let info = tools
            .probe(&clip_path(&data, id, &clips[0].file))
            .await
            .unwrap();
        eprintln!(
            "clip 1: {} ms, {:?}x{:?}",
            info.duration_ms, info.width, info.height
        );
        assert!((info.duration_ms - 38_300).abs() < 100);
        let row = VideoRepository::get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.status, "done");
        // 再处理一次：都已完成，不会重复生成
        let again = make();
        let job = run_job(&jobs, move |ctx| again.run(ctx)).await;
        assert_eq!(job.result.as_ref().unwrap()["created"], 0);
        let _ = std::fs::remove_dir_all(&data);
    }
}
