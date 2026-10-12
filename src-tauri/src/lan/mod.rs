//! 局域网设备互传（唯一 owner）：同一网络里的拼读互相发现、配对，之后在已配对的设备之间传送素材与数据。
//!
//! 参考 LocalSend：UDP 组播发现 + HTTPS 接口；不同的是要先配对——第一次连接时两边核对 6 位数字，
//! 确认后互相记住对方的证书编号（`lan_devices` 表），之后的传送只接受已配对的设备。
//! 协议细节见 `protocol.rs`，方案见 `.claude/work/lan-pairing/plan.md`。
//!
//! 默认关闭：设置里开启后才广播、监听端口；关闭即停止。`LanNode` 不依赖 AppHandle，
//! 变化经 [`LanEvent`] 交给调用方（lib.rs 转成前端事件），测试里两个节点可以直接在 127.0.0.1 上配对。

pub mod client;
pub mod discovery;
pub mod identity;
pub mod package;
pub mod protocol;
mod server;
mod tls;
pub mod transfer;

use crate::error::{AppError, AppResult};
use crate::jobs::Jobs;
use crate::logger::Logger;
use crate::repositories::lan_repository::{LanDeviceRow, LanRepository};
use crate::services::lan_settings::{LanSettings, LanSettingsService};
use crate::types::lan::{
    LanStatus, NearbyDevice, PairRequest, PairRequestClosed, PairedDevice, PairingResult,
    PairingStarted, TransferClosed, TransferOffer,
};
use client::{ClientError, Target};
use hyper::StatusCode;
use identity::Identity;
use protocol::*;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{oneshot, watch};
use tokio::task::JoinHandle;

/// 广播心跳间隔；超过 [`NEARBY_TTL`] 没听到就从附近列表移除
const HEARTBEAT: Duration = Duration::from_secs(30);
const NEARBY_TTL: Duration = Duration::from_secs(95);
/// 对方确认配对的等待时间（接收方弹窗）与发起方的等待上限
const DECISION_TIMEOUT: Duration = Duration::from_secs(60);
const CONFIRM_WAIT: Duration = Duration::from_secs(75);
const REQUEST_WAIT: Duration = Duration::from_secs(10);
/// 同时等待确认的配对请求上限
const MAX_INCOMING: usize = 3;

/// 交给调用方的变化（lib.rs 转成前端事件）
#[derive(Debug, Clone)]
pub enum LanEvent {
    /// 附近的设备有变化
    NearbyChanged,
    /// 配对过的设备有变化（新配对、取消配对）
    PairedChanged,
    PairRequest(PairRequest),
    PairRequestClosed(PairRequestClosed),
    PairingResult(PairingResult),
    /// 别的设备想发送内容（等本机确认）
    TransferOffer(TransferOffer),
    /// 接收结束（弹窗关闭）
    TransferClosed(TransferClosed),
}

pub type EventSink = Arc<dyn Fn(LanEvent) + Send + Sync>;

/// 运行参数：正式运行用固定端口 + 组播；测试用随机端口、不组播
#[derive(Debug, Clone, Copy)]
pub struct LanOptions {
    pub preferred_port: u16,
    pub discovery: bool,
}

impl Default for LanOptions {
    fn default() -> Self {
        Self {
            preferred_port: PORT,
            discovery: true,
        }
    }
}

#[derive(Clone)]
pub struct LanNode {
    shared: Arc<Shared>,
}

pub(crate) struct Shared {
    pool: SqlitePool,
    logger: Logger,
    /// 数据目录（视频与收到的文件放这里）
    data_dir: PathBuf,
    /// `<数据目录>/lan`：本机证书与收文件的临时目录
    dir: PathBuf,
    jobs: Jobs,
    app_version: String,
    options: LanOptions,
    emit: EventSink,
    identity: Mutex<Option<Arc<Identity>>>,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    enabled: bool,
    alias: String,
    running: Option<Running>,
    error: Option<String>,
    nearby: HashMap<String, Nearby>,
    incoming: HashMap<String, Incoming>,
    outgoing: HashMap<String, Outgoing>,
    /// 对 announce 的回应节流（每台设备几秒一次）
    replied: HashMap<String, Instant>,
    /// 正在接收的传送（同时只接收一个）
    inbound: Option<transfer::Inbound>,
}

struct Running {
    port: u16,
    shutdown: watch::Sender<bool>,
    tasks: Vec<JoinHandle<()>>,
}

struct Nearby {
    info: DeviceInfo,
    address: IpAddr,
    last_seen: Instant,
    /// 经接口认识的（按地址添加、对方来注册或配对）：组播可能不通，关闭前不过期
    sticky: bool,
}

struct Incoming {
    info: DeviceInfo,
    address: IpAddr,
    commit: String,
    nonce: String,
    created: Instant,
    /// 发起方揭示随机数后算出的配对码
    code: Option<String>,
    /// 已揭示、正在等本机用户决定
    decision: Option<oneshot::Sender<bool>>,
}

