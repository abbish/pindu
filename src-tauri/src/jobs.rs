//! 后台任务（唯一 owner）：耗时的 AI / 媒体工作提交为任务，命令立即返回任务 id，
//! 进度与结果经 `job-updated` 事件推给前端（顶栏任务按钮、任务面板、发起页面的内嵌进度）。
//!
//! - 只放内存：完成的保留最近 [`KEEP_FINISHED`] 条；需要跨重启的状态由业务表自己记（如视频处理按段可续）。
//! - 两条队列：agent（AI 任务）与 media（ffmpeg），各自限制同时运行的数量，其余排队。
//! - `detached`：结果由后端写库、离开发起页面后继续的任务；为 false 的任务结果只给发起页面用（如计划 AI 排序），页面离开时自行取消。
//! - 取消只是设标志，由任务在检查点停下；停下前已完成的部分可以作为结果返回（状态为 cancelled）。

use crate::error::{AppError, AppResult};
use futures::FutureExt;
use serde::Serialize;
use serde_json::Value;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

/// 前端订阅的事件名，载荷为 [`Job`]
pub const EVENT: &str = "job-updated";
/// 内存里保留的已结束任务数
const KEEP_FINISHED: usize = 50;
/// 同一任务两次进度推送的最小间隔（状态变化不受限）
const EMIT_INTERVAL: Duration = Duration::from_millis(200);
/// 同时运行的 AI 任务数的初始值（「设置 → AI 任务」可改，见 [`Jobs::set_agent_slots`]；每个任务内部的并发另算，如批量分析按设置分批）
const AGENT_SLOTS: usize = 2;
/// 同时运行的媒体任务数（ffmpeg 吃满 CPU）
const MEDIA_SLOTS: usize = 1;
/// 设备互传同时进行的发送数（不占 AI 与视频处理的空位；接收另有一条队列）
const TRANSFER_SLOTS: usize = 2;
/// 模型下载同时进行的数（不占 AI 与视频处理的空位）
const DOWNLOAD_SLOTS: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Running)
    }
}

/// 任务排在哪条队列
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    Agent,
    /// ffmpeg 处理视频
    Media,
    /// 设备互传的发送（lan/transfer.rs）
    Transfer,
    /// 设备互传的接收（同时只接收一个；不排在发送后面，否则对方传完了也等不到导入）
    Receive,
    /// 本机模型下载（发音评估、语音输入、字幕识别）
    Download,
}

/// 任务属于哪个模块：序列化为侧边栏一级页面键，菜单上显示这个模块进行中的任务
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobModule {
    WordBooks,
    Passages,
    Videos,
    Plans,
}

/// 「打开」结果时跳转的页面（`navigation.ts` 的页面键与参数）
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobLink {
    pub page: String,
    pub params: Value,
}

impl JobLink {
    pub fn new(page: &str, params: Value) -> Self {
        Self {
            page: page.to_string(),
            params,
        }
    }
}

/// 任务快照（事件载荷与 list_jobs 返回值）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    /// 任务类型，如 `word_analysis`、`passage_generate`、`video_process`
    pub kind: String,
    pub module: Option<JobModule>,
    pub title: String,
    pub status: JobStatus,
    /// 当前阶段的说明，如「第 3/8 段 · 切分中」
    pub stage: Option<String>,
    pub current: u64,
    /// 0 表示进度不确定（只显示转圈）
    pub total: u64,
    pub detached: bool,
    pub link: Option<JobLink>,
    /// 运行中的细节（形状由任务类型决定，如批量分析的逐词状态），随进度节流推送
    pub detail: Option<Value>,
    /// 任务产出（给发起页面用，形状由任务类型决定）
    pub result: Option<Value>,
    /// 失败原因，形状同 IPC 错误 `{code, message}`
    pub error: Option<Value>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// 提交任务时的描述
pub struct JobSpec {
    pub kind: &'static str,
    pub module: Option<JobModule>,
    pub title: String,
    pub lane: Lane,
    pub detached: bool,
    pub link: Option<JobLink>,
}

struct Entry {
    job: Job,
    cancel: Arc<AtomicBool>,
    last_emit: Option<Instant>,
    /// 有被节流压下、还没推送的变化（间隔到了补推一次，不然最后一次进度要等下一次变化才看得到）
    pending: bool,
}

type EmitFn = dyn Fn(&Job) + Send + Sync;

