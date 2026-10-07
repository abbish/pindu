import { BaseService } from './baseService';
import type {
  AIProvider,
  AIModelConfig,
  AIModelQuery,
  AIModelTestResult,
  TestAIModelResult,
  CreateAIProviderRequest,
  UpdateAIProviderRequest,
  CreateAIModelRequest,
  UpdateAIModelRequest,
  RemoteModelInfo,
  CatalogModel,
  CatalogProviderSummary,
  Id,
  ApiResult,
} from '../types';

/**
 * AI模型管理服务
 */
export class AIModelService extends BaseService {
  /**
   * 获取所有AI提供商（包括禁用的，用于设置页面）
   */
  async getAllAIProviders(): Promise<ApiResult<AIProvider[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<AIProvider[]>('get_all_ai_providers');
    });
  }

  /**
   * 获取所有AI模型（包括禁用的，用于设置页面）
   */
  async getAllAIModels(query?: AIModelQuery): Promise<ApiResult<AIModelConfig[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<AIModelConfig[]>('get_all_ai_models', { query });
    });
  }

  /**
   * 设置默认AI模型
   */
  async setDefaultAIModel(modelId: Id): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ modelId }, ['modelId']);

      return this.client.invoke<void>('set_default_ai_model', { modelId: modelId });
    });
  }

  /**
   * 创建AI提供商
   */
  async createAIProvider(request: CreateAIProviderRequest): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      this.validateRequired(request, ['name', 'displayName', 'baseUrl', 'apiKey']);

      // 直接传递请求对象的所有字段作为参数
      return this.client.invoke<Id>('create_ai_provider', {
        name: request.name,
        displayName: request.displayName,
        baseUrl: request.baseUrl,
        apiKey: request.apiKey,
        description: request.description,
        piProvider: request.piProvider ?? undefined,
        api: request.api
      });
    });
  }

  /**
   * 更新AI提供商
   */
  async updateAIProvider(
    providerId: Id,
    request: UpdateAIProviderRequest
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ providerId }, ['providerId']);

      const result = await this.client.invoke<void>('update_ai_provider', {
        providerId: providerId,
        displayName: request.displayName,
        baseUrl: request.baseUrl,
        apiKey: request.apiKey,
        description: request.description,
        isActive: request.isActive,
        piProvider: request.piProvider,
        api: request.api
      });
      return result;
    });
  }

  /**
   * 删除AI提供商
   */
  async deleteAIProvider(providerId: Id): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ providerId }, ['providerId']);
      const result = await this.client.invoke<void>('delete_ai_provider', { providerId: providerId });
      return result;
    });
  }

  /**
   * pi 内置提供商列表（映射下拉）
   */
  async getAgentCatalogProviders(): Promise<ApiResult<CatalogProviderSummary[]>> {
    return this.executeWithLoading(
      () => this.client.invoke<CatalogProviderSummary[]>('get_agent_catalog_providers')
    );
  }

  /**
   * 某个 pi 内置提供商的模型目录（思考档 / 上下文 / 价格）
   */
  async getAgentCatalogModels(piProvider: string): Promise<ApiResult<CatalogModel[]>> {
    return this.executeWithLoading(
      () => this.client.invoke<CatalogModel[]>('get_agent_catalog_models', { piProvider })
    );
  }

  /**
   * 可添加的模型（同步模型列表）：映射了 pi 内置提供商时合并 pi 目录与提供商 `/models`
   */
  async listProviderRemoteModels(providerId: Id): Promise<ApiResult<RemoteModelInfo[]>> {
    return this.executeWithLoading(
      () => this.client.invoke<RemoteModelInfo[]>('list_provider_remote_models', { providerId })
    );
  }

  /**
   * 创建AI模型
   */
  async createAIModel(request: CreateAIModelRequest): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      this.validateRequired(request, ['providerId', 'name', 'displayName', 'modelId']);

      return this.client.invoke<Id>('create_ai_model', {
        providerId: request.providerId,
        name: request.name,
        displayName: request.displayName,
        modelId: request.modelId,
        description: request.description,
        generation: request.generation
      });
    });
  }

  /**
   * 更新AI模型
   */
  async updateAIModel(
    modelId: Id,
    request: UpdateAIModelRequest
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ modelId }, ['modelId']);

      const result = await this.client.invoke<void>('update_ai_model', {
        modelId: modelId,
        displayName: request.displayName,
        modelIdParam: request.modelId,
        description: request.description,
        isActive: request.isActive,
        isDefault: request.isDefault,
        generation: request.generation
      });
      return result;
    });
  }

  /**
   * 删除AI模型
   */
  async deleteAIModel(modelId: Id): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ modelId }, ['modelId']);
      const result = await this.client.invoke<void>('delete_ai_model', { modelId: modelId });
      return result;
    });
  }

  /**
   * 测试AI模型 - 发送简单对话指令，并记录响应时间
   */
  async testAIModel(modelId: number, testText?: string): Promise<ApiResult<AIModelTestResult>> {
    const startTime = performance.now();
    const result = await this.client.invoke<TestAIModelResult>('test_ai_model', {
      modelId,
      testText: testText?.trim() || 'Hello',
    });
    const responseTime = Math.round(performance.now() - startTime);
    if (result.success && result.data.success) {
      return { success: true, data: { success: true, responseTime, message: result.data.message } };
    }
    // 调用失败也作为一条测试结果返回（失败原因放在 error）
    const error = result.success ? result.data.message || '未知错误' : result.error;
    return { success: true, data: { success: false, responseTime, message: '测试失败', error } };
  }
}

export const aiModelService = new AIModelService();
