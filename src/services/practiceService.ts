import { BaseService } from './baseService';
import {
  PracticeSession,
  PracticeResult,
  PracticeStatistics,
  StartPracticeSessionRequest,
  SubmitStepResultRequest,
  PausePracticeSessionRequest,
  ResumePracticeSessionRequest,
  CompletePracticeSessionRequest,
  ApiResult,
  LoadingState
} from '../types';

/**
 * 单词练习服务
 */
export class PracticeService extends BaseService {

  /**
   * 开始练习会话
   */
  async startPracticeSession(
    request: StartPracticeSessionRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<PracticeSession>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['planId', 'scheduleId']);

      return this.client.invoke<PracticeSession>('start_practice_session', {
        planId: request.planId,
        scheduleId: request.scheduleId
      });
    }, setLoading);
  }

  /**
   * 提交步骤结果
   */
  async submitStepResult(
    request: SubmitStepResultRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['sessionId', 'wordId', 'planWordId', 'step', 'userInput', 'isCorrect', 'timeSpent', 'attempts']);

      if (request.step < 1 || request.step > 3) {
        throw new Error('步骤必须在1-3之间');
      }

      if (request.timeSpent < 0) {
        throw new Error('用时不能为负数');
      }

      if (request.attempts < 1) {
        throw new Error('尝试次数必须大于0');
      }

      return this.client.invoke<void>('submit_step_result', {
        sessionId: request.sessionId,
        wordId: request.wordId,
        planWordId: request.planWordId,
        step: request.step,
        userInput: request.userInput,
        isCorrect: request.isCorrect,
        timeSpent: request.timeSpent,
        attempts: request.attempts
      });
    }, setLoading);
  }

  /**
   * 暂停练习会话
   */
  async pausePracticeSession(
    request: PausePracticeSessionRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['sessionId']);

      return this.client.invoke<void>('pause_practice_session', {
        sessionId: request.sessionId
      });
    }, setLoading);
  }

  /**
   * 恢复练习会话
   */
  async resumePracticeSession(
    request: ResumePracticeSessionRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['sessionId']);

      return this.client.invoke<void>('resume_practice_session', {
        sessionId: request.sessionId
      });
    }, setLoading);
  }

  /**
   * 完成练习会话
   */
  async completePracticeSession(
    request: CompletePracticeSessionRequest & { totalTime: number; activeTime: number },
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<PracticeResult>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['sessionId', 'totalTime', 'activeTime']);

      if (request.totalTime < 0 || request.activeTime < 0) {
        throw new Error('时间不能为负数');
      }

      if (request.activeTime > request.totalTime) {
        throw new Error('实际练习时间不能大于总时间');
      }

      return this.client.invoke<PracticeResult>('complete_practice_session', {
        sessionId: request.sessionId,
        totalTime: request.totalTime,
        activeTime: request.activeTime
      });
    }, setLoading);
  }

  /**
   * 取消练习会话
   */
  async cancelPracticeSession(
    sessionId: string,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ sessionId }, ['sessionId']);

      return this.client.invoke<void>('cancel_practice_session', {
        sessionId
      });
    }, setLoading);
  }

  /**
   * 获取未完成的练习会话
   */
  async getIncompletePracticeSessions(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<PracticeSession[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<PracticeSession[]>('get_incomplete_practice_sessions');
    }, setLoading);
  }

  /**
   * 检查是否有未完成的练习
   */
  async checkIncompletePractice(): Promise<ApiResult<{
    hasIncomplete: boolean;
    sessions: PracticeSession[];
  }>> {
    try {
      const result = await this.getIncompletePracticeSessions();
      
      if (result.success) {
        return {
          success: true,
          data: {
            hasIncomplete: result.data.length > 0,
            sessions: result.data
          }
        };
      } else {
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '检查未完成练习时发生错误'
      };
    }
  }

  /**
   * 获取练习会话详情（包含单词状态）
   */
  async getPracticeSessionDetail(
    sessionId: string,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<PracticeSession>> {
    console.log('=== PracticeService.getPracticeSessionDetail 被调用 ===');
    console.log('参数:', { sessionId });

    return this.executeWithLoading(async () => {
      this.validateRequired({ sessionId }, ['sessionId']);
      console.log('参数验证通过，调用后端API');

      const result = await this.client.invoke<PracticeSession>('get_practice_session_detail', {
        sessionId
      });

      console.log('后端API调用结果:', result);
      return result;
    }, setLoading);
  }



  /**
   * 获取练习统计数据
   */
  async getPracticeStatistics(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<PracticeStatistics>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId }, ['planId']);

      return this.client.invoke<PracticeStatistics>('get_practice_statistics', {
        planId
      });
    }, setLoading);
  }

  /**
   * 获取学习计划的练习会话列表
   */
  async getPlanPracticeSessions(
    planId: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<PracticeSession[]>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId }, ['planId']);

      return this.client.invoke<PracticeSession[]>('get_plan_practice_sessions', {
        planId
      });
    }, setLoading);
  }
}

// 创建单例实例
export const practiceService = new PracticeService();
