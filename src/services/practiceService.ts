import { BaseService } from './baseService';
import {
  PracticeSession,
  PracticeResult,
  StartPracticeSessionRequest,
  SubmitStepResultRequest,
  PausePracticeSessionRequest,
  ResumePracticeSessionRequest,
  CompletePracticeSessionRequest,
  ApiResult,
} from '../types';

/**
 * 单词练习服务
 */
export class PracticeService extends BaseService {

  /**
   * 开始练习会话
   */
  async startPracticeSession(request: StartPracticeSessionRequest): Promise<ApiResult<PracticeSession>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['planId', 'scheduleId']);

      return this.client.invoke<PracticeSession>('start_practice_session', {
        planId: request.planId,
        scheduleId: request.scheduleId
      });
    });
  }

  /**
   * 提交步骤结果
   */
  async submitStepResult(request: SubmitStepResultRequest): Promise<ApiResult<void>> {
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
        attempts: request.attempts,
        kind: request.kind ?? 'learn'
      });
    });
  }

  /**
   * 保存练习进度时长（毫秒，只增不减）：暂停、退出、作答时上报，恢复练习后从这里继续累计
   */
  async savePracticeProgress(sessionId: string, totalTime: number, activeTime: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(() =>
      this.client.invoke<void>('save_practice_progress', {
        sessionId,
        totalTime: Math.round(totalTime),
        activeTime: Math.round(Math.min(activeTime, totalTime))
      })
    );
  }

  /**
   * 暂停练习会话
   */
  async pausePracticeSession(request: PausePracticeSessionRequest): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['sessionId']);

      return this.client.invoke<void>('pause_practice_session', {
        sessionId: request.sessionId
      });
    });
  }

  /**
   * 恢复练习会话
   */
  async resumePracticeSession(request: ResumePracticeSessionRequest): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['sessionId']);

      return this.client.invoke<void>('resume_practice_session', {
        sessionId: request.sessionId
      });
    });
  }

  /**
   * 完成练习会话
   */
  async completePracticeSession(request: CompletePracticeSessionRequest & { totalTime: number; activeTime: number }): Promise<ApiResult<PracticeResult>> {
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
    });
  }

  /**
   * 取消练习会话
   */
  async cancelPracticeSession(sessionId: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ sessionId }, ['sessionId']);

      return this.client.invoke<void>('cancel_practice_session', {
        sessionId
      });
    });
  }

  /**
   * 获取未完成的练习会话
   */
  async getIncompletePracticeSessions(): Promise<ApiResult<PracticeSession[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<PracticeSession[]>('get_incomplete_practice_sessions');
    });
  }

  /**
   * 获取练习会话详情（包含单词状态）
   */
  async getPracticeSessionDetail(sessionId: string): Promise<ApiResult<PracticeSession>> {

    return this.executeWithLoading(async () => {
      this.validateRequired({ sessionId }, ['sessionId']);

      const result = await this.client.invoke<PracticeSession>('get_practice_session_detail', {
        sessionId
      });

      return result;
    });
  }



  /**
   * 获取学习计划的练习会话列表
   */
  async getPlanPracticeSessions(planId: number): Promise<ApiResult<PracticeSession[]>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ planId }, ['planId']);

      return this.client.invoke<PracticeSession[]>('get_plan_practice_sessions', {
        planId
      });
    });
  }
}

// 创建单例实例
export const practiceService = new PracticeService();
