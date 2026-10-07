import { apiClient } from '../api/client';
import { ApiResult, LoadingState } from '../types';
import { messageOf } from '../utils/errorHandler';

/**
 * 基础服务类
 */
export abstract class BaseService {
  protected client = apiClient;

  /**
   * 执行 API 调用并处理加载状态
   */
  protected async executeWithLoading<T>(
    operation: () => Promise<ApiResult<T>>,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<T>> {
    try {
      setLoading?.({ loading: true });
      const result = await operation();
      setLoading?.({ loading: false });
      return result;
    } catch (error) {
      const errorMessage = this.formatError(error);
      setLoading?.({ loading: false, error: errorMessage });

      // 返回统一的错误格式而不是抛出异常
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * 验证必需参数
   */
  protected validateRequired<T extends object>(params: T, requiredFields: (keyof T & string)[]): void {
    for (const field of requiredFields) {
      const value: unknown = params[field];
      if (value === undefined || value === null || value === '') {
        throw new Error(`Required field '${field}' is missing or empty`);
      }
    }
  }

  /**
   * 格式化错误消息
   */
  protected formatError(error: unknown): string {
    return messageOf(error) ?? 'An unknown error occurred';
  }
}
