import { BaseService } from './baseService';
import type {
  CalendarMonthRequest,
  CalendarMonthResponse,
  TodayStudySchedule,
  LoadingState,
  ApiResult
} from '../types';

/**
 * 日历服务类
 * 处理日历相关的数据获取和管理
 */
export class CalendarService extends BaseService {
  /**
   * 获取指定月份的日历数据
   */
  async getMonthData(
    request: CalendarMonthRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<CalendarMonthResponse>> {
    return this.executeWithLoading(async () => {
      // 验证必填字段
      this.validateRequired(request, ['year', 'month']);

      if (request.month < 1 || request.month > 12) {
        throw new Error('月份必须在1-12之间');
      }

      if (request.year < 1970 || request.year > 9999) {
        throw new Error('年份必须在1970-9999之间');
      }

      return this.client.invoke<CalendarMonthResponse>('get_calendar_month_data', {
        year: request.year,
        month: request.month,
        includeOtherMonths: request.includeOtherMonths ?? true
      });
    }, setLoading);
  }

  /**
   * 获取今日学习日程清单
   */
  async getTodayStudySchedules(): Promise<ApiResult<TodayStudySchedule[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<TodayStudySchedule[]>('get_today_study_schedules', {});
    });
  }
}

// 导出单例实例
export const calendarService = new CalendarService();
