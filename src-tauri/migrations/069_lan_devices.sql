-- 局域网里配对过的设备（设置 → 附近的设备）。
-- fingerprint 是对方证书的 SHA-256（hex），连接时按它核对对方身份；本机自己的证书在数据目录 lan/ 下，不进数据库。
CREATE TABLE IF NOT EXISTS lan_devices (
    fingerprint TEXT PRIMARY KEY,
    alias TEXT NOT NULL,
    os TEXT NOT NULL DEFAULT '',
    app_version TEXT NOT NULL DEFAULT '',
    last_address TEXT,
    last_port INTEGER,
    paired_at TEXT NOT NULL,
    last_seen_at TEXT
);
