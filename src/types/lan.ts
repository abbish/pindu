/** 局域网设备互传（对应 Rust `types/lan.rs`，camelCase） */

/** 本机的互传状态 */
export interface LanStatus {
  /** 设置里是否开启 */
  enabled: boolean;
  /** 本机在别的设备上显示的名字 */
  alias: string;
  /** 服务是否在运行 */
  running: boolean;
  /** 实际监听的端口 */
  port: number | null;
  /** 本机的局域网地址（别的设备按地址添加时用） */
  addresses: string[];
  /** 开启失败或发现不可用的原因 */
  error: string | null;
}

export interface UpdateLanSettingsRequest {
  enabled: boolean;
  alias: string;
}

/** 附近的设备 */
export interface NearbyDevice {
  fingerprint: string;
  alias: string;
  /** macos / windows / linux */
  os: string;
  address: string;
  port: number;
  appVersion: string;
  /** 已和本机配对 */
  paired: boolean;
}

/** 配对过的设备 */
export interface PairedDevice {
  fingerprint: string;
  alias: string;
  os: string;
  appVersion: string;
  pairedAt: string;
  lastSeenAt: string | null;
  /** 现在在局域网里能看到 */
  online: boolean;
}

/** 发起配对后两边要核对的数字 */
export interface PairingStarted {
  pairingId: string;
  alias: string;
  code: string;
}

/** 别的设备发来的配对请求 */
export interface PairRequest {
  requestId: string;
  fingerprint: string;
  alias: string;
  os: string;
  address: string;
  code: string;
}

/** 配对请求结束：accepted / rejected / timeout / canceled */
export interface PairRequestClosed {
  requestId: string;
  reason: string;
}

/** 本机发起的配对的结果：accepted / rejected / failed / canceled */
export interface PairingResult {
  pairingId: string;
  alias: string;
  outcome: string;
  /** 失败原因 */
  message: string | null;
}

/** 后端推送的事件名 */
export const LAN_EVENTS = {
  nearbyChanged: 'lan-nearby-changed',
  pairedChanged: 'lan-paired-changed',
  pairRequest: 'lan-pair-request',
  pairRequestClosed: 'lan-pair-request-closed',
  pairingResult: 'lan-pairing-result',
} as const;

/** 系统名称 */
export const osLabel = (os: string): string =>
  ({ macos: 'macOS', windows: 'Windows', linux: 'Linux' })[os] ?? os;
