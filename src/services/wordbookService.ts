import { BaseService } from './baseService';
import {
  WordBook,
  CreateWordBookRequest,
  UpdateWordBookRequest,
  WordBookQuery,
  Word,
  CreateWordRequest,
  UpdateWordRequest,
  WordQuery,
  AnalysisProgress,
  PaginationQuery,
  PaginatedResponse,
  WordBookStatistics,
  WordTypeDistribution,
  WordSaveResult,
  ThemeTag,
  Id,
  ApiResult,
  LoadingState,
} from '../types';

/**
 * 单词本服务
 */
export class WordBookService extends BaseService {

  /**
   * 获取所有单词本
   */
  async getAllWordBooks(includeDeleted: boolean = false, status?: string, setLoading?: (state: LoadingState) => void): Promise<ApiResult<WordBook[]>> {
    return this.executeWithLoading(async () => {
      const params: any = { include_deleted: includeDeleted };
      if (status) {
        params.status = status;
      }
      return this.client.invoke<WordBook[]>('get_word_books', params);
    }, setLoading);
  }

  /**
   * 根据查询条件获取单词本
   */
  async getWordBooks(
    query: WordBookQuery,
    pagination?: PaginationQuery,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<PaginatedResponse<WordBook>>> {
    return this.executeWithLoading(async () => {
      // 获取所有单词本
      const allWordBooksResult = await this.client.invoke<WordBook[]>('get_word_books');

      if (!allWordBooksResult.success) {
        throw new Error(allWordBooksResult.error || '获取单词本失败');
      }

      // 前端过滤
      let filteredBooks = allWordBooksResult.data;

      if (query.keyword) {
        filteredBooks = filteredBooks.filter(book =>
          book.title.toLowerCase().includes(query.keyword!.toLowerCase()) ||
          book.description.toLowerCase().includes(query.keyword!.toLowerCase())
        );
      }

      if (query.icon_color) {
        filteredBooks = filteredBooks.filter(book => book.icon_color === query.icon_color);
      }

      // 前端分页
      const page = pagination?.page || 1;
      const pageSize = pagination?.page_size || 20;
      const total = filteredBooks.length;
      const totalPages = Math.ceil(total / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const data = filteredBooks.slice(startIndex, endIndex);

      return {
        success: true,
        data: {
          data,
          total,
          page,
          page_size: pageSize,
          total_pages: totalPages,
        }
      };
    }, setLoading);
  }

  /**
   * 根据 ID 获取单词本详情
   */
  async getWordBookById(id: Id, setLoading?: (state: LoadingState) => void): Promise<ApiResult<WordBook>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ id }, ['id']);