struct Outgoing {
    target: Target,
    request_id: String,
    task: Option<JoinHandle<()>>,
}

fn current_os() -> String {
    std::env::consts::OS.to_string()
}

impl LanNode {
    pub fn new(
        pool: SqlitePool,
        logger: Logger,
        data_dir: PathBuf,
        app_version: String,
        emit: EventSink,
        jobs: Jobs,
    ) -> Self {
        Self::with_options(
            pool,
            logger,
            data_dir,
            app_version,
            emit,
            jobs,
            LanOptions::default(),
        )
    }

    pub fn with_options(
        pool: SqlitePool,
        logger: Logger,
        data_dir: PathBuf,
        app_version: String,
        emit: EventSink,
        jobs: Jobs,
        options: LanOptions,
    ) -> Self {
        Self {
            shared: Arc::new(Shared {
                pool,
                logger,
                dir: data_dir.join("lan"),
                data_dir,
                jobs,
                app_version,
                options,
                emit,
                identity: Mutex::new(None),
                state: Mutex::new(State::default()),
            }),
        }
    }

    /// 启动时：读设置，开启的话就启动服务（失败只记警告，设置页显示原因）
    pub async fn apply_saved(&self) {
        let settings = match LanSettingsService::load(&self.shared.pool).await {
            Ok(s) => s,
            Err(e) => {
                self.shared.logger.warn(
                    "LAN",
                    "读取设备互传设置失败，保持关闭",
                    Some(&e.to_string()),
                );
                return;
            }
        };
        self.shared.apply_settings(&settings);
        if settings.enabled {
            if let Err(e) = self.shared.start().await {
                self.shared
                    .logger
                    .warn("LAN", "设备互传没有开启", Some(&e.to_string()));
            }
        }
    }

    pub fn status(&self) -> LanStatus {
        let st = self.shared.lock();
        LanStatus {
            enabled: st.enabled,
            alias: st.alias.clone(),
            running: st.running.is_some(),
            port: st.running.as_ref().map(|r| r.port),
            addresses: discovery::local_ipv4()
                .into_iter()
                .map(|ip| ip.to_string())
                .collect(),
            error: st.error.clone(),
        }
    }

    /// 保存设置并按需开启 / 关闭；开启失败时设置照样保存，原因在返回的状态里
    pub async fn update_settings(&self, enabled: bool, alias: &str) -> AppResult<LanStatus> {
        let saved = LanSettingsService::save(&self.shared.pool, enabled, alias).await?;
        let (was_running, renamed) = {
            let st = self.shared.lock();
            (st.running.is_some(), st.alias != saved.alias)
        };
        self.shared.apply_settings(&saved);
        if renamed {
            self.shared
                .logger
                .info("LAN", &format!("本机名字改为「{}」", saved.alias));
        }
        match (saved.enabled, was_running) {
            (true, false) => {
                if let Err(e) = self.shared.start().await {
                    self.shared
                        .logger
                        .warn("LAN", "设备互传没有开启", Some(&e.to_string()));
                }
            }
            (false, true) => self.shared.stop(),
            (true, true) if renamed => self.shared.announce(false),
            _ => {}
        }
        Ok(self.status())
    }

    pub async fn nearby(&self) -> AppResult<Vec<NearbyDevice>> {
        let paired: HashSet<String> = LanRepository::list(&self.shared.pool)
            .await?
            .into_iter()
            .map(|r| r.fingerprint)
            .collect();
        let st = self.shared.lock();
        let mut list: Vec<NearbyDevice> = st
            .nearby
            .values()
            .map(|n| NearbyDevice {
                fingerprint: n.info.fingerprint.clone(),
                alias: n.info.alias.clone(),
                os: n.info.os.clone(),
                address: n.address.to_string(),
                port: n.info.port,
                app_version: n.info.app_version.clone(),
                paired: paired.contains(&n.info.fingerprint),
            })
            .collect();
        list.sort_by(|a, b| a.alias.cmp(&b.alias));
        Ok(list)
    }

    /// 重新广播，请附近的设备回应
    pub fn refresh(&self) {
        self.shared.announce(true);
    }

