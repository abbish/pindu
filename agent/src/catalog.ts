// pi 内置模型目录导出（供 RedLark 设置页：内置 provider 下拉、同步模型、思考档选项）。
// 由 `redlark-agent --redlark-catalog` 输出 JSON 后退出，不启动 agent。
import { builtinProviders, getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

export interface CatalogModel {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  input: string[];
  /** 美元 / 百万 token */
  costInput: number;
  costOutput: number;
  thinkingLevels: string[];
}

export interface CatalogProvider {
  id: string;
  /** pi 给出的展示名称 */
  name: string;
  baseUrl: string;
  api: string;
  /** pi 对 API 密钥的说明（如 "DeepSeek API key"）；不支持密钥鉴权时为 null */
  apiKeyLabel: string | null;
  /** 支持登录授权（OAuth） */
  supportsOAuth: boolean;
  /** 只填 API 密钥就能用：pi 支持密钥鉴权，且提供商自带固定地址（无 {占位参数}） */
  keyOnly: boolean;
  models: CatalogModel[];
}

interface PiProvider {
  id: string;
  name?: string;
  baseUrl?: string;
  auth?: { apiKey?: { name?: string }; oauth?: unknown };
  getModels(): ReturnType<typeof getBuiltinModels>;
}

export function buildCatalog(): CatalogProvider[] {
  return (builtinProviders() as unknown as PiProvider[])
    .map(provider => {
      const models = [...provider.getModels()];
      const providerUrl = provider.baseUrl ?? "";
      const apiKey = provider.auth?.apiKey;
      return {
        id: provider.id,
        name: provider.name || provider.id,
        baseUrl: providerUrl || (models[0]?.baseUrl ?? ""),
        api: models[0]?.api ?? "",
        apiKeyLabel: apiKey ? (apiKey.name ?? "API key") : null,
        supportsOAuth: Boolean(provider.auth?.oauth),
        keyOnly: Boolean(apiKey) && providerUrl !== "" && !providerUrl.includes("{"),
        models: models.map(model => ({
          id: model.id,
          name: model.name,
          api: model.api,
          reasoning: model.reasoning,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          input: [...model.input],
          costInput: model.cost.input,
          costOutput: model.cost.output,
          thinkingLevels: getSupportedThinkingLevels(model),
        })),
      };
    })
    .filter(provider => provider.models.length > 0);
}
