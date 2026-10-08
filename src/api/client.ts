import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
import type { ApiResult } from '../types';
import { parseIpcError, toUserMessage } from './errors';

/** 开发模式下每次 invoke 派发的事件（DevTools 的 API 调用面板订阅它） */
export const API_CALL_EVENT = 'tauri-api-call';

/** API_CALL_EVENT 的 detail */
export interface ApiCallEventDetail {
  command: string;
  args?: object;
}

/**
 * Tauri API 客户端：唯一直接调用 `invoke` 的地方。
 * 永远返回 `ApiResult<T>`，不抛异常；错误解析与面向用户的说法见 `./errors.ts`。
 */
export class TauriApiClient {
  async invoke<T>(command: string, args?: object): Promise<ApiResult<T>> {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<ApiCallEventDetail>(API_CALL_EVENT, { detail: { command, args } })
      );
    }
    try {
      const data = await invoke<T>(command, args as InvokeArgs | undefined);
      return { success: true, data };
    } catch (error) {
      const { message, code } = parseIpcError(error);
      console.error(`[ipc] ${command} 失败:`, message);
      // 没有错误码 = 没进到命令里（命令未注册、参数对不上）：后端日志里没有记录，从这里补上
      if (code === undefined) this.log('ERROR', 'ipc', `${command} 调用失败`, message);
      // error 是给用户看的一句话；原始信息留在 detail（DevTools / 日志排查用）
      return { success: false, error: toUserMessage(message, code), code, detail: message };
    }
  }

  /** 写一条应用日志（组件名在后端加 `UI:` 前缀）；写日志失败静默，不能再制造错误 */
  log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', component: string, message: string, details?: string): void {
    invoke('write_client_log', { level, component, message, details: details ?? null }).catch(() => {});
  }
}

export const apiClient = new TauriApiClient();