      return this.client.invoke<WordBook>('get_word_book_detail', { bookId: id });
    }, setLoading);
  }

  /**
   * 获取单词本关联的学习计划
   */
  async getWordBookLinkedPlans(id: Id, setLoading?: (state: LoadingState) => void): Promise<ApiResult<any[]>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ id }, ['id']);

      return this.client.invoke<any[]>('get_word_book_linked_plans', { bookId: id });
    }, setLoading);
  }

  /**
   * 创建单词本
   */
  async createWordBook(
    request: CreateWordBookRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      this.validateRequired(request, ['title']);

      return this.client.invoke<Id>('create_word_book', { request });
    }, setLoading);
  }

  /**
   * 更新单词本
   */
  async updateWordBook(
    id: Id,
    request: UpdateWordBookRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ id }, ['id']);

      return this.client.invoke<void>('update_word_book', { bookId: id, request });
    }, setLoading);
  }

  /**
   * 删除单词本
   */
  async deleteWordBook(id: Id, setLoading?: (state: LoadingState) => void): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ id }, ['id']);

      return this.client.invoke<void>('delete_word_book', { bookId: id });
    }, setLoading);
  }

  /**
   * 获取单词本中的单词
   */
  async getWordsByBookId(
    bookId: Id,
    query?: WordQuery,
    pagination?: PaginationQuery,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<PaginatedResponse<Word>>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ bookId }, ['bookId']);

      const page = pagination?.page;
      const page_size = pagination?.page_size;
      const search_term = query?.keyword;
      const part_of_speech = query?.part_of_speech;

      return this.client.invoke<PaginatedResponse<Word>>('get_words_by_book', {
        bookId: bookId,
        page,
        page_size,
        search_term,
        part_of_speech
      });
    }, setLoading);
  }

  /**
   * 添加单词到单词本
   */
  async addWordToBook(
    bookId: Id,
    wordData: CreateWordRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ bookId }, ['bookId']);
      this.validateRequired(wordData, ['word', 'meaning']);

      return this.client.invoke<Id>('add_word_to_book', {
        bookId: bookId,
        wordData: wordData
      });
    }, setLoading);
  }

  /**
   * 更新单词
   */
  async updateWord(
    wordId: Id,
    wordData: UpdateWordRequest,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ wordId }, ['wordId']);

      return this.client.invoke<void>('update_word', {
        wordId: wordId,
        wordData: wordData
      });
    }, setLoading);
  }

  /**
   * 删除单词
   */
  async deleteWord(wordId: Id, setLoading?: (state: LoadingState) => void): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ wordId }, ['wordId']);

      return this.client.invoke<void>('delete_word', { wordId: wordId });
    }, setLoading);
  }

  /**
   * 获取单词本统计信息
   */
  async getWordBookStatistics(setLoading?: (state: LoadingState) => void): Promise<ApiResult<WordBookStatistics>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<WordBookStatistics>('get_global_word_book_statistics');
    }, setLoading);
  }

  /**
   * 更新所有单词本的单词数量
   */
  async updateAllWordBookCounts(setLoading?: (state: LoadingState) => void): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('update_all_word_book_counts');
    }, setLoading);
  }

  /**
   * 获取所有主题标签
   */
  async getThemeTags(setLoading?: (state: LoadingState) => void): Promise<ApiResult<ThemeTag[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<ThemeTag[]>('get_theme_tags');
    }, setLoading);
  }

  /**
   * 获取单词本词性统计
   */
  async getWordBookTypeStatistics(
    bookId: Id,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<WordTypeDistribution>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ bookId }, ['bookId']);

      return this.client.invoke<WordTypeDistribution>('get_word_book_statistics', {
        bookId: bookId
      });
    }, setLoading);
  }

  /**
   * 分析文本并提取词汇
   */
  async analyzeTextForVocabulary(
    text: string,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<any>> {
    return this.executeWithLoading(async () => {
      // 验证输入
      if (!text || text.trim().length === 0) {
        throw new Error('文本内容不能为空');
      }

      if (text.length > 10000) {
        throw new Error('文本内容过长，请限制在10000字符以内');
      }

      return this.client.invoke<any>('analyze_text_for_vocabulary', { text });
    }, setLoading);
  }

  /**
   * 从分析结果创建单词本
   */
  async createWordBookFromAnalysis(
    request: {
      title: string;
      description: string;
      icon?: string;
      icon_color?: string;
      words: any[];
      status?: string;
      book_id?: Id; // 如果提供，则向现有单词本添加单词
      theme_tag_ids?: number[]; // 主题标签ID列表
    },
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<WordSaveResult>> {
    return this.executeWithLoading(async () => {
      // 验证输入
      this.validateRequired(request, ['title', 'words']);

      if (request.words.length === 0) {
        throw new Error('单词本必须包含至少一个单词');
      }

      return this.client.invoke<{
        book_id: Id;
        added_count: number;
        updated_count: number;
        skipped_count: number;
      }>('create_word_book_from_analysis', { request });
    }, setLoading);
  }

  /**
   * 获取分析进度
   */
  async getAnalysisProgress(): Promise<ApiResult<AnalysisProgress | null>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<AnalysisProgress | null>('get_analysis_progress');
    });
  }

  /**
   * 清除分析进度
   */
  async clearAnalysisProgress(): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('clear_analysis_progress');
    });
  }

  /**
   * 取消分析
   */
  async cancelAnalysis(): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<void>('cancel_analysis');
    });
  }
}
