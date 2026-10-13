//! 两个节点在 127.0.0.1 上走完整的 TLS 配对流程（不组播，按地址添加）

use super::*;
use crate::test_support::memory_pool;
use std::net::IpAddr;
use std::path::PathBuf;
use tokio::sync::mpsc;

struct TestNode {
    node: LanNode,
    events: mpsc::UnboundedReceiver<LanEvent>,
}

async fn node(name: &str) -> TestNode {
    let dir = std::env::temp_dir().join(format!("pindu-lan-{name}-{}", uuid::Uuid::new_v4()));
    node_with(name, (*memory_pool().await).clone(), dir).await
}

async fn node_with(name: &str, pool: SqlitePool, dir: PathBuf) -> TestNode {
    let logger = Logger::new(&dir.join("logs")).unwrap();
    let (tx, rx) = mpsc::unbounded_channel();
    let node = LanNode::with_options(
        pool,
        logger,
        dir,
        "0.0.0-test".into(),
        Arc::new(move |e| {
            let _ = tx.send(e);
        }),
        crate::jobs::Jobs::new(|_| {}),
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
    // B 先同意：A 还没确认数字，不保存
    let result = a
        .wait(|e| match e {
            LanEvent::PairingResult(r) => Some(r.clone()),
            _ => None,
        })
        .await;
    assert_eq!(result.outcome, "remote_accepted", "{:?}", result.message);
    assert!(paired_with(&a).await.is_empty());
    // A 确认数字一致后才保存
    a.node.confirm_pairing(&started.pairing_id).await.unwrap();
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

    // 再配一次：已经配对过，不用对方确认（本机先确认数字）
    let again = a.node.start_pairing(&b.fingerprint()).await.unwrap();
    a.node.confirm_pairing(&again.pairing_id).await.unwrap();
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

/// 配对两个节点（A 发起，B 同意）
async fn pair(a: &mut TestNode, b: &mut TestNode) {
    a.node.add_by_address(&b.address()).await.unwrap();
    let started = a.node.start_pairing(&b.fingerprint()).await.unwrap();
    a.node.confirm_pairing(&started.pairing_id).await.unwrap();
    let request = b
        .wait(|e| match e {
            LanEvent::PairRequest(r) => Some(r.clone()),
            _ => None,
        })
        .await;
    b.node.respond(&request.request_id, true).unwrap();
    a.wait(|e| matches!(e, LanEvent::PairingResult(r) if r.outcome == "accepted").then_some(()))
        .await;
}

/// 在 A 的任务队列里发送，等任务结束，返回（状态, 结果, 错误）
async fn send_and_wait(
    a: &TestNode,
    to: &str,
    items: Vec<crate::services::lan_export::ExportItem>,
    options: crate::services::lan_export::ExportOptions,
) -> crate::jobs::Job {
    let node = a.node.clone();
    let to = to.to_string();
    let jobs = a.node.shared.jobs.clone();
    let id = jobs.spawn(
        crate::jobs::JobSpec {
            kind: "lan_send",
            module: None,
            title: "发送".into(),
            lane: crate::jobs::Lane::Transfer,
            detached: true,
            link: None,
        },
        move |ctx| async move {
            let r = node.send(&ctx, &to, &items, &options).await?;
            Ok(serde_json::to_value(r).unwrap())
        },
    );
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let job = jobs.get(&id).unwrap();
            if !job.status.is_active() {
                return job;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("发送任务超时")
}

#[tokio::test]
async fn send_plan_and_video_to_a_paired_device() {
    use crate::services::lan_export::{ExportItem, ExportOptions};
    let src = crate::services::lan_import::tests::seed().await;
    let mut a = node_with("书房", (*src.pool).clone(), src.dir.clone()).await;
    let mut b = node("客厅").await;
    pair(&mut a, &mut b).await;

    // B 拒绝：A 的任务失败，B 什么都没有
    let items = vec![
        ExportItem {
            kind: "plan".into(),
            id: src.plan_id,
        },
        ExportItem {
            kind: "video".into(),
            id: src.video_id,
        },
    ];
    let b_fp = b.fingerprint();
    let a2 = a.node.clone();
    let send = tokio::spawn({
        let items = items.clone();
        let a = TestNode {
            node: a2,
            events: mpsc::unbounded_channel().1,
        };
        let to = b_fp.clone();
        async move { send_and_wait(&a, &to, items, ExportOptions::default()).await }
    });
    let offer = b
        .wait(|e| match e {
            LanEvent::TransferOffer(o) => Some(o.clone()),
            _ => None,
        })
        .await;
    assert_eq!(
        (
            offer.summary.plans,
            offer.summary.videos,
            offer.summary.clips
        ),
        (1, 1, 2)
    );
    assert_eq!(
        b.node.pending_transfer().unwrap().transfer_id,
        offer.transfer_id
    );
    b.node.respond_transfer(&offer.transfer_id, false).unwrap();
    let job = send.await.unwrap();
    assert_eq!(job.status, crate::jobs::JobStatus::Failed);
    assert!(job.error.unwrap().to_string().contains("没有接收"));
    let plans: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM study_plans")
        .fetch_one(&b.node.shared.pool)
        .await
        .unwrap();
    assert_eq!(plans, 0);

    // B 接收：A 的任务成功，结果里是 B 新建的对象；B 的临时目录已删除
    let a2 = a.node.clone();
    let send = tokio::spawn({
        let a = TestNode {
            node: a2,
            events: mpsc::unbounded_channel().1,
        };
        let to = b_fp.clone();
        async move { send_and_wait(&a, &to, items, ExportOptions::default()).await }
    });
    let offer = b
        .wait(|e| match e {
            LanEvent::TransferOffer(o) => Some(o.clone()),
            _ => None,
        })
        .await;
    b.node.respond_transfer(&offer.transfer_id, true).unwrap();
    let job = send.await.unwrap();
    assert_eq!(
        job.status,
        crate::jobs::JobStatus::Succeeded,
        "{:?}",
        job.error
    );
    let result: crate::services::lan_import::ImportResult =
        serde_json::from_value(job.result.unwrap()).unwrap();
    assert_eq!(result.plans[0].title, "出国前");
    assert_eq!(result.videos[0].title, "机场对话");
    let clip_file = crate::services::video::video_dir(&b.node.shared.data_dir, result.videos[0].id)
        .join("clips/1-a.mp4");
    assert_eq!(std::fs::read_to_string(clip_file).unwrap(), "clip-a");
    let closed = b
        .wait(|e| match e {
            LanEvent::TransferClosed(c) if c.transfer_id == offer.transfer_id => {
                Some(c.reason.clone())
            }
            _ => None,
        })
        .await;
    assert_eq!(closed, "done");
    assert!(!b
        .node
        .shared
        .dir
        .join("incoming")
        .join(&offer.transfer_id)
        .exists());
    // B 那边的接收任务也成功了
    let recv = b
        .node
        .shared
        .jobs
        .list()
        .into_iter()
        .find(|j| j.kind == "lan_receive")
        .unwrap();
    for _ in 0..50 {
        if !b.node.shared.jobs.get(&recv.id).unwrap().status.is_active() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(
        b.node.shared.jobs.get(&recv.id).unwrap().status,
        crate::jobs::JobStatus::Succeeded
    );
}

#[tokio::test]
async fn transfer_requires_pairing_and_token() {
    let a = node("A").await;
    let b = node("B").await;
    a.node.add_by_address(&b.address()).await.unwrap();
    let id = a.node.shared.identity().unwrap();
    let target = Target {
        address: "127.0.0.1".parse().unwrap(),
        port: b.node.status().port.unwrap(),
        fingerprint: Some(b.fingerprint()),
    };
    // 没配对：提议被拒绝
    let offer = transfer::OfferRequest {
        transfer_id: "t1".into(),
        package_version: 1,
        summary: Default::default(),
    };
    let err = client::post_json::<_, transfer::OfferResponse>(
        &id,
        &target,
        "/transfer/offer",
        &offer,
        REQUEST_WAIT,
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, ClientError::Status(s, _) if s == StatusCode::FORBIDDEN),
        "{err}"
    );
    // 没有进行中的传送：上传被拒绝
    let err = client::send(
        &id,
        &target,
        hyper::Method::PUT,
        "/transfer/t1/files/f1",
        &[
            (transfer::TOKEN_HEADER, "x".into()),
            (transfer::OFFSET_HEADER, "0".into()),
        ],
        client::bytes_body("data"),
        REQUEST_WAIT,
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, ClientError::Status(s, _) if s == StatusCode::GONE),
        "{err}"
    );
}

#[tokio::test]
async fn upload_resumes_from_where_it_stopped() {
    use crate::services::lan_export::{export, ExportItem, ExportOptions};
    let src = crate::services::lan_import::tests::seed().await;
    let mut a = node_with("A", (*src.pool).clone(), src.dir.clone()).await;
    let mut b = node("B").await;
    pair(&mut a, &mut b).await;
    let exported = export(
        src.pool.clone(),
        &src.dir,
        &[ExportItem {
            kind: "video".into(),
            id: src.video_id,
        }],
        &ExportOptions {
            include_source_video: true,
            ..Default::default()
        },
        "0",
    )
    .await
    .unwrap();
    let id = a.node.shared.identity().unwrap();
    let target = Target {
        address: "127.0.0.1".parse().unwrap(),
        port: b.node.status().port.unwrap(),
        fingerprint: Some(b.fingerprint()),
    };
    let offer = transfer::OfferRequest {
        transfer_id: "resume-1".into(),
        package_version: 1,
        summary: exported.package.summary(),
    };
    let ask = {
        let id = id.clone();
        let target = target.clone();
        tokio::spawn(async move {
            client::post_json::<_, transfer::OfferResponse>(
                &id,
                &target,
                "/transfer/offer",
                &offer,
                REQUEST_WAIT,
            )
            .await
            .unwrap()
            .1
        })
    };
    b.wait(|e| matches!(e, LanEvent::TransferOffer(_)).then_some(()))
        .await;
    b.node.respond_transfer("resume-1", true).unwrap();
    let token = ask.await.unwrap().token.unwrap();
    let auth = |offset: Option<u64>| {
        let mut h = vec![(transfer::TOKEN_HEADER, token.clone())];
        if let Some(o) = offset {
            h.push((transfer::OFFSET_HEADER, o.to_string()));
        }
        h
    };
    let manifest = serde_json::to_vec(&exported.package).unwrap();
    client::send(
        &id,
        &target,
        hyper::Method::PUT,
        "/transfer/resume-1/manifest",
        &auth(None),
        client::bytes_body(manifest.clone()),
        REQUEST_WAIT,
    )
    .await
    .unwrap();

    // 原始视频先传前一半，再从断点传完
    let source = exported.package.videos[0]
        .files
        .iter()
        .find(|f| f.path == "source.mp4")
        .unwrap()
        .file
        .clone();
    let data = std::fs::read(&exported.files[&source]).unwrap();
    let half = data.len() / 2;
    let put = |offset: u64, body: Vec<u8>| {
        let id = id.clone();
        let target = target.clone();
        let headers = auth(Some(offset));
        let path = format!("/transfer/resume-1/files/{source}");
        async move {
            client::send(
                &id,
                &target,
                hyper::Method::PUT,
                &path,
                &headers,
                client::bytes_body(body),
                REQUEST_WAIT,
            )
            .await
        }
    };
    put(0, data[..half].to_vec()).await.unwrap();
    // 断点不对：拒绝，并告诉已经收到多少
    let err = put(0, data.to_vec()).await.unwrap_err();
    assert!(
        matches!(&err, ClientError::Status(s, body) if *s == StatusCode::CONFLICT && body == &half.to_string()),
        "{err}"
    );
    let (_, bytes) = client::send(
        &id,
        &target,
        hyper::Method::PUT,
        "/transfer/resume-1/manifest",
        &auth(None),
        client::bytes_body(manifest),
        REQUEST_WAIT,
    )
    .await
    .unwrap();
    let received: transfer::ReceivedFiles = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(received.received[&source], half as u64);
    put(half as u64, data[half..].to_vec()).await.unwrap();
    let dir = b.node.shared.dir.join("incoming").join("resume-1");
    assert_eq!(std::fs::read(dir.join(&source)).unwrap(), data);

    // 内容被改过：校验不通过，丢掉重传
    let poster = exported
        .package
        .files
        .iter()
        .find(|f| f.kind == "image")
        .unwrap()
        .id
        .clone();
    let err = client::send(
        &id,
        &target,
        hyper::Method::PUT,
        &format!("/transfer/resume-1/files/{poster}"),
        &auth(Some(0)),
        client::bytes_body(vec![
            b'x';
            exported
                .package
                .files
                .iter()
                .find(|f| f.id == poster)
                .unwrap()
                .size as usize
        ]),
        REQUEST_WAIT,
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, ClientError::Status(s, _) if s == StatusCode::UNPROCESSABLE_ENTITY),
        "{err}"
    );
    assert!(!dir.join(format!("{poster}.part")).exists());

    // 发送方取消：接收方结束并删掉临时文件
    client::send(
        &id,
        &target,
        hyper::Method::POST,
        "/transfer/resume-1/cancel",
        &auth(None),
        client::bytes_body(""),
        REQUEST_WAIT,
    )
    .await
    .unwrap();
    let reason = b
        .wait(|e| match e {
            LanEvent::TransferClosed(c) => Some(c.reason.clone()),
            _ => None,
        })
        .await;
    assert_eq!(reason, "canceled");
    assert!(!dir.exists());
}

#[tokio::test]
async fn initiator_cancel_after_remote_accepted_unpairs_both_sides() {
    let mut a = node("A").await;
    let mut b = node("B").await;
    a.node.add_by_address(&b.address()).await.unwrap();
    let started = a.node.start_pairing(&b.fingerprint()).await.unwrap();
    let request = b
        .wait(|e| match e {
            LanEvent::PairRequest(r) => Some(r.clone()),
            _ => None,
        })
        .await;
    b.node.respond(&request.request_id, true).unwrap();
    a.wait(|e| {
        matches!(e, LanEvent::PairingResult(r) if r.outcome == "remote_accepted").then_some(())
    })
    .await;
    assert_eq!(paired_with(&b).await.len(), 1);
    // A 发现数字对不上，取消：B 那边也删除
    a.node.cancel_pairing(&started.pairing_id);
    for _ in 0..100 {
        if paired_with(&b).await.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(paired_with(&a).await.is_empty());
    assert!(paired_with(&b).await.is_empty());
    assert!(a.node.confirm_pairing(&started.pairing_id).await.is_err());
}

#[tokio::test]
async fn unpairing_stops_an_active_transfer() {
    use crate::services::lan_export::{export, ExportItem, ExportOptions};
    let src = crate::services::lan_import::tests::seed().await;
    let mut a = node_with("A", (*src.pool).clone(), src.dir.clone()).await;
    let mut b = node("B").await;
    pair(&mut a, &mut b).await;
    let exported = export(
        src.pool.clone(),
        &src.dir,
        &[ExportItem {
            kind: "video".into(),
            id: src.video_id,
        }],
        &ExportOptions::default(),
        "0",
    )
    .await
    .unwrap();
    let id = a.node.shared.identity().unwrap();
    let target = Target {
        address: "127.0.0.1".parse().unwrap(),
        port: b.node.status().port.unwrap(),
        fingerprint: Some(b.fingerprint()),
    };
    let offer = transfer::OfferRequest {
        transfer_id: "t-unpair".into(),
        package_version: 1,
        summary: exported.package.summary(),
    };
    let ask = {
        let id = id.clone();
        let target = target.clone();
        tokio::spawn(async move {
            client::post_json::<_, transfer::OfferResponse>(
                &id,
                &target,
                "/transfer/offer",
                &offer,
                REQUEST_WAIT,
            )
            .await
            .unwrap()
            .1
        })
    };
    b.wait(|e| matches!(e, LanEvent::TransferOffer(_)).then_some(()))
        .await;
    b.node.respond_transfer("t-unpair", true).unwrap();
    let token = ask.await.unwrap().token.unwrap();
    // B 取消配对：进行中的接收立刻结束，之后的请求被拒绝
    b.node.unpair(&a.fingerprint()).await.unwrap();
    let reason = b
        .wait(|e| match e {
            LanEvent::TransferClosed(c) => Some(c.reason.clone()),
            _ => None,
        })
        .await;
    assert_eq!(reason, "canceled");
    let err = client::send(
        &id,
        &target,
        hyper::Method::PUT,
        "/transfer/t-unpair/manifest",
        &[(transfer::TOKEN_HEADER, token)],
        client::bytes_body(serde_json::to_vec(&exported.package).unwrap()),
        REQUEST_WAIT,
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, ClientError::Status(s, _) if s == StatusCode::GONE),
        "{err}"
    );
}

#[tokio::test]
async fn spoofed_announcements_cannot_rename_or_remove_a_device() {
    let mut a = node("A").await;
    let mut b = node("B").await;
    pair(&mut a, &mut b).await;
    let b_fp = b.fingerprint();
    let before = a.node.nearby().await.unwrap();
    let real = before
        .iter()
        .find(|d| d.fingerprint == b_fp)
        .unwrap()
        .clone();
    // 别的地址冒名发：改名、下线
    let fake = |bye: bool| {
        serde_json::to_vec(&Announcement::new(
            DeviceInfo {
                alias: "冒名的电脑".into(),
                fingerprint: b_fp.clone(),
                port: 1,
                os: "linux".into(),
                app_version: "9".into(),
                protocol: PROTOCOL,
            },
            false,
            bye,
        ))
        .unwrap()
    };
    let other: IpAddr = "10.255.255.1".parse().unwrap();
    a.node.shared.on_datagram(&fake(false), other);
    a.node.shared.on_datagram(&fake(true), other);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let after = a.node.nearby().await.unwrap();
    let still = after
        .iter()
        .find(|d| d.fingerprint == b_fp)
        .expect("冒名下线不应生效");
    assert_eq!(still.alias, real.alias);
    assert_eq!(still.address, real.address);
    assert_eq!(paired_with(&a).await, vec![real.alias.clone()]);
    let _ = &mut b;
}