    /// 按地址添加（组播不通时）：`192.168.1.5` 或 `192.168.1.5:53318`
    pub async fn add_by_address(&self, address: &str) -> AppResult<NearbyDevice> {
        let (ip, port) = parse_address(address)?;
        let id = self.shared.require_running()?;
        let own = self.shared.own_info()?;
        let target = Target {
            address: ip,
            port,
            fingerprint: None,
        };
        let (fingerprint, resp): (String, RegisterResponse) =
            client::post_json(&id, &target, "/register", &own, REQUEST_WAIT)
                .await
                .map_err(|e| user_error(&e, address))?;
        if resp.info.fingerprint != fingerprint {
            return Err(AppError::ExternalServiceError(
                "对方的身份信息前后不一致，没有添加".into(),
            ));
        }
        if fingerprint == id.fingerprint {
            return Err(AppError::ValidationError("这是这台电脑自己的地址".into()));
        }
        let mut info = resp.info;
        info.alias = clean_alias(&info.alias).unwrap_or_else(|| address.to_string());
        self.shared.remember_nearby(info.clone(), ip, true);
        self.shared.logger.info(
            "LAN",
            &format!("按地址添加了设备「{}」（{}:{}）", info.alias, ip, info.port),
        );
        Ok(NearbyDevice {
            fingerprint: info.fingerprint,
            alias: info.alias,
            os: info.os,
            address: ip.to_string(),
            port: info.port,
            app_version: info.app_version,
            paired: resp.paired,
        })
    }

    /// 发起配对：先拿到两边要核对的数字，再在后台等对方确认（结果经 PairingResult 事件）
    pub async fn start_pairing(&self, fingerprint: &str) -> AppResult<PairingStarted> {
        let id = self.shared.require_running()?;
        let own = self.shared.own_info()?;
        let (target, alias) = {
            let st = self.shared.lock();
            let n = st
                .nearby
                .get(fingerprint)
                .ok_or_else(|| AppError::NotFound("附近没有这台设备了，请刷新后再试".into()))?;
            (
                Target {
                    address: n.address,
                    port: n.info.port,
                    fingerprint: Some(fingerprint.to_string()),
                },
                n.info.alias.clone(),
            )
        };
        let nonce_a = new_nonce();
        let start = PairStartRequest {
            info: own,
            commit: commitment(&nonce_a),
        };
        let (_, resp): (String, PairStartResponse) =
            client::post_json(&id, &target, "/pair/start", &start, REQUEST_WAIT)
                .await
                .map_err(|e| user_error(&e, &alias))?;
        let code = pairing_code(&id.fingerprint, fingerprint, &nonce_a, &resp.nonce);
        let pairing_id = uuid::Uuid::new_v4().to_string();
        self.shared.logger.info(
            "LAN",
            &format!("向「{alias}」发起配对，等对方确认（pairing {pairing_id}）"),
        );

        // 先登记再开始等：对方可能立即回应（已经配对过时自动同意）
        self.shared.lock().outgoing.insert(
            pairing_id.clone(),
            Outgoing {
                target: target.clone(),
                request_id: resp.request_id.clone(),
                task: None,
            },
        );
        let shared = self.shared.clone();
        let confirm = PairConfirmRequest {
            request_id: resp.request_id.clone(),
            nonce: nonce_a,
        };
        let task_target = target;
        let task_id = pairing_id.clone();
        let task = tokio::spawn(async move {
            let result: Result<(String, PairConfirmResponse), ClientError> =
                client::post_json(&id, &task_target, "/pair/confirm", &confirm, CONFIRM_WAIT).await;
            shared
                .finish_outgoing(&task_id, &task_target, alias.clone(), result)
                .await;
        });
        match self.shared.lock().outgoing.get_mut(&pairing_id) {
            Some(o) => o.task = Some(task),
            None => drop(task), // 已经有结果：任务自己结束
        }
        Ok(PairingStarted {
            pairing_id,
            alias: resp.info.alias,
            code,
        })
    }

    /// 本机用户取消正在等待的配对（顺带告诉对方关掉弹窗）
    pub fn cancel_pairing(&self, pairing_id: &str) {
        let removed = self.shared.lock().outgoing.remove(pairing_id);
        let Some(mut outgoing) = removed else {
            return;
        };
        if let Some(task) = outgoing.task.take() {
            task.abort();
        }
        self.shared
            .logger
            .info("LAN", &format!("取消了配对（pairing {pairing_id}）"));
        if let Some(id) = self.shared.identity() {
            let body = PairCancelRequest {
                request_id: outgoing.request_id,
            };
            tokio::spawn(async move {
                let _ = client::post_json::<_, serde_json::Value>(
                    &id,
                    &outgoing.target,
                    "/pair/cancel",
                    &body,
                    REQUEST_WAIT,
                )
                .await;
            });
        }
    }

    /// 本机用户对配对请求的决定
    pub fn respond(&self, request_id: &str, accept: bool) -> AppResult<()> {
        let sender = self
            .shared
            .lock()
            .incoming
            .get_mut(request_id)
            .and_then(|r| r.decision.take());
        match sender {
            Some(tx) => {
                let _ = tx.send(accept);
                Ok(())
            }
            None => Err(AppError::NotFound("这个配对请求已经结束了".into())),
        }
    }

    /// 正在等本机确认的配对请求（界面刷新后恢复弹窗）
    pub fn pending_requests(&self) -> Vec<PairRequest> {
        let st = self.shared.lock();
        st.incoming
            .iter()
            .filter(|(_, r)| r.decision.is_some())
            .map(|(id, r)| r.to_request(id))
            .collect()
    }

