//! 后台任务「分析并加入词汇本」：分批并发做拼读分析（每批词数与并发按「设置 → AI 助手」），
//! 逐词状态经任务 detail 推送；分析完（或停止时）把成功的词写进词汇本，失败 / 没轮到的词放进结果，可以再提交一次。

use crate::error::{AppError, AppResult};
use crate::jobs::JobCtx;
use crate::logger::Logger;
use crate::services::phonics_analysis::PhonicsBatchAnalyzer;
use crate::services::wordbook::WordBookService;
use crate::types::word_analysis::{
    PhonicsWord, WordAnalysisDetail, WordAnalysisOutcome, WordAnalysisStatus,
};
use crate::types::wordbook::CreateWordBookFromAnalysisRequest;
use futures::stream::{self, StreamExt};
use sqlx::SqlitePool;
use std::sync::{Arc, Mutex};

const PENDING: &str = "pending";
const ANALYZING: &str = "analyzing";
const COMPLETED: &str = "completed";
const FAILED: &str = "failed";

pub struct WordAnalysisJob {
    pub pool: Arc<SqlitePool>,
    pub logger: Arc<Logger>,
    pub analyzer: Arc<PhonicsBatchAnalyzer>,
    pub book_id: i64,
    pub book_title: String,
    pub words: Vec<String>,
    /// 生成 / 提取时 AI 给的标签，保存后给词汇本加上
    pub tags: Vec<String>,
    pub batch_size: usize,
    pub concurrency: usize,
}

/// 逐词状态（保持提交时的顺序），每次变化推送 detail 与进度
struct Statuses {
    ctx: JobCtx,
    words: Mutex<Vec<WordAnalysisStatus>>,
}

impl Statuses {
    fn new(ctx: JobCtx, words: &[String]) -> Self {
        let statuses = Self {
            ctx,
            words: Mutex::new(
                words
                    .iter()
                    .map(|w| WordAnalysisStatus {
                        word: w.clone(),
                        status: PENDING.to_string(),
                        error: None,
                    })
                    .collect(),
            ),
        };
        statuses.publish();
        statuses
    }

    fn set(&self, words: &[String], status: &str, error: Option<&str>) {
        {
            let mut all = self.words.lock().unwrap();
            for entry in all
                .iter_mut()
                .filter(|e| words.iter().any(|w| w.eq_ignore_ascii_case(&e.word)))
            {
                entry.status = status.to_string();
                entry.error = error.map(str::to_string);
            }
        }
        self.publish();
    }

    fn publish(&self) {
        let all = self.words.lock().unwrap().clone();
        let done = all
            .iter()
            .filter(|w| w.status == COMPLETED || w.status == FAILED)
            .count();
        self.ctx.progress(done as u64, all.len() as u64);
        if let Ok(detail) = serde_json::to_value(WordAnalysisDetail { words: all }) {
            self.ctx.detail(detail);
        }
    }

    /// 没有分析成功的词；还没轮到的（已停止）标上原因
    fn unfinished(&self) -> Vec<WordAnalysisStatus> {
        self.words
            .lock()
            .unwrap()
            .iter()
            .filter(|w| w.status != COMPLETED)
            .map(|w| WordAnalysisStatus {
                word: w.word.clone(),
                status: FAILED.to_string(),
                error: w
                    .error
                    .clone()
                    .or_else(|| Some("已停止，没有分析".to_string())),
            })
            .collect()
    }
}

impl WordAnalysisJob {
    pub async fn run(self, ctx: JobCtx) -> AppResult<WordAnalysisOutcome> {
        let statuses = Statuses::new(ctx.clone(), &self.words);
        ctx.stage("AI 正在分析拼读、音标和例句");
        let analyzed = self.analyze(&ctx, &statuses).await;
        let failed = statuses.unfinished();

        if analyzed.is_empty() {
            if ctx.is_cancelled() {
                return Ok(self.outcome(0, 0, failed));
            }
            let reason = failed
                .iter()
                .find_map(|w| w.error.clone())
                .unwrap_or_else(|| "请再试一次".to_string());
            return Err(AppError::ExternalServiceError(format!(
                "没有分析成功的单词：{reason}"
            )));
        }

        ctx.stage("保存到词汇本");
        let saved = WordBookService::new(self.pool.clone(), self.logger.clone())
            .create_word_book_from_analysis(CreateWordBookFromAnalysisRequest {
                title: self.book_title.clone(),
                description: String::new(),
                icon: None,
                icon_color: None,
                words: analyzed.iter().map(PhonicsWord::to_analyzed).collect(),
                status: None,
                book_id: Some(self.book_id),
                tag_ids: None,
            })
            .await?;
        self.add_tags().await;
        self.logger.info(
            "WORD_ANALYSIS",
            &format!(
                "词汇本 {} 新增 {}、更新 {}，未完成 {}",
                self.book_id,
                saved.added_count,
                saved.updated_count,
                failed.len()
            ),
        );
        Ok(self.outcome(saved.added_count, saved.updated_count, failed))
    }

    /// 给词汇本加上 AI 定的标签（已有的不重复）；失败只记 WARN，单词已经保存
    async fn add_tags(&self) {
        if self.tags.is_empty() {
            return;
        }
        let result = async {
            let mut conn = self.pool.acquire().await?;
            crate::services::tag::TagService::new(self.pool.clone())
                .add_names_conn(
                    &mut conn,
                    crate::types::material::MaterialKind::WordBook,
                    self.book_id,
                    &self.tags,
                )
                .await
        }
        .await;
        if let Err(e) = result {
            self.logger.warn(
                "WORD_ANALYSIS",
                &format!("词汇本 {} 加 AI 标签失败：{e}", self.book_id),
                None,
            );
        }
    }

    fn outcome(
        &self,
        added_count: i32,
        updated_count: i32,
        failed: Vec<WordAnalysisStatus>,
    ) -> WordAnalysisOutcome {
        WordAnalysisOutcome {
            book_id: self.book_id,
            added_count,
            updated_count,
            failed,
        }
    }

    /// 分批并发分析；停止后不再开始新的批次（进行中的批次跑完）
    async fn analyze(&self, ctx: &JobCtx, statuses: &Statuses) -> Vec<PhonicsWord> {
        let batches: Vec<Vec<String>> = self
            .words
            .chunks(self.batch_size.max(1))
            .map(<[String]>::to_vec)
            .collect();
        let total = batches.len();
        let results: Vec<Vec<PhonicsWord>> = stream::iter(batches.into_iter().enumerate())
            .map(|(index, batch)| async move {
                if ctx.is_cancelled() {
                    return Vec::new();
                }
                statuses.set(&batch, ANALYZING, None);
                match self.analyzer.analyze_batch(&batch, index, total).await {
                    Ok(outcome) => {
                        statuses.set(&outcome.missing, FAILED, Some("模型没有返回该单词的分析"));
                        let done: Vec<String> =
                            outcome.analyzed.iter().map(|w| w.word.clone()).collect();
                        statuses.set(&done, COMPLETED, None);
                        outcome.analyzed
                    }
                    Err(e) => {
                        self.logger.error(
                            "WORD_ANALYSIS",
                            &format!("批次 {}/{} 失败", index + 1, total),
                            Some(&e.to_string()),
                        );
                        statuses.set(&batch, FAILED, Some(&e.to_string()));
                        Vec::new()
                    }
                }
            })
            .buffer_unordered(self.concurrency.max(1))
            .collect()
            .await;
        results.into_iter().flatten().collect()
    }
}
