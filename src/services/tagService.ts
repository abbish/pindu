import { BaseService } from './baseService';
import type { ApiResult } from '@/types';
import type { MaterialKind, MaterialSettings, Tag, TagUsage, WordMaterial, WordMaterialCount } from '@/types/material';

/** 标签或素材的标签变了（侧边栏「标签」与标签页据此刷新数量），见 hooks/useTagUsage */
export const TAGS_CHANGED_EVENT = 'pindu:tags-changed';

/** 改动成功后通知一次 */
function notifyOnSuccess<T>(result: ApiResult<T>): ApiResult<T> {
  if (result.success) window.dispatchEvent(new Event(TAGS_CHANGED_EVENT));
  return result;
}

/** 素材关联：标签（词汇本 / 短文 / 视频共用）与单词 ↔ 素材 */
class TagService extends BaseService {
  /** 全部标签与各类素材的数量 */
  async getTags(): Promise<ApiResult<TagUsage[]>> {
    return this.executeWithLoading(() => this.client.invoke<TagUsage[]>('get_tags'));
  }

  /** 新建标签（同名已存在时返回已有的） */
  async createTag(name: string): Promise<ApiResult<Tag>> {
    return notifyOnSuccess(await this.executeWithLoading(() => this.client.invoke<Tag>('create_tag', { name })));
  }

  /** 改名；与另一个标签同名时合并进那个标签，返回最终的标签 */
  async renameTag(tagId: number, name: string): Promise<ApiResult<Tag>> {
    return notifyOnSuccess(await this.executeWithLoading(() => this.client.invoke<Tag>('rename_tag', { tagId, name })));
  }

  /** 删除标签（素材不受影响） */
  async deleteTag(tagId: number): Promise<ApiResult<void>> {
    return notifyOnSuccess(await this.executeWithLoading(() => this.client.invoke<void>('delete_tag', { tagId })));
  }

  /** 批量给多个素材加 / 去标签；返回改了几个 */
  async updateMaterialTags(kind: MaterialKind, refIds: number[], addTagIds: number[], removeTagIds: number[]): Promise<ApiResult<number>> {
    return notifyOnSuccess(await this.executeWithLoading(() => this.client.invoke<number>('update_material_tags', { kind, refIds, addTagIds, removeTagIds })));
  }

  /** 整体设置一个素材的标签 */
  async setMaterialTags(kind: MaterialKind, refId: number, tagIds: number[]): Promise<ApiResult<Tag[]>> {
    return notifyOnSuccess(await this.executeWithLoading(() => this.client.invoke<Tag[]>('set_material_tags', { kind, refId, tagIds })));
  }

  /** 素材处理的默认值（「设置 → 素材」） */
  async getMaterialSettings(): Promise<ApiResult<MaterialSettings>> {
    return this.executeWithLoading(() => this.client.invoke<MaterialSettings>('get_material_settings'));
  }

  async saveMaterialSettings(settings: MaterialSettings): Promise<ApiResult<MaterialSettings>> {
    return this.executeWithLoading(() => this.client.invoke<MaterialSettings>('save_material_settings', { settings }));
  }

  /** 一个词出现在哪些短文 / 视频切片里（重点词在前） */
  async getWordMaterials(word: string, wordId?: number): Promise<ApiResult<WordMaterial[]>> {
    return this.executeWithLoading(() => this.client.invoke<WordMaterial[]>('get_word_materials', { word, wordId }));
  }

  /** 词汇本里每个词出现过的短文数与切片数 */
  async getBookWordMaterials(bookId: number): Promise<ApiResult<WordMaterialCount[]>> {
    return this.executeWithLoading(() => this.client.invoke<WordMaterialCount[]>('get_book_word_materials', { bookId }));
  }
}

export const tagService = new TagService();
