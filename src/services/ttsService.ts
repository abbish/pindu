import { BaseService } from './baseService';
import type { LoadingState, ApiResult } from '../types';

export interface TTSProvider {
  id: number;
  name: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TTSVoice {
  id: number;
  providerId: number;
  voiceId: string;
  voiceName: string;
  displayName: string;
  language: string;
  gender?: string;
  description?: string;
  modelId: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TTSRequest {
  text: string;
  voiceId?: string;
  useCache?: boolean;
}

export interface TTSResponse {
  audioUrl: string;
  cached: boolean;
  durationMs?: number;
}



export interface ElevenLabsConfig {
  apiKey: string;
  modelId: string;
  voiceStability: number;
  voiceSimilarity: number;
  voiceStyle?: number;
  voiceBoost: boolean;
  optimizeStreamingLatency?: number;
  outputFormat: string;
  defaultVoiceId: string;
}

export interface UpdateElevenLabsConfigRequest {
  apiKey?: string;
  modelId?: string;
  voiceStability?: number;
  voiceSimilarity?: number;
  voiceStyle?: number;
  voiceBoost?: boolean;
  optimizeStreamingLatency?: number;
  outputFormat?: string;
  defaultVoiceId?: string;
}

/**
 * TTS (Text-to-Speech) 服务
 */
export class TTSService extends BaseService {
  /**
   * 文本转语音
   */
  async textToSpeech(
    request: TTSRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<TTSResponse>> {
    return this.executeWithLoading(async () => {
      console.log('=== TTS Service textToSpeech 调试信息 ===');
      console.log('收到的请求参数:', request);

      this.validateRequired(request, ['text']);

      if (request.text.trim().length === 0) {
        throw new Error('文本内容不能为空');
      }

      if (request.text.length > 5000) {
        throw new Error('文本长度不能超过5000个字符');
      }

      const invokeParams = {
        text: request.text,
        voiceId: request.voiceId,
        useCache: request.useCache ?? true
      };

      console.log('准备调用Tauri命令 text_to_speech，参数:', invokeParams);

      const result = await this.client.invoke<TTSResponse>('text_to_speech', invokeParams);
      console.log('Tauri命令 text_to_speech 返回结果:', result);

      return result;
    }, setLoading);
  }

  /**
   * 获取可用语音列表
   */
  async getTTSVoices(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<TTSVoice[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<TTSVoice[]>('get_tts_voices');
    }, setLoading);
  }

  /**
   * 获取默认语音
   */
  async getDefaultTTSVoice(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<TTSVoice | null>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<TTSVoice | null>('get_default_tts_voice');
    }, setLoading);
  }

  /**
   * 获取TTS提供商列表
   */
  async getTTSProviders(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<TTSProvider[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<TTSProvider[]>('get_tts_providers');
    }, setLoading);
  }



  /**
   * 设置默认语音
   */
  async setDefaultTTSVoice(
    voiceId: string,  // 现在使用字符串类型的voice_id
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ voiceId }, ['voiceId']);

      return this.client.invoke<void>('set_default_tts_voice', {
        voiceId
      });
    }, setLoading);
  }

  /**
   * 清理TTS缓存
   */
  async clearTTSCache(
    olderThanDays?: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<number>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<number>('clear_tts_cache', {
        olderThanDays: olderThanDays ?? 30
      });
    }, setLoading);
  }

  /**
   * 播放单词发音 - 便捷方法
   */
  async playWordPronunciation(
    word: string,
    voiceId?: string,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<TTSResponse>> {
    return this.textToSpeech({
      text: word,
      voiceId,
      useCache: true
    }, setLoading);
  }

  /**
   * 播放句子发音 - 便捷方法
   */
  async playSentencePronunciation(
    sentence: string,
    voiceId?: string,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<TTSResponse>> {
    return this.textToSpeech({
      text: sentence,
      voiceId,
      useCache: true
    }, setLoading);
  }

  /**
   * 获取ElevenLabs配置
   */
  async getElevenLabsConfig(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<ElevenLabsConfig>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<ElevenLabsConfig>('get_elevenlabs_config');
    }, setLoading);
  }

  /**
   * 更新ElevenLabs配置
   */
  async updateElevenLabsConfig(
    request: UpdateElevenLabsConfigRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('update_elevenlabs_config', {
        apiKey: request.apiKey,
        modelId: request.modelId,
        voiceStability: request.voiceStability,
        voiceSimilarity: request.voiceSimilarity,
        voiceStyle: request.voiceStyle,
        voiceBoost: request.voiceBoost,
        optimizeStreamingLatency: request.optimizeStreamingLatency,
        outputFormat: request.outputFormat,
        defaultVoiceId: request.defaultVoiceId
      });
    }, setLoading);
  }
}

export const ttsService = new TTSService();