/// 任务管理器（`app.manage`，克隆共享同一份状态）
#[derive(Clone)]
pub struct Jobs {
    entries: Arc<Mutex<Vec<Entry>>>,
    emit: Arc<EmitFn>,
    agent: Arc<Semaphore>,
    /// AI 队列当前的总空位数（含正在用的）
    agent_slots: Arc<AtomicUsize>,
    media: Arc<Semaphore>,
    transfer: Arc<Semaphore>,
    receive: Arc<Semaphore>,
    download: Arc<Semaphore>,
    /// `spawn_unique` 的检查与提交在这把锁里，两次几乎同时的点击不会建出两个任务
    unique: Arc<Mutex<()>>,
    seq: Arc<AtomicU64>,
}

impl Jobs {
    /// `emit`：任务变化时调用（应用里是发 `job-updated` 事件，测试里收集快照）
    pub fn new(emit: impl Fn(&Job) + Send + Sync + 'static) -> Self {
        Self {
            entries: Arc::new(Mutex::new(Vec::new())),
            emit: Arc::new(emit),
            agent: Arc::new(Semaphore::new(AGENT_SLOTS)),
            agent_slots: Arc::new(AtomicUsize::new(AGENT_SLOTS)),
            media: Arc::new(Semaphore::new(MEDIA_SLOTS)),
            transfer: Arc::new(Semaphore::new(TRANSFER_SLOTS)),
            receive: Arc::new(Semaphore::new(1)),
            download: Arc::new(Semaphore::new(DOWNLOAD_SLOTS)),
            unique: Arc::new(Mutex::new(())),
            seq: Arc::new(AtomicU64::new(0)),
        }
    }

    /// 改 AI 队列同时运行的任务数：调大立即生效；调小时等正在运行的任务结束后再收回空位（不打断任务）
    pub fn set_agent_slots(&self, slots: usize) {
        let slots = slots.max(1);
        let previous = self.agent_slots.swap(slots, Ordering::SeqCst);
        if slots > previous {
            self.agent.add_permits(slots - previous);
        } else if slots < previous {
            let semaphore = self.agent.clone();
            let surplus = (previous - slots) as u32;
            tauri::async_runtime::spawn(async move {
                if let Ok(permits) = semaphore.acquire_many_owned(surplus).await {
                    permits.forget();
                }
            });
        }
    }

    /// 同一 kind 已有进行中的任务就返回它的 id，否则提交新的（检查与提交不会被另一次调用插进来）
    pub fn spawn_unique<F, Fut>(&self, spec: JobSpec, run: F) -> String
    where
        F: FnOnce(JobCtx) -> Fut + Send + 'static,
        Fut: Future<Output = AppResult<Value>> + Send + 'static,
    {
        let _guard = self.unique.lock().unwrap();
        let running = self
            .entries
            .lock()
            .unwrap()
            .iter()
            .find(|e| e.job.kind == spec.kind && e.job.status.is_active())
            .map(|e| e.job.id.clone());
        running.unwrap_or_else(|| self.spawn(spec, run))
    }

    /// 提交任务，立即返回任务 id；`run` 在队列有空位时开始执行
    pub fn spawn<F, Fut>(&self, spec: JobSpec, run: F) -> String
    where
        F: FnOnce(JobCtx) -> Fut + Send + 'static,
        Fut: Future<Output = AppResult<Value>> + Send + 'static,
    {
        let id = format!("job-{}", self.seq.fetch_add(1, Ordering::SeqCst) + 1);
        let cancel = Arc::new(AtomicBool::new(false));
        let job = Job {
            id: id.clone(),
            kind: spec.kind.to_string(),
            module: spec.module,
            title: spec.title,
            status: JobStatus::Queued,
            stage: None,
            current: 0,
            total: 0,
            detached: spec.detached,
            link: spec.link,
            detail: None,
            result: None,
            error: None,
            created_at: crate::time::now_utc(),
            started_at: None,
            finished_at: None,
        };
        {
            let mut entries = self.entries.lock().unwrap();
            entries.push(Entry {
                job: job.clone(),
                cancel: cancel.clone(),
                last_emit: None,
                pending: false,
            });
            prune(&mut entries);
        }
        (self.emit)(&job);

        let jobs = self.clone();
        let semaphore = match spec.lane {
            Lane::Agent => self.agent.clone(),
            Lane::Media => self.media.clone(),
            Lane::Transfer => self.transfer.clone(),
            Lane::Receive => self.receive.clone(),
            Lane::Download => self.download.clone(),
        };
        let job_id = id.clone();
        tauri::async_runtime::spawn(async move {
            let _permit = semaphore.acquire_owned().await;
            if cancel.load(Ordering::SeqCst) {
                jobs.finish(&job_id, JobStatus::Cancelled, None, None);
                return;
            }
            jobs.update(&job_id, true, |job| {
                job.status = JobStatus::Running;
                job.started_at = Some(crate::time::now_utc());
            });
            let ctx = JobCtx {
                id: job_id.clone(),
                jobs: jobs.clone(),
                cancel: cancel.clone(),
            };
            let outcome = AssertUnwindSafe(run(ctx)).catch_unwind().await;
            let cancelled = cancel.load(Ordering::SeqCst);
            match outcome {
                Ok(Ok(value)) => {
                    let status = if cancelled {
                        JobStatus::Cancelled
                    } else {
                        JobStatus::Succeeded
                    };
                    jobs.finish(&job_id, status, Some(value), None);
                }
                Ok(Err(e)) if cancelled || is_cancel_error(&e) => {
                    jobs.finish(&job_id, JobStatus::Cancelled, None, None)
                }
                Ok(Err(e)) => jobs.finish(&job_id, JobStatus::Failed, None, Some(&e)),
                Err(_) => jobs.finish(
                    &job_id,
                    JobStatus::Failed,
                    None,
                    Some(&AppError::InternalError("任务意外中止".to_string())),
                ),
            }
        });
        id
    }

