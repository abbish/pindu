import { BaseService } from './baseService';
import type { ApiResult } from '../types';
import type { MaterialText, ReadMaterialRequest } from '../types/passage';

/** 用户资料：把文件读成清理过的纯文本（单词本「从我的材料提取」与短文「从我的材料导入」共用） */
class MaterialService extends BaseService {
  async readFile(request: ReadMaterialRequest): Promise<ApiResult<MaterialText>> {
    return this.executeWithLoading(() => this.client.invoke<MaterialText>('read_material_file', { request }));
  }
}

export const materialService = new MaterialService();
