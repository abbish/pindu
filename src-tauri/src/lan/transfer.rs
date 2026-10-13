//! 传送会话（参考 LocalSend 的 prepare-upload / upload）：已配对的设备之间推送素材包。
//!
//! 发送方（后台任务）：生成素材包 → `offer`（接收方确认）→ `manifest` → 逐个 `files`（流式、可续传）→ `finish`（对方导入完成才返回）。
//! 接收方：确认后起一个后台任务显示进度，文件写进 `<数据目录>/lan/incoming/<传送编号>/`（按 sha256 校验），
//! `finish` 时在这个任务里导入（`services/lan_import.rs`），完成后删掉临时目录。同时只接收一个传送。
//! 全部接口要求调用方已配对，之后的请求还要带上确认时给的 token。

use super::client::{self, bytes_body, ClientError, Target};
use super::package::{Package, PackageSummary, MAX_MANIFEST_BYTES, VERSION};
use super::{user_error, LanEvent, LanNode, Shared};
use crate::error::{AppError, AppResult};
use crate::jobs::{JobCtx, JobLink, JobSpec, Lane};
use crate::repositories::lan_repository::LanRepository;
use crate::services::lan_export::{self, ExportItem, ExportOptions};
use crate::services::lan_import::{self, ImportResult};
use crate::types::lan::{TransferClosed, TransferOffer};
use futures::StreamExt;
use http_body_util::{BodyExt, StreamBody};
use hyper::body::{Bytes, Frame};
use hyper::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot, watch};

pub const TOKEN_HEADER: &str = "x-pindu-token";
pub const OFFSET_HEADER: &str = "x-pindu-offset";

/// 接收方确认的等待时间；发送方多等一点
const DECISION_TIMEOUT: Duration = Duration::from_secs(90);
const OFFER_WAIT: Duration = Duration::from_secs(100);
/// 接收方多久没收到任何数据就放弃
const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// 导入的等待上限（发送方等 finish）
const IMPORT_WAIT: Duration = Duration::from_secs(30 * 60);
const RETRIES: usize = 3;
const CHUNK: usize = 256 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferRequest {
    pub transfer_id: String,
    pub package_version: u32,
    pub summary: PackageSummary,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferResponse {
    pub accepted: bool,
    #[serde(default)]
    pub token: Option<String>,
}

/// 接收方已经收到的文件进度（续传用）
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedFiles {
    pub received: HashMap<String, u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishResponse {
    pub result: ImportResult,
}

// ==================== 接收方 ====================

pub(super) enum Signal {
    Finish(oneshot::Sender<Result<ImportResult, String>>),
    Cancel(String),
}

pub(super) struct Inbound {
    pub transfer_id: String,
    pub peer: String,
    pub alias: String,
    pub summary: PackageSummary,
    pub dir: PathBuf,
    /// 等本机用户决定（确认前）
    pub decision: Option<oneshot::Sender<bool>>,
    /// 确认后才有
    pub token: Option<String>,
    pub package: Option<Arc<Package>>,
    pub received: HashMap<String, u64>,
    pub progress: Option<watch::Sender<u64>>,
    pub signals: Option<mpsc::UnboundedSender<Signal>>,
    pub job_id: Option<String>,
    /// 正在写的文件：同一个文件同时只接受一个上传（发送方超时重试时旧连接可能还在写）
    pub uploading: std::collections::HashSet<String>,
}

/// 占住一个正在写的文件，离开作用域时放开
struct UploadSlot<'a> {
    shared: &'a Shared,
    transfer_id: String,
    file_id: String,
}

impl Drop for UploadSlot<'_> {
    fn drop(&mut self) {
        if let Some(i) = self
            .shared
            .lock()
            .inbound
            .as_mut()
            .filter(|i| i.transfer_id == self.transfer_id)
        {
            i.uploading.remove(&self.file_id);
        }
    }
}

type Reply<T> = Result<T, (StatusCode, String)>;