    pub async fn paired(&self) -> AppResult<Vec<PairedDevice>> {
        let rows = LanRepository::list(&self.shared.pool).await?;
        let st = self.shared.lock();
        Ok(rows
            .into_iter()
            .map(|r| PairedDevice {
                online: st.nearby.contains_key(&r.fingerprint),
                fingerprint: r.fingerprint,
                alias: r.alias,
                os: r.os,
                app_version: r.app_version,
                paired_at: r.paired_at,
                last_seen_at: r.last_seen_at,
            })
            .collect())
    }

    /// 取消配对：本机删除，对方在线时顺带通知它也删除
    pub async fn unpair(&self, fingerprint: &str) -> AppResult<()> {
        let row = LanRepository::get(&self.shared.pool, fingerprint)
            .await?
            .ok_or_else(|| AppError::NotFound("没有和这台设备配对".into()))?;
        LanRepository::delete(&self.shared.pool, fingerprint).await?;
        self.shared
            .logger
            .info("LAN", &format!("取消了和「{}」的配对", row.alias));
        (self.shared.emit)(LanEvent::PairedChanged);
        (self.shared.emit)(LanEvent::NearbyChanged);
        let target = {
            let st = self.shared.lock();
            st.nearby.get(fingerprint).map(|n| Target {
                address: n.address,
                port: n.info.port,
                fingerprint: Some(fingerprint.to_string()),
            })
        };
        if let (Some(target), Some(id)) = (target, self.shared.identity()) {
            tokio::spawn(async move {
                let _ = client::post_json::<_, serde_json::Value>(
                    &id,
                    &target,
                    "/unpair",
                    &serde_json::json!({}),
                    REQUEST_WAIT,
                )
                .await;
            });
        }
        Ok(())
    }

    /// 关闭服务（应用退出时也可调用）
    pub fn shutdown(&self) {
        self.shared.stop();
    }
}

impl Incoming {
    fn to_request(&self, request_id: &str) -> PairRequest {
        PairRequest {
            request_id: request_id.to_string(),
            fingerprint: self.info.fingerprint.clone(),
            alias: self.info.alias.clone(),
            os: self.info.os.clone(),
            address: self.address.to_string(),
            code: self.code.clone().unwrap_or_default(),
        }
    }
}

/// 解析「IP」或「IP:端口」
fn parse_address(input: &str) -> AppResult<(IpAddr, u16)> {
    let s = input.trim();
    if let Ok(sock) = s.parse::<std::net::SocketAddr>() {
        return Ok((sock.ip(), sock.port()));
    }
    if let Ok(ip) = s.parse::<IpAddr>() {
        return Ok((ip, PORT));
    }
    Err(AppError::ValidationError(
        "地址格式不对，例如 192.168.1.8 或 192.168.1.8:53318".into(),
    ))
}

/// 连接失败转成给用户看的话
fn user_error(e: &ClientError, who: &str) -> AppError {
    let msg = match e {
        ClientError::Unreachable(_) | ClientError::Timeout => {
            format!(
                "连不上「{who}」，请确认它开着拼读、打开了设备互传，并且和这台电脑在同一个网络里"
            )
        }
        ClientError::IdentityMismatch => {
            format!("「{who}」的身份和发现时不一致，为了安全已停止")
        }
        ClientError::Status(s, _)
            if *s == StatusCode::TOO_MANY_REQUESTS || *s == StatusCode::CONFLICT =>
        {
            format!("「{who}」正在处理别的配对请求，请稍后再试")
        }
        ClientError::Status(s, _) if *s == StatusCode::FORBIDDEN => {
            format!("「{who}」拒绝了这次请求（可能已经取消了配对）")
        }
        ClientError::Status(s, _) if *s == StatusCode::GONE => {
            format!("「{who}」停止了接收")
        }
        _ => format!("和「{who}」通信失败"),
    };
    tracing::warn!(component = "LAN", error = %e, "{msg}");
    AppError::ExternalServiceError(msg)
}

type HandlerResult<T> = Result<T, (StatusCode, String)>;

fn bad(msg: &str) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, msg.to_string())
}

