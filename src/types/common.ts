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
