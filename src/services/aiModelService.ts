import { BaseService } from './baseService';
import type {
  AIProvider,
  AIModelConfig,
  AIModelQuery,
  CreateAIProviderRequest,
  UpdateAIProviderRequest,
  CreateAIModelRequest,
  UpdateAIModelRequest,
  PhonicsAnalysisResult,
  Id,
  LoadingState,
  ApiResult,
  WordExtractionMode
} from '../types';

/**
 * AI模型管理服务
 */
export class AIModelService extends BaseService {
  /**
   * 获取所有AI提供商
   */
  async getAIProviders(setLoading?: (state: LoadingState) => void): Promise<ApiResult<AIProvider[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<AIProvider[]>('get_ai_providers');
    }, setLoading);
  }

  /**
   * 获取AI模型列表
   */
  async getAIModels(
    query?: AIModelQuery,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<AIModelConfig[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<AIModelConfig[]>('get_ai_models', query || {});
    }, setLoading);
  }

  /**
   * 获取默认AI模型
   */
  async getDefaultAIModel(setLoading?: (state: LoadingState) => void): Promise<ApiResult<AIModelConfig | null>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<AIModelConfig | null>('get_default_ai_model');
    }, setLoading);
  }

  /**
   * 设置默认AI模型
   */
  async setDefaultAIModel(
    modelId: Id,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ modelId }, ['modelId']);

      return this.client.invoke<void>('set_default_ai_model', { modelId: modelId });
    }, setLoading);
  }

  /**
   * 创建AI提供商
   */
  async createAIProvider(
    request: CreateAIProviderRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      this.validateRequired(request, ['name', 'display_name', 'base_url', 'api_key']);
      
      // 直接传递请求对象的所有字段作为参数
      return this.client.invoke<Id>('create_ai_provider', {
        name: request.name,
        displayName: request.display_name,
        baseUrl: request.base_url,
        apiKey: request.api_key,
        description: request.description
      });
    }, setLoading);
  }

  /**
   * 更新AI提供商
   */
  async updateAIProvider(
    providerId: Id,
    request: UpdateAIProviderRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      console.log('updateAIProvider called with:', { providerId, request });
      this.validateRequired({ providerId }, ['providerId']);

      // 扁平化参数，将 providerId 和 request 的所有字段作为单独的参数
      const params = {
        providerId: providerId,
        displayName: request.display_name,
        baseUrl: request.base_url,
        apiKey: request.api_key,
        description: request.description,
        isActive: request.is_active
      };

      console.log('Calling update_ai_provider with params:', params);
      const result = await this.client.invoke<void>('update_ai_provider', params);
      console.log('update_ai_provider call successful');
      return result;
    }, setLoading);
  }

  /**
   * 删除AI提供商
   */
  async deleteAIProvider(
    providerId: Id,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      console.log('deleteAIProvider called with providerId:', providerId);
      this.validateRequired({ providerId }, ['providerId']);

      const params = { providerId: providerId };
      console.log('Calling delete_ai_provider with params:', params);
      const result = await this.client.invoke<void>('delete_ai_provider', params);
      console.log('delete_ai_provider call successful');
      return result;
    }, setLoading);
  }

  /**
   * 创建AI模型
   */
  async createAIModel(
    request: CreateAIModelRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      this.validateRequired(request, ['provider_id', 'name', 'display_name', 'model_id']);
      
      return this.client.invoke<Id>('create_ai_model', {
        providerId: request.provider_id,
        name: request.name,
        displayName: request.display_name,
        modelId: request.model_id,
        description: request.description,
        maxTokens: request.max_tokens,
        temperature: request.temperature
      });
    }, setLoading);
  }

  /**
   * 更新AI模型
   */
  async updateAIModel(
    modelId: Id,
    request: UpdateAIModelRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      console.log('updateAIModel called with:', { modelId, request });
      this.validateRequired({ modelId }, ['modelId']);

      const params = {
        modelId: modelId,
        displayName: request.display_name,
        modelIdParam: request.model_id,
        description: request.description,
        maxTokens: request.max_tokens,
        temperature: request.temperature,
        isActive: request.is_active,
        isDefault: request.is_default
      };

      console.log('Calling update_ai_model with params:', params);
      const result = await this.client.invoke<void>('update_ai_model', params);
      console.log('update_ai_model call successful');
      return result;
    }, setLoading);
  }

  /**
   * 删除AI模型
   */
  async deleteAIModel(
    modelId: Id,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      console.log('deleteAIModel called with modelId:', modelId);
      this.validateRequired({ modelId }, ['modelId']);

      const params = { modelId: modelId };
      console.log('Calling delete_ai_model with params:', params);
      const result = await this.client.invoke<void>('delete_ai_model', params);
      console.log('delete_ai_model call successful');
      return result;
    }, setLoading);
  }

  /**
   * 使用指定模型分析文本
   */
  async analyzeTextWithModel(
    text: string,
    modelId?: Id,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<any>> {
    return this.executeWithLoading(async () => {
      // 验证输入
      if (!text || text.trim().length === 0) {
        throw new Error('文本内容不能为空');
      }

      if (text.length > 10000) {
        throw new Error('文本内容过长，请限制在10000字符以内');
      }

      return this.client.invoke<any>('analyze_text_with_model', { text, modelId: modelId || null });
    }, setLoading);
  }

  /**
   * 自然拼读分析
   */
  async analyzePhonics(
    text: string,
    modelId?: number,
    extractionMode: WordExtractionMode = 'focus',
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<PhonicsAnalysisResult>> {
    return this.executeWithLoading(async () => {
      console.log('analyzePhonics called with:', { text: text.substring(0, 100), modelId });

      if (!text || text.trim().length === 0) {
        throw new Error('文本内容不能为空');
      }

      if (text.length > 5000) {
        throw new Error('文本内容过长，请限制在5000字符以内');
      }



      // 使用对象参数方式，与其他命令保持一致
      const result = await this.client.invoke<PhonicsAnalysisResult>('analyze_phonics_with_model', {
        text: text.trim(),
        modelId: modelId || null,
        extractionMode: extractionMode
      });

      return result;
    }, setLoading);
  }
}
