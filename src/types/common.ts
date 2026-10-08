import type { AppErrorCode } from '../api/errors';

// 通用类型定义

/// 统一的 API 错误类型
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

/// 统一的 API 响应类型
export type ApiResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  /** 给用户看的错误说明（已去掉技术前缀，可直接放进提示的描述里） */
  error: string;
  /** 后端 AppError 类别；Tauri 自身错误或前端异常时为空 */
  code?: AppErrorCode;
  /** 原始错误信息（排查用，不直接展示） */
  detail?: string;
};

/// 分页查询参数
export interface PaginationQuery {
  page?: number;
  page_size?: number;
}

/// 分页响应
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/// 时间戳类型
export type Timestamp = string;

/// ID 类型
export type Id = number;

/// 加载状态
export interface LoadingState {
  loading: boolean;
  error?: string;
}

/** 启动失败的原因（对应 Rust `types::common::StartupFailure`，camelCase） */
export interface StartupFailure {
  /** connect / interrupted / newer_database / modified_migration / backup / migrate */
  kind: string;
  title: string;
  /** 给用户看的说明 */
  message: string;
  /** 原始错误（反馈问题时附上） */
  detail: string | null;
  dataDir: string;
  /** 升级前备份所在目录 */
  backupDir: string;
}

/** 启动状态（对应 Rust `types::common::StartupStatus`） */
export interface StartupStatus {
  /** 数据库已打开，可以进入应用 */
  ok: boolean;
  failure: StartupFailure | null;
  /** 启动阶段：opening / backing_up / upgrading / ready / failed */
  phase: 'opening' | 'backing_up' | 'upgrading' | 'ready' | 'failed';
  /** 阶段补充说明：备份 / 升级时为 "57 → 59" */
  detail: string | null;
}

/** 检查到的新版本（对应 Rust `types::common::UpdateInfo`） */
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  /** 更新说明（latest.json 的 notes，来自 docs/releases/vX.md） */
  notes: string | null;
  /** 能否在应用内安装（Linux deb / rpm 不能，只提示去下载） */
  canInstall: boolean;
}

/** 下载进度（对应 Rust `types::common::UpdateProgress`） */
export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}
