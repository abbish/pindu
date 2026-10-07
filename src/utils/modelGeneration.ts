// 模型生成参数表单 ↔ ModelGenerationSettings（空字段 = 不设置，请求中不发送）
import type { AIModelConfig, ModelGenerationSettings } from '../types';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export const THINKING_LABELS: Record<string, string> = {
  off: '关闭',
  minimal: '极少',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
};

/** 表单中的生成参数（全部为字符串，便于输入框绑定） */
export interface GenerationForm {
  maxTokens: string;
  temperature: string;
  thinkingLevel: string;
  /** JSON 对象文本 */
  extraParams: string;
  contextWindow: string;
  /** '' = 未设置，'true' / 'false' */
  reasoning: string;
}

export const emptyGenerationForm = (): GenerationForm => ({
  maxTokens: '',
  temperature: '',
  thinkingLevel: '',
  extraParams: '',
  contextWindow: '',
  reasoning: '',
});

export function generationFormFromModel(model: AIModelConfig): GenerationForm {
  const str = (v: number | null | undefined) => (v == null ? '' : String(v));
  return {
    maxTokens: str(model.maxTokens),
    temperature: str(model.temperature),
    thinkingLevel: model.thinkingLevel ?? '',
    extraParams: model.extraParams ? JSON.stringify(model.extraParams, null, 2) : '',
    contextWindow: str(model.contextWindow),
    reasoning: model.reasoning == null ? '' : String(model.reasoning),
  };
}

export type ParseResult =
  | { ok: true; generation: ModelGenerationSettings }
  | { ok: false; error: string };

function optionalNumber(value: string, label: string, integer: boolean): number | null | string {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) return `${label}需为${integer ? '整数' : '数字'}`;
  return n;
}

/** 表单 → 生成参数；格式错误返回提示（范围校验以后端为准） */
export function parseGenerationForm(form: GenerationForm): ParseResult {
  const maxTokens = optionalNumber(form.maxTokens, '最大输出 token', true);
  if (typeof maxTokens === 'string') return { ok: false, error: maxTokens };
  const temperature = optionalNumber(form.temperature, '温度', false);
  if (typeof temperature === 'string') return { ok: false, error: temperature };
  const contextWindow = optionalNumber(form.contextWindow, '上下文窗口', true);
  if (typeof contextWindow === 'string') return { ok: false, error: contextWindow };

  let extraParams: Record<string, unknown> | null = null;
  if (form.extraParams.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(form.extraParams);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: '额外参数需为 JSON 对象，例如 {"top_p": 0.95}' };
      }
      extraParams = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: '额外参数不是合法的 JSON' };
    }
  }

  return {
    ok: true,
    generation: {
      maxTokens,
      temperature,
      thinkingLevel: form.thinkingLevel || null,
      extraParams,
      contextWindow,
      reasoning: form.reasoning === '' ? null : form.reasoning === 'true',
    },
  };
}
