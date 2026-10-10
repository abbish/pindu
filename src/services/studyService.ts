import { BaseService } from './baseService';
import {
  StudyPlanWithProgress,
  StudyStatistics,
  PlanScheduleSummary,
  DailyLearningActivity,
  StudyPlanScheduleRequest,
  StudyPlanAIResult,
  PlanPaceResult,
  CalendarDayData,
  CreateStudyPlanWithScheduleRequest,
  StudyPlanWord,
  StudyPlanStatistics,
  ApiResult,
  Id,
  PlanMemoryOverview,
} from '../types';


/**
 * 学习计划服务
 */
export class StudyService extends BaseService {

  /**
   * 获取所有学习计划
   */
  async getAllStudyPlans(): Promise<ApiResult<StudyPlanWithProgress[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyPlanWithProgress[]>('get_study_plans');
    });
  }

  /**
   * 获取单个学习计划详情
   */
  async getStudyPlan(planId: number): Promise<ApiResult<StudyPlanWithProgress>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyPlanWithProgress>('get_study_plan', { planId });
    });
  }

  /**
   * 获取学习统计
   */
  async getStudyStatistics(): Promise<ApiResult<StudyStatistics>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyStatistics>('get_study_statistics');
    });
  }

  /**
   * 每日学习量（首页学习热力图）：最近 days 天（含今天，本地日期），只返回有学习的日期
   */
  async getDailyLearningActivity(days: number): Promise<ApiResult<DailyLearningActivity[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<DailyLearningActivity[]>('get_daily_learning_activity', { days });
    });
  }

  /** 按默认顺序生成日程（不用 AI，立即完成） */
  async generateStudyPlanSchedule(request: StudyPlanScheduleRequest): Promise<ApiResult<StudyPlanAIResult>> {
    return this.executeWithLoading(async () =>
      this.client.invoke<StudyPlanAIResult>('generate_study_plan_schedule', { request: this.scheduleRequest(request) })
    );
  }

  /**
   * AI 排学习顺序并生成日程（前台任务）：返回任务 id，结果（StudyPlanAIResult）在任务完成时的 job.result 里；
   * 页面离开时应取消任务
   */
  async startStudyPlanOrdering(request: StudyPlanScheduleRequest): Promise<ApiResult<string>> {
    return this.executeWithLoading(async () =>
      this.client.invoke<string>('start_study_plan_ordering', { request: this.scheduleRequest(request) })
    );
  }

  /** 校验并转成后端的请求形状（snake_case 结构体字段） */
  private scheduleRequest(request: StudyPlanScheduleRequest) {
    this.validateRequired(request, ['name', 'dailyNewWords', 'startDate', 'wordbookIds']);
    if (request.wordbookIds.length === 0) {
      throw new Error('必须选择至少一个词汇本');
    }
    if (!Number.isInteger(request.dailyNewWords) || request.dailyNewWords < 1 || request.dailyNewWords > 50) {
      throw new Error('每天新词数需在 1–50 之间');
    }
    return {
      name: request.name,
      description: request.description,
      daily_new_words: request.dailyNewWords,
      start_date: request.startDate,
      wordbook_ids: request.wordbookIds,
      model_id: request.modelId || null,
      use_ai: request.useAi ?? false,
    };
  }

  /** 改每天新词数（就地生效）：只重排还没练过的新词日 */
  async replanStudyPlanPace(planId: Id, dailyNewWords: number): Promise<ApiResult<PlanPaceResult>> {
    return this.executeWithLoading(() => this.client.invoke<PlanPaceResult>('replan_study_plan_pace', { planId, dailyNewWords }));
  }

  /** 往计划里追加词汇本：新词排在还没学的新词后面 */
  async addWordBooksToPlan(planId: Id, wordbookIds: Id[]): Promise<ApiResult<PlanPaceResult>> {
    return this.executeWithLoading(() => this.client.invoke<PlanPaceResult>('add_word_books_to_plan', { planId, wordbookIds }));
  }

  /** 创建前的即时预览（确定性，不用 AI）：按默认顺序从今天排出的日程 */
  async previewStudyPlan(wordbookIds: Id[], dailyNewWords: number): Promise<ApiResult<StudyPlanAIResult>> {
    return this.executeWithLoading(() => this.client.invoke<StudyPlanAIResult>('preview_study_plan', { wordbookIds, dailyNewWords }));
  }

  /**
   * 创建带AI规划的学习计划
   */
  async createStudyPlanWithSchedule(request: CreateStudyPlanWithScheduleRequest): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      // 周期、档位等以规划元数据为准（后端保存时覆盖），这里只校验必填项
      this.validateRequired(request, ['name', 'startDate', 'endDate']);
      // 只练短文的计划没有词汇本与单词日程（短文是否选了由后端校验）
      const withWords = (request.practiceContent ?? 'words') !== 'passages';

      if (withWords && request.wordbookIds.length === 0) {
        throw new Error('必须选择至少一个词汇本');
      }

      if (withWords && (!request.aiPlanData || request.aiPlanData.trim() === '')) {
        throw new Error('AI规划数据不能为空');
      }

      // 验证AI规划数据是否为有效JSON
      if (withWords) {
        try {
          JSON.parse(request.aiPlanData);
        } catch (e) {
          throw new Error('AI规划数据格式无效');
        }
      }

      // 转换参数名称以匹配后端期望的格式
      const backendRequest = {
        name: request.name,
        description: request.description,
        start_date: request.startDate,
        end_date: request.endDate,
        ai_plan_data: request.aiPlanData,
        wordbook_ids: request.wordbookIds,
        status: request.status || 'normal', // normal → 待开始；draft 仅为兼容旧数据
        practice_content: request.practiceContent ?? 'words',
        passages: request.passages ?? [],
        passage_interval_days: request.passageIntervalDays,
      };

      return this.client.invoke<Id>('create_study_plan_with_schedule', { request: backendRequest });
    });
  }

  /**
   * 获取学习计划的扁平化单词列表
   */
  async getStudyPlanWords(planId: number): Promise<ApiResult<StudyPlanWord[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyPlanWord[]>('get_study_plan_words', { planId });
    });
  }

  /**
   * 获取学习计划的日历数据（用于StudyCalendar组件）
   */
  async getStudyPlanCalendarData(
    planId: number,
    year: number,
    month: number
  ): Promise<ApiResult<CalendarDayData[]>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId, year, month }, ['planId', 'year', 'month']);

      if (month < 1 || month > 12) {
        throw new Error('月份必须在1-12之间');
      }

      if (!Number.isInteger(year) || year < 1970 || year > 9999) {
        throw new Error('年份不正确');
      }

      return this.client.invoke<CalendarDayData[]>('get_study_plan_calendar_data', {
        planId,
        year,
        month
      });
    });
  }

  /**
   * 获取学习计划关联的词汇本ID列表
   */
  async getStudyPlanWordBooks(planId: number): Promise<ApiResult<number[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<number[]>('get_study_plan_word_books', { planId });
    });
  }

  /**
   * 更新学习计划基本信息（仅名称和描述）
   */
  async updateStudyPlanBasicInfo(
    planId: number,
    data: {
      name: string;
      description?: string;
    }): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId, name: data.name }, ['planId', 'name']);

      return this.client.invoke<void>('update_study_plan_basic_info', {
        planId,
        name: data.name,
        description: data.description
      });
    });
  }

  /**
   * 批量从学习计划中移除单词关联
   */
  async batchRemoveWordsFromPlan(
    planId: number,
    wordIds: number[]
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('batch_remove_words_from_plan', { planId, wordIds });
    });
  }

  /**
   * 获取学习计划统计数据
   */
  async getStudyPlanStatistics(planId: number): Promise<ApiResult<StudyPlanStatistics>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyPlanStatistics>('get_study_plan_statistics', { planId });
    });
  }

  // ==================== 状态管理相关方法 ====================

  /**
   * 开始学习计划
   */
  async startStudyPlan(planId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('start_study_plan', { planId });
    });
  }

  /** 暂停（进行中 → 已暂停）：暂停期间不能练习、不安排复习 */
  async pauseStudyPlan(planId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => this.client.invoke<void>('pause_study_plan', { planId }));
  }

  /** 继续（已暂停 → 进行中）：未练的日程与复习按暂停天数顺延 */
  async resumeStudyPlan(planId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => this.client.invoke<void>('resume_study_plan', { planId }));
  }

  /**
   * 完成学习计划
   */
  async completeStudyPlan(planId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('complete_study_plan', { planId });
    });
  }

  /**
   * 终止学习计划
   */
  async terminateStudyPlan(planId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('terminate_study_plan', { planId });
    });
  }

  /**
   * 重新学习计划
   */
  async restartStudyPlan(planId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('restart_study_plan', { planId });
    });
  }

  /**
   * 发布学习计划（从草稿状态转为正常状态）
   */
  async publishStudyPlan(planId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('publish_study_plan', { planId });
    });
  }



  /**
   * 删除学习计划（软删除）
   */
  async deleteStudyPlan(planId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('delete_study_plan', { planId });
    });
  }

  /**
   * 获取学习计划的日程列表
   */
  async getStudyPlanSchedules(planId: number): Promise<ApiResult<PlanScheduleSummary[]>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId }, ['planId']);
      return this.client.invoke<PlanScheduleSummary[]>('get_study_plan_schedules', { planId });
    });
  }


  /** 计划的记忆概况：各记忆等级的词数、今天待复习、已掌握 */
  async getPlanMemoryOverview(planId: Id): Promise<ApiResult<PlanMemoryOverview>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId }, ['planId']);
      return this.client.invoke<PlanMemoryOverview>('get_plan_memory_overview', { planId });
    });
  }
}

// 创建全局服务实例
export const studyService = new StudyService();

// 默认导出服务类
