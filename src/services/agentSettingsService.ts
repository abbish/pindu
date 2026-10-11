import { BaseService } from './baseService';
import type { ApiResult } from '../types';

/** 一个任务的模型设置（对应 Rust `AgentTaskModel`，camelCase） */
export interface AgentTaskModel {
  /** 任务：extract / phonics / examples / plan / explain / tutor / chat / passage / video */
  task: string;
  label: string;
  description: string;
  /** 指定的模型；null = 跟随 fallbackTask 的设置（没有时跟随默认模型） */
  modelId: number | null;
  /** 没有单独设置时沿用哪个任务的模型 */
  fallbackTask: string | null;
}

/** AI 老师对话能做哪些改动：删除前问 / 改动都问 / 只查看 */
export type TutorPermission = 'ask_delete' | 'ask_changes' | 'view_only';

/** AI 任务设置（对应 Rust `AgentSettings`） */
export interface AgentSettings {
  taskModels: AgentTaskModel[];
  /** 批量分析每批词数（3–20） */
  batchSize: number;
  /** 同时请求数（1–5） */
  maxConcurrency: number;
  /** AI 一次任务的等待上限，分钟（3–60） */
  timeoutMinutes: number;
  /** 模型服务出错时自动重试的次数（0–10） */
  maxRetries: number;
  /** 后台同时进行的 AI 任务数（1–4） */
  jobSlots: number;
  /** AI 老师对话能做哪些改动 */
  tutorPermission: TutorPermission;
  /** AI 老师回答后给出下一步可以说的话 */
  tutorSuggestions: boolean;
}

/** 更新请求：只改传了的字段（对应 Rust `UpdateAgentSettingsRequest`） */
export interface UpdateAgentSettingsRequest {
  taskModels?: { task: string; modelId: number | null }[];
  batchSize?: number;
  maxConcurrency?: number;
  timeoutMinutes?: number;
  maxRetries?: number;
  jobSlots?: number;
  tutorPermission?: TutorPermission;
  tutorSuggestions?: boolean;
}

class AgentSettingsService extends BaseService {
  async getSettings(): Promise<ApiResult<AgentSettings>> {
    return this.executeWithLoading(async () => this.client.invoke<AgentSettings>('get_agent_settings'));
  }

  async updateSettings(request: UpdateAgentSettingsRequest): Promise<ApiResult<AgentSettings>> {
    return this.executeWithLoading(async () => this.client.invoke<AgentSettings>('update_agent_settings', { request }));
  }
}

export const agentSettingsService = new AgentSettingsService();
