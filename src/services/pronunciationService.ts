import { BaseService } from './baseService';
import type { ApiResult } from '../types';
import type { Assessment, AssessPronunciationRequest, PronunciationOverview, PronunciationSettings, PronunciationStatus } from '../types/pronunciation';

/** 本机发音评估（handlers/pronunciation.rs）：全部在本机，录音不上传 */
class PronunciationService extends BaseService {
  async status(): Promise<ApiResult<PronunciationStatus>> {
    return this.executeWithLoading(() => this.client.invoke<PronunciationStatus>('get_pronunciation_status'));
  }

  async updateSettings(request: PronunciationSettings): Promise<ApiResult<PronunciationSettings>> {
    return this.executeWithLoading(() => this.client.invoke<PronunciationSettings>('update_pronunciation_settings', { request }));
  }

  /** 下载评估模型（后台任务），返回任务 id */
  async startDownload(): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('start_pronunciation_model_download'));
  }

  async deleteModel(): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('delete_pronunciation_model'));
  }

  /** 评估一段录音；模型没下载时失败的 code 是 NOT_FOUND */
  async assess(request: AssessPronunciationRequest): Promise<ApiResult<Assessment>> {
    return this.executeWithLoading(() => this.client.invoke<Assessment>('assess_pronunciation', { request }));
  }

  /** 学习计划的发音统计（常错的音） */
  async overview(planId: number): Promise<ApiResult<PronunciationOverview>> {
    return this.executeWithLoading(() => this.client.invoke<PronunciationOverview>('get_pronunciation_overview', { planId }));
  }
}

export const pronunciationService = new PronunciationService();
