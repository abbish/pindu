import { BaseService } from './baseService';
import type { ApiResult } from '../types';
import type { DictationLanguage, DictationStatus } from '../types/pronunciation';

/** 语音输入（handlers/dictation.rs）：本机把一小段录音转成文字，录音不上传 */
class DictationService extends BaseService {
  async status(): Promise<ApiResult<DictationStatus>> {
    return this.executeWithLoading(() => this.client.invoke<DictationStatus>('get_dictation_status'));
  }

  /** 下载语音输入模型（后台任务），返回任务 id */
  async startDownload(): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('start_dictation_model_download'));
  }

  async deleteModel(): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('delete_dictation_model'));
  }

  /** 录音转文字；没说话时为空字符串，模型没下载时失败的 code 是 NOT_FOUND */
  async transcribe(audio: string, language: DictationLanguage): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('transcribe_speech', { request: { audio, language } }));
  }
}

export const dictationService = new DictationService();
