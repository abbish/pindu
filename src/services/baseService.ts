import { apiClient } from '../api/client';
import { ApiResult, LoadingState } from '../types';

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
      console.log('executeWithLoading: Starting operation...');
      setLoading?.({ loading: true });
      const result = await operation();
      console.log('executeWithLoading: Operation completed successfully');
      setLoading?.({ loading: false });
      return result;
    } catch (error) {
      console.error('executeWithLoading: Operation failed:', error);
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
   * 检查是否在 Tauri 环境中
   */
  protected isTauriEnvironment(): boolean {
    return this.client.isTauriEnvironment();
  }

  /**
   * 创建模拟数据（开发环境使用）
   */
  protected createMockData<T>(data: T): ApiResult<T> {
    return {
      success: true,
      data: data
    };
  }

  /**
   * 延迟执行（模拟网络延迟）
   */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 验证必需参数
   */
  protected validateRequired(params: Record<string, any>, requiredFields: string[]): void {
    for (const field of requiredFields) {
      if (params[field] === undefined || params[field] === null || params[field] === '') {
        throw new Error(`Required field '${field}' is missing or empty`);
      }
    }
  }

  /**
   * 格式化错误消息
   */
  protected formatError(error: any): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && error.message) {
      return error.message;
    }
    return 'An unknown error occurred';
  }
}
