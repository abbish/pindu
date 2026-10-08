import { BaseService } from './baseService';
import type { ApiResult } from '../types';
import type { Job } from '../types/job';

/** 后台任务（handlers/jobs.rs）：列表、取消、移除、确认退出。任务由各功能的 start_* 命令提交 */
export class JobService extends BaseService {
  async list(): Promise<ApiResult<Job[]>> {
    return this.executeWithLoading(() => this.client.invoke<Job[]>('list_jobs'));
  }

  async cancel(jobId: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('cancel_job', { jobId }));
  }

  async remove(jobId: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('remove_job', { jobId }));
  }

  async clearFinished(): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('clear_finished_jobs'));
  }

  /** 用户确认后退出（有任务在跑时也退出） */
  async quit(): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('quit_app'));
  }
}

export const jobService = new JobService();