fn err(status: StatusCode, msg: &str) -> (StatusCode, String) {
    (status, msg.to_string())
}

/// 临时目录里已经收到的字节（完成的按文件大小，没完成的按 .part 大小）
fn scan_received(dir: &Path, pkg: &Package) -> HashMap<String, u64> {
    pkg.files
        .iter()
        .filter_map(|f| {
            let done = std::fs::metadata(dir.join(&f.id)).map(|m| m.len()).ok();
            let part = std::fs::metadata(dir.join(format!("{}.part", f.id)))
                .map(|m| m.len())
                .ok();
            done.or(part).map(|n| (f.id.clone(), n))
        })
        .collect()
}

impl Shared {
    fn incoming_dir(&self, transfer_id: &str) -> PathBuf {
        self.dir.join("incoming").join(transfer_id)
    }

    async fn require_paired(&self, peer: &str) -> Reply<String> {
        match LanRepository::get(&self.pool, peer).await {
            Ok(Some(row)) => Ok(row.alias),
            Ok(None) => Err(err(StatusCode::FORBIDDEN, "没有配对")),
            Err(e) => Err(err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())),
        }
    }

    /// 校验 token 与调用方，返回素材包与临时目录
    fn active(
        &self,
        peer: &str,
        transfer_id: &str,
        token: &str,
    ) -> Reply<(Option<Arc<Package>>, PathBuf)> {
        let st = self.lock();
        match &st.inbound {
            Some(i)
                if i.transfer_id == transfer_id
                    && i.peer == peer
                    && i.token.as_deref() == Some(token) =>
            {
                Ok((i.package.clone(), i.dir.clone()))
            }
            _ => Err(err(StatusCode::GONE, "传送已经结束或不存在")),
        }
    }

    pub(crate) async fn on_offer(
        self: &Arc<Self>,
        peer: &str,
        req: OfferRequest,
    ) -> Reply<OfferResponse> {
        let alias = self.require_paired(peer).await?;
        if req.package_version > VERSION {
            return Err(err(
                StatusCode::UPGRADE_REQUIRED,
                "对方的拼读版本较旧，请先在对方电脑上更新拼读",
            ));
        }
        if req.transfer_id.is_empty()
            || req.transfer_id.len() > 64
            || !req
                .transfer_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(err(StatusCode::BAD_REQUEST, "传送编号不对"));
        }
        let (tx, rx) = oneshot::channel();
        let dir = self.incoming_dir(&req.transfer_id);
        {
            let mut st = self.lock();
            if st.inbound.is_some() {
                return Err(err(StatusCode::CONFLICT, "正在接收别的内容"));
            }
            st.inbound = Some(Inbound {
                transfer_id: req.transfer_id.clone(),
                peer: peer.to_string(),
                alias: alias.clone(),
                summary: req.summary.clone(),
                dir: dir.clone(),
                decision: Some(tx),
                token: None,
                package: None,
                received: HashMap::new(),
                progress: None,
                signals: None,
                job_id: None,
                uploading: Default::default(),
            });
        }
        self.logger.info(
            "LAN",
            &format!(
                "「{alias}」想发送内容（传送 {}，共 {} 个文件 {} 字节）",
                req.transfer_id, req.summary.file_count, req.summary.total_bytes
            ),
        );
        (self.emit)(LanEvent::TransferOffer(TransferOffer {
            transfer_id: req.transfer_id.clone(),
            fingerprint: peer.to_string(),
            alias: alias.clone(),
            summary: req.summary.clone(),
        }));
        let decision = tokio::time::timeout(DECISION_TIMEOUT, rx).await;
        let accepted = matches!(decision, Ok(Ok(true)));
        if !accepted {
            let reason = match decision {
                Ok(Ok(_)) => "rejected",
                Ok(Err(_)) => "canceled",
                Err(_) => "timeout",
            };
            self.end_inbound(&req.transfer_id, reason);
            self.logger
                .info("LAN", &format!("没有接收「{alias}」的内容：{reason}"));
            return Ok(OfferResponse {
                accepted: false,
                token: None,
            });
        }
        if let Err(e) = std::fs::create_dir_all(&dir) {
            self.end_inbound(&req.transfer_id, "failed");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("无法创建临时目录：{e}"),
            ));
        }
        let token = uuid::Uuid::new_v4().simple().to_string();
        let (progress_tx, progress_rx) = watch::channel(0u64);
        let (signal_tx, signal_rx) = mpsc::unbounded_channel();
        let job_id = self.spawn_receive_job(
            req.transfer_id.clone(),
            alias.clone(),
            req.summary.total_bytes,
            progress_rx,
            signal_rx,
        );
        {
            let mut st = self.lock();
            if let Some(i) = st
                .inbound
                .as_mut()
                .filter(|i| i.transfer_id == req.transfer_id)
            {
                i.token = Some(token.clone());
                i.progress = Some(progress_tx);
                i.signals = Some(signal_tx);
                i.job_id = Some(job_id);
            }
        }
        Ok(OfferResponse {
            accepted: true,
            token: Some(token),
        })
    }

    fn spawn_receive_job(
        self: &Arc<Self>,
        transfer_id: String,
        alias: String,
        total: u64,
        mut progress: watch::Receiver<u64>,
        mut signals: mpsc::UnboundedReceiver<Signal>,
    ) -> String {
        let shared = self.clone();
        self.jobs.spawn(
            JobSpec {
                kind: "lan_receive",
                module: None,
                title: format!("接收「{alias}」发来的内容"),
                lane: Lane::Receive,
                detached: true,
                link: None,
            },
            move |ctx: JobCtx| async move {
                ctx.stage("正在接收");
                ctx.progress(0, total);
                let mut last = Instant::now();
                loop {
                    tokio::select! {
                        changed = progress.changed() => {
                            if changed.is_ok() {
                                ctx.progress(*progress.borrow(), total);
                                last = Instant::now();
                            }
                        }
                        signal = signals.recv() => match signal {
                            Some(Signal::Finish(reply)) => {
                                ctx.stage("正在导入");
                                let result = shared.import_inbound(&transfer_id).await;
                                let _ = reply.send(match &result {
                                    Ok(r) => Ok(r.clone()),
                                    Err(e) => Err(e.to_string()),
                                });
                                shared.end_inbound(&transfer_id, if result.is_ok() { "done" } else { "failed" });
                                if let Some(link) = result.as_ref().ok().and_then(link_of) {
                                    ctx.set_link(link);
                                }
                                return result.map(|r| serde_json::to_value(r).unwrap_or_default());
                            }
                            Some(Signal::Cancel(reason)) => {
                                return Err(AppError::ExternalServiceError(reason));
                            }
                            None => return Err(AppError::ExternalServiceError("传送中断了".into())),
                        },
                        _ = tokio::time::sleep(Duration::from_secs(1)) => {
                            if ctx.is_cancelled() {
                                shared.end_inbound(&transfer_id, "canceled");
                                return Err(AppError::InternalError(crate::agent::session::CANCELLED.into()));
                            }
                            if last.elapsed() > IDLE_TIMEOUT {
                                shared.end_inbound(&transfer_id, "failed");
                                return Err(AppError::ExternalServiceError(format!("「{alias}」很久没有发送数据，已停止接收")));
                            }
                        }
                    }
                }
            },
        )
    }

    async fn import_inbound(self: &Arc<Self>, transfer_id: &str) -> AppResult<ImportResult> {
        let (pkg, dir) = {
            let st = self.lock();
            let i = st
                .inbound
                .as_ref()
                .filter(|i| i.transfer_id == transfer_id)
                .ok_or_else(|| AppError::InternalError("传送已经结束".into()))?;
            (i.package.clone(), i.dir.clone())
        };
        let pkg = pkg.ok_or_else(|| AppError::InternalError("还没有收到清单".into()))?;
        let data_dir = self.data_dir.clone();
        lan_import::import(
            Arc::new(self.pool.clone()),
            Arc::new(self.logger.clone()),
            &data_dir,
            &pkg,
            &dir,
        )
        .await
    }

    /// 结束接收：删临时目录、通知界面（同一个传送只结束一次）
    pub(super) fn end_inbound(&self, transfer_id: &str, reason: &str) {
        let ended = {
            let mut st = self.lock();
            if st
                .inbound
                .as_ref()
                .is_some_and(|i| i.transfer_id == transfer_id)
            {
                st.inbound.take()
            } else {
                None
            }
        };
        let Some(i) = ended else {
            return;
        };
        if let Some(tx) = i.signals {
            let _ = tx.send(Signal::Cancel("对方取消了传送".into()));
        }
        if i.dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&i.dir) {
                tracing::warn!(component = "LAN", error = %e, "删除传送临时目录失败");
            }
        }
        (self.emit)(LanEvent::TransferClosed(TransferClosed {
            transfer_id: transfer_id.to_string(),
            reason: reason.to_string(),
        }));
    }

    pub(crate) async fn on_manifest(
        &self,
        peer: &str,
        transfer_id: &str,
        token: &str,
        body: Bytes,
    ) -> Reply<ReceivedFiles> {
        let (existing, dir) = self.active(peer, transfer_id, token)?;
        if body.len() > MAX_MANIFEST_BYTES {
            return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "清单太大"));
        }
        let pkg = match existing {
            Some(p) => p,
            None => {
                let pkg: Package = serde_json::from_slice(&body)
                    .map_err(|e| err(StatusCode::BAD_REQUEST, &format!("清单格式不对：{e}")))?;
                pkg.validate()
                    .map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                let offered = self.lock().inbound.as_ref().map(|i| i.summary.clone());
                if offered.as_ref() != Some(&pkg.summary()) {
                    return Err(err(StatusCode::BAD_REQUEST, "清单和确认时的内容不一致"));
                }
                let pkg = Arc::new(pkg);
                let mut st = self.lock();
                if let Some(i) = st.inbound.as_mut().filter(|i| i.transfer_id == transfer_id) {
                    i.package = Some(pkg.clone());
                }
                pkg
            }
        };
        let received = scan_received(&dir, &pkg);
        let mut st = self.lock();
        if let Some(i) = st.inbound.as_mut().filter(|i| i.transfer_id == transfer_id) {
            i.received = received.clone();
        }
        Ok(ReceivedFiles { received })
    }

    fn add_progress(&self, transfer_id: &str, file_id: &str, bytes: u64) {
        let st = &mut *self.lock();
        if let Some(i) = st.inbound.as_mut().filter(|i| i.transfer_id == transfer_id) {
            i.received.insert(file_id.to_string(), bytes);
            if let Some(p) = &i.progress {
                let _ = p.send(i.received.values().sum());
            }
        }
    }

    pub(crate) async fn on_file(
        &self,
        peer: &str,
        transfer_id: &str,
        file_id: &str,
        token: &str,
        offset: u64,
        body: axum::body::Body,
    ) -> Reply<ReceivedFiles> {
        let (pkg, dir) = self.active(peer, transfer_id, token)?;
        let pkg = pkg.ok_or_else(|| err(StatusCode::CONFLICT, "还没有收到清单"))?;
        let file = pkg
            .files
            .iter()
            .find(|f| f.id == file_id)
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "清单里没有这个文件"))?;
        let done = dir.join(&file.id);
        if done.is_file() {
            return Ok(ReceivedFiles {
                received: HashMap::from([(file.id.clone(), file.size)]),
            });
        }
        let _slot = {
            let mut st = self.lock();
            let busy = match st.inbound.as_mut().filter(|i| i.transfer_id == transfer_id) {
                Some(i) => !i.uploading.insert(file.id.clone()),
                None => return Err(err(StatusCode::GONE, "传送已经结束或不存在")),
            };
            if busy {
                return Err(err(StatusCode::CONFLICT, "这个文件正在接收"));
            }
            UploadSlot {
                shared: self,
                transfer_id: transfer_id.to_string(),
                file_id: file.id.clone(),
            }
        };
        let part = dir.join(format!("{}.part", file.id));
        let current = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        if offset != current {
            return Err(err(StatusCode::CONFLICT, &current.to_string()));
        }
        let io = |e: std::io::Error| {
            if e.kind() == std::io::ErrorKind::StorageFull {
                err(StatusCode::INSUFFICIENT_STORAGE, "磁盘空间不够")
            } else {
                err(StatusCode::INTERNAL_SERVER_ERROR, &format!("写入失败：{e}"))
            }
        };
        let mut out = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part)
            .await
            .map_err(io)?;
        let mut written = current;
        let mut stream = body.into_data_stream();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|e| err(StatusCode::BAD_REQUEST, &format!("接收中断：{e}")))?;
            written += chunk.len() as u64;
            if written > file.size {
                drop(out);
                let _ = std::fs::remove_file(&part);
                return Err(err(StatusCode::BAD_REQUEST, "文件比清单里说的大"));
            }
            out.write_all(&chunk).await.map_err(io)?;
            self.add_progress(transfer_id, &file.id, written);
        }
        out.flush().await.map_err(io)?;
        drop(out);
        if written == file.size {
            let (_, sha) = lan_export::hash_file(part.clone())
                .await
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            if sha != file.sha256 {
                let _ = std::fs::remove_file(&part);
                self.add_progress(transfer_id, &file.id, 0);
                return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "文件校验没有通过"));
            }
            std::fs::rename(&part, &done).map_err(io)?;
        }
        Ok(ReceivedFiles {
            received: HashMap::from([(file.id.clone(), written)]),
        })
    }

    pub(crate) async fn on_finish(
        &self,
        peer: &str,
        transfer_id: &str,
        token: &str,
    ) -> Reply<FinishResponse> {
        let (pkg, dir) = self.active(peer, transfer_id, token)?;
        let pkg = pkg.ok_or_else(|| err(StatusCode::CONFLICT, "还没有收到清单"))?;
        if pkg.files.iter().any(|f| !dir.join(&f.id).is_file()) {
            return Err(err(StatusCode::CONFLICT, "还有文件没有收完"));
        }
        let signals = self
            .lock()
            .inbound
            .as_ref()
            .and_then(|i| i.signals.clone())
            .ok_or_else(|| err(StatusCode::GONE, "传送已经结束"))?;
        let (tx, rx) = oneshot::channel();
        signals
            .send(Signal::Finish(tx))
            .map_err(|_| err(StatusCode::GONE, "接收已经停止"))?;
        match tokio::time::timeout(IMPORT_WAIT, rx).await {
            Ok(Ok(Ok(result))) => Ok(FinishResponse { result }),
            Ok(Ok(Err(e))) => Err(err(StatusCode::INTERNAL_SERVER_ERROR, &e)),
            _ => Err(err(StatusCode::GATEWAY_TIMEOUT, "对方导入超时")),
        }
    }

    pub(crate) fn on_transfer_cancel(&self, peer: &str, transfer_id: &str) {
        let (mine, job) = {
            let st = self.lock();
            match &st.inbound {
                Some(i) if i.transfer_id == transfer_id && i.peer == peer => {
                    (true, i.job_id.clone())
                }
                _ => (false, None),
            }
        };
        if !mine {
            return;
        }
        self.logger
            .info("LAN", &format!("对方取消了传送 {transfer_id}"));
        self.end_inbound(transfer_id, "canceled");
        if let Some(job) = job {
            self.jobs.cancel(&job);
        }
    }
}