    /// 全部任务，最新的在前
    /// 提交后补上任务明细（排队时就要显示的信息，如要生成的题组的题量）
    pub fn set_detail(&self, id: &str, detail: Value) {
        self.update(id, true, |job| job.detail = Some(detail));
    }

    pub fn list(&self) -> Vec<Job> {
        let entries = self.entries.lock().unwrap();
        entries.iter().rev().map(|e| e.job.clone()).collect()
    }

    #[cfg(test)]
    pub fn get(&self, id: &str) -> Option<Job> {
        let entries = self.entries.lock().unwrap();
        entries
            .iter()
            .find(|e| e.job.id == id)
            .map(|e| e.job.clone())
    }

    /// 请求取消；排队中的任务立即结束，运行中的在下一个检查点停下。任务不存在或已结束时返回 false
    pub fn cancel(&self, id: &str) -> bool {
        let queued = {
            let entries = self.entries.lock().unwrap();
            match entries.iter().find(|e| e.job.id == id) {
                Some(e) if e.job.status.is_active() => {
                    e.cancel.store(true, Ordering::SeqCst);
                    e.job.status == JobStatus::Queued
                }
                _ => return false,
            }
        };
        if queued {
            self.finish(id, JobStatus::Cancelled, None, None);
        } else {
            self.update(id, true, |job| job.stage = Some("正在停止…".to_string()));
        }
        true
    }

    /// 从列表里移除已结束的任务
    pub fn remove(&self, id: &str) -> bool {
        let mut entries = self.entries.lock().unwrap();
        let before = entries.len();
        entries.retain(|e| e.job.id != id || e.job.status.is_active());
        entries.len() != before
    }

    /// 清除全部已结束的任务
    pub fn clear_finished(&self) {
        self.entries
            .lock()
            .unwrap()
            .retain(|e| e.job.status.is_active());
    }

    /// 排队中或运行中的任务标题（更新安装、退出前提示用）
    pub fn active_titles(&self) -> Vec<String> {
        let entries = self.entries.lock().unwrap();
        entries
            .iter()
            .filter(|e| e.job.status.is_active())
            .map(|e| e.job.title.clone())
            .collect()
    }

