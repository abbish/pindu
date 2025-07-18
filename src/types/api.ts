import { ApiError, Timestamp } from './common';

/// API 响应包装器
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: Timestamp;
}

/// 健康检查响应
export interface HealthCheckResponse {
  status: string;
  version: string;
  database_connected: boolean;
  uptime_seconds: number;
}

/// 系统信息响应
export interface SystemInfoResponse {
  app_version: string;
  platform: string;
  database_version: string;
  total_words: number;
  total_study_plans: number;
  total_word_books: number;
}

/// 导出数据响应
export interface ExportDataResponse {
  file_path: string;
  file_size: number;
  export_date: Timestamp;
  included_data: string[];
}

/// 导入数据请求
export interface ImportDataRequest {
  file_path: string;
  overwrite_existing: boolean;
  data_types: string[];
}

/// 导入数据响应
export interface ImportDataResponse {
  success: boolean;
  imported_items: ImportedItemsCount;
  errors: string[];
  warnings: string[];
}

/// 导入项目计数
export interface ImportedItemsCount {
  word_books: number;
  words: number;
  study_plans: number;
  categories: number;
}

/// 搜索响应
export interface SearchResponse<T> {
  results: T[];
  total_count: number;
  search_time_ms: number;
  suggestions: string[];
}

/// 批量操作请求
export interface BatchOperationRequest<T> {
  operation: BatchOperation;
  items: T[];
}

/// 批量操作类型
export type BatchOperation = 'create' | 'update' | 'delete';

/// 批量操作响应
export interface BatchOperationResponse {
  success_count: number;
  error_count: number;
  errors: BatchOperationError[];
}

/// 批量操作错误
export interface BatchOperationError {
  index: number;
  error: ApiError;
}
