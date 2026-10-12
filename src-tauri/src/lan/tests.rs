//! 两个节点在 127.0.0.1 上走完整的 TLS 配对流程（不组播，按地址添加）

use super::*;
use crate::test_support::memory_pool;
use tokio::sync::mpsc;

struct TestNode {
    node: LanNode,
    events: mpsc::UnboundedReceiver<LanEvent>,
}

async fn node(name: &str) -> TestNode {
    let dir = std::env::temp_dir().join(format!("pindu-lan-{name}-{}", uuid::Uuid::new_v4()));
    let logger = Logger::new(&dir.join("logs")).unwrap();
    let (tx, rx) = mpsc::unbounded_channel();
    let node = LanNode::with_options(
        (*memory_pool().await).clone(),
        logger,
        dir,
        "0.0.0-test".into(),
        Arc::new(move |e| {
            let _ = tx.send(e);
        }),
        LanOptions {
            preferred_port: 0,
            discovery: false,
        },
    );
    let status = node.update_settings(true, name).await.unwrap();
    assert!(status.running, "{name} 应该开启：{:?}", status.error);
    TestNode { node, events: rx }
}

impl TestNode {
    fn address(&self) -> String {
        format!("127.0.0.1:{}", self.node.status().port.unwrap())
    }

    fn fingerprint(&self) -> String {
        self.node.shared.identity().unwrap().fingerprint.clone()
    }

    async fn wait<T>(&mut self, mut pick: impl FnMut(&LanEvent) -> Option<T>) -> T {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let e = self.events.recv().await.expect("事件通道关闭");
                if let Some(v) = pick(&e) {
                    return v;
                }
            }
        })
        .await
        .expect("等事件超时")
    }
}

async fn paired_with(n: &TestNode) -> Vec<String> {
    n.node
        .paired()
        .await
        .unwrap()
        .into_iter()
        .map(|d| d.alias)
        .collect()
}

#[tokio::test]
async fn pair_accept_unpair_and_reject() {
    let mut a = node("书房").await;
    let mut b = node("客厅").await;

    // A 按地址认识 B，B 也因此认识了 A
    let found = a.node.add_by_address(&b.address()).await.unwrap();
    assert_eq!(found.alias, "客厅");
    assert_eq!(found.fingerprint, b.fingerprint());
    assert!(!found.paired);
    assert_eq!(b.node.nearby().await.unwrap()[0].alias, "书房");

    // 配对：两边数字一致，B 同意后双方都记住对方
    let started = a.node.start_pairing(&b.fingerprint()).await.unwrap();
    let request = b
        .wait(|e| match e {
            LanEvent::PairRequest(r) => Some(r.clone()),
            _ => None,
        })
        .await;
    assert_eq!(request.code, started.code);
    assert_eq!(request.alias, "书房");
    assert_eq!(b.node.pending_requests().len(), 1);
    b.node.respond(&request.request_id, true).unwrap();
    let result = a
        .wait(|e| match e {
            LanEvent::PairingResult(r) => Some(r.clone()),
            _ => None,
        })
        .await;
    assert_eq!(result.outcome, "accepted", "{:?}", result.message);
    assert_eq!(paired_with(&a).await, vec!["客厅"]);
    assert_eq!(paired_with(&b).await, vec!["书房"]);
    assert!(b.node.pending_requests().is_empty());

    // 再配一次：已经配对过，不用对方确认
    a.node.start_pairing(&b.fingerprint()).await.unwrap();
    let again = a
        .wait(|e| match e {
            LanEvent::PairingResult(r) => Some(r.outcome.clone()),
            _ => None,
        })
        .await;
    assert_eq!(again, "accepted");

    // A 取消配对，B 也随之删除
    a.node.unpair(&b.fingerprint()).await.unwrap();
    b.wait(|e| matches!(e, LanEvent::PairedChanged).then_some(()))
        .await;
    // PairedChanged 可能来自更早的事件，轮询到删除为止
    for _ in 0..50 {
        if paired_with(&b).await.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(paired_with(&a).await.is_empty());
    assert!(paired_with(&b).await.is_empty());

    // 拒绝：双方都没有配对
    a.node.start_pairing(&b.fingerprint()).await.unwrap();
    let request = b
        .wait(|e| match e {
            LanEvent::PairRequest(r) => Some(r.clone()),
            _ => None,
        })
        .await;
    b.node.respond(&request.request_id, false).unwrap();
    let result = a
        .wait(|e| match e {
            LanEvent::PairingResult(r) => Some(r.outcome.clone()),
            _ => None,
        })
        .await;
    assert_eq!(result, "rejected");
    assert!(paired_with(&a).await.is_empty());
    assert!(paired_with(&b).await.is_empty());

    a.node.shutdown();
    b.node.shutdown();
}

#[tokio::test]
async fn cancel_closes_the_request_on_the_other_side() {
    let a = node("A").await;
    let mut b = node("B").await;
    a.node.add_by_address(&b.address()).await.unwrap();
    let started = a.node.start_pairing(&b.fingerprint()).await.unwrap();
    let request = b
        .wait(|e| match e {
            LanEvent::PairRequest(r) => Some(r.clone()),
            _ => None,
        })
        .await;
    a.node.cancel_pairing(&started.pairing_id);
    let closed = b
        .wait(|e| match e {
            LanEvent::PairRequestClosed(c) => Some(c.clone()),
            _ => None,
        })
        .await;
    assert_eq!(closed.request_id, request.request_id);
    assert_eq!(closed.reason, "canceled");
    assert!(b.node.respond(&request.request_id, true).is_err());
    assert!(paired_with(&b).await.is_empty());
}

#[tokio::test]
async fn refuses_a_server_with_another_identity() {
    let a = node("A").await;
    let b = node("B").await;
    let id = a.node.shared.identity().unwrap();
    let target = Target {
        address: "127.0.0.1".parse().unwrap(),
        port: b.node.status().port.unwrap(),
        fingerprint: Some("0".repeat(64)),
    };
    let own = a.node.shared.own_info().unwrap();
    let err =
        client::post_json::<_, RegisterResponse>(&id, &target, "/register", &own, REQUEST_WAIT)
            .await
            .unwrap_err();
    assert!(matches!(err, ClientError::IdentityMismatch), "{err}");

    // 自称别的编号（和证书不符）的请求被拒绝
    let mut forged = own.clone();
    forged.fingerprint = "1".repeat(64);
    let target = Target {
        fingerprint: None,
        ..target
    };
    let err =
        client::post_json::<_, RegisterResponse>(&id, &target, "/register", &forged, REQUEST_WAIT)
            .await
            .unwrap_err();
    assert!(
        matches!(err, ClientError::Status(s, _) if s == StatusCode::BAD_REQUEST),
        "{err}"
    );

    // 关闭后不再监听
    let port = b.node.status().port.unwrap();
    b.node.update_settings(false, "B").await.unwrap();
    assert!(!b.node.status().running);
    let err = a
        .node
        .add_by_address(&format!("127.0.0.1:{port}"))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("连不上"), "{err}");
}
