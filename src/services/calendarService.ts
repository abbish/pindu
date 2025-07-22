import { BaseService } from './baseService';
import type {
  CalendarMonthRequest,
  CalendarMonthResponse,
  CalendarDayData,
  CalendarMonthlyStats,
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

      if (request.year < 2020 || request.year > 2030) {
        throw new Error('年份必须在2020-2030之间');
      }

      return this.client.invoke<CalendarMonthResponse>('get_calendar_month_data', {
        year: request.year,
        month: request.month,
        includeOtherMonths: request.includeOtherMonths ?? true
      });
    }, setLoading);
  }

  /**
   * 获取当前月份的日历数据
   */
  async getCurrentMonthData(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<CalendarMonthResponse>> {
    const now = new Date();
    return this.getMonthData({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      includeOtherMonths: true
    }, setLoading);
  }

  /**
   * 获取指定日期的详细数据
   */
  async getDayDetail(
    date: string,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<CalendarDayData | null>> {
    return this.executeWithLoading(async () => {
      // 验证日期格式
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('日期格式必须为YYYY-MM-DD');
      }

      const dateObj = new Date(date);
      const year = dateObj.getFullYear();
      const month = dateObj.getMonth() + 1;

      // 获取该月的数据，然后找到指定日期
      const monthResult = await this.getMonthData({ year, month, includeOtherMonths: false });
      
      if (!monthResult.success) {
        throw new Error(monthResult.error);
      }

      return this.client.invoke<CalendarDayData | null>('get_calendar_day_detail', { date });
    }, setLoading);
  }

  /**
   * 获取今日的学习数据
   */
  async getTodayData(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<CalendarDayData | null>> {
    const today = new Date().toISOString().split('T')[0];
    return this.getDayDetail(today, setLoading);
  }

  /**
   * 获取今日学习日程清单
   */
  async getTodayStudySchedules(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<TodayStudySchedule[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<TodayStudySchedule[]>('get_today_study_schedules', {});
    }, setLoading);
  }

  /**
   * 获取月度统计数据
   */
  async getMonthlyStats(
    year: number,
    month: number,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<CalendarMonthlyStats>> {
    return this.executeWithLoading(async () => {
      const monthResult = await this.getMonthData({ year, month, includeOtherMonths: false });
      
      if (!monthResult.success) {
        throw new Error(monthResult.error);
      }

      return this.client.invoke<CalendarMonthlyStats>('get_calendar_monthly_stats', { year, month });
    }, setLoading);
  }

  /**
   * 获取学习连续天数
   */
  async getStudyStreak(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<number>> {
    return this.executeWithLoading(async () => {
      const now = new Date();
      const currentMonthResult = await this.getMonthData({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        includeOtherMonths: false
      });

      if (!currentMonthResult.success) {
        throw new Error(currentMonthResult.error);
      }

      // 简单计算连续天数（从今天往前数）
      const today = now.toISOString().split('T')[0];
      const days = currentMonthResult.data.days.sort((a, b) => a.date.localeCompare(b.date));
      
      let streak = 0;
      let currentDate = new Date(today);
      
      while (true) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayData = days.find(day => day.date === dateStr);
        
        if (!dayData || dayData.status !== 'completed') {
          break;
        }
        
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
        
        // 防止无限循环，最多查找30天
        if (streak >= 30) break;
      }

      return this.client.invoke<number>('get_study_streak', {});
    }, setLoading);
  }

  /**
   * 格式化日期为显示文本
   */
  formatDate(date: string): string {
    const dateObj = new Date(date);
    return dateObj.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * 格式化月份为显示文本
   */
  formatMonth(year: number, month: number): string {
    return `${year}年${month}月`;
  }

  /**
   * 获取日期的状态颜色
   */
  getStatusColor(status: CalendarDayData['status']): string {
    switch (status) {
      case 'completed':
        return 'var(--color-success)';
      case 'in-progress':
        return 'var(--color-warning)';
      case 'overdue':
        return 'var(--color-error)';
      case 'not-started':
      default:
        return 'var(--color-text-tertiary)';
    }
  }

  /**
   * 获取日期的状态图标
   */
  getStatusIcon(status: CalendarDayData['status']): string {
    switch (status) {
      case 'completed':
        return 'fa-check-circle';
      case 'in-progress':
        return 'fa-clock';
      case 'overdue':
        return 'fa-exclamation-triangle';
      case 'not-started':
      default:
        return 'fa-calendar';
    }
  }

  /**
   * 获取日期的状态文本
   */
  getStatusText(status: CalendarDayData['status']): string {
    switch (status) {
      case 'completed':
        return '已完成';
      case 'in-progress':
        return '进行中';
      case 'overdue':
        return '逾期';
      case 'not-started':
      default:
        return '未开始';
    }
  }

  /**
   * 检查是否为今天
   */
  isToday(date: string): boolean {
    const today = new Date().toISOString().split('T')[0];
    return date === today;
  }

  /**
   * 检查是否为当前月份
   */
  isCurrentMonth(date: string, year: number, month: number): boolean {
    const dateObj = new Date(date);
    return dateObj.getFullYear() === year && dateObj.getMonth() + 1 === month;
  }
}

// 导出单例实例
export const calendarService = new CalendarService();
export default calendarService;
