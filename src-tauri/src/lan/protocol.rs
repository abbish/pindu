//! 局域网协议：发现消息、接口请求 / 响应、配对码（参考 LocalSend v2；端口与它区分开，两个应用互不干扰）。
//!
//! 配对码用数字比对（SAS）：发起方先交随机数的承诺 H(nA)，接收方给出 nB，发起方再揭示 nA；
//! 两边各自算 `SHA256(发起方编号 | 接收方编号 | nA | nB)` 的 6 位数。中间人两头的证书不同，
//! 又不能在看到对方随机数之后再改自己的，所以两边数字对上的机会只有百万分之一。

use super::identity::hex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::Ipv4Addr;

pub const APP: &str = "pindu";
/// 协议版本：不同版本的设备互相看不到（以后改协议时加一）
pub const PROTOCOL: u32 = 1;
/// 组播地址与 LocalSend 相同（某些设备只接受 224.0.0.0/24），端口不同
pub const MULTICAST_ADDR: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 167);
/// 组播端口，也是首选的 HTTPS 端口（占用时 HTTPS 用随机端口，广播里带实际端口）
pub const PORT: u16 = 53318;
pub const API: &str = "/api/pindu/v1";

/// 一台设备的公开信息（广播、注册、配对都带上）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub alias: String,
    pub fingerprint: String,
    pub port: u16,
    /// macos / windows / linux
    #[serde(default)]
    pub os: String,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub protocol: u32,
}

/// 组播消息：announce = 刚上线 / 请大家回应；bye = 下线
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Announcement {
    pub app: String,
    #[serde(flatten)]
    pub info: DeviceInfo,
    #[serde(default)]
    pub announce: bool,
    #[serde(default)]
    pub bye: bool,
}

impl Announcement {
    pub fn new(info: DeviceInfo, announce: bool, bye: bool) -> Self {
        Self {
            app: APP.to_string(),
            info,
            announce,
            bye,
        }
    }
}

/// 名字最长字数（显示用，超过截断）
pub const ALIAS_MAX_CHARS: usize = 32;

/// 解析收到的组播消息：只接受拼读、同一协议版本、不是自己、编号格式正确的
pub fn parse_announcement(data: &[u8], own_fingerprint: &str) -> Option<Announcement> {
    let mut msg: Announcement = serde_json::from_slice(data).ok()?;
    if msg.app != APP || msg.info.protocol != PROTOCOL || msg.info.fingerprint == own_fingerprint {
        return None;
    }
    if !is_fingerprint(&msg.info.fingerprint) || msg.info.port == 0 {
        return None;
    }
    msg.info.alias = clean_alias(&msg.info.alias)?;
    Some(msg)
}

pub fn is_fingerprint(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// 名字去掉首尾空白与控制字符，截到上限；为空返回 None
pub fn clean_alias(s: &str) -> Option<String> {
    let cleaned: String = s
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(ALIAS_MAX_CHARS)
        .collect();
    let cleaned = cleaned.trim().to_string();
    (!cleaned.is_empty()).then_some(cleaned)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterResponse {
    pub info: DeviceInfo,
    /// 对方是否已经和调用方配对
    pub paired: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStartRequest {
    pub info: DeviceInfo,
    /// 发起方随机数的承诺 H(nA)
    pub commit: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStartResponse {
    pub request_id: String,
    pub info: DeviceInfo,
    /// 接收方随机数 nB
    pub nonce: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairConfirmRequest {
    pub request_id: String,
    /// 发起方揭示的随机数 nA
    pub nonce: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairConfirmResponse {
    pub accepted: bool,
    pub info: DeviceInfo,
    /// 没有同意时的原因：rejected / timeout / canceled
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairCancelRequest {
    pub request_id: String,
}

/// 32 字节随机数（hex）
pub fn new_nonce() -> String {
    use ring::rand::SecureRandom;
    let mut buf = [0u8; 32];
    ring::rand::SystemRandom::new()
        .fill(&mut buf)
        .expect("系统随机数不可用");
    hex(&buf)
}

pub fn commitment(nonce: &str) -> String {
    hex(&Sha256::digest(
        format!("pindu-commit-v1|{nonce}").as_bytes(),
    ))
}

/// 6 位配对码（两边各自计算，应当相同）
pub fn pairing_code(initiator: &str, responder: &str, nonce_a: &str, nonce_b: &str) -> String {
    let digest = Sha256::digest(
        format!("pindu-pair-v1|{initiator}|{responder}|{nonce_a}|{nonce_b}").as_bytes(),
    );
    let mut first = [0u8; 8];
    first.copy_from_slice(&digest[..8]);
    format!("{:06}", u64::from_be_bytes(first) % 1_000_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(fp: &str) -> DeviceInfo {
        DeviceInfo {
            alias: " 客厅的电脑 ".into(),
            fingerprint: fp.into(),
            port: 53318,
            os: "macos".into(),
            app_version: "0.3.1".into(),
            protocol: PROTOCOL,
        }
    }

    #[test]
    fn parses_only_other_pindu_devices() {
        let me = "a".repeat(64);
        let other = "b".repeat(64);
        let raw = serde_json::to_vec(&Announcement::new(info(&other), true, false)).unwrap();
        let msg = parse_announcement(&raw, &me).unwrap();
        assert_eq!(msg.info.alias, "客厅的电脑");
        assert!(msg.announce);

        // 自己的、别的应用的、别的协议版本的、编号不对的都忽略
        assert!(parse_announcement(&raw, &other).is_none());
        let mut foreign = Announcement::new(info(&other), true, false);
        foreign.app = "localsend".into();
        assert!(parse_announcement(&serde_json::to_vec(&foreign).unwrap(), &me).is_none());
        let mut newer = info(&other);
        newer.protocol = PROTOCOL + 1;
        let raw = serde_json::to_vec(&Announcement::new(newer, true, false)).unwrap();
        assert!(parse_announcement(&raw, &me).is_none());
        let raw = serde_json::to_vec(&Announcement::new(info("xyz"), true, false)).unwrap();
        assert!(parse_announcement(&raw, &me).is_none());
        assert!(parse_announcement(b"not json", &me).is_none());
    }

    #[test]
    fn alias_is_trimmed_and_capped() {
        assert_eq!(clean_alias("  \n "), None);
        assert_eq!(
            clean_alias(&"字".repeat(50)).unwrap().chars().count(),
            ALIAS_MAX_CHARS
        );
    }

    #[test]
    fn pairing_code_is_six_digits_and_depends_on_every_input() {
        let (a, b) = ("a".repeat(64), "b".repeat(64));
        let (na, nb) = ("1".repeat(64), "2".repeat(64));
        let code = pairing_code(&a, &b, &na, &nb);
        assert_eq!(code.len(), 6);
        assert!(code.bytes().all(|c| c.is_ascii_digit()));
        assert_eq!(code, pairing_code(&a, &b, &na, &nb));
        // 角色互换（中间人两头的身份不同）、随机数不同，数字都不同（固定输入，结果确定）
        assert_ne!(code, pairing_code(&b, &a, &na, &nb));
        assert_ne!(code, pairing_code(&a, &b, &"3".repeat(64), &nb));
        assert_eq!(new_nonce().len(), 64);
        assert_ne!(new_nonce(), new_nonce());
        assert_eq!(commitment(&na), commitment(&na));
        assert_ne!(commitment(&na), commitment(&nb));
    }
}
