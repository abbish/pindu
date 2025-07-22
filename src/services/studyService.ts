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
  StudyPlanStatusHistory,
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

      if (![1, 3, 7, 14, 28].includes(request.studyPeriodDays)) {
        throw new Error('学习周期必须是1天、3天、7天、14天或28天');
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
        status: request.status || 'normal',  // 修复：默认应该是 'normal' 而不是 'active'
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
   * 获取学习计划的日历数据（用于StudyCalendar组件）
   */
  async getStudyPlanCalendarData(
    planId: number,
    year: number,
    month: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<any[]>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId, year, month }, ['planId', 'year', 'month']);

      if (month < 1 || month > 12) {
        throw new Error('月份必须在1-12之间');
      }

      if (year < 2020 || year > 2030) {
        throw new Error('年份必须在2020-2030之间');
      }

      return this.client.invoke<any[]>('get_study_plan_calendar_data', {
        planId,
        year,
        month
      });
    }, setLoading);
  }

  /**
   * 获取学习计划关联的单词本ID列表
   */
  async getStudyPlanWordBooks(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<number[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<number[]>('get_study_plan_word_books', { planId });
    }, setLoading);
  }

  /**
   * 更新学习计划基本信息（仅名称和描述）
   */
  async updateStudyPlanBasicInfo(
    planId: number,
    data: {
      name: string;
      description?: string;
    },
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId, name: data.name }, ['planId', 'name']);

      return this.client.invoke<void>('update_study_plan_basic_info', {
        planId,
        name: data.name,
        description: data.description
      });
    }, setLoading);
  }

  /**
   * 更新学习计划完整信息（包括学习设置和日程）
   */
  async updateStudyPlanWithSchedule(
    planId: number,
    data: {
      name: string;
      description?: string;
      intensityLevel: string;
      studyPeriodDays: number;
      reviewFrequency: number;
      startDate: string;
      wordbookIds: number[];
      schedule: any[];
      status: 'draft' | 'active';
    },
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId, name: data.name }, ['planId', 'name']);

      return this.client.invoke<void>('update_study_plan_with_schedule', {
        planId,
        name: data.name,
        description: data.description,
        intensityLevel: data.intensityLevel,
        studyPeriodDays: data.studyPeriodDays,
        reviewFrequency: data.reviewFrequency,
        startDate: data.startDate,
        wordbookIds: data.wordbookIds,
        schedule: data.schedule,
        status: data.status
      });
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

  // ==================== 状态管理相关方法 ====================

  /**
   * 开始学习计划
   */
  async startStudyPlan(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('start_study_plan', { planId });
    }, setLoading);
  }

  /**
   * 完成学习计划
   */
  async completeStudyPlan(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('complete_study_plan', { planId });
    }, setLoading);
  }

  /**
   * 终止学习计划
   */
  async terminateStudyPlan(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('terminate_study_plan', { planId });
    }, setLoading);
  }

  /**
   * 重新学习计划
   */
  async restartStudyPlan(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('restart_study_plan', { planId });
    }, setLoading);
  }

  /**
   * 编辑学习计划（转为草稿状态）
   */
  async editStudyPlan(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('edit_study_plan', { planId });
    }, setLoading);
  }

  /**
   * 发布学习计划（从草稿状态转为正常状态）
   */
  async publishStudyPlan(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('publish_study_plan', { planId });
    }, setLoading);
  }



  /**
   * 删除学习计划（软删除）
   */
  async deleteStudyPlan(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('delete_study_plan', { planId });
    }, setLoading);
  }

  /**
   * 获取学习计划状态变更历史
   */
  async getStudyPlanStatusHistory(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<StudyPlanStatusHistory[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyPlanStatusHistory[]>('get_study_plan_status_history', { planId });
    }, setLoading);
  }

  /**
   * 获取学习计划的日程列表
   */
  async getStudyPlanSchedules(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<Array<{
    id: number;
    schedule_date: string;
    word_count: number;
    completed: boolean;
  }>>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId }, ['planId']);
      return this.client.invoke<Array<{
        id: number;
        schedule_date: string;
        word_count: number;
        completed: boolean;
      }>>('get_study_plan_schedules', { planId });
    }, setLoading);
  }

}

// 创建全局服务实例
export const studyService = new StudyService();

// 默认导出服务类
export default StudyService;
