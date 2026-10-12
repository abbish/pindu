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

/** 素材包摘要（对应 Rust `lan::package::PackageSummary`） */
export interface PackageSummary {
  wordBooks: number;
  words: number;
  passages: number;
  videos: number;
  clips: number;
  plans: number;
  withProgress: boolean;
  withSourceVideo: boolean;
  totalBytes: number;
  fileCount: number;
  /** 选中的对象标题（最多 20 个） */
  titles: string[];
}

/** 别的设备想发送的内容（等本机确认） */
export interface TransferOffer {
  transferId: string;
  fingerprint: string;
  alias: string;
  summary: PackageSummary;
}

/** 接收结束：rejected / timeout / canceled / done / failed */
export interface TransferClosed {
  transferId: string;
  reason: string;
}

/** 要发送的一项：word_book / passage / video / clip（短文编号）/ plan */
export interface ExportItem {
  kind: 'word_book' | 'passage' | 'video' | 'clip' | 'plan';
  id: number;
}

export interface StartTransferRequest {
  fingerprint: string;
  items: ExportItem[];
  /** 计划连同学习进度 */
  includeProgress: boolean;
  /** 视频带上原始视频 */
  includeSourceVideo: boolean;
}

/** 后端推送的事件名 */
export const LAN_EVENTS = {
  nearbyChanged: 'lan-nearby-changed',
  pairedChanged: 'lan-paired-changed',
  pairRequest: 'lan-pair-request',
  pairRequestClosed: 'lan-pair-request-closed',
  pairingResult: 'lan-pairing-result',
  transferOffer: 'lan-transfer-offer',
  transferClosed: 'lan-transfer-closed',
} as const;

/** 字节数的大致大小：12 MB / 1.2 GB */
export const formatBytes = (n: number): string => {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

/** 摘要里的内容：「2 个词汇本、1 个学习计划、3 段场景片段」 */
export const summaryText = (s: PackageSummary): string =>
  [
    s.wordBooks && `${s.wordBooks} 个词汇本`,
    s.passages && `${s.passages} 篇短文`,
    s.videos && `${s.videos} 个视频`,
    s.clips && `${s.clips} 段场景片段`,
    s.plans && `${s.plans} 个学习计划${s.withProgress ? '（含学习进度）' : ''}`,
  ]
    .filter(Boolean)
    .join('、');

/** 系统名称 */
export const osLabel = (os: string): string =>
  ({ macos: 'macOS', windows: 'Windows', linux: 'Linux' })[os] ?? os;
