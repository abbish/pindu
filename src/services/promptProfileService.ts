import { BaseService } from './baseService';
import type { ApiResult } from '../types';

/** 学习者档案与 AI 风格（对应 Rust `prompts::PromptProfile`，camelCase） */
export interface PromptProfile {
  /** primary 小学生 / junior 初中生 / senior 高中生 / adult 成人 */
  learner: string;
  /** auto（按学习者）/ a1 / a2 / b1 / b2 */
  level: string;
  /** zh 中文为主 / mixed 中英混合 / en 英文为主 */
  language: string;
  /** 兴趣场景（例句、讲解优先用这些场景） */
  interests: string[];
  /** AI 讲解详略：brief / standard / detailed */
  explainLength: string;
  /** 记忆方法偏好：auto / phonics / morphology / imagery */
  memoryMethod: string;
  /** AI 老师的称呼（空 = 默认） */
  tutorName: string;
  /** 答疑风格：gentle / concise / socratic */
  tutorStyle: string;
  /** 回答末尾可以出一个小问题 */
  tutorQuiz: boolean;
  /** 音标：british / american */
  ipa: string;
  /** 各任务的补充要求（任务 key → 文本） */
  custom: Record<string, string>;
}

/** 渲染后的系统提示词（对应 Rust `PromptPreview`） */
export interface PromptPreview {
  /** 任务 key：extract / generate / phonics / examples / plan / explain / tutor */
  task: string;
  label: string;
  content: string;
}

/** 补充要求的最大字数（与 Rust `CUSTOM_MAX_CHARS` 一致） */
export const CUSTOM_MAX_CHARS = 300;

class PromptProfileService extends BaseService {
  async getProfile(): Promise<ApiResult<PromptProfile>> {
    return this.executeWithLoading(async () => this.client.invoke<PromptProfile>('get_prompt_profile'));
  }

  async updateProfile(request: PromptProfile): Promise<ApiResult<PromptProfile>> {
    return this.executeWithLoading(async () => this.client.invoke<PromptProfile>('update_prompt_profile', { request }));
  }

  /** 套用预设：primary / secondary / adult（保留兴趣场景、老师称呼与补充要求） */
  async applyPreset(preset: string): Promise<ApiResult<PromptProfile>> {
    return this.executeWithLoading(async () => this.client.invoke<PromptProfile>('apply_prompt_preset', { preset }));
  }

  /** 按传入的档案渲染各任务的系统提示词（只读预览） */
  async preview(request: PromptProfile): Promise<ApiResult<PromptPreview[]>> {
    return this.executeWithLoading(async () => this.client.invoke<PromptPreview[]>('preview_prompts', { request }));
  }
}

export const promptProfileService = new PromptProfileService();