impl LanNode {
    /// 本机用户对传送请求的决定
    pub fn respond_transfer(&self, transfer_id: &str, accept: bool) -> AppResult<()> {
        let sender = self
            .shared
            .lock()
            .inbound
            .as_mut()
            .filter(|i| i.transfer_id == transfer_id)
            .and_then(|i| i.decision.take());
        match sender {
            Some(tx) => {
                let _ = tx.send(accept);
                Ok(())
            }
            None => Err(AppError::NotFound("这个传送请求已经结束了".into())),
        }
    }

    /// 正在等本机确认的传送请求（界面刷新后恢复弹窗）
    pub fn pending_transfer(&self) -> Option<TransferOffer> {
        let st = self.shared.lock();
        st.inbound
            .as_ref()
            .filter(|i| i.decision.is_some())
            .map(|i| TransferOffer {
                transfer_id: i.transfer_id.clone(),
                fingerprint: i.peer.clone(),
                alias: i.alias.clone(),
                summary: i.summary.clone(),
            })
    }

    /// 发送（在后台任务里运行）：返回对方导入的结果
    pub async fn send(
        &self,
        ctx: &JobCtx,
        fingerprint: &str,
        items: &[ExportItem],
        options: &ExportOptions,
    ) -> AppResult<ImportResult> {
        let shared = &self.shared;
        let id = shared.require_running()?;
        let alias = LanRepository::get(&shared.pool, fingerprint)
            .await?
            .map(|r| r.alias)
            .ok_or_else(|| AppError::ValidationError("请先和这台设备配对".into()))?;
        let target = {
            let st = shared.lock();
            st.nearby.get(fingerprint).map(|n| Target {
                address: n.address,
                port: n.info.port,
                fingerprint: Some(fingerprint.to_string()),
            })
        }
        .ok_or_else(|| AppError::ValidationError(format!("「{alias}」现在不在线")))?;
        let cancelled = || -> AppResult<()> {
            if ctx.is_cancelled() {
                Err(AppError::InternalError(
                    crate::agent::session::CANCELLED.into(),
                ))
            } else {
                Ok(())
            }
        };

        ctx.stage("正在准备");
        let exported = lan_export::export(
            Arc::new(shared.pool.clone()),
            &shared.data_dir,
            items,
            options,
            &shared.app_version,
        )
        .await?;
        cancelled()?;
        let pkg = &exported.package;
        let summary = pkg.summary();
        let total = summary.total_bytes;
        let manifest = Bytes::from(
            serde_json::to_vec(pkg).map_err(|e| AppError::InternalError(e.to_string()))?,
        );
        let transfer_id = uuid::Uuid::new_v4().to_string();
        shared.logger.info(
            "LAN",
            &format!(
                "向「{alias}」发送：词汇本 {}、短文 {}、视频 {}、计划 {}，{} 个文件 {} 字节（传送 {transfer_id}）",
                summary.word_books, summary.passages, summary.videos, summary.plans, summary.file_count, total
            ),
        );

        ctx.stage(format!("等「{alias}」确认"));
        let offer = OfferRequest {
            transfer_id: transfer_id.clone(),
            package_version: VERSION,
            summary,
        };
        let (_, resp): (String, OfferResponse) =
            client::post_json(&id, &target, "/transfer/offer", &offer, OFFER_WAIT)
                .await
                .map_err(|e| match e {
                    ClientError::Status(s, body) if s == StatusCode::UPGRADE_REQUIRED => {
                        AppError::ExternalServiceError(body)
                    }
                    other => user_error(&other, &alias),
                })?;
        let token = match (resp.accepted, resp.token) {
            (true, Some(t)) => t,
            _ => {
                return Err(AppError::ExternalServiceError(format!(
                    "「{alias}」没有接收"
                )))
            }
        };

        let result = self
            .upload(
                ctx,
                &id,
                &target,
                &alias,
                &transfer_id,
                &token,
                &exported,
                manifest,
                total,
            )
            .await;
        if result.is_err() {
            // 取消或失败：告诉对方停止接收（尽力而为）
            let path = format!("/transfer/{transfer_id}/cancel");
            let _ = client::send(
                &id,
                &target,
                Method::POST,
                &path,
                &[(TOKEN_HEADER, token.clone())],
                bytes_body(Bytes::new()),
                Duration::from_secs(5),
            )
            .await;
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn upload(
        &self,
        ctx: &JobCtx,
        id: &super::identity::Identity,
        target: &Target,
        alias: &str,
        transfer_id: &str,
        token: &str,
        exported: &lan_export::ExportedPackage,
        manifest: Bytes,
        total: u64,
    ) -> AppResult<ImportResult> {
        let headers = |extra: Option<u64>| {
            let mut h = vec![(TOKEN_HEADER, token.to_string())];
            if let Some(o) = extra {
                h.push((OFFSET_HEADER, o.to_string()));
            }
            h
        };
        let put_manifest = || async {
            let (_, bytes) = client::send(
                id,
                target,
                Method::PUT,
                &format!("/transfer/{transfer_id}/manifest"),
                &headers(None),
                bytes_body(manifest.clone()),
                Duration::from_secs(120),
            )
            .await
            .map_err(|e| user_error(&e, alias))?;
            serde_json::from_slice::<ReceivedFiles>(&bytes)
                .map_err(|e| AppError::ExternalServiceError(format!("对方的回应格式不对：{e}")))
        };

        ctx.stage(format!("正在发送到「{alias}」"));
        let mut received = put_manifest().await?.received;
        let sent = Arc::new(AtomicU64::new(received.values().sum()));
        ctx.progress(sent.load(Ordering::Relaxed), total);

        for file in &exported.package.files {
            let path = &exported.files[&file.id];
            let mut attempts = 0;
            loop {
                if ctx.is_cancelled() {
                    return Err(AppError::InternalError(
                        crate::agent::session::CANCELLED.into(),
                    ));
                }
                let offset = received.get(&file.id).copied().unwrap_or(0).min(file.size);
                if offset == file.size {
                    break;
                }
                let base: u64 = received
                    .iter()
                    .filter(|(k, _)| *k != &file.id)
                    .map(|(_, v)| *v)
                    .sum();
                sent.store(base + offset, Ordering::Relaxed);
                let body = file_body(path, offset, sent.clone(), ctx.clone(), total).await?;
                let remaining = file.size - offset;
                let wait = Duration::from_secs(300 + remaining / (512 * 1024));
                let result = client::send(
                    id,
                    target,
                    Method::PUT,
                    &format!("/transfer/{transfer_id}/files/{}", file.id),
                    &[
                        (TOKEN_HEADER, token.to_string()),
                        (OFFSET_HEADER, offset.to_string()),
                        ("content-length", remaining.to_string()),
                    ],
                    body,
                    wait,
                )
                .await;
                let result = result.and_then(|(_, bytes)| {
                    let got = serde_json::from_slice::<ReceivedFiles>(&bytes)
                        .ok()
                        .and_then(|r| r.received.get(&file.id).copied())
                        .unwrap_or(0);
                    if got >= file.size {
                        Ok(())
                    } else {
                        // 对方只收到一部分（文件中途变了、连接提前结束）：当作中断，问进度后接着传
                        Err(ClientError::Unreachable(format!(
                            "对方只收到 {got} / {} 字节",
                            file.size
                        )))
                    }
                });
                match result {
                    Ok(()) => {
                        received.insert(file.id.clone(), file.size);
                        break;
                    }
                    Err(e) => {
                        attempts += 1;
                        if ctx.is_cancelled() {
                            return Err(AppError::InternalError(
                                crate::agent::session::CANCELLED.into(),
                            ));
                        }
                        let retryable = matches!(
                            &e,
                            ClientError::Unreachable(_)
                                | ClientError::Timeout
                                | ClientError::Status(StatusCode::CONFLICT, _)
                                | ClientError::Status(StatusCode::UNPROCESSABLE_ENTITY, _)
                        );
                        if !retryable || attempts > RETRIES {
                            return Err(match e {
                                ClientError::Status(StatusCode::INSUFFICIENT_STORAGE, _) => {
                                    AppError::ExternalServiceError(format!(
                                        "「{alias}」的磁盘空间不够"
                                    ))
                                }
                                other => user_error(&other, alias),
                            });
                        }
                        tracing::warn!(component = "LAN", error = %e, attempt = attempts, "传送文件中断，接着传");
                        // 问对方收到了多少，从那里接着传（问的时候网络也可能还没恢复：一起算在重试次数里）
                        let mut asked = None;
                        while attempts <= RETRIES {
                            tokio::time::sleep(Duration::from_secs(2)).await;
                            match put_manifest().await {
                                Ok(r) => {
                                    asked = Some(r.received);
                                    break;
                                }
                                Err(e) if attempts >= RETRIES => return Err(e),
                                Err(_) => attempts += 1,
                            }
                        }
                        received = asked.ok_or_else(|| user_error(&e, alias))?;
                    }
                }
            }
        }
        ctx.progress(total, total);

        ctx.stage(format!("「{alias}」正在导入"));
        let (_, bytes) = client::send(
            id,
            target,
            Method::POST,
            &format!("/transfer/{transfer_id}/finish"),
            &headers(None),
            bytes_body(Bytes::new()),
            IMPORT_WAIT + Duration::from_secs(30),
        )
        .await
        .map_err(|e| match e {
            ClientError::Status(_, body) if !body.is_empty() => {
                AppError::ExternalServiceError(format!("「{alias}」没能导入：{body}"))
            }
            other => user_error(&other, alias),
        })?;
        let resp: FinishResponse = serde_json::from_slice(&bytes)
            .map_err(|e| AppError::ExternalServiceError(format!("对方的回应格式不对：{e}")))?;
        self.shared
            .logger
            .info("LAN", &format!("已发送到「{alias}」（传送 {transfer_id}）"));
        Ok(resp.result)
    }
}

/// 收完后「打开」去哪：计划 > 单个词汇本 / 短文 > 视频库 > 词汇本列表
fn link_of(r: &ImportResult) -> Option<JobLink> {
    use serde_json::json;
    if let Some(p) = r.plans.first() {
        return Some(JobLink::new("plan-detail", json!({ "planId": p.id })));
    }
    match (
        r.word_books.as_slice(),
        r.passages.as_slice(),
        r.videos.as_slice(),
    ) {
        ([b], [], []) => Some(JobLink::new("wordbook-detail", json!({ "id": b.id }))),
        ([], [p], []) => Some(JobLink::new("passage-detail", json!({ "passageId": p.id }))),
        (_, _, [_, ..]) => Some(JobLink::new("videos", json!({ "tab": "sources" }))),
        ([_, ..], _, _) => Some(JobLink::new("wordbooks", serde_json::Value::Null)),
        (_, [_, ..], _) => Some(JobLink::new("passages", serde_json::Value::Null)),
        _ => None,
    }
}

/// 从 offset 起读文件的流式请求体；边发边报告进度
async fn file_body(
    path: &Path,
    offset: u64,
    sent: Arc<AtomicU64>,
    ctx: JobCtx,
    total: u64,
) -> AppResult<client::Body> {
    let mut f = tokio::fs::File::open(path)
        .await
        .map_err(|e| AppError::InternalError(format!("读取文件失败：{e}")))?;
    f.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|e| AppError::InternalError(format!("读取文件失败：{e}")))?;
    let stream = futures::stream::unfold(f, |mut f| async move {
        let mut buf = vec![0u8; CHUNK];
        match f.read(&mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((Ok(Frame::data(Bytes::from(buf))), f))
            }
            Err(e) => Some((Err(e), f)),
        }
    })
    .map(move |frame| {
        if let Ok(f) = &frame {
            if let Some(d) = f.data_ref() {
                let n = sent.fetch_add(d.len() as u64, Ordering::Relaxed) + d.len() as u64;
                ctx.progress(n, total);
            }
        }
        frame
    });
    Ok(BodyExt::boxed(StreamBody::new(stream)))
}
