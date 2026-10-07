// RedLark 模型配置 → pi models.json（见 docs/agent-harness/DESIGN.md §4、DECISIONS D04）。
// Rust 每次启动 sidecar 只传入本次会话使用的那一个提供商与模型；密钥只以环境变量名出现。

/** Rust 写入 REDLARK_AGENT_CONFIG 指向文件的结构（camelCase） */
export interface RedLarkAgentConfig {
  provider: RedLarkProvider;
}

export interface RedLarkProvider {
  /** pi 中使用的 provider id：内置 provider 用其 id（如 moonshotai-cn），自定义为 redlark-p<数据库 id> */
  key: string;
  /** 映射的 pi 内置 provider；null 表示自定义 OpenAI / Anthropic 兼容端点 */
  piProvider: string | null;
  name: string;
  baseUrl: string;
  /** 自定义 provider 的接口类型 */
  api: string;
  /** 存放 API Key 的环境变量名（值不出现在任何文件里） */
  apiKeyEnv: string;
  model: RedLarkModel;
}

export interface RedLarkModel {
  modelId: string;
  name: string;
  maxTokens: number | null;
  temperature: number | null;
  /** 额外采样参数（如 top_p），与 temperature 合并为 samplingParams */
  extraParams: Record<string, unknown> | null;
  contextWindow: number | null;
  reasoning: boolean | null;
}

/** pi models.json 中单个模型的（子集）结构 */
export interface PiModelEntry {
  id: string;
  name?: string;
  maxTokens?: number;
  contextWindow?: number;
  reasoning?: boolean;
  samplingParams?: Record<string, unknown>;
}

export interface PiProviderEntry {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey: string;
  models?: PiModelEntry[];
  modelOverrides?: Record<string, Omit<PiModelEntry, 'id'>>;
}

export interface PiModelsJson {
  providers: Record<string, PiProviderEntry>;
}

/** 查询 pi 内置目录：provider 是否内置、某模型是否在目录中 */
export interface BuiltinCatalog {
  hasProvider(providerId: string): boolean;
  hasModel(providerId: string, modelId: string): boolean;
}

function samplingParams(model: RedLarkModel): Record<string, unknown> | undefined {
  const params: Record<string, unknown> = { ...(model.extraParams ?? {}) };
  if (model.temperature !== null) params.temperature = model.temperature;
  return Object.keys(params).length > 0 ? params : undefined;
}

/** 只保留有值的字段（pi 对缺省字段使用目录默认值） */
function modelFields(model: RedLarkModel): Omit<PiModelEntry, 'id'> {
  const fields: Omit<PiModelEntry, 'id'> = {};
  if (model.maxTokens !== null && model.maxTokens > 0) fields.maxTokens = model.maxTokens;
  if (model.contextWindow !== null && model.contextWindow > 0) fields.contextWindow = model.contextWindow;
  if (model.reasoning !== null) fields.reasoning = model.reasoning;
  const sampling = samplingParams(model);
  if (sampling) fields.samplingParams = sampling;
  return fields;
}

/**
 * 生成 pi 的 models.json：
 * - 内置 provider：目录中已有的模型写 `modelOverrides`（保留 pi 的兼容参数与思考档映射），没有的写 `models` 追加；
 * - 自定义 provider：写完整定义（baseUrl / api / 模型）。
 * 两种情况的 apiKey 都是 `$<环境变量名>` 引用。
 */
export function toPiModelsJson(config: RedLarkAgentConfig, catalog: BuiltinCatalog): PiModelsJson {
  const { provider } = config;
  const { model } = provider;
  const apiKey = `$${provider.apiKeyEnv}`;
  const fields = modelFields(model);

  if (provider.piProvider !== null && provider.key === provider.piProvider && catalog.hasProvider(provider.piProvider)) {
    const entry: PiProviderEntry = { apiKey };
    if (catalog.hasModel(provider.piProvider, model.modelId)) {
      if (Object.keys(fields).length > 0) entry.modelOverrides = { [model.modelId]: fields };
    } else {
      entry.models = [{ id: model.modelId, name: model.name, ...fields }];
    }
    return { providers: { [provider.key]: entry } };
  }

  return {
    providers: {
      [provider.key]: {
        name: provider.name,
        baseUrl: provider.baseUrl,
        api: provider.api,
        apiKey,
        models: [{ id: model.modelId, name: model.name, ...fields }],
      },
    },
  };
}