    /// 修改任务并推送；`force` 为 false 时按 [`EMIT_INTERVAL`] 节流
    fn update(&self, id: &str, force: bool, change: impl FnOnce(&mut Job)) {
        let snapshot = {
            let mut entries = self.entries.lock().unwrap();
            let Some(entry) = entries.iter_mut().find(|e| e.job.id == id) else {
                return;
            };
            change(&mut entry.job);
            let due = entry
                .last_emit
                .is_none_or(|at| at.elapsed() >= EMIT_INTERVAL);
            if !force && !due {
                if !entry.pending {
                    entry.pending = true;
                    let wait = entry.last_emit.map_or(Duration::ZERO, |at| {
                        EMIT_INTERVAL.saturating_sub(at.elapsed())
                    });
                    let jobs = self.clone();
                    let id = id.to_string();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(wait).await;
                        jobs.flush(&id);
                    });
                }
                return;
            }
            entry.last_emit = Some(Instant::now());
            entry.pending = false;
            entry.job.clone()
        };
        (self.emit)(&snapshot);
    }

    /// 补推被节流压下的变化（期间已经推过的就不再推）
    fn flush(&self, id: &str) {
        let snapshot = {
            let mut entries = self.entries.lock().unwrap();
            let Some(entry) = entries.iter_mut().find(|e| e.job.id == id && e.pending) else {
                return;
            };
            entry.pending = false;
            entry.last_emit = Some(Instant::now());
            entry.job.clone()
        };
        (self.emit)(&snapshot);
    }

    fn finish(&self, id: &str, status: JobStatus, result: Option<Value>, error: Option<&AppError>) {
        let error = error.and_then(|e| serde_json::to_value(e).ok());
        self.update(id, true, |job| {
            job.status = status;
            job.result = result;
            job.error = error;
            job.finished_at = Some(crate::time::now_utc());
            if status == JobStatus::Succeeded && job.total > 0 {
                job.current = job.total;
            }
        });
    }
}

/// 只保留最近 KEEP_FINISHED 条已结束的任务
fn prune(entries: &mut Vec<Entry>) {
    let finished = entries.iter().filter(|e| !e.job.status.is_active()).count();
    let mut excess = finished.saturating_sub(KEEP_FINISHED);
    entries.retain(|e| {
        if excess > 0 && !e.job.status.is_active() {
            excess -= 1;
            false
        } else {
            true
        }
    });
}

/// agent 被中止时返回的错误（`agent::session::CANCELLED`）
fn is_cancel_error(e: &AppError) -> bool {
    e.to_string().contains(crate::agent::session::CANCELLED)
}

/// 任务运行时拿到的句柄：报告进度、检查取消
#[derive(Clone)]
pub struct JobCtx {
    id: String,
    jobs: Jobs,
    cancel: Arc<AtomicBool>,
}

