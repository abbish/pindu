import { BaseService } from './baseService';
import type { ApiResult } from '../types';

/** 一个任务的模型设置（对应 Rust `AgentTaskModel`，camelCase） */
export interface AgentTaskModel {
  /** 任务：extract / phonics / examples / plan / explain / tutor */
  task: string;
  label: string;
  description: string;
  /** 指定的模型；null = 跟随默认模型 */
  modelId: number | null;
}

/** AI 助手设置（对应 Rust `AgentSettings`） */
export interface AgentSettings {
  taskModels: AgentTaskModel[];
  /** 批量分析每批词数（3–20） */
  batchSize: number;
  /** 同时请求数（1–5） */
  maxConcurrency: number;
}

/** 更新请求：只改传了的字段（对应 Rust `UpdateAgentSettingsRequest`） */
export interface UpdateAgentSettingsRequest {
  taskModels?: { task: string; modelId: number | null }[];
  batchSize?: number;
  maxConcurrency?: number;
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
