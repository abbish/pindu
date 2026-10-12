//! 组播发现：在每个 IPv4 网卡上加入 `224.0.0.167:53318`，广播本机信息、接收别的设备的广播。
//! 同一台电脑上开两个实例（测试）也能互相看到：端口复用、组播回环打开。

use super::protocol::{Announcement, MULTICAST_ADDR, PORT};
use socket2::{Domain, Protocol, SockAddr, Socket, Type};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use tokio::net::UdpSocket;

/// 本机可用于局域网的 IPv4 地址（排除回环）
pub fn local_ipv4() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
            _ => None,
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// 接收用的组播套接字
pub fn bind_receiver() -> std::io::Result<UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    socket.set_reuse_port(true)?;
    socket.bind(&SockAddr::from(SocketAddrV4::new(
        Ipv4Addr::UNSPECIFIED,
        PORT,
    )))?;
    let mut joined = 0;
    for ip in local_ipv4() {
        match socket.join_multicast_v4(&MULTICAST_ADDR, &ip) {
            Ok(()) => joined += 1,
            Err(e) => tracing::debug!(component = "LAN", %ip, error = %e, "这个网卡加入组播失败"),
        }
    }
    if joined == 0 {
        socket.join_multicast_v4(&MULTICAST_ADDR, &Ipv4Addr::UNSPECIFIED)?;
    }
    socket.set_multicast_loop_v4(true)?;
    socket.set_nonblocking(true)?;
    UdpSocket::from_std(socket.into())
}

/// 在每个网卡上广播一条消息（发送失败的网卡跳过）
pub fn send(msg: &Announcement) {
    let Ok(data) = serde_json::to_vec(msg) else {
        return;
    };
    let target = SockAddr::from(SocketAddrV4::new(MULTICAST_ADDR, PORT));
    let mut ifaces = local_ipv4();
    if ifaces.is_empty() {
        ifaces.push(Ipv4Addr::UNSPECIFIED);
    }
    for ip in ifaces {
        let sent = (|| -> std::io::Result<()> {
            let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
            socket.set_multicast_loop_v4(true)?;
            if !ip.is_unspecified() {
                socket.set_multicast_if_v4(&ip)?;
                socket.bind(&SockAddr::from(SocketAddr::new(IpAddr::V4(ip), 0)))?;
            }
            socket.send_to(&data, &target)?;
            Ok(())
        })();
        if let Err(e) = sent {
            tracing::debug!(component = "LAN", %ip, error = %e, "这个网卡广播失败");
        }
    }
}
