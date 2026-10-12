//! 局域网设备互传（设置 → 附近的设备）的类型

use serde::{Deserialize, Serialize};

/// 本机的互传状态
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    /// 设置里是否开启
    pub enabled: bool,
    /// 本机在别的设备上显示的名字
    pub alias: String,
    /// 服务是否在运行（开启了但端口打不开时为 false，原因在 error）
    pub running: bool,
    /// 实际监听的端口
    pub port: Option<u16>,
    /// 本机的局域网地址（别的设备「按地址添加」用）
    pub addresses: Vec<String>,
    /// 开启失败或发现不可用的原因（给用户看的话）
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLanSettingsRequest {
    pub enabled: bool,
    pub alias: String,
}

/// 附近的设备（发现到的或按地址添加的）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyDevice {
    pub fingerprint: String,
    pub alias: String,
    /// macos / windows / linux
    pub os: String,
    pub address: String,
    pub port: u16,
    pub app_version: String,
    /// 已和本机配对
    pub paired: bool,
}

/// 配对过的设备
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub fingerprint: String,
    pub alias: String,
    pub os: String,
    pub app_version: String,
    pub paired_at: String,
    pub last_seen_at: Option<String>,
    /// 现在在局域网里能看到
    pub online: bool,
}

/// 发起配对后：两边要核对的数字
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingStarted {
    pub pairing_id: String,
    pub alias: String,
    pub code: String,
}

/// 别的设备发来的配对请求（等本机用户确认）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequest {
    pub request_id: String,
    pub fingerprint: String,
    pub alias: String,
    pub os: String,
    pub address: String,
    pub code: String,
}

/// 配对请求结束（弹窗关闭）：accepted / rejected / timeout / canceled
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequestClosed {
    pub request_id: String,
    pub reason: String,
}

/// 本机发起的配对有了结果：accepted / rejected / failed / canceled
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingResult {
    pub pairing_id: String,
    pub alias: String,
    pub outcome: String,
    /// 失败原因（给用户看的话）
    pub message: Option<String>,
}

/// 别的设备想发送的内容（等本机确认）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOffer {
    pub transfer_id: String,
    pub fingerprint: String,
    pub alias: String,
    pub summary: crate::lan::package::PackageSummary,
}

/// 接收结束：rejected / timeout / canceled / done / failed
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferClosed {
    pub transfer_id: String,
    pub reason: String,
}

/// 发送到已配对的设备
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTransferRequest {
    pub fingerprint: String,
    pub items: Vec<crate::services::lan_export::ExportItem>,
    /// 计划连同学习进度
    #[serde(default)]
    pub include_progress: bool,
    /// 视频带上原始视频
    #[serde(default)]
    pub include_source_video: bool,
}
