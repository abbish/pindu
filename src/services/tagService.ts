import { BaseService } from './baseService';
import type { ApiResult } from '@/types';
import type { MaterialKind, Tag, TagUsage, WordMaterial, WordMaterialCount } from '@/types/material';

/** 素材关联：标签（单词本 / 短文 / 视频共用）与单词 ↔ 素材 */
class TagService extends BaseService {
  /** 全部标签与各类素材的数量 */
  async getTags(): Promise<ApiResult<TagUsage[]>> {
    return this.executeWithLoading(() => this.client.invoke<TagUsage[]>('get_tags'));
  }

  /** 新建标签（同名已存在时返回已有的） */
  async createTag(name: string, icon?: string): Promise<ApiResult<Tag>> {
    return this.executeWithLoading(() => this.client.invoke<Tag>('create_tag', { name, icon }));
  }

  /** 改名；与另一个标签同名时合并进那个标签，返回最终的标签 */
  async renameTag(tagId: number, name: string): Promise<ApiResult<Tag>> {
    return this.executeWithLoading(() => this.client.invoke<Tag>('rename_tag', { tagId, name }));
  }

  /** 删除标签（素材不受影响） */
  async deleteTag(tagId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('delete_tag', { tagId }));
  }

  /** 批量给多个素材加 / 去标签；返回改了几个 */
  async updateMaterialTags(kind: MaterialKind, refIds: number[], addTagIds: number[], removeTagIds: number[]): Promise<ApiResult<number>> {
    return this.executeWithLoading(() => this.client.invoke<number>('update_material_tags', { kind, refIds, addTagIds, removeTagIds }));
  }

  /** 整体设置一个素材的标签 */
  async setMaterialTags(kind: MaterialKind, refId: number, tagIds: number[]): Promise<ApiResult<Tag[]>> {
    return this.executeWithLoading(() => this.client.invoke<Tag[]>('set_material_tags', { kind, refId, tagIds }));
  }

  /** 一个词出现在哪些短文 / 视频切片里（重点词在前） */
  async getWordMaterials(word: string, wordId?: number): Promise<ApiResult<WordMaterial[]>> {
    return this.executeWithLoading(() => this.client.invoke<WordMaterial[]>('get_word_materials', { word, wordId }));
  }

  /** 单词本里每个词出现过的短文数与切片数 */
  async getBookWordMaterials(bookId: number): Promise<ApiResult<WordMaterialCount[]>> {
    return this.executeWithLoading(() => this.client.invoke<WordMaterialCount[]>('get_book_word_materials', { bookId }));
  }
}

export const tagService = new TagService();
