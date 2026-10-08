import { BaseService } from './baseService';
import {
  AnalyzedWord,
  StudyPlanWithProgress,
  WordBook,
  CreateWordBookRequest,
  UpdateWordBookRequest,
  Word,
  WordExample,
  CreateWordRequest,
  UpdateWordRequest,
  WordQuery,
  PaginationQuery,
  PaginatedResponse,
  WordBookStatistics,
  WordTypeDistribution,
  WordSaveResult,
  ThemeTag,
  Id,
  ApiResult,
} from '../types';

/**
 * 单词本服务
 */
export class WordBookService extends BaseService {

  /**
   * 获取所有单词本
   */
  async getAllWordBooks(includeDeleted: boolean = false, status?: string): Promise<ApiResult<WordBook[]>> {
    return this.executeWithLoading(async () => {
      // Tauri 只转换顶层参数名：必须传 camelCase（原来的 include_deleted 会被静默忽略）
      return this.client.invoke<WordBook[]>('get_word_books', { includeDeleted, status });
    });
  }

  /**
   * 根据 ID 获取单词本详情
   */
  async getWordBookById(id: Id): Promise<ApiResult<WordBook>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ id }, ['id']);

      return this.client.invoke<WordBook>('get_word_book_detail', { bookId: id });
    });
  }

  /**
   * 获取单词本关联的学习计划
   */
  async getWordBookLinkedPlans(id: Id): Promise<ApiResult<StudyPlanWithProgress[]>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ id }, ['id']);

      return this.client.invoke<StudyPlanWithProgress[]>('get_word_book_linked_plans', { bookId: id });
    });
  }

  /**
   * 创建单词本
   */
  async createWordBook(request: CreateWordBookRequest): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      this.validateRequired(request, ['title']);

      return this.client.invoke<Id>('create_word_book', { request });
    });
  }

  /**
   * 更新单词本
   */
  async updateWordBook(
    id: Id,
    request: UpdateWordBookRequest
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ id }, ['id']);

      return this.client.invoke<void>('update_word_book', { bookId: id, request });
    });
  }

  /**
   * 删除单词本
   */
  /** 恢复已删除的单词本（回到正式状态） */
  async restoreWordBook(id: Id): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => this.client.invoke<void>('restore_word_book', { bookId: id }));
  }

  async deleteWordBook(id: Id): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ id }, ['id']);

      return this.client.invoke<void>('delete_word_book', { bookId: id });
    });
  }

  /**
   * 获取单词本中的单词
   */
  async getWordsByBookId(
    bookId: Id,
    query?: WordQuery,
    pagination?: PaginationQuery
  ): Promise<ApiResult<PaginatedResponse<Word>>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ bookId }, ['bookId']);

      // 参数键必须是 camelCase：Tauri 只把 camelCase 映射到 Rust 的 snake_case 参数
      return this.client.invoke<PaginatedResponse<Word>>('get_words_by_book', {
        bookId,
        page: pagination?.page,
        pageSize: pagination?.page_size,
        searchTerm: query?.keyword,
        partOfSpeech: query?.part_of_speech,
      });
    });
  }

  /**
   * AI 补充（append）或重新生成（replace）单词例句，返回该单词最新的全部例句
   */
  async generateWordExamples(
    wordId: Id,
    mode: 'append' | 'replace'
  ): Promise<ApiResult<WordExample[]>> {
    return this.executeWithLoading(
      () => this.client.invoke<WordExample[]>('generate_word_examples', { wordId, mode })
    );
  }

  /**
   * 添加单词到单词本
   */
  async addWordToBook(
    bookId: Id,
    wordData: CreateWordRequest
  ): Promise<ApiResult<Id>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ bookId }, ['bookId']);
      this.validateRequired(wordData, ['word', 'meaning']);

      return this.client.invoke<Id>('add_word_to_book', {
        bookId: bookId,
        wordData: wordData
      });
    });
  }

  /**
   * 更新单词
   */
  async updateWord(
    wordId: Id,
    wordData: UpdateWordRequest
  ): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ wordId }, ['wordId']);

      return this.client.invoke<void>('update_word', {
        wordId: wordId,
        wordData: wordData
      });
    });
  }

  /**
   * 删除单词
   */
  /** 这些单词里哪些已经在单词本中（忽略大小写），返回小写形式 */
  async findExistingWords(bookId: Id, words: string[]): Promise<ApiResult<string[]>> {
    return this.executeWithLoading(() => this.client.invoke<string[]>('find_existing_words', { bookId, words }));
  }

  /** 批量删除同一单词本内的单词（后端单事务：要么全删，要么都不删），返回实际删除数 */
  async deleteWords(bookId: Id, wordIds: Id[]): Promise<ApiResult<number>> {
    return this.executeWithLoading(
      () => this.client.invoke<number>('delete_words', { bookId, wordIds })
    );
  }

  /**
   * 获取单词本统计信息
   */
  async getWordBookStatistics(): Promise<ApiResult<WordBookStatistics>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<WordBookStatistics>('get_global_word_book_statistics');
    });
  }

  /**
   * 获取所有主题标签
   */
  /** 新建主题标签（名称 1–10 个字；同名已存在时返回已有的） */
  async createThemeTag(name: string, icon?: string): Promise<ApiResult<ThemeTag>> {
    return this.executeWithLoading(() => this.client.invoke<ThemeTag>('create_theme_tag', { name, icon }));
  }

  async getThemeTags(): Promise<ApiResult<ThemeTag[]>> {
    return this.executeWithLoading(async () => {
      return this.client.invoke<ThemeTag[]>('get_theme_tags');
    });
  }

  /**
   * 获取单词本词性统计
   */
  async getWordBookTypeStatistics(bookId: Id): Promise<ApiResult<WordTypeDistribution>> {
    return this.executeWithLoading(async () => {
      this.validateRequired({ bookId }, ['bookId']);

      return this.client.invoke<WordTypeDistribution>('get_word_book_statistics', {
        bookId: bookId
      });
    });
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
      words: AnalyzedWord[];
      status?: string;
      book_id?: Id; // 如果提供，则向现有单词本添加单词
      theme_tag_ids?: number[]; // 主题标签ID列表
    }): Promise<ApiResult<WordSaveResult>> {
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
    });
  }
}

/** 模块级单例：组件中直接使用，不要 `new WordBookService()` */
export const wordBookService = new WordBookService();