impl JobCtx {
    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    /// 等别的任务结束（结束、失败、取消都算），自己被取消时也停止等待
    pub async fn wait_for(&self, ids: &[String]) {
        while !self.is_cancelled()
            && self
                .jobs
                .list()
                .iter()
                .any(|job| job.status.is_active() && ids.contains(&job.id))
        {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    /// 进度（节流推送）
    pub fn progress(&self, current: u64, total: u64) {
        self.jobs.update(&self.id, false, |job| {
            job.current = current;
            job.total = total;
        });
    }

    /// 运行中的细节（节流推送）
    pub fn detail(&self, detail: Value) {
        self.jobs
            .update(&self.id, false, |job| job.detail = Some(detail));
    }

    /// 改「打开」的跳转目标（结果生成后才知道，如新写的短文）
    pub fn set_link(&self, link: JobLink) {
        self.jobs
            .update(&self.id, true, |job| job.link = Some(link));
    }

    /// 阶段说明（立即推送）
    pub fn stage(&self, stage: impl Into<String>) {
        let stage = stage.into();
        self.jobs
            .update(&self.id, true, |job| job.stage = Some(stage));
    }

    /// 换到一个有自己计数的阶段：阶段说明与从 0 开始的进度一起立即推送（不带出上一阶段的计数）
    pub fn stage_with_total(&self, stage: impl Into<String>, total: u64) {
        let stage = stage.into();
        self.jobs.update(&self.id, true, |job| {
            job.stage = Some(stage);
            job.current = 0;
            job.total = total;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn collecting() -> (Jobs, Arc<Mutex<Vec<Job>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let jobs = Jobs::new(move |job| sink.lock().unwrap().push(job.clone()));
        (jobs, seen)
    }

    fn spec(lane: Lane) -> JobSpec {
        JobSpec {
            kind: "test",
            module: None,
            title: "测试".to_string(),
            lane,
            detached: true,
            link: None,
        }
    }

    async fn wait_done(jobs: &Jobs, id: &str) -> Job {
        for _ in 0..200 {
            let job = jobs.get(id).unwrap();
            if !job.status.is_active() {
                return job;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("任务没有结束");
    }

    #[tokio::test]
    async fn agent_slots_can_grow_and_shrink() {
        let (jobs, _) = collecting();
        jobs.set_agent_slots(4);
        assert_eq!(jobs.agent.available_permits(), 4);
        jobs.set_agent_slots(1);
        for _ in 0..100 {
            if jobs.agent.available_permits() == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert_eq!(jobs.agent.available_permits(), 1);
        // 收回空位后任务照常排队执行
        let id = jobs.spawn(spec(Lane::Agent), |_| async { Ok(json!(null)) });
        assert_eq!(wait_done(&jobs, &id).await.status, JobStatus::Succeeded);
    }

    #[tokio::test]
    async fn succeeded_job_keeps_result_and_fills_progress() {
        let (jobs, seen) = collecting();
        let id = jobs.spawn(spec(Lane::Agent), |ctx| async move {
            ctx.progress(1, 4);
            Ok(json!({"n": 1}))
        });
        let job = wait_done(&jobs, &id).await;
        assert_eq!(job.status, JobStatus::Succeeded);
        assert_eq!(job.result, Some(json!({"n": 1})));
        assert_eq!((job.current, job.total), (4, 4));
        assert!(job.started_at.is_some() && job.finished_at.is_some());
        // 第一条是排队，最后一条是完成
        let seen = seen.lock().unwrap();
        assert_eq!(seen.first().unwrap().status, JobStatus::Queued);
        assert_eq!(seen.last().unwrap().status, JobStatus::Succeeded);
    }

    #[tokio::test]
    async fn throttled_progress_is_pushed_after_the_interval_and_new_stage_starts_from_zero() {
        let (jobs, seen) = collecting();
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let id = jobs.spawn(spec(Lane::Agent), |ctx| async move {
            ctx.progress(300, 300);
            ctx.stage_with_total("生成单词卡", 10);
            // 紧接着的进度被节流压下，间隔到了也要补推
            ctx.progress(5, 10);
            let _ = rx.await;
            Ok(json!(null))
        });
        tokio::time::sleep(EMIT_INTERVAL * 2).await;
        {
            let seen = seen.lock().unwrap();
            let stage = seen
                .iter()
                .find(|j| j.stage.as_deref() == Some("生成单词卡"))
                .unwrap();
            assert_eq!((stage.current, stage.total), (0, 10));
            let last = seen.last().unwrap();
            assert_eq!((last.current, last.total), (5, 10));
        }
        let _ = tx.send(());
        wait_done(&jobs, &id).await;
    }

    #[tokio::test]
    async fn failed_job_carries_ipc_error_shape() {
        let (jobs, _) = collecting();
        let id = jobs.spawn(spec(Lane::Agent), |_| async {
            Err(AppError::ValidationError("没有配置模型".to_string()))
        });
        let job = wait_done(&jobs, &id).await;
        assert_eq!(job.status, JobStatus::Failed);
        let error = job.error.unwrap();
        assert_eq!(error["code"], "VALIDATION_ERROR");
        assert!(error["message"].as_str().unwrap().contains("没有配置模型"));
    }

    #[tokio::test]
    async fn cancelling_running_job_stops_at_checkpoint_and_keeps_partial_result() {
        let (jobs, _) = collecting();
        let id = jobs.spawn(spec(Lane::Agent), |ctx| async move {
            let mut done = 0;
            for _ in 0..100 {
                if ctx.is_cancelled() {
                    break;
                }
                done += 1;
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            Ok(json!(done))
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(jobs.cancel(&id));
        let job = wait_done(&jobs, &id).await;
        assert_eq!(job.status, JobStatus::Cancelled);
        assert!(job.result.unwrap().as_u64().unwrap() < 100);
        // 已结束的任务不能再取消
        assert!(!jobs.cancel(&id));
    }

    #[tokio::test]
    async fn cancel_error_from_agent_counts_as_cancelled() {
        let (jobs, _) = collecting();
        let id = jobs.spawn(spec(Lane::Agent), |_| async move {
            Err(AppError::ExternalServiceError(format!(
                "{}：用户中止",
                crate::agent::session::CANCELLED
            )))
        });
        assert_eq!(wait_done(&jobs, &id).await.status, JobStatus::Cancelled);
    }

    #[tokio::test]
    async fn media_lane_runs_one_at_a_time_and_queued_job_can_be_cancelled() {
        let (jobs, _) = collecting();
        let gate = Arc::new(tokio::sync::Notify::new());
        let ids: Vec<String> = (0..2)
            .map(|_| {
                let g = gate.clone();
                jobs.spawn(spec(Lane::Media), move |_| async move {
                    g.notified().await;
                    Ok(Value::Null)
                })
            })
            .collect();
        tokio::time::sleep(Duration::from_millis(50)).await;
        // 哪个先拿到位置不确定：一个在跑，另一个排队
        let status = |id: &String| jobs.get(id).unwrap().status;
        let (running, queued) = if status(&ids[0]) == JobStatus::Running {
            (&ids[0], &ids[1])
        } else {
            (&ids[1], &ids[0])
        };
        assert_eq!(status(running), JobStatus::Running);
        assert_eq!(status(queued), JobStatus::Queued);
        assert_eq!(jobs.active_titles().len(), 2);

        assert!(jobs.cancel(queued));
        assert_eq!(status(queued), JobStatus::Cancelled);
        gate.notify_one();
        assert_eq!(wait_done(&jobs, running).await.status, JobStatus::Succeeded);
        assert!(jobs.active_titles().is_empty());
    }

    #[tokio::test]
    async fn panicking_job_fails_instead_of_hanging() {
        let (jobs, _) = collecting();
        let id = jobs.spawn(spec(Lane::Agent), |_| async {
            if true {
                panic!("boom");
            }
            Ok(Value::Null)
        });
        assert_eq!(wait_done(&jobs, &id).await.status, JobStatus::Failed);
    }

    #[tokio::test]
    async fn progress_is_throttled_but_stage_is_not() {
        let (jobs, seen) = collecting();
        let id = jobs.spawn(spec(Lane::Agent), |ctx| async move {
            for i in 0..50 {
                ctx.progress(i, 50);
            }
            ctx.stage("收尾");
            Ok(Value::Null)
        });
        wait_done(&jobs, &id).await;
        let seen = seen.lock().unwrap();
        let progress_events = seen
            .iter()
            .filter(|j| j.status == JobStatus::Running)
            .count();
        assert!(progress_events < 10, "推送了 {progress_events} 次");
        assert!(seen.iter().any(|j| j.stage.as_deref() == Some("收尾")));
    }

    #[test]
    fn remove_and_clear_only_touch_finished_jobs() {
        let (jobs, _) = collecting();
        let push = |status| {
            let mut entries = jobs.entries.lock().unwrap();
            let id = format!("j{}", entries.len());
            entries.push(Entry {
                job: Job {
                    id,
                    kind: "t".into(),
                    module: None,
                    title: "t".into(),
                    status,
                    stage: None,
                    current: 0,
                    total: 0,
                    detached: true,
                    link: None,
                    detail: None,
                    result: None,
                    error: None,
                    created_at: String::new(),
                    started_at: None,
                    finished_at: None,
                },
                cancel: Arc::new(AtomicBool::new(false)),
                last_emit: None,
                pending: false,
            })
        };
        push(JobStatus::Running);
        push(JobStatus::Succeeded);
        push(JobStatus::Failed);
        assert!(!jobs.remove("j0"));
        assert!(jobs.remove("j1"));
        jobs.clear_finished();
        let left: Vec<_> = jobs.list().into_iter().map(|j| j.id).collect();
        assert_eq!(left, vec!["j0"]);
    }

    #[test]
    fn module_serializes_as_sidebar_page_key() {
        let keys: Vec<_> = [
            JobModule::WordBooks,
            JobModule::Passages,
            JobModule::Videos,
            JobModule::Plans,
        ]
        .iter()
        .map(|m| serde_json::to_value(m).unwrap())
        .collect();
        assert_eq!(keys, ["wordbooks", "passages", "videos", "plans"]);
    }

    #[test]
    fn prune_keeps_active_and_latest_finished() {
        let (jobs, _) = collecting();
        for i in 0..(KEEP_FINISHED + 5) {
            jobs.entries.lock().unwrap().push(Entry {
                job: Job {
                    id: format!("j{i}"),
                    kind: "t".into(),
                    module: None,
                    title: "t".into(),
                    status: if i == 0 {
                        JobStatus::Running
                    } else {
                        JobStatus::Succeeded
                    },
                    stage: None,
                    current: 0,
                    total: 0,
                    detached: true,
                    link: None,
                    detail: None,
                    result: None,
                    error: None,
                    created_at: String::new(),
                    started_at: None,
                    finished_at: None,
                },
                cancel: Arc::new(AtomicBool::new(false)),
                last_emit: None,
                pending: false,
            });
        }
        prune(&mut jobs.entries.lock().unwrap());
        let ids: Vec<_> = jobs.list().into_iter().map(|j| j.id).collect();
        assert_eq!(ids.len(), KEEP_FINISHED + 1);
        assert!(ids.contains(&"j0".to_string()));
        assert!(!ids.contains(&"j1".to_string()));
    }
}
