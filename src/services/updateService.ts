import { Channel } from '@tauri-apps/api/core';
import { BaseService } from './baseService';
import type { ApiResult, UpdateInfo, UpdateProgress } from '../types';

/**
 * 应用内更新：检查 GitHub Releases 上的新版本、下载安装（验签由后端完成）、重启。
 */
export class UpdateService extends BaseService {
  /** 检查更新：有新版本返回版本信息，已是最新返回 null */
  async checkForUpdate(): Promise<ApiResult<UpdateInfo | null>> {
    return this.executeWithLoading(() => this.client.invoke<UpdateInfo | null>('check_for_update'));
  }

  /** 下载并安装最近一次检查到的更新；onProgress 收到已下载 / 总字节 */
  async installUpdate(onProgress: (progress: UpdateProgress) => void): Promise<ApiResult<void>> {
    const channel = new Channel<UpdateProgress>();
    channel.onmessage = onProgress;
    return this.executeWithLoading(() => this.client.invoke<void>('install_update', { onProgress: channel }));
  }

  /** 重启应用以完成更新 */
  async restart(): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('restart_app'));
  }
}

export const updateService = new UpdateService();