impl Shared {
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn identity(&self) -> Option<Arc<Identity>> {
        self.identity
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    fn load_identity(&self) -> AppResult<Arc<Identity>> {
        let mut slot = self.identity.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(id) = slot.as_ref() {
            return Ok(id.clone());
        }
        let id = Arc::new(Identity::load_or_create(&self.dir)?);
        *slot = Some(id.clone());
        Ok(id)
    }

    fn apply_settings(&self, settings: &LanSettings) {
        let mut st = self.lock();
        st.enabled = settings.enabled;
        st.alias = settings.alias.clone();
    }

    fn require_running(&self) -> AppResult<Arc<Identity>> {
        if self.lock().running.is_none() {
            return Err(AppError::ValidationError(
                "请先在「设置 → 附近的设备」里打开设备互传".into(),
            ));
        }
        self.identity()
            .ok_or_else(|| AppError::InternalError("本机身份还没有准备好".into()))
    }

    fn own_info(&self) -> AppResult<DeviceInfo> {
        let id = self
            .identity()
            .ok_or_else(|| AppError::InternalError("本机身份还没有准备好".into()))?;
        let st = self.lock();
        let port = st
            .running
            .as_ref()
            .map(|r| r.port)
            .ok_or_else(|| AppError::ValidationError("设备互传没有开启".into()))?;
        Ok(DeviceInfo {
            alias: st.alias.clone(),
            fingerprint: id.fingerprint.clone(),
            port,
            os: current_os(),
            app_version: self.app_version.clone(),
            protocol: PROTOCOL,
        })
    }

    async fn start(self: &Arc<Self>) -> AppResult<()> {
        if self.lock().running.is_some() {
            return Ok(());
        }
        let result = self.start_inner().await;
        if let Err(e) = &result {
            self.lock().error = Some(e.to_string());
        }
        result
    }

    async fn start_inner(self: &Arc<Self>) -> AppResult<()> {
        let id = self.load_identity()?;
        let preferred = self.options.preferred_port;
        let listener = match tokio::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, preferred)).await
        {
            Ok(l) => l,
            Err(e) if preferred != 0 => {
                self.logger.warn(
                    "LAN",
                    &format!("端口 {preferred} 被占用，改用随机端口"),
                    Some(&e.to_string()),
                );
                tokio::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
                    .await
                    .map_err(|e| AppError::InternalError(format!("无法打开网络端口：{e}")))?
            }
            Err(e) => return Err(AppError::InternalError(format!("无法打开网络端口：{e}"))),
        };
        let port = listener
            .local_addr()
            .map_err(|e| AppError::InternalError(e.to_string()))?
            .port();
        let config = tls::server_config(&id)?;
        let (tx, rx) = watch::channel(false);
        let mut tasks = vec![tokio::spawn(server::serve(
            listener,
            config,
            self.clone(),
            rx.clone(),
        ))];
        let mut error = None;
        if self.options.discovery {
            match discovery::bind_receiver() {
                Ok(socket) => {
                    tasks.push(tokio::spawn(recv_loop(self.clone(), socket, rx.clone())));
                }
                Err(e) => {
                    self.logger
                        .warn("LAN", "无法接收附近设备的广播", Some(&e.to_string()));
                    error = Some("暂时找不到附近的设备，可以按地址添加".to_string());
                }
            }
            tasks.push(tokio::spawn(heartbeat(self.clone(), rx)));
        }
        {
            let mut st = self.lock();
            st.running = Some(Running {
                port,
                shutdown: tx,
                tasks,
            });
            st.error = error;
        }
        self.logger.info(
            "LAN",
            &format!(
                "设备互传已开启：端口 {port}，本机编号 {}",
                &id.fingerprint[..12]
            ),
        );
        self.announce(true);
        (self.emit)(LanEvent::NearbyChanged);
        Ok(())
    }

    fn stop(&self) {
        let running = self.lock().running.is_some();
        if running && self.options.discovery {
            if let Ok(info) = self.own_info() {
                discovery::send(&Announcement::new(info, false, true));
            }
        }
        let (running, incoming, outgoing) = {
            let mut st = self.lock();
            st.nearby.clear();
            st.replied.clear();
            st.error = None;
            (
                st.running.take(),
                std::mem::take(&mut st.incoming),
                std::mem::take(&mut st.outgoing),
            )
        };
        let inbound = self
            .lock()
            .inbound
            .as_ref()
            .map(|i| (i.transfer_id.clone(), i.job_id.clone()));
        if let Some((transfer_id, job)) = inbound {
            self.end_inbound(&transfer_id, "canceled");
            if let Some(job) = job {
                self.jobs.cancel(&job);
            }
        }
        let Some(running) = running else {
            return;
        };
        let _ = running.shutdown.send(true);
        for t in running.tasks {
            t.abort();
        }
        // 等待中的配对：丢掉决定通道，弹窗已经显示的通知界面关闭
        for (id, r) in incoming {
            if r.code.is_some() {
                self.close_request(&id, "canceled");
            }
        }
        for (_, mut o) in outgoing {
            if let Some(t) = o.task.take() {
                t.abort();
            }
        }
        self.logger.info("LAN", "设备互传已关闭");
        (self.emit)(LanEvent::NearbyChanged);
    }

    fn announce(&self, announce: bool) {
        if !self.options.discovery {
            return;
        }
        if let Ok(info) = self.own_info() {
            discovery::send(&Announcement::new(info, announce, false));
        }
    }

    /// 记下 / 更新附近的设备；有变化时通知界面，已配对的顺带更新名字与最后在线时间
    fn remember_nearby(self: &Arc<Self>, info: DeviceInfo, address: IpAddr, sticky: bool) {
        let changed = {
            let mut st = self.lock();
            let now = Instant::now();
            match st.nearby.get_mut(&info.fingerprint) {
                Some(n) => {
                    let changed = n.info != info || n.address != address;
                    n.info = info.clone();
                    n.address = address;
                    n.last_seen = now;
                    n.sticky |= sticky;
                    changed
                }
                None => {
                    st.nearby.insert(
                        info.fingerprint.clone(),
                        Nearby {
                            info: info.clone(),
                            address,
                            last_seen: now,
                            sticky,
                        },
                    );
                    true
                }
            }
        };
        if changed {
            (self.emit)(LanEvent::NearbyChanged);
            let pool = self.pool.clone();
            let emit = self.emit.clone();
            tokio::spawn(async move {
                match LanRepository::touch_seen(
                    &pool,
                    &info.fingerprint,
                    &info.alias,
                    &info.os,
                    &info.app_version,
                    &address.to_string(),
                    info.port as i64,
                    &crate::time::now_utc(),
                )
                .await
                {
                    Ok(true) => emit(LanEvent::PairedChanged),
                    Ok(false) => {}
                    Err(e) => {
                        tracing::warn!(component = "LAN", error = %e, "更新已配对设备的信息失败")
                    }
                }
            });
        }
    }

    /// 收到一条组播
    fn on_datagram(self: &Arc<Self>, data: &[u8], src: IpAddr) {
        let Some(own) = self.identity() else {
            return;
        };
        let Some(msg) = parse_announcement(data, &own.fingerprint) else {
            return;
        };
        let fingerprint = msg.info.fingerprint.clone();
        if msg.bye {
            let removed = self.lock().nearby.remove(&fingerprint).is_some();
            if removed {
                tracing::debug!(component = "LAN", alias = %msg.info.alias, "设备下线");
                (self.emit)(LanEvent::NearbyChanged);
                (self.emit)(LanEvent::PairedChanged);
            }
            return;
        }
        self.remember_nearby(msg.info, src, false);
        if msg.announce {
            let reply = {
                let mut st = self.lock();
                let now = Instant::now();
                let recent = st
                    .replied
                    .get(&fingerprint)
                    .is_some_and(|t| now.duration_since(*t) < Duration::from_secs(3));
                if !recent {
                    st.replied.insert(fingerprint, now);
                }
                !recent
            };
            if reply {
                self.announce(false);
            }
        }
    }

    /// 心跳：广播、清理过期的附近设备与没走完的配对请求
    fn tick(&self) {
        self.announce(false);
        let pruned = {
            let mut st = self.lock();
            let now = Instant::now();
            let before = st.nearby.len();
            st.nearby
                .retain(|_, n| n.sticky || now.duration_since(n.last_seen) < NEARBY_TTL);
            // 对方断开（等待确认的那一端已经没了）或超过时限的请求一并清掉
            let mut closed = Vec::new();
            st.incoming.retain(|id, r| {
                let alive = match &r.decision {
                    Some(tx) => !tx.is_closed(),
                    None => r.code.is_some(),
                };
                let keep = alive && now.duration_since(r.created) < Duration::from_secs(120);
                if !keep && r.code.is_some() {
                    closed.push(id.clone());
                }
                keep
            });
            st.replied
                .retain(|_, t| now.duration_since(*t) < Duration::from_secs(60));
            (before != st.nearby.len(), closed)
        };
        let (pruned, closed) = pruned;
        for id in closed {
            self.close_request(&id, "canceled");
        }
        if pruned {
            (self.emit)(LanEvent::NearbyChanged);
            (self.emit)(LanEvent::PairedChanged);
        }
    }

    async fn finish_outgoing(
        &self,
        pairing_id: &str,
        target: &Target,
        alias: String,
        result: Result<(String, PairConfirmResponse), ClientError>,
    ) {
        if self.lock().outgoing.remove(pairing_id).is_none() {
            return; // 已经取消
        }
        let (outcome, message) = match result {
            Ok((fingerprint, resp)) if resp.accepted && resp.info.fingerprint == fingerprint => {
                let alias = clean_alias(&resp.info.alias).unwrap_or(alias.clone());
                let now = crate::time::now_utc();
                let row = LanDeviceRow {
                    fingerprint,
                    alias: alias.clone(),
                    os: resp.info.os,
                    app_version: resp.info.app_version,
                    last_address: Some(target.address.to_string()),
                    last_port: Some(resp.info.port as i64),
                    paired_at: now.clone(),
                    last_seen_at: Some(now),
                };
                match LanRepository::upsert_paired(&self.pool, &row).await {
                    Ok(()) => {
                        self.logger.info(
                            "LAN",
                            &format!("已和「{alias}」配对（pairing {pairing_id}）"),
                        );
                        (self.emit)(LanEvent::PairedChanged);
                        (self.emit)(LanEvent::NearbyChanged);
                        ("accepted", None)
                    }
                    Err(e) => {
                        self.logger
                            .error("LAN", "保存配对失败", Some(&e.to_string()));
                        (
                            "failed",
                            Some("对方已同意，但这台电脑没能保存配对，请重试".to_string()),
                        )
                    }
                }
            }
            Ok((_, resp)) if resp.reason == "timeout" => {
                self.logger.info(
                    "LAN",
                    &format!("「{alias}」没有在一分钟内确认配对（pairing {pairing_id}）"),
                );
                ("failed", Some(format!("「{alias}」没有在一分钟内确认")))
            }
            Ok(_) => {
                self.logger.info(
                    "LAN",
                    &format!("「{alias}」没有同意配对（pairing {pairing_id}）"),
                );
                ("rejected", None)
            }
            Err(e) => {
                let msg = match &e {
                    ClientError::Timeout => format!("「{alias}」没有在一分钟内确认"),
                    other => user_error(other, &alias).to_string(),
                };
                self.logger.warn(
                    "LAN",
                    &format!("和「{alias}」的配对没有完成（pairing {pairing_id}）"),
                    Some(&e.to_string()),
                );
                ("failed", Some(msg))
            }
        };
        (self.emit)(LanEvent::PairingResult(PairingResult {
            pairing_id: pairing_id.to_string(),
            alias,
            outcome: outcome.to_string(),
            message,
        }));
    }

    // ---- 接口（server.rs 调用；peer_fp 来自 TLS 客户端证书） ----

    fn check_info(peer_fp: &str, info: &mut DeviceInfo) -> HandlerResult<()> {
        if info.fingerprint != peer_fp {
            return Err(bad("设备编号和证书不一致"));
        }
        if info.protocol != PROTOCOL {
            return Err(bad("协议版本不同"));
        }
        info.alias = clean_alias(&info.alias).ok_or_else(|| bad("缺少设备名字"))?;
        Ok(())
    }

    pub(crate) async fn on_register(
        self: &Arc<Self>,
        peer_fp: &str,
        address: IpAddr,
        mut info: DeviceInfo,
    ) -> HandlerResult<RegisterResponse> {
        Self::check_info(peer_fp, &mut info)?;
        let own = self
            .own_info()
            .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e.to_string()))?;
        self.remember_nearby(info, address, true);
        let paired = LanRepository::get(&self.pool, peer_fp)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .is_some();
        Ok(RegisterResponse { info: own, paired })
    }

    pub(crate) fn on_pair_start(
        self: &Arc<Self>,
        peer_fp: &str,
        address: IpAddr,
        mut req: PairStartRequest,
    ) -> HandlerResult<PairStartResponse> {
        Self::check_info(peer_fp, &mut req.info)?;
        if !is_fingerprint(&req.commit) {
            return Err(bad("配对请求格式不对"));
        }
        let own = self
            .own_info()
            .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e.to_string()))?;
        let request_id = uuid::Uuid::new_v4().to_string();
        let nonce = new_nonce();
        {
            let mut st = self.lock();
            // 同一台设备只保留最新的一个请求；还在等决定的不能被顶掉
            if st
                .incoming
                .values()
                .any(|r| r.info.fingerprint == peer_fp && r.decision.is_some())
            {
                return Err((StatusCode::CONFLICT, "上一个配对请求还在等确认".into()));
            }
            st.incoming.retain(|_, r| r.info.fingerprint != peer_fp);
            if st.incoming.len() >= MAX_INCOMING {
                return Err((StatusCode::TOO_MANY_REQUESTS, "配对请求太多".into()));
            }
            st.incoming.insert(
                request_id.clone(),
                Incoming {
                    info: req.info.clone(),
                    address,
                    commit: req.commit,
                    nonce: nonce.clone(),
                    created: Instant::now(),
                    code: None,
                    decision: None,
                },
            );
        }
        self.remember_nearby(req.info, address, true);
        Ok(PairStartResponse {
            request_id,
            info: own,
            nonce,
        })
    }

    pub(crate) async fn on_pair_confirm(
        self: &Arc<Self>,
        peer_fp: &str,
        req: PairConfirmRequest,
    ) -> HandlerResult<PairConfirmResponse> {
        let own = self
            .own_info()
            .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e.to_string()))?;
        let already_paired = LanRepository::get(&self.pool, peer_fp)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .is_some();
        let (rx, request, info, address) = {
            let mut st = self.lock();
            let Some(r) = st.incoming.get_mut(&req.request_id) else {
                return Err((StatusCode::NOT_FOUND, "配对请求不存在或已过期".into()));
            };
            if r.info.fingerprint != peer_fp || r.decision.is_some() {
                return Err((StatusCode::FORBIDDEN, "不是这台设备的配对请求".into()));
            }
            if commitment(&req.nonce) != r.commit {
                st.incoming.remove(&req.request_id);
                return Err(bad("配对校验没有通过"));
            }
            r.code = Some(pairing_code(
                peer_fp,
                &own.fingerprint,
                &req.nonce,
                &r.nonce,
            ));
            let request = r.to_request(&req.request_id);
            let (info, address) = (r.info.clone(), r.address);
            if already_paired {
                st.incoming.remove(&req.request_id);
                (None, request, info, address)
            } else {
                let (tx, rx) = oneshot::channel();
                r.decision = Some(tx);
                (Some(rx), request, info, address)
            }
        };

        let reason = match rx {
            // 已经配对过（对方丢了配对记录又来配）：直接同意
            None => "accepted",
            Some(rx) => {
                self.logger.info(
                    "LAN",
                    &format!("收到「{}」（{}）的配对请求", info.alias, address),
                );
                (self.emit)(LanEvent::PairRequest(request.clone()));
                let reason = match tokio::time::timeout(DECISION_TIMEOUT, rx).await {
                    Ok(Ok(true)) => "accepted",
                    Ok(Ok(false)) => "rejected",
                    Ok(Err(_)) => "canceled",
                    Err(_) => "timeout",
                };
                // 已被取消 / 关闭的请求由那一方通知界面，这里不重复
                if self.lock().incoming.remove(&req.request_id).is_some() {
                    self.close_request(&req.request_id, reason);
                }
                reason
            }
        };

        let accepted = reason == "accepted";
        if accepted {
            let now = crate::time::now_utc();
            let row = LanDeviceRow {
                fingerprint: peer_fp.to_string(),
                alias: info.alias.clone(),
                os: info.os.clone(),
                app_version: info.app_version.clone(),
                last_address: Some(address.to_string()),
                last_port: Some(info.port as i64),
                paired_at: now.clone(),
                last_seen_at: Some(now),
            };
            if let Err(e) = LanRepository::upsert_paired(&self.pool, &row).await {
                self.logger
                    .error("LAN", "保存配对失败", Some(&e.to_string()));
                return Err((StatusCode::INTERNAL_SERVER_ERROR, "保存配对失败".into()));
            }
            self.logger
                .info("LAN", &format!("已和「{}」配对", info.alias));
            (self.emit)(LanEvent::PairedChanged);
            (self.emit)(LanEvent::NearbyChanged);
        } else {
            self.logger.info(
                "LAN",
                &format!("「{}」的配对请求没有完成：{reason}", info.alias),
            );
        }
        Ok(PairConfirmResponse {
            accepted,
            info: own,
            reason: reason.to_string(),
        })
    }

    pub(crate) fn on_pair_cancel(&self, peer_fp: &str, req: PairCancelRequest) {
        let removed = {
            let mut st = self.lock();
            let mine = st
                .incoming
                .get(&req.request_id)
                .is_some_and(|r| r.info.fingerprint == peer_fp);
            if mine {
                st.incoming.remove(&req.request_id)
            } else {
                None
            }
        };
        // 丢掉决定通道；弹窗已经显示的，通知界面关闭
        if removed.is_some_and(|r| r.code.is_some()) {
            self.logger.info("LAN", "对方取消了配对请求");
            self.close_request(&req.request_id, "canceled");
        }
    }

    fn close_request(&self, request_id: &str, reason: &str) {
        (self.emit)(LanEvent::PairRequestClosed(PairRequestClosed {
            request_id: request_id.to_string(),
            reason: reason.to_string(),
        }));
    }

    pub(crate) async fn on_unpair(&self, peer_fp: &str) -> HandlerResult<()> {
        let row = LanRepository::get(&self.pool, peer_fp)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if let Some(row) = row {
            LanRepository::delete(&self.pool, peer_fp)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            self.logger
                .info("LAN", &format!("「{}」取消了和本机的配对", row.alias));
            (self.emit)(LanEvent::PairedChanged);
            (self.emit)(LanEvent::NearbyChanged);
        }
        Ok(())
    }
}

async fn recv_loop(
    shared: Arc<Shared>,
    socket: tokio::net::UdpSocket,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut buf = vec![0u8; 4096];
    loop {
        tokio::select! {
            r = socket.recv_from(&mut buf) => match r {
                Ok((n, src)) => shared.on_datagram(&buf[..n], src.ip()),
                Err(e) => {
                    tracing::debug!(component = "LAN", error = %e, "接收广播出错");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            },
            _ = shutdown.changed() => break,
        }
    }
}

async fn heartbeat(shared: Arc<Shared>, mut shutdown: watch::Receiver<bool>) {
    let mut interval = tokio::time::interval(HEARTBEAT);
    interval.tick().await; // 第一下立即触发，开启时已经广播过
    loop {
        tokio::select! {
            _ = interval.tick() => shared.tick(),
            _ = shutdown.changed() => break,
        }
    }
}

#[cfg(test)]
mod tests;
