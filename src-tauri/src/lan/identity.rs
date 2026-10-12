//! 本机在局域网里的身份：自签证书 + 私钥，存 `<数据目录>/lan/identity.pem`（不进数据库：
//! 以后整机迁移时，新电脑保留自己的身份）。设备编号 = 证书 DER 的 SHA-256（hex），对方按它认出这台电脑。

use crate::error::{AppError, AppResult};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use sha2::{Digest, Sha256};
use std::path::Path;

const FILE: &str = "identity.pem";

pub struct Identity {
    pub cert: CertificateDer<'static>,
    key: PrivateKeyDer<'static>,
    pub fingerprint: String,
}

impl Identity {
    /// 读取已有身份；没有或读不出来时生成新的（编号随之改变，需要重新配对）
    pub fn load_or_create(dir: &Path) -> AppResult<Self> {
        let path = dir.join(FILE);
        if let Ok(text) = std::fs::read_to_string(&path) {
            match Self::parse(&text) {
                Some(id) => return Ok(id),
                None => tracing::warn!(
                    component = "LAN",
                    "本机身份文件读不出来，重新生成（已配对的设备需要重新配对）"
                ),
            }
        }
        let generated = rcgen::generate_simple_self_signed(vec!["pindu.local".to_string()])
            .map_err(|e| AppError::InternalError(format!("无法生成本机证书：{e}")))?;
        let text = format!(
            "{}{}",
            generated.signing_key.serialize_pem(),
            generated.cert.pem()
        );
        std::fs::create_dir_all(dir)
            .map_err(|e| AppError::InternalError(format!("无法创建 {}：{e}", dir.display())))?;
        write_private(&path, &text)?;
        let id = Self::parse(&text)
            .ok_or_else(|| AppError::InternalError("新生成的本机证书无法读取".into()))?;
        tracing::info!(component = "LAN", fingerprint = %id.fingerprint, "已生成本机身份");
        Ok(id)
    }

    fn parse(text: &str) -> Option<Self> {
        let key = PrivateKeyDer::from_pem_slice(text.as_bytes()).ok()?;
        let cert = CertificateDer::from_pem_slice(text.as_bytes()).ok()?;
        Some(Self {
            fingerprint: fingerprint_of(&cert),
            cert,
            key,
        })
    }

    pub fn key(&self) -> PrivateKeyDer<'static> {
        self.key.clone_key()
    }
}

/// 证书的编号：DER 的 SHA-256，小写 hex
pub fn fingerprint_of(cert_der: &[u8]) -> String {
    hex(&Sha256::digest(cert_der))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 私钥文件只给当前用户读写
fn write_private(path: &Path, text: &str) -> AppResult<()> {
    let err = |e: std::io::Error| AppError::InternalError(format!("无法写入本机证书：{e}"));
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(err)?;
        f.write_all(text.as_bytes()).map_err(err)
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, text).map_err(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_once_and_reloads_same_fingerprint() {
        let dir = std::env::temp_dir().join(format!("pindu-lan-id-{}", uuid::Uuid::new_v4()));
        let a = Identity::load_or_create(&dir).unwrap();
        let b = Identity::load_or_create(&dir).unwrap();
        assert_eq!(a.fingerprint, b.fingerprint);
        assert_eq!(a.fingerprint.len(), 64);

        // 文件坏了：重新生成，编号改变
        std::fs::write(dir.join(FILE), "broken").unwrap();
        let c = Identity::load_or_create(&dir).unwrap();
        assert_ne!(a.fingerprint, c.fingerprint);
    }
}
