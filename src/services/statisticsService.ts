import { BaseService } from './baseService';
import { STATISTICS_ENDPOINTS } from '../api/endpoints';
import {
  StudyStatistics,
  WordBookStatistics,
  ApiResult,
  LoadingState,
} from '../types';

/**
 * 统计服务
 */
export class StatisticsService extends BaseService {
  /**
   * 获取学习统计
   */
  async getStudyStatistics(setLoading?: (state: LoadingState) => void): Promise<ApiResult<StudyStatistics>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StudyStatistics>(STATISTICS_ENDPOINTS.GET_STUDY_STATS);
    }, setLoading);
  }

  /**
   * 获取单词本统计
   */
  async getWordBookStatistics(setLoading?: (state: LoadingState) => void): Promise<ApiResult<WordBookStatistics>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<WordBookStatistics>(STATISTICS_ENDPOINTS.GET_WORDBOOK_STATS);
    }, setLoading);
  }
}

// 创建全局服务实例
export const statisticsService = new StatisticsService();

// 默认导出服务类
export default StatisticsService;
