import { invoke } from '@tauri-apps/api/core';
import { ApiResult } from '../types';

// 调试：检查 invoke 函数是否正确导入
console.log('TauriApiClient: invoke function imported:', typeof invoke);

/**
 * Tauri API 客户端封装
 */
export class TauriApiClient {
  /**
   * 调用 Tauri 命令
   */
  async invoke<T>(command: string, args?: Record<string, any>): Promise<ApiResult<T>> {
    console.log(`TauriApiClient.invoke called:`, { command, args });

    try {
      // 直接尝试调用 invoke 函数，让 Tauri 处理环境检查
      console.log(`Calling Tauri invoke for command: ${command}`);
      const result = await invoke<T>(command, args);
      console.log(`Tauri invoke successful for command: ${command}`, result);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      // 增强错误信息以便调试
      console.error(`Tauri API call failed:`, {
        command,
        args,
        error,
        isTauriEnv: this.isTauriEnvironment(),
        invokeAvailable: typeof invoke !== 'undefined',
        windowTauri: typeof window !== 'undefined' ? (window as any).__TAURI__ : 'window undefined'
      });

      // 返回错误格式的ApiResult，增强错误信息
      let errorMessage: string;
      if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && typeof error === 'object') {
        // 尝试从错误对象中提取更多信息
        const errorObj = error as any;
        
        if ('message' in errorObj) {
          errorMessage = errorObj.message;
        } else if ('error' in errorObj) {
          errorMessage = errorObj.error;
        } else if ('data' in errorObj) {
          errorMessage = errorObj.data;
        } else {
          // 将整个错误对象转换为字符串，包含所有属性
          errorMessage = JSON.stringify(errorObj, null, 2);
        }
        
        // 添加额外的错误信息（如果有的话）
        if ('cause' in errorObj && errorObj.cause) {
          errorMessage += ` (Cause: ${errorObj.cause})`;
        }
        if ('code' in errorObj && errorObj.code) {
          errorMessage += ` (Code: ${errorObj.code})`;
        }
      } else {
        errorMessage = `Unknown error occurred (Type: ${typeof error}, Value: ${String(error)})`;
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * 检查是否在 Tauri 环境中
   */
  isTauriEnvironment(): boolean {
    // 在 Tauri v2 中，检查多种可能的标识
    if (typeof window === 'undefined') {
      return false;
    }

    const isTauriEnv = (
      '__TAURI__' in window ||
      '__TAURI_INTERNALS__' in window ||
      'isTauri' in window ||
      // 检查是否有 Tauri 特有的 API
      typeof (window as any).__TAURI_INVOKE__ === 'function'
    );

    // 开发模式下输出详细调试信息
    const isDev = import.meta.env.DEV;
    if (isDev) {
      console.log('🔧 Development Mode - Tauri Environment Check:', {
        isTauriEnv,
        windowExists: typeof window !== 'undefined',
        __TAURI__: '__TAURI__' in window,
        __TAURI_INTERNALS__: '__TAURI_INTERNALS__' in window,
        isTauri: 'isTauri' in window,
        __TAURI_INVOKE__: typeof (window as any).__TAURI_INVOKE__ === 'function',
        invokeExists: typeof invoke !== 'undefined',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
      });
    }

    return isTauriEnv;
  }


}

// 创建全局客户端实例
export const apiClient = new TauriApiClient();
