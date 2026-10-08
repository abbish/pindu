import { BaseService } from './baseService';
import type {
  DatabaseOverview,
  ResetResult,
  ApiResult,
  StartupStatus,
} from '../types';

/**
 * 数据管理服务
 * 处理数据库统计和重置相关操作
 */
export class DataManagementService extends BaseService {
  /**
   * 获取数据库统计信息
   */
  async getDatabaseStatistics(): Promise<ApiResult<DatabaseOverview>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<DatabaseOverview>('get_database_statistics', {});
    });
  }

  /**
   * 重置用户数据（保留配置数据）
   */
  async resetUserData(): Promise<ApiResult<ResetResult>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<ResetResult>('reset_user_data', {});
    });
  }

  /**
   * 选择性重置指定的数据表
   */
  async resetSelectedTables(tableNames: string[]): Promise<ApiResult<ResetResult>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<ResetResult>('reset_selected_tables', {
        tableNames: tableNames
      });
    });
  }

  /**
   * 删除数据库文件并重启应用程序
   * 注意：此操作会立即重启应用，无法获取返回结果
   */
  async deleteDatabaseAndRestart(): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('delete_database_and_restart', {});
    });
  }

  /**
   * 读取应用日志（app.log 的最近若干行，每行通常为 JSON）
   */
  /** 最近的系统日志（每行一条 JSON，最新在前）；limit 默认 300，最多 2000 */
  async getSystemLogs(limit?: number): Promise<ApiResult<string[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<string[]>('get_system_logs', { limit });
    });
  }

  /** 启动状态：数据库打开并升级成功为 ok，否则带原因（App 据此只显示错误页） */
  async getStartupStatus(): Promise<ApiResult<StartupStatus>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<StartupStatus>('get_startup_status');
    });
  }

  /** 在访达 / 资源管理器中打开数据文件夹（数据库、升级备份、日志） */
  async openDataFolder(): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('open_data_folder');
    });
  }

  /** 在访达 / 资源管理器中打开日志文件夹（反馈问题时附上日志） */
  async openLogFolder(): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('open_log_folder');
    });
  }
}

// 导出服务实例
export const dataManagementService = new DataManagementService();
