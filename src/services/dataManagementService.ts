import { BaseService } from './baseService';
import type { 
  DatabaseOverview,
  ResetResult,
  LoadingState,
  ApiResult 
} from '../types';

/**
 * 数据管理服务
 * 处理数据库统计和重置相关操作
 */
export class DataManagementService extends BaseService {
  /**
   * 获取数据库统计信息
   */
  async getDatabaseStatistics(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<DatabaseOverview>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<DatabaseOverview>('get_database_statistics', {});
    }, setLoading);
  }

  /**
   * 重置用户数据（保留配置数据）
   */
  async resetUserData(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<ResetResult>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<ResetResult>('reset_user_data', {});
    }, setLoading);
  }

  /**
   * 选择性重置指定的数据表
   */
  async resetSelectedTables(
    tableNames: string[],
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<ResetResult>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<ResetResult>('reset_selected_tables', {
        tableNames: tableNames
      });
    }, setLoading);
  }

  /**
   * 删除数据库文件并重启应用程序
   * 注意：此操作会立即重启应用，无法获取返回结果
   */
  async deleteDatabaseAndRestart(
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('delete_database_and_restart', {});
    }, setLoading);
  }
}

// 导出服务实例
export const dataManagementService = new DataManagementService();
