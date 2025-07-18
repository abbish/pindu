// 通用类型定义

/// 统一的 API 错误类型
export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

/// 统一的 API 响应类型
export type ApiResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: string;
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

/// 排序参数
export interface SortQuery {
  field: string;
  direction: 'asc' | 'desc';
}

/// 搜索查询参数
export interface SearchQuery {
  keyword?: string;
  filters?: any;
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

/// 操作结果
export interface OperationResult {
  success: boolean;
  message?: string;
  data?: any;
}
