//! 双向 TLS：两边都用自签证书，不走证书链，身份就是证书编号。
//! - 服务端要求客户端出示证书（任何自签都接受，但握手里必须证明持有私钥），由此知道是哪台设备在调用。
//! - 客户端按发现时拿到的编号核对服务端证书，不一致在发出任何数据之前就断开。

use super::identity::{fingerprint_of, Identity};
use crate::error::{AppError, AppResult};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, DistinguishedName, ServerConfig,
    SignatureScheme,
};
use std::sync::{Arc, Mutex};

/// 握手时记下的对方证书编号
pub type SeenFingerprint = Arc<Mutex<Option<String>>>;

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn tls_err(e: rustls::Error) -> AppError {
    AppError::InternalError(format!("无法建立加密连接配置：{e}"))
}

pub fn server_config(id: &Identity) -> AppResult<Arc<ServerConfig>> {
    let p = provider();
    let config = ServerConfig::builder_with_provider(p.clone())
        .with_safe_default_protocol_versions()
        .map_err(tls_err)?
        .with_client_cert_verifier(Arc::new(AnyClientCert(p)))
        .with_single_cert(vec![id.cert.clone()], id.key())
        .map_err(tls_err)?;
    Ok(Arc::new(config))
}

/// 客户端配置；`expected` 为 None 时接受任何证书（按地址添加设备时，先认识对方），
/// 返回的槽里记下对方实际的编号
pub fn client_config(
    id: &Identity,
    expected: Option<String>,
) -> AppResult<(Arc<ClientConfig>, SeenFingerprint)> {
    let p = provider();
    let seen = Arc::new(Mutex::new(None));
    let verifier = PinnedServer {
        provider: p.clone(),
        expected,
        seen: seen.clone(),
    };
    let config = ClientConfig::builder_with_provider(p)
        .with_safe_default_protocol_versions()
        .map_err(tls_err)?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_client_auth_cert(vec![id.cert.clone()], id.key())
        .map_err(tls_err)?;
    Ok((Arc::new(config), seen))
}

/// 连接时用的服务器名（不按名字校验，只是握手需要一个）
pub fn server_name() -> ServerName<'static> {
    ServerName::try_from("pindu.local").expect("固定的合法名字")
}

#[derive(Debug)]
struct AnyClientCert(Arc<CryptoProvider>);

impl ClientCertVerifier for AnyClientCert {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }

    fn verify_client_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _now: UnixTime,
    ) -> Result<ClientCertVerified, rustls::Error> {
        Ok(ClientCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

#[derive(Debug)]
struct PinnedServer {
    provider: Arc<CryptoProvider>,
    expected: Option<String>,
    seen: SeenFingerprint,
}

impl ServerCertVerifier for PinnedServer {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let fingerprint = fingerprint_of(end_entity);
        let matches = self.expected.as_deref().is_none_or(|e| e == fingerprint);
        if let Ok(mut seen) = self.seen.lock() {
            *seen = Some(fingerprint);
        }
        if matches {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::InvalidCertificate(
                CertificateError::ApplicationVerificationFailure,
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}
