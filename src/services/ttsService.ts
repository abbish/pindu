import { BaseService } from './baseService';
import type { ApiResult } from '../types';

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

/** 朗读风格：word = 单词示范发音，sentence = 例句朗读；不传为默认（设置页试听） */
export type SpeechStyle = 'word' | 'sentence';

export interface TTSRequest {
  text: string;
  voiceId?: string;
  useCache?: boolean;
  /** 朗读风格（豆包 2.0 音色用固定指令保持语气一致；参与缓存键） */
  style?: SpeechStyle;
  /** slow = 比设置的语速再慢一档（单独缓存） */
  speed?: SpeechSpeed;
  /** 同时返回逐词时间（豆包 enable_subtitle） */
  withTimings?: boolean;
}

/** 语速：normal 按设置 / slow 再慢一档 */
export type SpeechSpeed = 'normal' | 'slow';

/** 一个词在音频里的起止时间（毫秒） */
export interface WordTiming {
  /** 原文中的写法（可能带标点） */
  word: string;
  startMs: number;
  endMs: number;
}

export interface TTSResponse {
  audioUrl: string;
  cached: boolean;
  durationMs?: number;
  /** 逐词时间（请求 withTimings 时返回） */
  words?: WordTiming[] | null;
}



/** 对应 Rust `TtsConfigSafe`：豆包语音合成配置，后端不返回任何密钥本身 */
/** 语音缓存统计（对应 Rust `TtsCacheStats`，camelCase） */
export interface TtsCacheStats {
  /** 缓存条数 */
  entries: number;
  /** 占用空间（字节） */
  totalBytes: number;
  /** 超过 staleDays 天没用过的条数 */
  staleEntries: number;
  /** 超过 staleDays 天没用过的占用空间（字节） */
  staleBytes: number;
  /** “很久没用”的天数 */
  staleDays: number;
}

export interface TtsConfig {
  /** 鉴权是否完整（可以发起合成） */
  configured: boolean;
  /** 是否已配置新控制台 API Key */
  hasApiKey: boolean;
  /** API Key 前 4 位脱敏预览 */
  apiKeyPreview?: string | null;
  /** 旧控制台 AppID（非密钥，原样返回） */
  appId: string;
  /** 是否已配置旧控制台 Access Token */
  hasAccessKey: boolean;
  /** Access Token 前 4 位脱敏预览 */
  accessKeyPreview?: string | null;
  /** 用户填写的资源 ID；空字符串表示按音色自动推断 */
  resourceId: string;
  /** 默认音色 ID */
  defaultVoiceId: string;
  /** 默认音色实际使用的资源 ID */
  effectiveResourceId: string;
  /** 语速 [-50, 100]，0 为正常 */
  speechRate: number;
  /** 采样率 */
  sampleRate: number;
}

/** 对应 Rust `UpdateTtsConfigRequest`：未提供的字段不修改；密钥传空字符串表示清除 */
export interface UpdateTtsConfigRequest {
  apiKey?: string;
  appId?: string;
  accessKey?: string;
  resourceId?: string;
  defaultVoiceId?: string;
  speechRate?: number;
}

/**
 * TTS (Text-to-Speech) 服务
 */
export class TTSService extends BaseService {
  /**
   * 文本转语音
   */
  async textToSpeech(request: TTSRequest): Promise<ApiResult<TTSResponse>> {
    return this.executeWithLoading(async () => {

      this.validateRequired(request, ['text']);

      if (request.text.trim().length === 0) {
        throw new Error('文本内容不能为空');
      }

      if (request.text.length > 1000) {
        throw new Error('文本长度不能超过1000个字符');
      }


      const result = await this.client.invoke<TTSResponse>('text_to_speech', {
        text: request.text,
        voiceId: request.voiceId,
        useCache: request.useCache ?? true,
        style: request.style,
        speed: request.speed === 'slow' ? 'slow' : null,
        withTimings: request.withTimings ?? false,
      });

      return result;
    });
  }

  /**
   * 获取可用语音列表
   */
  async getTTSVoices(): Promise<ApiResult<TTSVoice[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<TTSVoice[]>('get_tts_voices');
    });
  }

  /**
   * 获取默认语音
   */
  async getDefaultTTSVoice(): Promise<ApiResult<TTSVoice | null>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<TTSVoice | null>('get_default_tts_voice');
    });
  }

  /**
   * 清理TTS缓存
   */
  /** 语音缓存统计：条数、占用空间、很久没用的部分 */
  async getCacheStats(): Promise<ApiResult<TtsCacheStats>> {
    return this.executeWithLoading(async () => this.client.invoke<TtsCacheStats>('get_tts_cache_stats'));
  }

  /** 清理缓存：olderThanDays = 0 表示全部清空 */
  async clearTTSCache(olderThanDays?: number): Promise<ApiResult<number>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<number>('clear_tts_cache', {
        olderThanDays: olderThanDays ?? 30
      });
    });
  }

  /**
   * 获取豆包语音合成配置（脱敏）
   */
  async getTtsConfig(): Promise<ApiResult<TtsConfig>> {
    return this.executeWithLoading(
      () => this.client.invoke<TtsConfig>('get_tts_config')
    );
  }

  /**
   * 更新豆包语音合成配置
   */
  async updateTtsConfig(request: UpdateTtsConfigRequest): Promise<ApiResult<void>> {
    return this.executeWithLoading(
      () => this.client.invoke<void>('update_tts_config', { request })
    );
  }
}

export const ttsService = new TTSService();
