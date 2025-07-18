import { BaseService } from './baseService';
import {
  StudyPlanWithProgress,
  StudyStatistics,
  CreateStudyPlanRequest,
  StudyPlanScheduleRequest,
  StudyPlanAIResult,
  CreateStudyPlanWithScheduleRequest,
  StudyPlanStatus,
  StudyPlanWord,
  StudyPlanStatistics,
  ApiResult,
  LoadingState,
  Id,
} from '../types';


/**
 * 学习计划服务
 */
export class StudyService extends BaseService {

  /**
   * 获取所有学习计划
   */
  async getAllStudyPlans(setLoading?: (state: LoadingState) => void): Promise<ApiResult<StudyPlanWithProgress[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyPlanWithProgress[]>('get_study_plans');
    }, setLoading);
  }

  /**
   * 获取单个学习计划详情
   */
  async getStudyPlan(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<StudyPlanWithProgress>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyPlanWithProgress>('get_study_plan', { planId });
    }, setLoading);
  }

  /**
   * 更新学习计划
   */
  async updateStudyPlan(
    planId: number,
    updates: Partial<{
      name: string;
      description: string;
      status: StudyPlanStatus;
      intensity_level: string;
      review_frequency: number;
    }>,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<boolean>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<boolean>('update_study_plan', { planId, updates });
    }, setLoading);
  }

  /**
   * 获取学习统计
   */
  async getStudyStatistics(setLoading?: (state: LoadingState) => void): Promise<ApiResult<StudyStatistics>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyStatistics>('get_study_statistics');
    }, setLoading);
  }

  /**
   * 创建学习计划
   */
  async createStudyPlan(
    request: CreateStudyPlanRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['name', 'word_ids']);

      if (request.word_ids.length === 0) {
        throw new Error('学习计划必须包含至少一个单词');
      }

      return this.client.invoke<Id>('create_study_plan', { request });
    }, setLoading);
  }

  /**
   * 生成学习计划AI规划
   */
  async generateStudyPlanSchedule(
    request: StudyPlanScheduleRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<StudyPlanAIResult>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['name', 'intensityLevel', 'studyPeriodDays', 'reviewFrequency', 'startDate', 'wordbookIds']);

      if (request.wordbookIds.length === 0) {
        throw new Error('必须选择至少一个单词本');
      }

      if (![7, 14, 28].includes(request.studyPeriodDays)) {
        throw new Error('学习周期必须是7天、14天或28天');
      }

      if (!['easy', 'normal', 'intensive'].includes(request.intensityLevel)) {
        throw new Error('学习强度必须是easy、normal或intensive');
      }

      if (request.reviewFrequency < 3 || request.reviewFrequency > 5) {
        throw new Error('复习频率必须在3-5次之间');
      }

      // 转换参数名称以匹配后端期望的格式
      const backendRequest = {
        name: request.name,
        description: request.description,
        intensity_level: request.intensityLevel,
        study_period_days: request.studyPeriodDays,
        review_frequency: request.reviewFrequency,
        start_date: request.startDate,
        wordbook_ids: request.wordbookIds,
        model_id: request.modelId || null,
      };

      return this.client.invoke<StudyPlanAIResult>('generate_study_plan_schedule', { request: backendRequest });
    }, setLoading);
  }

  /**
   * 创建带AI规划的学习计划
   */
  async createStudyPlanWithSchedule(
    request: CreateStudyPlanWithScheduleRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['name', 'intensityLevel', 'studyPeriodDays', 'reviewFrequency', 'startDate', 'endDate', 'aiPlanData', 'wordbookIds']);

      if (request.wordbookIds.length === 0) {
        throw new Error('必须选择至少一个单词本');
      }

      if (!request.aiPlanData || request.aiPlanData.trim() === '') {
        throw new Error('AI规划数据不能为空');
      }

      // 验证AI规划数据是否为有效JSON
      try {
        JSON.parse(request.aiPlanData);
      } catch (e) {
        throw new Error('AI规划数据格式无效');
      }

      // 转换参数名称以匹配后端期望的格式
      const backendRequest = {
        name: request.name,
        description: request.description,
        intensity_level: request.intensityLevel,
        study_period_days: request.studyPeriodDays,
        review_frequency: request.reviewFrequency,
        start_date: request.startDate,
        end_date: request.endDate,
        ai_plan_data: request.aiPlanData,
        wordbook_ids: request.wordbookIds,
        status: request.status || 'active',
      };

      return this.client.invoke<Id>('create_study_plan_with_schedule', { request: backendRequest });
    }, setLoading);
  }

  /**
   * 获取学习计划的扁平化单词列表
   */
  async getStudyPlanWords(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<StudyPlanWord[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyPlanWord[]>('get_study_plan_words', { planId });
    }, setLoading);
  }

  /**
   * 从学习计划中移除单词关联
   */
  async removeWordFromPlan(
    planId: number,
    wordId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('remove_word_from_plan', { planId, wordId });
    }, setLoading);
  }

  /**
   * 批量从学习计划中移除单词关联
   */
  async batchRemoveWordsFromPlan(
    planId: number,
    wordIds: number[],
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('batch_remove_words_from_plan', { planId, wordIds });
    }, setLoading);
  }

  /**
   * 获取学习计划统计数据
   */
  async getStudyPlanStatistics(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<StudyPlanStatistics>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyPlanStatistics>('get_study_plan_statistics', { planId });
    }, setLoading);
  }

}

// 创建全局服务实例
export const studyService = new StudyService();

// 默认导出服务类
export default StudyService;
